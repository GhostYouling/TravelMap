export interface Trip {
  id: string;
  title: string;
  locationName: string;
  countryCode: string | null;
  cityName: string | null;
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string | null;
  story: string;
  color: string;
  mediaCount: number;
  photoCount: number;
  videoCount: number;
  totalBytes: number;
  coverMediaId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MediaItem {
  id: string;
  tripId: string;
  originalName: string;
  mimeType: string;
  kind: "image" | "video";
  size: number;
  width: number | null;
  height: number | null;
  hasThumbnail: boolean;
  createdAt: string;
}

export interface Totals {
  tripCount: number;
  mediaCount: number;
  totalBytes: number;
}

export interface AppConfig {
  maxUploadMb: number;
  writeProtected: boolean;
}

export interface TripInput {
  title: string;
  locationName: string;
  countryCode: string | null;
  cityName: string | null;
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string | null;
  story: string;
}

export interface CountryOption {
  code: string;
  name: string;
}

export interface LocationSuggestion {
  id: string;
  name: string;
  country: string | null;
  countryCode: string;
  admin1: string | null;
  latitude: number;
  longitude: number;
}
