/**
 * Tier 3 — Analyses.
 *
 * Capability-keyed interpretations rendered as toggleable rows in the right
 * LayerPanel ("Analyses" section). An analysis shows up only when at least one
 * of its `requires.capabilities` is currently selected by the operator.
 *
 * Real run() implementations go in their own file:
 *   src/analyses/heavyVehicleCorridors.ts, …
 * Results are cached by `analysisKey(id, area, capabilities, timeOffset, params)`.
 *
 * Adding a new analysis: append to ANALYSES below, set `requires` so the
 * resolver knows what to load, leave `hasData: false` until run() is wired.
 */

import { AreaContext } from "../area";
import { Analysis, AnalysisContext } from "../registry/types";
import { cache, analysisKey } from "../registry/cache";
import { loadSource } from "../sources";
import { computeDerivative } from "../derivatives";

const PLACEHOLDER_RUN = async (): Promise<unknown> => {
  throw new Error("analysis not implemented");
};

export const ANALYSES: Analysis[] = [
  {
    id: "heavy_vehicle_corridors",
    label: "Movement Corridors",
    sublabel: "Routes · Bridge ratings",
    accentColor: "#c87d2a",
    hasData: false,
    requires: {
      sources: ["terrain", "landcover"],
      derivatives: ["chokepoints", "slope_grades"],
      capabilities: ["heavy_vehicles"],
    },
    run: PLACEHOLDER_RUN,
  },
  {
    id: "drone_shelter_positions",
    label: "Drone Shelter Positions",
    sublabel: "Concealment from sensors",
    accentColor: "#2a9d8a",
    hasData: false,
    requires: {
      sources: ["forest", "terrain"],
      derivatives: ["viewshed"],
      capabilities: ["fpv_drones"],
    },
    run: PLACEHOLDER_RUN,
  },
  {
    id: "infantry_concealment",
    label: "Infantry Concealment",
    sublabel: "Cover · Concealment grade",
    accentColor: "#5a7a5a",
    hasData: false,
    requires: {
      sources: ["forest", "terrain", "landcover"],
      derivatives: ["viewshed", "slope_grades"],
      capabilities: ["light_infantry"],
    },
    run: PLACEHOLDER_RUN,
  },
  {
    id: "artillery_firing_positions",
    label: "Firing Positions",
    sublabel: "Defilade · Survey control",
    accentColor: "#d4a017",
    hasData: false,
    requires: {
      sources: ["terrain"],
      derivatives: ["viewshed", "open_areas"],
      capabilities: ["towed_artillery"],
    },
    run: PLACEHOLDER_RUN,
  },
  {
    id: "logistics_routes",
    label: "Sustainment Routes",
    sublabel: "Capacity · Risk-weighted",
    accentColor: "#8a7a5a",
    hasData: false,
    requires: {
      sources: ["landcover"],
      derivatives: ["chokepoints"],
      capabilities: ["logistics"],
    },
    run: PLACEHOLDER_RUN,
  },
  {
    id: "fortification_sites",
    label: "Fortification Sites",
    sublabel: "Soil · Drainage · Cover",
    accentColor: "#c0392b",
    hasData: false,
    requires: {
      sources: ["terrain", "landcover"],
      derivatives: ["viewshed"],
      capabilities: ["fortification"],
    },
    run: PLACEHOLDER_RUN,
  },
];

export function getAnalysis(id: string): Analysis | undefined {
  return ANALYSES.find(a => a.id === id);
}

/** Analyses whose required capability set intersects the operator's selection. */
export function analysesForCapabilities(capabilityIds: string[]): Analysis[] {
  const set = new Set(capabilityIds);
  return ANALYSES.filter(a => a.requires.capabilities.some(c => set.has(c)));
}

/**
 * Resolve and run an analysis through the cache. Loads all required sources +
 * derivatives first (each individually cached, so reruns after capability /
 * time changes only redo the tier-3 step).
 */
export function runAnalysis<T = unknown>(
  id: string,
  area: AreaContext,
  capabilities: string[],
  timeOffsetHours: number,
  params?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const def = getAnalysis(id);
  if (!def) return Promise.reject(new Error(`Unknown analysis: ${id}`));

  return cache.memoize(
    analysisKey(id, area, capabilities, timeOffsetHours, params),
    async () => {
      const sources: Record<string, unknown> = {};
      for (const sid of def.requires.sources ?? []) {
        sources[sid] = await loadSource(sid, area, signal);
      }
      const derivatives: Record<string, unknown> = {};
      for (const did of def.requires.derivatives ?? []) {
        derivatives[did] = await computeDerivative(did, area, undefined, signal);
      }
      const ctx: AnalysisContext = { area, sources, derivatives, capabilities, timeOffsetHours, signal };
      return def.run(ctx) as Promise<T>;
    },
  );
}
