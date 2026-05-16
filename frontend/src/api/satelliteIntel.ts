/**
 * Satellite Intelligence — placeholder API.
 *
 * This module exists so the UI can wire up the satellite_intelligence capability
 * end-to-end before any real backend exists. Every call returns mock data after
 * a small simulated delay so the panel behaves like a real fetch.
 *
 * Replace these stubs with real calls (e.g. N2YO, Spire, Planet Tasking) when
 * the backend lands.
 */

import { BoundingBox } from "../types";

export interface NextOverpass {
  satelliteId: string;
  satelliteLabel: string;
  nextPassUtc: string;        // ISO timestamp of the next AOI overpass
  durationSeconds: number;    // how long the satellite is over the AOI
  elevationDeg: number;       // max elevation above horizon during pass
  azimuthDeg: number;         // direction of travel at peak
  imageUrl: string | null;    // most recent image taken over this AOI (placeholder)
  source: "placeholder";
}

const PLACEHOLDER_LABELS: Record<string, string> = {
  sentinel_2:     "Sentinel-2",
  sentinel_1:     "Sentinel-1",
  landsat_9:      "Landsat 9",
  iceye_x:        "ICEYE",
  planet_skysat:  "SkySat",
};

function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Return mock next-overpass metadata for a satellite over the given AOI.
 * Deterministic on (satelliteId, bbox) so re-checking the same satellite
 * shows the same fake pass.
 */
export async function fetchNextOverpass(
  satelliteId: string,
  bbox: BoundingBox,
): Promise<NextOverpass> {
  await new Promise((r) => setTimeout(r, 400));

  const seed = hash(`${satelliteId}|${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`);
  const minutesAhead = 30 + (seed % 720);             // 30 min … 12 h ahead
  const durationSeconds = 90 + (seed % 360);          // 1.5 … 7.5 min over AOI
  const elevationDeg = 25 + (seed % 60);              // 25° … 85°
  const azimuthDeg = seed % 360;

  return {
    satelliteId,
    satelliteLabel: PLACEHOLDER_LABELS[satelliteId] ?? satelliteId,
    nextPassUtc: new Date(Date.now() + minutesAhead * 60_000).toISOString(),
    durationSeconds,
    elevationDeg,
    azimuthDeg,
    imageUrl: null,
    source: "placeholder",
  };
}
