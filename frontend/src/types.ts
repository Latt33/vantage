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
  | "infrastructure"
  | "population";

export interface LayerConfig {
  id: LayerId;
  label: string;
  sublabel: string;
  accentColor: string;
  visible: boolean;
  opacity: number;
}
