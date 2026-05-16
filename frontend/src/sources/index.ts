/**
 * Tier 1 — Sources.
 *
 * Each entry is a manifest. Replace `load: PLACEHOLDER_LOAD` + flip `hasData: true`
 * once a real loader exists.
 *
 * Results are cached by `sourceKey(id, area)` and stable per AOI.
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

async function loadTerrain(area: AreaContext, signal?: AbortSignal): Promise<FeatureCollection> {
  const aoiId = getBackendAoiId(area);
  const raw = await fetchJson(`/api/aoi/${aoiId}/dem/elevation`, signal);
  return asFeatureCollection(raw);
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
  return asFeatureCollection(raw);
}

async function loadSatellites(area: AreaContext, signal?: AbortSignal): Promise<FeatureCollection> {
  const aoiId = getBackendAoiId(area);
  const raw = await fetchJson(`/api/aoi/${aoiId}/satellites/passes`, signal);
  return asFeatureCollection(raw);
}

async function loadCameras(area: AreaContext, signal?: AbortSignal): Promise<FeatureCollection> {
  const aoiId = getBackendAoiId(area);
  const raw = await fetchJson(`/api/aoi/${aoiId}/traffic_cameras/stations`, signal);
  return asFeatureCollection(raw);
}

async function loadCellTowers(area: AreaContext, signal?: AbortSignal): Promise<FeatureCollection> {
  const aoiId = getBackendAoiId(area);
  const raw = await fetchJson(`/api/aoi/${aoiId}/cellular/towers`, signal);
  return asFeatureCollection(raw);
}

export const SOURCES: DataSource[] = [
  { id: "terrain",    label: "Topography",      sublabel: "Elevation · DEM",         category: "base",        hasData: false, load: loadTerrain },
  { id: "landcover",  label: "Land Type",       sublabel: "Surface classification",  category: "base",        hasData: false, load: loadLandcover },
  { id: "forest",     label: "Forest Cover",    sublabel: "Canopy density",          category: "base",        hasData: false, load: loadForest },
  { id: "water",      label: "Water",           sublabel: "Lakes · Rivers",          category: "base",        hasData: false, load: loadWater },
  { id: "cameras",    label: "Traffic Cameras", sublabel: "Fintraffic · Digitraffic",category: "base",        hasData: false, load: loadCameras },
  { id: "cellular",   label: "Cell Towers",     sublabel: "OpenCelliD · 4G/5G",      category: "base",        hasData: false, load: loadCellTowers },
  { id: "weather",    label: "Weather",         sublabel: "ECMWF forecast grid",     category: "atmospheric", hasData: false, load: loadWeather },
  { id: "satellites", label: "Satellites",      sublabel: "Recon passes · N2YO",     category: "atmospheric", hasData: false, load: loadSatellites },
  { id: "population", label: "Population",      sublabel: "Density distribution",    category: "demographic", hasData: false, load: PLACEHOLDER_LOAD },
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
