/**
 * Tier 2 — Derivatives.
 *
 * Geometric primitives computed purely from sources (and other derivatives).
 * Capability-agnostic. Not surfaced in the operator UI for this MVP — exist as
 * code structure so tier 3 analyses can declare and resolve them.
 *
 * Real compute() implementations go in their own file:
 *   src/derivatives/chokepoints.ts, src/derivatives/openAreas.ts, …
 * Results are cached by `derivativeKey(id, area, params)`.
 */

import { AreaContext } from "../area";
import { Derivative, DerivativeContext } from "../registry/types";
import { cache, derivativeKey } from "../registry/cache";
import { loadSource } from "../sources";

const PLACEHOLDER_COMPUTE = async (): Promise<unknown> => {
  throw new Error("derivative not implemented");
};

export const DERIVATIVES: Derivative[] = [
  { id: "open_areas",   label: "Open Areas",   sublabel: "Exposure polygons",    inputs: { sources: ["landcover", "forest"] },                       compute: PLACEHOLDER_COMPUTE },
  { id: "chokepoints",  label: "Chokepoints",  sublabel: "Movement constraints", inputs: { sources: ["terrain", "landcover"], derivatives: ["open_areas"] }, compute: PLACEHOLDER_COMPUTE },
  { id: "slope_grades", label: "Slope Grades", sublabel: "Trafficability",       inputs: { sources: ["terrain"] },                                   compute: PLACEHOLDER_COMPUTE },
  { id: "viewshed",     label: "Viewsheds",    sublabel: "Line-of-sight basins", inputs: { sources: ["terrain"] },                                   compute: PLACEHOLDER_COMPUTE },
];

export function getDerivative(id: string): Derivative | undefined {
  return DERIVATIVES.find(d => d.id === id);
}

/**
 * Resolve and compute a derivative through the cache. Recursively loads all
 * required sources + upstream derivatives first (each individually cached).
 */
export function computeDerivative<T = unknown>(
  id: string,
  area: AreaContext,
  params?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const def = getDerivative(id);
  if (!def) return Promise.reject(new Error(`Unknown derivative: ${id}`));

  return cache.memoize(derivativeKey(id, area, params), async () => {
    const sources: Record<string, unknown> = {};
    for (const sid of def.inputs.sources ?? []) {
      sources[sid] = await loadSource(sid, area, signal);
    }
    const derivatives: Record<string, unknown> = {};
    for (const did of def.inputs.derivatives ?? []) {
      derivatives[did] = await computeDerivative(did, area, undefined, signal);
    }
    const ctx: DerivativeContext = { area, sources, derivatives, signal };
    return def.compute(ctx) as Promise<T>;
  });
}
