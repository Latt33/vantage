export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export type AppMode = "select" | "confirm" | "analyze";

export type WeatherMetricId = "cloudAmount" | "cloudHeight" | "visibility" | "temperature" | "windSpeed";

/**
 * AoI-wide averages computed across all grid points at the first valid_time.
 * Each value is null when no data is available for that variable.
 */
export interface WeatherAverages {
  windSpeed: number | null;       // m/s
  windDir: number | null;         // degrees, meteorological "from" direction
  windGust: number | null;        // m/s
  temperature: number | null;     // °C
  cloudAmount: number | null;     // % total cloud cover
  cloudHeight: number | null;     // % high-cloud proxy
  visibility: number | null;      // m
}

export const MAX_AOI_KM = 30;

/**
 * Layer ids are strings — typed unions don't compose with the dynamic analysis
 * registry, where ids come from `src/analyses/`. The well-known source ids are
 * still listed in `src/sources/index.ts`.
 */
export type LayerId = string;

export interface LayerConfig {
  id: LayerId;
  label: string;
  sublabel: string;
  accentColor: string;
  visible: boolean;
  opacity: number;
  /** When false (default), the panel shows a "NO DATA" badge while visible. */
  hasData?: boolean;
  loadState?: "idle" | "loading" | "ready" | "error";
}

export interface LayerSection {
  title: string;
  layers: LayerConfig[];
}
