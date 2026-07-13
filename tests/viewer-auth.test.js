import { describe, expect, it } from "vitest";
import { createViewerAuth, VIEWER_COOKIE_NAME } from "../server/viewer-auth.js";

describe("影像观看会话", () => {
  it("签发可验证、可过期且防篡改的安全 Cookie", () => {
    let timestamp = Date.UTC(2026, 6, 13, 12, 0, 0);
    const auth = createViewerAuth({
      accessToken: "same-admin-token",
      sessionSecret: "test-signing-secret",
      secureCookies: true,
      now: () => timestamp,
    });

    expect(auth.accepts("same-admin-token")).toBe(true);
    expect(auth.accepts("wrong-token")).toBe(false);
    const cookie = auth.issueCookie();
    expect(cookie).toContain(`${VIEWER_COOKIE_NAME}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");

    const cookieHeader = cookie.split(";", 1)[0];
    expect(auth.isAuthenticated(cookieHeader)).toBe(true);
    expect(auth.isAuthenticated(`${cookieHeader}tampered`)).toBe(false);

    timestamp += 12 * 60 * 60 * 1000 + 1000;
    expect(auth.isAuthenticated(cookieHeader)).toBe(false);
  });

  it("未设置管理口令时保持原有公开访问行为", () => {
    const auth = createViewerAuth();
    expect(auth.enabled).toBe(false);
    expect(auth.isAuthenticated("")).toBe(true);
    expect(auth.accepts("")).toBe(true);
  });
});
