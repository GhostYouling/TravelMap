import archiver from "archiver";
import Database from "better-sqlite3";
import express from "express";
import { fileTypeFromFile } from "file-type";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import multer from "multer";
import sharp from "sharp";

const DEFAULT_PAGE_SIZE = 18;
const MAX_PAGE_SIZE = 48;
const COLORS = ["#ef8354", "#f2c14e", "#79c5b4", "#d991ba", "#9ab6e5", "#d7a86e"];
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
]);

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function readBoolean(value, fallback = false) {
  if (value == null) return fallback;
  return String(value).toLowerCase() === "true";
}

function safeTokenEqual(received, expected) {
  const left = Buffer.from(received || "");
  const right = Buffer.from(expected || "");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function mapTrip(row) {
  return {
    id: row.id,
    title: row.title,
    locationName: row.location_name,
    latitude: row.latitude,
    longitude: row.longitude,
    startDate: row.start_date,
    endDate: row.end_date,
    story: row.story,
    color: row.color,
    mediaCount: row.media_count || 0,
    photoCount: row.photo_count || 0,
    videoCount: row.video_count || 0,
    totalBytes: row.total_bytes || 0,
    coverMediaId: row.cover_media_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMedia(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    kind: row.mime_type.startsWith("image/") ? "image" : "video",
    size: row.size,
    width: row.width,
    height: row.height,
    hasThumbnail: Boolean(row.thumbnail_name),
    createdAt: row.created_at,
  };
}

function initializeDatabase(db, seedDemo) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      location_name TEXT NOT NULL,
      latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
      longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
      start_date TEXT NOT NULL,
      end_date TEXT,
      story TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      thumbnail_name TEXT,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS media_trip_created_idx ON media(trip_id, created_at DESC, id DESC);
  `);

  if (seedDemo && db.prepare("SELECT COUNT(*) AS count FROM trips").get().count === 0) {
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO trips (id, title, location_name, latitude, longitude, start_date, end_date, story, color, created_at, updated_at)
      VALUES (@id, @title, @locationName, @latitude, @longitude, @startDate, @endDate, @story, @color, @createdAt, @updatedAt)
    `);
    const demoTrips = [
      { id: "demo-hokkaido", title: "雪落北海道", locationName: "日本 · 小樽", latitude: 43.1907, longitude: 140.9947, startDate: "2025-02-08", endDate: "2025-02-14", story: "海风穿过旧仓库，雪落在运河边。等你上传第一张照片，这段旅程就会真正亮起来。", color: COLORS[0] },
      { id: "demo-yunnan", title: "山风与古城", locationName: "中国 · 云南大理", latitude: 25.6065, longitude: 100.2676, startDate: "2024-10-02", endDate: "2024-10-07", story: "沿着洱海慢慢走，把苍山的云和巷子里的黄昏留在这里。", color: COLORS[1] },
      { id: "demo-iceland", title: "北纬六十四度", locationName: "冰岛 · 雷克雅未克", latitude: 64.1466, longitude: -21.9426, startDate: "2024-03-16", endDate: "2024-03-24", story: "黑沙滩、风和一场迟来的极光。地球转到这一边时，故事又被看见。", color: COLORS[2] },
    ];
    const seed = db.transaction((trips) => trips.forEach((trip) => insert.run({ ...trip, createdAt: now, updatedAt: now })));
    seed(demoTrips);
  }
}

function tripSelectSql(where = "") {
  return `
    SELECT t.*,
      COUNT(m.id) AS media_count,
      COALESCE(SUM(CASE WHEN m.mime_type LIKE 'image/%' THEN 1 ELSE 0 END), 0) AS photo_count,
      COALESCE(SUM(CASE WHEN m.mime_type LIKE 'video/%' THEN 1 ELSE 0 END), 0) AS video_count,
      COALESCE(SUM(m.size), 0) AS total_bytes,
      (
        SELECT mi.id FROM media mi
        WHERE mi.trip_id = t.id AND mi.thumbnail_name IS NOT NULL
        ORDER BY mi.created_at DESC, mi.id DESC LIMIT 1
      ) AS cover_media_id
    FROM trips t
    LEFT JOIN media m ON m.trip_id = t.id
    ${where}
    GROUP BY t.id
  `;
}

function validateTrip(payload) {
  const title = String(payload.title || "").trim();
  const locationName = String(payload.locationName || "").trim();
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  const startDate = String(payload.startDate || "").trim();
  const endDate = payload.endDate ? String(payload.endDate).trim() : null;
  const story = String(payload.story || "").trim();
  if (!title || title.length > 80) throw new Error("旅程名称应为 1–80 个字符");
  if (!locationName || locationName.length > 100) throw new Error("地点名称应为 1–100 个字符");
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error("纬度应在 -90 到 90 之间");
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error("经度应在 -180 到 180 之间");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error("请选择出发日期");
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error("结束日期格式不正确");
  if (endDate && endDate < startDate) throw new Error("结束日期不能早于出发日期");
  if (story.length > 4000) throw new Error("旅行手记不能超过 4000 个字符");
  return { title, locationName, latitude, longitude, startDate, endDate, story };
}

export function createApp(options = {}) {
  const cwd = options.cwd || process.cwd();
  const dataDir = path.resolve(cwd, options.dataDir || process.env.DATA_DIR || "data");
  const uploadDir = path.resolve(cwd, options.uploadDir || process.env.UPLOAD_DIR || "uploads");
  const thumbnailDir = path.resolve(cwd, options.thumbnailDir || process.env.THUMBNAIL_DIR || "thumbnails");
  const databasePath = options.databasePath || path.join(dataDir, "travelmap.db");
  const maxUploadMb = Number(options.maxUploadMb || process.env.MAX_UPLOAD_MB || 2048);
  const adminToken = options.adminToken ?? process.env.ADMIN_TOKEN ?? "";
  const seedDemo = options.seedDemo ?? readBoolean(process.env.SEED_DEMO, process.env.NODE_ENV !== "production");

  [dataDir, uploadDir, thumbnailDir].forEach(ensureDirectory);
  const db = new Database(databasePath);
  initializeDatabase(db, seedDemo);

  const app = express();
  app.disable("x-powered-by");
  app.use((_, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  const requireAdmin = (req, res, next) => {
    if (!adminToken || safeTokenEqual(req.get("x-admin-token"), adminToken)) return next();
    return res.status(401).json({ error: "管理口令不正确" });
  };

  const storage = multer.diskStorage({
    destination(req, _file, callback) {
      const trip = db.prepare("SELECT id FROM trips WHERE id = ?").get(req.params.tripId);
      if (!trip) return callback(new Error("旅程不存在"));
      const destination = path.join(uploadDir, req.params.tripId);
      ensureDirectory(destination);
      callback(null, destination);
    },
    filename(_req, _file, callback) {
      callback(null, `${randomUUID()}.upload`);
    },
  });
  const upload = multer({ storage, limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1 } });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, database: "ready", storage: "ready" });
  });

  app.get("/api/config", (_req, res) => {
    res.json({ maxUploadMb, writeProtected: Boolean(adminToken) });
  });

  app.get("/api/trips", (_req, res) => {
    const trips = db.prepare(`${tripSelectSql()} ORDER BY t.start_date DESC, t.created_at DESC`).all().map(mapTrip);
    const totals = db.prepare("SELECT COUNT(*) AS media_count, COALESCE(SUM(size), 0) AS total_bytes FROM media").get();
    res.json({ trips, totals: { tripCount: trips.length, mediaCount: totals.media_count, totalBytes: totals.total_bytes } });
  });

  app.get("/api/trips/:tripId", (req, res) => {
    const row = db.prepare(tripSelectSql("WHERE t.id = ?")).get(req.params.tripId);
    if (!row) return res.status(404).json({ error: "旅程不存在" });
    res.json({ trip: mapTrip(row) });
  });

  app.post("/api/trips", requireAdmin, (req, res) => {
    try {
      const trip = validateTrip(req.body);
      const id = randomUUID();
      const now = new Date().toISOString();
      const color = COLORS[db.prepare("SELECT COUNT(*) AS count FROM trips").get().count % COLORS.length];
      db.prepare(`
        INSERT INTO trips (id, title, location_name, latitude, longitude, start_date, end_date, story, color, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, trip.title, trip.locationName, trip.latitude, trip.longitude, trip.startDate, trip.endDate, trip.story, color, now, now);
      const row = db.prepare(tripSelectSql("WHERE t.id = ?")).get(id);
      res.status(201).json({ trip: mapTrip(row) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/trips/:tripId", requireAdmin, (req, res) => {
    try {
      const existing = db.prepare("SELECT id FROM trips WHERE id = ?").get(req.params.tripId);
      if (!existing) return res.status(404).json({ error: "旅程不存在" });
      const trip = validateTrip(req.body);
      db.prepare(`
        UPDATE trips SET title = ?, location_name = ?, latitude = ?, longitude = ?, start_date = ?, end_date = ?, story = ?, updated_at = ?
        WHERE id = ?
      `).run(trip.title, trip.locationName, trip.latitude, trip.longitude, trip.startDate, trip.endDate, trip.story, new Date().toISOString(), req.params.tripId);
      const row = db.prepare(tripSelectSql("WHERE t.id = ?")).get(req.params.tripId);
      res.json({ trip: mapTrip(row) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/trips/:tripId", requireAdmin, async (req, res, next) => {
    try {
      const result = db.prepare("DELETE FROM trips WHERE id = ?").run(req.params.tripId);
      if (!result.changes) return res.status(404).json({ error: "旅程不存在" });
      await Promise.all([
        fsp.rm(path.join(uploadDir, req.params.tripId), { recursive: true, force: true }),
        fsp.rm(path.join(thumbnailDir, req.params.tripId), { recursive: true, force: true }),
      ]);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/trips/:tripId/media", (req, res) => {
    const trip = db.prepare("SELECT id FROM trips WHERE id = ?").get(req.params.tripId);
    if (!trip) return res.status(404).json({ error: "旅程不存在" });
    const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(String(req.query.limit || DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
    const total = db.prepare("SELECT COUNT(*) AS count FROM media WHERE trip_id = ?").get(req.params.tripId).count;
    const rows = db.prepare("SELECT * FROM media WHERE trip_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").all(req.params.tripId, limit, (page - 1) * limit);
    res.json({ media: rows.map(mapMedia), page, limit, total, hasMore: page * limit < total });
  });

  app.post("/api/trips/:tripId/media", requireAdmin, (req, res, next) => {
    upload.single("file")(req, res, async (uploadError) => {
      if (uploadError) {
        const message = uploadError.code === "LIMIT_FILE_SIZE" ? `单个文件不能超过 ${maxUploadMb} MiB` : uploadError.message;
        return res.status(400).json({ error: message });
      }
      if (!req.file) return res.status(400).json({ error: "请选择照片或视频" });
      let finalPath = req.file.path;
      try {
        const detected = await fileTypeFromFile(req.file.path);
        if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
          await fsp.rm(req.file.path, { force: true });
          return res.status(415).json({ error: "不支持该文件格式，请上传常见照片或 MP4/WebM/MOV 视频" });
        }
        const id = path.basename(req.file.filename, ".upload");
        const storedName = `${id}.${detected.ext}`;
        finalPath = path.join(path.dirname(req.file.path), storedName);
        await fsp.rename(req.file.path, finalPath);
        let thumbnailName = null;
        let width = null;
        let height = null;
        if (detected.mime.startsWith("image/")) {
          try {
            const metadata = await sharp(finalPath).metadata();
            width = metadata.width || null;
            height = metadata.height || null;
            const tripThumbDir = path.join(thumbnailDir, req.params.tripId);
            ensureDirectory(tripThumbDir);
            thumbnailName = `${id}.webp`;
            await sharp(finalPath, { animated: false })
              .rotate()
              .resize(960, 720, { fit: "inside", withoutEnlargement: true })
              .webp({ quality: 78 })
              .toFile(path.join(tripThumbDir, thumbnailName));
          } catch {
            thumbnailName = null;
          }
        }
        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO media (id, trip_id, original_name, stored_name, thumbnail_name, mime_type, size, width, height, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, req.params.tripId, req.file.originalname.slice(0, 240), storedName, thumbnailName, detected.mime, req.file.size, width, height, now);
        db.prepare("UPDATE trips SET updated_at = ? WHERE id = ?").run(now, req.params.tripId);
        const row = db.prepare("SELECT * FROM media WHERE id = ?").get(id);
        res.status(201).json({ media: mapMedia(row) });
      } catch (error) {
        await fsp.rm(finalPath, { force: true }).catch(() => {});
        next(error);
      }
    });
  });

  function findMedia(req, res) {
    const media = db.prepare("SELECT * FROM media WHERE id = ?").get(req.params.mediaId);
    if (!media) res.status(404).json({ error: "媒体不存在" });
    return media;
  }

  app.get("/api/media/:mediaId/file", (req, res, next) => {
    const media = findMedia(req, res);
    if (!media) return;
    res.type(media.mime_type);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("Accept-Ranges", "bytes");
    res.sendFile(path.join(uploadDir, media.trip_id, media.stored_name), (error) => error && next(error));
  });

  app.get("/api/media/:mediaId/thumbnail", (req, res, next) => {
    const media = findMedia(req, res);
    if (!media) return;
    if (!media.thumbnail_name) return res.status(404).json({ error: "该媒体没有缩略图" });
    res.type("image/webp");
    res.setHeader("Cache-Control", "private, max-age=604800");
    res.sendFile(path.join(thumbnailDir, media.trip_id, media.thumbnail_name), (error) => error && next(error));
  });

  app.get("/api/media/:mediaId/download", (req, res, next) => {
    const media = findMedia(req, res);
    if (!media) return;
    res.download(path.join(uploadDir, media.trip_id, media.stored_name), media.original_name, (error) => error && next(error));
  });

  app.delete("/api/media/:mediaId", requireAdmin, async (req, res, next) => {
    try {
      const media = db.prepare("SELECT * FROM media WHERE id = ?").get(req.params.mediaId);
      if (!media) return res.status(404).json({ error: "媒体不存在" });
      db.prepare("DELETE FROM media WHERE id = ?").run(req.params.mediaId);
      const files = [fsp.rm(path.join(uploadDir, media.trip_id, media.stored_name), { force: true })];
      if (media.thumbnail_name) files.push(fsp.rm(path.join(thumbnailDir, media.trip_id, media.thumbnail_name), { force: true }));
      await Promise.all(files);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/trips/:tripId/download", (req, res, next) => {
    const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(req.params.tripId);
    if (!trip) return res.status(404).json({ error: "旅程不存在" });
    const media = db.prepare("SELECT * FROM media WHERE trip_id = ? ORDER BY created_at, id").all(req.params.tripId);
    const safeTitle = trip.title.replace(/[\\/:*?\"<>|]/g, "_").slice(0, 60) || "trip";
    res.attachment(`${safeTitle}.zip`);
    res.type("application/zip");
    const archive = archiver("zip", { zlib: { level: 1 } });
    archive.on("error", next);
    archive.pipe(res);
    media.forEach((item, index) => {
      const name = `${String(index + 1).padStart(3, "0")}-${item.original_name.replace(/[\\/]/g, "_")}`;
      archive.file(path.join(uploadDir, item.trip_id, item.stored_name), { name });
    });
    archive.append(`${trip.title}\n${trip.location_name}\n${trip.start_date}${trip.end_date ? ` 至 ${trip.end_date}` : ""}\n\n${trip.story}\n`, { name: "旅行手记.txt" });
    archive.finalize();
  });

  const distDir = path.join(cwd, "dist");
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, { maxAge: "1h", index: false }));
    const indexTemplate = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
      const configuredOrigin = String(process.env.SITE_URL || "").replace(/\/$/, "");
      const requestOrigin = `${req.protocol}://${req.get("host")}`;
      res.type("html").send(indexTemplate.replaceAll("__SITE_URL__", configuredOrigin || requestOrigin));
    });
  }

  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    console.error(error);
    res.status(500).json({ error: "服务暂时开小差了，请稍后重试" });
  });

  return {
    app,
    db,
    paths: { dataDir, uploadDir, thumbnailDir, databasePath },
    close() {
      db.close();
    },
  };
}
