import { describe, expect, it } from "vitest";
import { normalizeGeocodingResults } from "../server/geocoding.js";

describe("地理编码结果", () => {
  it("只保留有效城市并规范化字段", () => {
    const result = normalizeGeocodingResults({
      results: [
        { id: 1, name: " 上海 ", country: " 中国 ", country_code: "cn", admin1: "上海", latitude: 31.22222, longitude: 121.45806 },
        { id: 2, name: "缺少坐标", country_code: "CN", latitude: null, longitude: 120 },
        { id: 3, country_code: "CN", latitude: 30, longitude: 120 },
      ],
    });

    expect(result).toEqual([{
      id: "1",
      name: "上海",
      country: "中国",
      countryCode: "CN",
      admin1: "上海",
      latitude: 31.22222,
      longitude: 121.45806,
    }]);
  });

  it("兼容服务未返回结果数组", () => {
    expect(normalizeGeocodingResults({})).toEqual([]);
    expect(normalizeGeocodingResults(null)).toEqual([]);
  });
});
