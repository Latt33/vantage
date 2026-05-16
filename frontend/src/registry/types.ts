/**
 * Three-tier analysis registry.
 *
 *   Tier 1 — Source       Raw geospatial data (DEM, landcover, weather, …)
 *   Tier 2 — Derivative   Geometric primitives derived from sources (chokepoints,
 *                         open areas, viewsheds). Capability-agnostic.
 *   Tier 3 — Analysis     Capability-keyed interpretations (heavy-vehicle
 *                         corridors, drone shelter positions, …) — what the
 *                         operator actually sees toggleable in the right panel.
 *
 * Dependency arrow points down only: Analysis → Derivative → Source.
 *
 * All three are async functions returning unknown payloads; the runtime contract
 * is "produce a result the caller can pass to MapLibre or display verbatim".
 * Results are cached by `registry/cache.ts` — see that file for key shape.
 */

import { AreaContext } from "../area";

export type SourceCategory = "base" | "atmospheric" | "demographic";

export interface DataSource<TResult = unknown> {
  id: string;
  label: string;
  sublabel: string;
  category: SourceCategory;
  /** False until a real load() exists. UI surfaces "NO DATA" while false. */
  hasData: boolean;
  /** Pulls raw data for the AOI. Cached by `sourceKey(id, area)`. */
  load(area: AreaContext, signal?: AbortSignal): Promise<TResult>;
}

export interface DerivativeContext {
  area: AreaContext;
  /** Resolved source results, keyed by source id. */
  sources: Record<string, unknown>;
  /** Resolved upstream derivative results, keyed by derivative id. */
  derivatives: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface Derivative<TResult = unknown> {
  id: string;
  label: string;
  sublabel: string;
  inputs: {
    sources?: string[];
    derivatives?: string[];
  };
  compute(ctx: DerivativeContext): Promise<TResult>;
}

export interface AnalysisContext extends DerivativeContext {
  capabilities: string[];
  timeOffsetHours: number;
}

export interface Analysis<TResult = unknown> {
  id: string;
  label: string;
  sublabel: string;
  /** Suggested accent for the UI swatch. */
  accentColor: string;
  /** False until run() is wired. UI surfaces "NO DATA" while false. */
  hasData: boolean;
  requires: {
    sources?: string[];
    derivatives?: string[];
    /** OR-semantics — analysis shows up when ANY of these is selected. */
    capabilities: string[];
  };
  run(ctx: AnalysisContext): Promise<TResult>;
}
