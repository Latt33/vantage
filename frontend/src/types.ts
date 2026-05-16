export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export type AppMode = "select" | "confirm" | "analyze";

export const MAX_AOI_KM = 30;

export type LayerId =
  | "terrain"
  | "weather"
  | "landcover"
  | "forest"
  | "infrastructure"
  | "population"
  | "traffic_cameras";

export interface LayerConfig {
  id: LayerId;
  label: string;
  sublabel: string;
  accentColor: string;
  visible: boolean;
  opacity: number;
  /** When false (default), the panel shows a "NO DATA" badge while visible. */
  hasData?: boolean;
}

export interface LayerSection {
  title: string;
  layers: LayerConfig[];
}
