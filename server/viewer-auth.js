import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const VIEWER_COOKIE_NAME = "jiyu_viewer_session";
const SESSION_VERSION = "v1";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

export function safeTokenEqual(received, expected) {
  const left = Buffer.from(received || "");
  const right = Buffer.from(expected || "");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function readCookie(header, name) {
  for (const item of String(header || "").split(";")) {
    const separator = item.indexOf("=");
    if (separator === -1 || item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function cookieAttributes(secureCookies) {
  return `Path=/; HttpOnly; SameSite=Strict${secureCookies ? "; Secure" : ""}`;
}

export function createViewerAuth({ accessToken = "", sessionSecret = "", secureCookies = false, now = () => Date.now() } = {}) {
  const enabled = Boolean(accessToken);
  const signingKey = createHash("sha256")
    .update(sessionSecret || `jiyu-access:${accessToken}`)
    .digest();

  function sign(payload) {
    return createHmac("sha256", signingKey).update(payload).digest("base64url");
  }

  function isAuthenticated(cookieHeader) {
    if (!enabled) return true;
    const session = readCookie(cookieHeader, VIEWER_COOKIE_NAME);
    const [version, expiresAtValue, signature, ...extra] = session.split(".");
    if (extra.length || version !== SESSION_VERSION || !/^\d+$/.test(expiresAtValue || "")) return false;
    const expiresAt = Number(expiresAtValue);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now() / 1000)) return false;
    return safeTokenEqual(signature, sign(`${version}.${expiresAt}`));
  }

  function accepts(token) {
    if (!enabled) return true;
    return safeTokenEqual(token, accessToken);
  }

  function issueCookie() {
    const expiresAt = Math.floor(now() / 1000) + SESSION_TTL_SECONDS;
    const payload = `${SESSION_VERSION}.${expiresAt}`;
    return `${VIEWER_COOKIE_NAME}=${payload}.${sign(payload)}; Max-Age=${SESSION_TTL_SECONDS}; ${cookieAttributes(secureCookies)}`;
  }

  function clearCookie() {
    return `${VIEWER_COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; ${cookieAttributes(secureCookies)}`;
  }

  return { enabled, accepts, isAuthenticated, issueCookie, clearCookie };
}
