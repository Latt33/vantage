/**
 * In-memory result cache for sources / derivatives / analyses.
 *
 * - Values are stored as Promises so concurrent callers single-flight onto the
 *   same in-flight request.
 * - Keys encode every input that affects the result (AOI bbox, capability set,
 *   time offset, free-form params). Add new dimensions by extending the key
 *   helpers below — do not stuff them into `params`.
 * - No eviction beyond optional TTL; the working set is bounded by AOI size
 *   (one AOI at a time) and the cardinality of derivatives/analyses (small).
 * - Lives entirely in-process. Persistent caching (IndexedDB, server-side)
 *   plugs in by swapping `ResultCache` here.
 */

import { AreaContext } from "../area";

interface CacheEntry<T> {
  value: Promise<T>;
  createdAt: number;
  ttlMs: number | null;
}

export class ResultCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): Promise<T> | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.ttlMs !== null && Date.now() - entry.createdAt > entry.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as Promise<T>;
  }

  set<T>(key: string, value: Promise<T>, ttlMs: number | null = null): Promise<T> {
    this.store.set(key, { value, createdAt: Date.now(), ttlMs });
    return value;
  }

  /**
   * Wrap a producer: returns cached promise if present, otherwise invokes
   * `produce()`, stores its promise, and returns it. Failures are not cached
   * (the rejected promise is removed so the next call retries).
   */
  async memoize<T>(key: string, produce: () => Promise<T>, ttlMs: number | null = null): Promise<T> {
    const existing = this.get<T>(key);
    if (existing) return existing;
    const p = produce();
    this.set(key, p, ttlMs);
    try {
      return await p;
    } catch (err) {
      this.store.delete(key);
      throw err;
    }
  }

  invalidate(prefix?: string): void {
    if (!prefix) { this.store.clear(); return; }
    for (const k of [...this.store.keys()]) {
      if (k.startsWith(prefix)) this.store.delete(k);
    }
  }

  size(): number { return this.store.size; }
}

// ─── Key helpers ──────────────────────────────────────────────────────────────

/** Stable bbox identifier — round coords to avoid float-jitter cache misses. */
export function bboxKey(area: AreaContext, precision = 4): string {
  const b = area.bbox;
  const r = (n: number) => n.toFixed(precision);
  return `${r(b.minLon)},${r(b.minLat)},${r(b.maxLon)},${r(b.maxLat)}`;
}

/** Shallow stable hash of a params object. Sufficient for flat-shape params. */
export function paramsKey(params?: Record<string, unknown>): string {
  if (!params) return "";
  return Object.keys(params).sort().map(k => `${k}=${String(params[k])}`).join("&");
}

export function sourceKey(id: string, area: AreaContext): string {
  return `src:${id}:${bboxKey(area)}`;
}

export function derivativeKey(
  id: string,
  area: AreaContext,
  params?: Record<string, unknown>,
): string {
  return `dvt:${id}:${bboxKey(area)}:${paramsKey(params)}`;
}

export function analysisKey(
  id: string,
  area: AreaContext,
  capabilities: string[],
  timeOffsetHours: number,
  params?: Record<string, unknown>,
): string {
  const caps = [...capabilities].sort().join(",");
  return `ana:${id}:${bboxKey(area)}:${caps}:t${timeOffsetHours}:${paramsKey(params)}`;
}

/** Process-wide singleton. */
export const cache = new ResultCache();
