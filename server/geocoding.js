const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";

function optionalText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeGeocodingResults(payload) {
  if (!payload || !Array.isArray(payload.results)) return [];

  return payload.results
    .filter((item) => (
      item
      && Number.isFinite(item.latitude)
      && Number.isFinite(item.longitude)
      && typeof item.name === "string"
      && item.name.trim()
      && typeof item.country_code === "string"
    ))
    .map((item) => ({
      id: String(item.id ?? `${item.country_code}-${item.name}-${item.latitude}-${item.longitude}`),
      name: item.name.trim(),
      country: optionalText(item.country),
      countryCode: item.country_code.trim().toUpperCase(),
      admin1: optionalText(item.admin1),
      latitude: Number(item.latitude),
      longitude: Number(item.longitude),
    }));
}

export async function searchCities({ query, countryCode, signal }) {
  const url = new URL(GEOCODING_ENDPOINT);
  url.searchParams.set("name", query);
  url.searchParams.set("count", "10");
  url.searchParams.set("language", "zh");
  url.searchParams.set("format", "json");
  url.searchParams.set("countryCode", countryCode);

  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`地理编码服务返回 ${response.status}`);
  return normalizeGeocodingResults(await response.json());
}
