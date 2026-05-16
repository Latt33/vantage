/**
 * Area module — single source of truth for the currently selected AOI.
 *
 * `AreaContext` is the canonical record. Today it carries only the rectangle
 * (as GeoJSON + bbox). The `metadata` field is the expansion point for future
 * per-area derived data (elevation stats, weather summary, threat assessment,
 * cached layer payloads, etc.) — extend it instead of scattering new state.
 *
 * Use `useArea()` inside React, `getArea()` from anywhere else (e.g. fetch
 * helpers), and `setArea()` from the selection flow.
 */

import { useSyncExternalStore } from "react";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import { BoundingBox } from "./types";

export interface AreaContext {
  /** Canonical GeoJSON polygon — send this directly to the backend. */
  geometry: Feature<Polygon>;
  /** Convenience bbox for code that wants min/max scalars. */
  bbox: BoundingBox;
  /** ISO timestamp of when this area was created. */
  createdAt: string;
  /**
   * Free-form extension slot. Add typed fields here as the app grows
   * (e.g. dem stats, weather, anomalies). Treat as immutable per AreaContext —
   * call `setArea()` with a new object rather than mutating in place.
   */
  metadata: Record<string, unknown>;
}

// ─── Construction / conversion ────────────────────────────────────────────────

export function bboxToFeature(bbox: BoundingBox): Feature<Polygon> {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[
        [bbox.minLon, bbox.minLat],
        [bbox.maxLon, bbox.minLat],
        [bbox.maxLon, bbox.maxLat],
        [bbox.minLon, bbox.maxLat],
        [bbox.minLon, bbox.minLat],
      ]],
    },
  };
}

export function bboxToArea(bbox: BoundingBox): AreaContext {
  return {
    geometry: bboxToFeature(bbox),
    bbox,
    createdAt: new Date().toISOString(),
    metadata: {},
  };
}

// ─── Serializers for API calls ────────────────────────────────────────────────

/** Single GeoJSON Feature — the default backend payload shape. */
export function areaAsFeature(area: AreaContext): Feature<Polygon> {
  return area.geometry;
}

/** GeoJSON FeatureCollection — for endpoints that expect a collection. */
export function areaAsFeatureCollection(area: AreaContext): FeatureCollection<Polygon> {
  return { type: "FeatureCollection", features: [area.geometry] };
}

/** [west, south, east, north] tuple — for endpoints expecting a bbox query. */
export function areaAsBBoxArray(area: AreaContext): [number, number, number, number] {
  return [area.bbox.minLon, area.bbox.minLat, area.bbox.maxLon, area.bbox.maxLat];
}

// ─── Store (module-level singleton + React subscription) ──────────────────────

let current: AreaContext | null = null;
const subscribers = new Set<() => void>();

export function getArea(): AreaContext | null {
  return current;
}

export function setArea(next: AreaContext | null): void {
  current = next;
  subscribers.forEach(fn => fn());
}

/** Merge additional metadata onto the current area without replacing it. */
export function patchAreaMetadata(patch: Record<string, unknown>): void {
  if (!current) return;
  current = { ...current, metadata: { ...current.metadata, ...patch } };
  subscribers.forEach(fn => fn());
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/** React hook — re-renders the calling component whenever the area changes. */
export function useArea(): AreaContext | null {
  return useSyncExternalStore(subscribe, getArea, () => null);
}
