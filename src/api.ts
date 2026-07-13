import type { AppConfig, LocationSuggestion, MediaItem, Totals, Trip, TripInput, ViewerSession } from "./types";

const TOKEN_KEY = "jiyu-admin-token";

export function getAdminToken() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

export function saveAdminToken(token: string) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const token = getAdminToken();
  if (token) headers.set("X-Admin-Token", token);
  const response = await fetch(url, { credentials: "same-origin", ...options, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "请求失败" }));
    const error = new Error(payload.error || "请求失败") as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const api = {
  getConfig: () => request<AppConfig>("/api/config"),
  getViewerSession: () => request<ViewerSession>("/api/auth/session"),
  loginViewer: (token: string) => request<ViewerSession>("/api/auth/login", { method: "POST", body: JSON.stringify({ token }) }),
  logoutViewer: () => request<ViewerSession>("/api/auth/logout", { method: "POST" }),
  getTrips: () => request<{ trips: Trip[]; totals: Totals }>("/api/trips"),
  searchCities: (countryCode: string, query: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ country: countryCode, q: query });
    return request<{ locations: LocationSuggestion[] }>(`/api/locations/search?${params}`, { signal });
  },
  createTrip: (trip: TripInput) => request<{ trip: Trip }>("/api/trips", { method: "POST", body: JSON.stringify(trip) }),
  updateTrip: (id: string, trip: TripInput) => request<{ trip: Trip }>(`/api/trips/${id}`, { method: "PATCH", body: JSON.stringify(trip) }),
  deleteTrip: (id: string) => request<void>(`/api/trips/${id}`, { method: "DELETE" }),
  getMedia: (tripId: string, page = 1) => request<{ media: MediaItem[]; page: number; total: number; hasMore: boolean }>(`/api/trips/${tripId}/media?page=${page}&limit=18`),
  deleteMedia: (id: string) => request<void>(`/api/media/${id}`, { method: "DELETE" }),
};

export function uploadMedia(
  tripId: string,
  file: File,
  onProgress: (progress: number) => void,
): Promise<MediaItem> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/trips/${tripId}/media`);
    const token = getAdminToken();
    if (token) xhr.setRequestHeader("X-Admin-Token", token);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener("load", () => {
      const payload = JSON.parse(xhr.responseText || "{}");
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload.media);
      else {
        const error = new Error(payload.error || "上传失败") as Error & { status?: number };
        error.status = xhr.status;
        reject(error);
      }
    });
    xhr.addEventListener("error", () => reject(new Error("网络中断，上传失败")));
    xhr.send(form);
  });
}
