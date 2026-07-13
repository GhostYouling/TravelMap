import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../server/app.js";

describe("迹屿 API", () => {
  let directory;
  let service;
  let tripId;
  let mediaId;
  let pngFixture;
  let viewerAgent;
  const geocodeCalls = [];

  beforeAll(async () => {
    pngFixture = await sharp({ create: { width: 4, height: 4, channels: 4, background: "#ef704e" } }).png().toBuffer();
    directory = await fsp.mkdtemp(path.join(os.tmpdir(), "jiyu-test-"));
    service = createApp({
      cwd: directory,
      databasePath: path.join(directory, "data", "test.db"),
      dataDir: "data",
      uploadDir: "uploads",
      thumbnailDir: "thumbnails",
      adminToken: "test-secret",
      sessionSecret: "test-session-secret",
      secureCookies: false,
      seedDemo: false,
      maxUploadMb: 5,
      geocodeSearch: async ({ query, countryCode }) => {
        geocodeCalls.push({ query, countryCode });
        return [{
          id: "1790645",
          name: "上海",
          country: "中国",
          countryCode: "CN",
          admin1: "上海",
          latitude: 31.22222,
          longitude: 121.45806,
        }];
      },
    });
    viewerAgent = request.agent(service.app);
  });

  afterAll(async () => {
    service.close();
    await fsp.rm(directory, { recursive: true, force: true });
  });

  it("报告数据库和存储健康状态", async () => {
    const response = await request(service.app).get("/api/health").expect(200);
    expect(response.body).toEqual({ ok: true, database: "ready", storage: "ready" });
  });

  it("使用管理口令建立安全的影像观看会话", async () => {
    const config = await request(service.app).get("/api/config").expect(200);
    expect(config.body.viewerAuthEnabled).toBe(true);

    const initial = await viewerAgent.get("/api/auth/session").expect(200);
    expect(initial.body).toEqual({ viewerAuthEnabled: true, authenticated: false });
    await viewerAgent.post("/api/auth/login").send({ token: "wrong-secret" }).expect(401);

    const login = await viewerAgent.post("/api/auth/login").send({ token: "test-secret" }).expect(200);
    expect(login.body).toEqual({ viewerAuthEnabled: true, authenticated: true });
    const cookie = login.headers["set-cookie"].join("; ");
    expect(cookie).toContain("jiyu_viewer_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Max-Age=43200");

    const authenticated = await viewerAgent.get("/api/auth/session").expect(200);
    expect(authenticated.body.authenticated).toBe(true);
  });

  it("按国家搜索城市并缓存地理编码结果", async () => {
    const first = await request(service.app).get("/api/locations/search").query({ country: "cn", q: "上海" }).expect(200);
    expect(first.body.locations[0]).toMatchObject({ name: "上海", countryCode: "CN", latitude: 31.22222, longitude: 121.45806 });

    await request(service.app).get("/api/locations/search").query({ country: "CN", q: "上海" }).expect(200);
    expect(geocodeCalls).toEqual([{ query: "上海", countryCode: "CN" }]);

    const shortQuery = await request(service.app).get("/api/locations/search").query({ country: "CN", q: "上" }).expect(200);
    expect(shortQuery.body.locations).toEqual([]);
    await request(service.app).get("/api/locations/search").query({ country: "China", q: "上海" }).expect(400);
  });

  it("保护写操作，并能创建一个合法旅程", async () => {
    const payload = {
      title: "海边的周末",
      locationName: "中国 · 厦门",
      countryCode: "CN",
      cityName: "厦门",
      latitude: 24.4798,
      longitude: 118.0894,
      startDate: "2026-04-03",
      endDate: "2026-04-05",
      story: "沿着海岸骑车。",
    };
    await request(service.app).post("/api/trips").send(payload).expect(401);
    const response = await request(service.app).post("/api/trips").set("X-Admin-Token", "test-secret").send(payload).expect(201);
    tripId = response.body.trip.id;
    expect(response.body.trip).toMatchObject({ title: payload.title, locationName: payload.locationName, countryCode: "CN", cityName: "厦门", mediaCount: 0 });
  });

  it("拒绝只提交国家而未选择城市", async () => {
    const response = await request(service.app).post("/api/trips").set("X-Admin-Token", "test-secret").send({
      title: "未完成的地点",
      locationName: "中国",
      countryCode: "CN",
      latitude: 31.2,
      longitude: 121.4,
      startDate: "2026-04-03",
      story: "",
    }).expect(400);
    expect(response.body.error).toContain("同时选择");
  });

  it("拒绝非法坐标", async () => {
    const response = await request(service.app).post("/api/trips").set("X-Admin-Token", "test-secret").send({
      title: "错误坐标",
      locationName: "未知",
      latitude: 99,
      longitude: 0,
      startDate: "2026-04-03",
      story: "",
    }).expect(400);
    expect(response.body.error).toContain("纬度");
  });

  it("流式接收图片、生成缩略图并分页返回元数据", async () => {
    const upload = await request(service.app)
      .post(`/api/trips/${tripId}/media`)
      .set("X-Admin-Token", "test-secret")
      .attach("file", pngFixture, { filename: "海边.png", contentType: "image/png" })
      .expect(201);
    mediaId = upload.body.media.id;
    expect(upload.body.media).toMatchObject({ kind: "image", mimeType: "image/png", hasThumbnail: true });

    await request(service.app).get(`/api/trips/${tripId}/media?page=1&limit=1`).expect(401);
    const listing = await viewerAgent.get(`/api/trips/${tripId}/media?page=1&limit=1`).expect(200);
    expect(listing.body.total).toBe(1);
    expect(listing.body.media[0].id).toBe(mediaId);

    await request(service.app).get(`/api/media/${mediaId}/thumbnail`).expect(401);
    const thumbnail = await viewerAgent.get(`/api/media/${mediaId}/thumbnail`).expect(200);
    expect(thumbnail.headers["content-type"]).toContain("image/webp");
    expect(thumbnail.headers["cache-control"]).toBe("private, no-store");
  });

  it("按原格式读取媒体并提供旅程 ZIP 下载", async () => {
    await request(service.app).get(`/api/media/${mediaId}/file`).expect(401);
    await request(service.app).get(`/api/media/${mediaId}/download`).expect(401);
    await request(service.app).get(`/api/trips/${tripId}/download`).expect(401);

    const media = await viewerAgent.get(`/api/media/${mediaId}/file`).expect(200);
    expect(media.headers["content-type"]).toContain("image/png");
    expect(Number(media.headers["content-length"])).toBe(pngFixture.length);
    expect(media.headers["cache-control"]).toBe("private, no-store");

    const archive = await viewerAgent
      .get(`/api/trips/${tripId}/download`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(archive.headers["content-type"]).toContain("application/zip");
    expect(archive.body.subarray(0, 2).toString()).toBe("PK");
  });

  it("删除媒体时同时清理数据库记录", async () => {
    await request(service.app).delete(`/api/media/${mediaId}`).set("X-Admin-Token", "test-secret").expect(204);
    await viewerAgent.get(`/api/media/${mediaId}/file`).expect(404);
    const trips = await request(service.app).get("/api/trips").expect(200);
    expect(trips.body.trips[0].mediaCount).toBe(0);
  });

  it("退出后立即撤销影像访问", async () => {
    const logout = await viewerAgent.post("/api/auth/logout").expect(200);
    expect(logout.body).toEqual({ viewerAuthEnabled: true, authenticated: false });
    expect(logout.headers["set-cookie"].join("; ")).toContain("Max-Age=0");
    await viewerAgent.get(`/api/trips/${tripId}/media`).expect(401);
  });
});
