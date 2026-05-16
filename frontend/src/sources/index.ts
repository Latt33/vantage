/**
 * Tier 1 — Sources.
 *
 * Each entry below is a manifest. Real loaders go in their own file:
 *   src/sources/terrain.ts, src/sources/weather.ts, …
 * import the loader and replace `load: PLACEHOLDER_LOAD` + flip `hasData: true`.
 *
 * Results are cached by `sourceKey(id, area)` and are stable per AOI.
 * Source results are the only thing tiers 2/3 can pull from — never let an
 * analysis fetch directly.
 */

import { AreaContext } from "../area";
import { DataSource } from "../registry/types";
import { cache, sourceKey } from "../registry/cache";
import { API_BASE_URL } from "../config";
import type { Feature, FeatureCollection, Geometry } from "geojson";

const PLACEHOLDER_LOAD = async (): Promise<unknown> => {
  throw new Error("source not implemented");
};

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

interface WeatherGrid {
  grid?: {
    points?: Array<{ lat: number; lon: number }>;
    times?: string[];
  };
  variables?: Record<string, number[][]>;
}

function getBackendAoiId(area: AreaContext): string {
  const id = area.metadata?.aoi_id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("missing backend aoi_id in area metadata");
  }
  return id;
}

async function fetchJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${API_BASE_URL}${path}`, { signal });
  if (!res.ok) {
    throw new Error(`request failed (${res.status}): ${path}`);
  }
  return res.json();
}

function asFeatureCollection(value: unknown): FeatureCollection {
  if (
    value &&
    typeof value === "object" &&
    (value as { type?: string }).type === "FeatureCollection" &&
    Array.isArray((value as { features?: unknown[] }).features)
  ) {
    return value as FeatureCollection;
  }
  return EMPTY_FC;
}

function isForestFeature(feature: Feature<Geometry>): boolean {
  const values = Object.values(feature.properties ?? {});
  const text = values.map(v => String(v).toLowerCase()).join(" ");
  return text.includes("forest") || text.includes("wood") || text.includes("mets");
}

async function loadLandcover(area: AreaContext, signal?: AbortSignal): Promise<FeatureCollection> {
  const aoiId = getBackendAoiId(area);
  const json = await fetchJson(`/api/aoi/${aoiId}/land/cover`, signal);
  return asFeatureCollection(json);
}

async function loadForest(area: AreaContext, signal?: AbortSignal): Promise<FeatureCollection> {
  const fc = await loadLandcover(area, signal);
  return {
    type: "FeatureCollection",
    features: fc.features.filter(isForestFeature),
  };
}

async function loadWater(area: AreaContext, signal?: AbortSignal): Promise<FeatureCollection> {
  const aoiId = getBackendAoiId(area);
  const [bodiesRaw, coursesRaw] = await Promise.all([
    fetchJson(`/api/aoi/${aoiId}/water/bodies`, signal),
    fetchJson(`/api/aoi/${aoiId}/water/courses`, signal),
  ]);
  const bodies = asFeatureCollection(bodiesRaw);
  const courses = asFeatureCollection(coursesRaw);

  return {
    type: "FeatureCollection",
    features: [
      ...bodies.features.map(f => ({
        ...f,
        properties: { ...(f.properties ?? {}), water_kind: "body" },
      })),
      ...courses.features.map(f => ({
        ...f,
        properties: { ...(f.properties ?? {}), water_kind: "course" },
      })),
    ],
  };
}

async function loadWeather(area: AreaContext, signal?: AbortSignal): Promise<FeatureCollection> {
  const aoiId = getBackendAoiId(area);
  const raw = await fetchJson(`/api/aoi/${aoiId}/weather/forecast`, signal);
  const weather = (raw ?? {}) as WeatherGrid;
  const points = weather.grid?.points ?? [];
  const times = weather.grid?.times ?? [];
  const variables = weather.variables ?? {};

  const features: Feature[] = points.map((p, idx) => {
    const windSeries = variables.wind_speed_ms?.[idx] ?? [];
    const tempSeries = variables.temperature_c?.[idx] ?? [];
    const rainSeries = variables.rain_mm?.[idx] ?? [];
    return {
      type: "Feature",
      properties: {
        point_index: idx,
        t0: times[0] ?? null,
        wind_speed_ms: windSeries[0] ?? null,
        temperature_c: tempSeries[0] ?? null,
        rain_mm: rainSeries[0] ?? null,
      },
      geometry: {
        type: "Point",
        coordinates: [p.lon, p.lat],
      },
    };
  });

  return { type: "FeatureCollection", features };
}

export const SOURCES: DataSource[] = [
  { id: "terrain",    label: "Topography",  sublabel: "Elevation · DEM",        category: "base",        hasData: false, load: PLACEHOLDER_LOAD },
  { id: "landcover",  label: "Land Type",   sublabel: "Surface classification", category: "base",        hasData: false, load: loadLandcover },
  { id: "forest",     label: "Forest Cover",sublabel: "Canopy density",         category: "base",        hasData: false, load: loadForest },
  { id: "water",      label: "Water",       sublabel: "Lakes · Rivers",         category: "base",        hasData: false, load: loadWater },
  { id: "weather",    label: "Weather",     sublabel: "ECMWF forecast grid",    category: "atmospheric", hasData: false, load: loadWeather },
  { id: "population", label: "Population",  sublabel: "Density distribution",   category: "demographic", hasData: false, load: PLACEHOLDER_LOAD },
];

export function getSource(id: string): DataSource | undefined {
  return SOURCES.find(s => s.id === id);
}

/** Load a source through the cache. Concurrent callers share the same promise. */
export function loadSource<T = unknown>(id: string, area: AreaContext, signal?: AbortSignal): Promise<T> {
  const src = getSource(id);
  if (!src) return Promise.reject(new Error(`Unknown source: ${id}`));
  return cache.memoize(sourceKey(id, area), () => src.load(area, signal) as Promise<T>);
}
