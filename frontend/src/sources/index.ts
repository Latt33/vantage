/**
 * Tier 1 — Sources.
 *
 * Each entry is a manifest. Real loaders go below; replace PLACEHOLDER_LOAD +
 * flip `hasData: true` when a real load() exists.
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

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

function getBackendAoiId(area: AreaContext): string {
  const id = area.metadata?.aoi_id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("missing backend aoi_id in area metadata");
  }
  return id;
}

async function fetchJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30000);
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`request failed (${res.status}): ${path}`);
    }
    return res.json();
  } finally {
    window.clearTimeout(timeout);
  }
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
  const landClass = String((feature.properties as Record<string, unknown> | undefined)?.land_class ?? "").toLowerCase();
  const landLabel = String((feature.properties as Record<string, unknown> | undefined)?.land_label ?? "").toLowerCase();
  if (landClass === "forest" || landLabel.includes("forest")) {
    return true;
  }
  return text.includes("forest") || text.includes("wood") || text.includes("mets") || text.includes("metsa");
}

function classifyLandFeature(feature: Feature<Geometry>): Feature<Geometry> {
  const props = feature.properties ?? {};
  const text = JSON.stringify(props).toLowerCase();
  const sourceLabel = String((props as Record<string, unknown>).nls_label ?? "").toLowerCase();
  const sourceCollection = String((props as Record<string, unknown>).nls_collection ?? "").toLowerCase();
  const haystack = `${text} ${sourceLabel} ${sourceCollection}`;
  const backendLandClass = String((props as Record<string, unknown>).land_class ?? "").toLowerCase();
  const backendLandLabel = String((props as Record<string, unknown>).land_label ?? "").toLowerCase();

  let landClass = "other";
  let landLabel = "Other";

  if (backendLandClass === "forest" || backendLandLabel.includes("forest")) {
    landClass = "forest";
    landLabel = "Forest";
  } else if (haystack.includes("forest") || haystack.includes("wood") || haystack.includes("mets") || haystack.includes("metsa")) {
    landClass = "forest";
    landLabel = "Forest";
  } else if (backendLandClass === "built" || backendLandLabel.includes("built")) {
    landClass = "built";
    landLabel = "Built-up";
  } else if (haystack.includes("building") || haystack.includes("rakenn") || haystack.includes("house") || haystack.includes("built") || haystack.includes("asuin") || haystack.includes("teoll")) {
    landClass = "built";
    landLabel = "Built-up";
  } else if (backendLandClass === "water" || backendLandLabel.includes("water")) {
    landClass = "water";
    landLabel = "Water";
  } else if (haystack.includes("water") || haystack.includes("lake") || haystack.includes("river") || haystack.includes("vesi") || haystack.includes("järvi") || haystack.includes("jarvi")) {
    landClass = "water";
    landLabel = "Water";
  } else if (backendLandClass === "wetland" || backendLandLabel.includes("wetland")) {
    landClass = "wetland";
    landLabel = "Wetland";
  } else if (haystack.includes("swamp") || haystack.includes("wetland") || haystack.includes("suo") || haystack.includes("bog") || haystack.includes("marsh")) {
    landClass = "wetland";
    landLabel = "Wetland";
  } else if (backendLandClass === "open" || backendLandLabel.includes("open")) {
    landClass = "open";
    landLabel = "Open Land";
  } else if (haystack.includes("field") || haystack.includes("grass") || haystack.includes("meadow") || haystack.includes("pelto") || haystack.includes("niitty") || haystack.includes("open")) {
    landClass = "open";
    landLabel = "Open Land";
  } else if (backendLandClass === "rock" || backendLandLabel.includes("rock")) {
    landClass = "rock";
    landLabel = "Rock";
  } else if (haystack.includes("rock") || haystack.includes("kallio") || haystack.includes("bedrock")) {
    landClass = "rock";
    landLabel = "Rock";
  }

  return {
    ...feature,
    properties: {
      ...(feature.properties ?? {}),
      land_class: landClass,
      land_label: landLabel,
    },
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function toFiniteNumber(value: unknown): number | null {
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : null;
}

function gridPointsToCells(
  fc: FeatureCollection,
  cellSize?: { lonStep?: number; latStep?: number },
): FeatureCollection {
  const points = fc.features.filter((f) => f.geometry?.type === "Point" && Array.isArray((f.geometry as { coordinates?: unknown }).coordinates));
  if (points.length === 0) return fc;

  const lonValues = [...new Set(points.map((f) => Number((f.geometry as unknown as { coordinates: [number, number] }).coordinates[0])))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const latValues = [...new Set(points.map((f) => Number((f.geometry as unknown as { coordinates: [number, number] }).coordinates[1])))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const lonDiffs: number[] = [];
  const latDiffs: number[] = [];
  for (let i = 1; i < lonValues.length; i++) {
    const diff = Math.abs(lonValues[i] - lonValues[i - 1]);
    if (diff > 0) lonDiffs.push(diff);
  }
  for (let i = 1; i < latValues.length; i++) {
    const diff = Math.abs(latValues[i] - latValues[i - 1]);
    if (diff > 0) latDiffs.push(diff);
  }

  const halfLon = ((cellSize?.lonStep ?? median(lonDiffs)) || 0.00005) / 2;
  const halfLat = ((cellSize?.latStep ?? median(latDiffs)) || 0.00005) / 2;

  return {
    type: "FeatureCollection",
    features: points.map((feature) => {
      const [lon, lat] = (feature.geometry as unknown as { coordinates: [number, number] }).coordinates;
      return {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [lon - halfLon, lat - halfLat],
            [lon + halfLon, lat - halfLat],
            [lon + halfLon, lat + halfLat],
            [lon - halfLon, lat + halfLat],
            [lon - halfLon, lat - halfLat],
          ]],
        },
        properties: { ...(feature.properties ?? {}) },
      };
    }),
  };
}

// ── Base layers ──────────────────────────────────────────────────────────────

async function loadTerrain(area: AreaContext, signal?: AbortSignal): Promise<FeatureCollection> {
  const aoiId = getBackendAoiId(area);
  const raw = await fetchJson(`/api/aoi/${aoiId}/dem/elevation`, signal);
  return asFeatureCollection(raw);
}

async function loadLandcover(area: AreaContext, signal?: AbortSignal): Promise<FeatureCollection> {
  const aoiId = getBackendAoiId(area);
  const json = await fetchJson(`/api/aoi/${aoiId}/land/cover`, signal);
  const fc = asFeatureCollection(json);
  return {
    ...fc,
    features: fc.features.map(classifyLandFeature),
  };
}

async function loadForest(area: AreaContext, signal?: AbortSignal): Promise<FeatureCollection> {
  const aoiId = getBackendAoiId(area);
  const raw = await fetchJson(`/api/aoi/${aoiId}/land/forest`, signal);
  const fc = asFeatureCollection(raw);
  return {
    type: "FeatureCollection",
    features: fc.features.filter((feature) => {
      const landClass = String((feature.properties as Record<string, unknown> | undefined)?.land_class ?? "").toLowerCase();
      return landClass === "forest" || isForestFeature(feature);
    }),
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

async function loadSatelliteImagery(): Promise<FeatureCollection> {
  return EMPTY_FC;
}

// ── Atmospheric ───────────────────────────────────────────────────────────────

async function loadWeather(area: AreaContext, signal?: AbortSignal): Promise<FeatureCollection> {
  const aoiId = getBackendAoiId(area);
  const raw = await fetchJson(`/api/aoi/${aoiId}/weather/forecast`, signal);
  return asFeatureCollection(raw);
}

// ── Infrastructure ────────────────────────────────────────────────────────────

async function loadInfraRoads(area: AreaContext, signal?: AbortSignal): Promise<FeatureCollection> {
  const aoiId = getBackendAoiId(area);
  const raw = await fetchJson(`/api/aoi/${aoiId}/infrastructure/roads`, signal);
  return asFeatureCollection(raw);
}

async function loadTrafficCameras(area: AreaContext, signal?: AbortSignal): Promise<FeatureCollection> {
  const aoiId = getBackendAoiId(area);
  const raw = await fetchJson(`/api/aoi/${aoiId}/traffic_cameras/stations`, signal);
  return asFeatureCollection(raw);
}

// ── Surveillance ──────────────────────────────────────────────────────────────

async function loadCellular(area: AreaContext, signal?: AbortSignal): Promise<FeatureCollection> {
  const aoiId = getBackendAoiId(area);
  const raw = await fetchJson(`/api/aoi/${aoiId}/cellular/towers`, signal);
  const fc = asFeatureCollection(raw);
  const features = fc.features
    .map((feature) => {
      if (feature.geometry?.type !== "Point") return null;
      const coordinates = (feature.geometry as unknown as { coordinates?: unknown }).coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

      const lon = toFiniteNumber(coordinates[0]);
      const lat = toFiniteNumber(coordinates[1]);
      if (lon === null || lat === null) return null;

      return {
        ...feature,
        geometry: {
          type: "Point" as const,
          coordinates: [lon, lat] as [number, number],
        },
        properties: {
          ...(feature.properties ?? {}),
          range: toFiniteNumber(feature.properties?.range) ?? feature.properties?.range,
        },
      } as Feature<Geometry>;
    })
    .filter((feature): feature is NonNullable<typeof feature> => feature !== null);

  return {
    ...fc,
    features,
  };
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const SOURCES: DataSource[] = [
  // Base
  { id: "terrain",          label: "Topography",     sublabel: "Elevation · DEM",          category: "base",           hasData: false, load: loadTerrain },
  { id: "satellite_imagery", label: "Satellite",      sublabel: "MapTiler imagery",         category: "base",           hasData: false, load: loadSatelliteImagery },
  { id: "landcover",        label: "Land Type",       sublabel: "Surface classification",   category: "base",           hasData: false, load: loadLandcover },
  { id: "forest",           label: "Forest Cover",    sublabel: "Canopy density",           category: "base",           hasData: false, load: loadForest },
  { id: "water",            label: "Water",           sublabel: "Lakes · Rivers",           category: "base",           hasData: false, load: loadWater },
  // Atmospheric
  { id: "weather",          label: "Weather",         sublabel: "ECMWF forecast grid",      category: "atmospheric",    hasData: false, load: loadWeather },
  // Infrastructure
  { id: "infra_roads",      label: "Roads",           sublabel: "Highway network",          category: "infrastructure", hasData: false, load: loadInfraRoads },
  // Surveillance
  { id: "cellular",         label: "Cell Towers",     sublabel: "RF coverage · Relays",     category: "surveillance",   hasData: false, load: loadCellular },
  { id: "traffic_cameras",   label: "Road Cameras",    sublabel: "Live weather cameras",     category: "surveillance",   hasData: false, load: loadTrafficCameras },
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
