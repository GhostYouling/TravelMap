import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../server/app.js";

describe("数据库升级", () => {
  it("为旧数据库补充国家和城市字段并保留原旅程", async () => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "jiyu-migration-"));
    const databasePath = path.join(directory, "data", "legacy.db");
    await fsp.mkdir(path.dirname(databasePath), { recursive: true });
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE trips (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        location_name TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT,
        story TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO trips VALUES (
        'legacy-trip', '旧旅程', '中国 · 杭州', 30.2741, 120.1551,
        '2025-01-01', NULL, '', '#ef8354', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z'
      );
    `);
    database.close();

    const service = createApp({
      cwd: directory,
      databasePath,
      dataDir: "data",
      uploadDir: "uploads",
      thumbnailDir: "thumbnails",
      seedDemo: false,
    });

    try {
      const response = await request(service.app).get("/api/trips").expect(200);
      expect(response.body.trips[0]).toMatchObject({
        id: "legacy-trip",
        locationName: "中国 · 杭州",
        countryCode: null,
        cityName: null,
      });
      const columns = service.db.pragma("table_info(trips)").map((column) => column.name);
      expect(columns).toContain("country_code");
      expect(columns).toContain("city_name");
    } finally {
      service.close();
      await fsp.rm(directory, { recursive: true, force: true });
    }
  });
});
