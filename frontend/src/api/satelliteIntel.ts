/**
 * Satellite Intelligence API — real backend calls.
 *
 * fetchTrajectories: fetches 24-hour SGP4 ground tracks from the backend.
 * Returns a GeoJSON FeatureCollection with:
 *   - LineString / MultiLineString features (feature_type: "track") per satellite
 *   - Point features (feature_type: "overpass") at each 1-min pass within 100 km
 */

import type { FeatureCollection } from "geojson";
import { API_BASE_URL } from "../config";

export async function fetchTrajectories(
  aoiId: string,
  signal?: AbortSignal,
): Promise<FeatureCollection> {
  const res = await fetch(`${API_BASE_URL}/api/aoi/${aoiId}/satellites/trajectories`, { signal });
  if (!res.ok) throw new Error(`Trajectory fetch failed (${res.status})`);
  return res.json() as Promise<FeatureCollection>;
}

export const CONSTELLATION_COLORS: Record<string, string> = {
  sentinel_1:     "#00b4d8",
  sentinel_2:     "#52b788",
  landsat_9:      "#f4a261",
  iceye_x:        "#e9c46a",
  planet_skysat:  "#c77dff",
};

export const CONSTELLATION_COLOR_FALLBACK = "#aaaaaa";

export const CONSTELLATION_LABELS: Record<string, string> = {
  sentinel_1:    "Sentinel-1 (SAR)",
  sentinel_2:    "Sentinel-2 (Optical)",
  landsat_9:     "Landsat 9",
  iceye_x:       "ICEYE-X (SAR)",
  planet_skysat: "SkySat (Optical)",
};
