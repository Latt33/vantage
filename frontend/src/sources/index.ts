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

const PLACEHOLDER_LOAD = async (): Promise<unknown> => {
  throw new Error("source not implemented");
};

export const SOURCES: DataSource[] = [
  { id: "terrain",    label: "Topography",  sublabel: "Elevation · DEM",        category: "base",        hasData: false, load: PLACEHOLDER_LOAD },
  { id: "landcover",  label: "Land Type",   sublabel: "Surface classification", category: "base",        hasData: false, load: PLACEHOLDER_LOAD },
  { id: "forest",     label: "Forest Cover",sublabel: "Canopy density",         category: "base",        hasData: false, load: PLACEHOLDER_LOAD },
  { id: "weather",    label: "Weather",     sublabel: "Open-Meteo forecast",    category: "atmospheric", hasData: false, load: PLACEHOLDER_LOAD },
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
