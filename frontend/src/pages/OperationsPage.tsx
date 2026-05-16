import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { BoundingBox, LayerConfig, LayerId, LayerSection, WeatherAverages } from "../types";
import { bboxToArea, setArea } from "../area";
import { API_BASE_URL, MAPTILER_KEY } from "../config";
import { CAPABILITIES, Capability } from "../data/capabilities";
import LayerPanel from "../components/LayerPanel";
import TimeSlider, { MissionWindowBand } from "../components/TimeSlider";
import ToolPanel from "../components/ToolPanel";
import MissionWindowModal, {
  DEFAULT_CONDITIONS,
  MissionConditionsUi,
} from "../components/MissionWindowModal";
import TrafficCameraModal, { TrafficCameraStationDetail } from "../components/TrafficCameraModal";
import ExportIpbReportModal, { ExportLegendState } from "../export/ExportIpbReportModal";
import { SOURCES, loadSource } from "../sources";
import { analysesForCapabilities } from "../analyses";
import { fetchNextOverpass } from "../api/satelliteIntel";

const SOURCE_ACCENTS: Record<string, string> = {
  terrain:     "#8a7a5a",
  landcover:   "#5a7a5a",
  forest:      "#2a7a2a",
  water:       "#2a6db5",
  weather:     "#2a6db5",
  infra_roads: "#a8a8a0",
  infra_rail:  "#d47c2f",
  cellular:    "#2a9d8a",
  traffic_cameras: "#e8622a",
  satellites:  "#8060c8",
};

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

const SATELLITE_COMPASS_BEARINGS: Record<string, number> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toEpochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric > 1e12 ? numeric : numeric * 1000;
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function toBearingDeg(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return ((value % 360) + 360) % 360;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return null;
  if (trimmed in SATELLITE_COMPASS_BEARINGS) {
    return SATELLITE_COMPASS_BEARINGS[trimmed];
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? ((parsed % 360) + 360) % 360 : null;
}

function projectPoint(
  lon: number,
  lat: number,
  bearingDeg: number,
  distanceMeters: number,
): [number, number] {
  const earthRadiusMeters = 6_371_000;
  const angularDistance = distanceMeters / earthRadiusMeters;
  const bearingRad = (bearingDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;

  const nextLat = Math.asin(
    Math.max(-1, Math.min(1, Math.sin(latRad) * Math.cos(angularDistance) + Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearingRad)))
  );
  const nextLon = lonRad + Math.atan2(
    Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(latRad),
    Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(nextLat),
  );

  return [((nextLon * 180) / Math.PI + 540) % 360 - 180, (nextLat * 180) / Math.PI];
}

function squareRing(centerLon: number, centerLat: number, sizeMeters: number): [number, number][] {
  const half = sizeMeters / 2;
  return [
    projectPoint(centerLon, centerLat, 315, half),
    projectPoint(centerLon, centerLat, 45, half),
    projectPoint(centerLon, centerLat, 135, half),
    projectPoint(centerLon, centerLat, 225, half),
    projectPoint(centerLon, centerLat, 315, half),
  ];
}

function buildSatelliteDisplayData(raw: FeatureCollection, aoi: BoundingBox | null, offsetHours: number): FeatureCollection {
  if (!aoi) return EMPTY_FC;

  const centerLon = (aoi.minLon + aoi.maxLon) / 2;
  const centerLat = (aoi.minLat + aoi.maxLat) / 2;
  const lonSpanMeters = Math.abs(aoi.maxLon - aoi.minLon) * 111_320 * Math.cos((centerLat * Math.PI) / 180);
  const latSpanMeters = Math.abs(aoi.maxLat - aoi.minLat) * 111_320;
  const trackRadius = Math.max(8_000, Math.max(lonSpanMeters, latSpanMeters) * 0.55);
  const boxSize = Math.max(250, Math.max(lonSpanMeters, latSpanMeters) * 0.04);
  const selectedMs = Date.now() + offsetHours * 3_600_000;

  const features: Feature<Geometry>[] = [];
  for (const feature of raw.features ?? []) {
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const startMs = toEpochMs(props.start_time ?? props.startUTC ?? props.startUtc);
    const endMs = toEpochMs(props.end_time ?? props.endUTC ?? props.endUtc);
    const startBearing = toBearingDeg(props.start_az_compass ?? props.startAzCompass ?? props.startAz ?? props.start_azimuth);
    const endBearing = toBearingDeg(props.end_az_compass ?? props.endAzCompass ?? props.endAz ?? props.end_azimuth);

    if (startMs === null || endMs === null || startBearing === null || endBearing === null) continue;

    const startPoint = projectPoint(centerLon, centerLat, startBearing, trackRadius);
    const endPoint = projectPoint(centerLon, centerLat, endBearing, trackRadius);

    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [startPoint, endPoint] },
      properties: { ...props, kind: "track" },
    } as Feature<Geometry>);

    if (selectedMs < startMs || selectedMs > endMs || endMs <= startMs) continue;

    const fraction = clamp((selectedMs - startMs) / (endMs - startMs), 0, 1);
    const currentLon = startPoint[0] + (endPoint[0] - startPoint[0]) * fraction;
    const currentLat = startPoint[1] + (endPoint[1] - startPoint[1]) * fraction;

    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [squareRing(currentLon, currentLat, boxSize)] },
      properties: { ...props, kind: "active", progress: fraction },
    } as Feature<Geometry>);
  }

  return { type: "FeatureCollection", features };
}

const INITIAL_LAYERS: LayerConfig[] = SOURCES.map((s) => ({
  id: s.id,
  label: s.label,
  sublabel: s.sublabel,
  accentColor: SOURCE_ACCENTS[s.id] ?? "#8a8880",
  visible: false,
  opacity: 0.7,
  hasData: s.hasData,
}));

const BASE_IDS:   LayerId[] = SOURCES.filter((s) => s.category === "base").map((s) => s.id);
const ATMOS_IDS:  LayerId[] = SOURCES.filter((s) => s.category === "atmospheric").map((s) => s.id);
const DEMO_IDS:   LayerId[] = SOURCES.filter((s) => s.category === "demographic").map((s) => s.id);
const SURV_IDS:   LayerId[] = SOURCES.filter((s) => s.category === "surveillance").map((s) => s.id);

// MapLibre source id for each data source id
const MAP_SOURCE_IDS: Record<string, string> = {
  landcover:   "natural-landcover-src",
  forest:      "natural-forest-src",
  water:       "natural-water-src",
  weather:     "natural-weather-src",
  terrain:     "dem-terrain-src",
  infra_roads: "infra-roads-src",
  infra_rail:  "infra-rail-src",
  cellular:    "cellular-src",
  traffic_cameras: "traffic-cameras-src",
  satellites:  "satellites-src",
};

// MapLibre layer ids that each data source drives
const MAP_LAYER_IDS: Record<string, string[]> = {
  landcover:   ["natural-landcover-raster"],
  forest:      ["natural-forest-raster"],
  water:       ["natural-water-fill", "natural-water-line"],
  weather:     ["natural-weather-wind-arrows"],
  terrain:     ["dem-terrain-fill"],
  infra_roads: ["infra-roads-line"],
  infra_rail:  ["infra-rail-line"],
  cellular:    ["cellular-halo", "cellular-circle"],
  traffic_cameras: ["traffic-camera-symbol"],
  satellites:  ["satellites-track-line", "satellites-box-fill"],
};

const MAP_LAYER_OPACITY_PROP: Record<string, "fill-opacity" | "line-opacity" | "circle-opacity" | "icon-opacity" | "text-opacity"> = {
  "natural-landcover-fill": "fill-opacity",
  "natural-landcover-line": "line-opacity",
  "natural-forest-fill":    "fill-opacity",
  "natural-water-fill":     "fill-opacity",
  "natural-water-line":     "line-opacity",
  "natural-weather-wind-arrows": "text-opacity",
  "dem-terrain-fill":       "fill-opacity",
  "infra-roads-line":       "line-opacity",
  "infra-rail-line":        "line-opacity",
  "cellular-halo":          "circle-opacity",
  "cellular-circle":        "circle-opacity",
  "traffic-camera-symbol":  "icon-opacity",
  "satellites-track-line":  "line-opacity",
  "satellites-box-fill":    "fill-opacity",
};

const EMPTY_WEATHER_AVERAGES: WeatherAverages = {
  windSpeed: null,
  windDir: null,
  windGust: null,
  temperature: null,
  cloudAmount: null,
  cloudHeight: null,
  visibility: null,
};

// Maps each source id to its backend job stage name
const SOURCE_STAGE: Record<string, string> = {
  landcover:   "land",
  forest:      "land",
  water:       "water",
  weather:     "weather",
  terrain:     "dem",
  infra_roads: "infrastructure",
  infra_rail:  "rail",
  cellular:    "cellular",
  traffic_cameras: "traffic_cameras",
  satellites:  "satellites",
};

interface JobInfo {
  aoiId: string;
  jobId: string;
}

function loadAoi(): BoundingBox | null {
  try {
    return JSON.parse(sessionStorage.getItem("aoi") ?? "null");
  } catch {
    return null;
  }
}

function loadCapabilities(): Capability[] {
  try {
    const ids = JSON.parse(sessionStorage.getItem("capabilities") ?? "[]") as string[];
    return CAPABILITIES.filter((c) => ids.includes(c.id));
  } catch {
    return [];
  }
}

function bboxLabel(b: BoundingBox): string {
  const lon = (b.minLon + b.maxLon) / 2;
  const lat = (b.minLat + b.maxLat) / 2;
  const lonStr = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  const latStr = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
  return `${latStr} ${lonStr}`;
}

export default function OperationsPage() {
  const navigate = useNavigate();
  const aoi = useMemo(() => loadAoi(), []);
  const capabilities = useMemo(() => loadCapabilities(), []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [layers, setLayers] = useState<LayerConfig[]>(INITIAL_LAYERS);
  const [analysisLayers, setAnalysisLayers] = useState<Record<string, { visible: boolean; opacity: number }>>({});
  const [infraSelected, setInfraSelected] = useState<Set<string>>(new Set());
  const [derivedSelected, setDerivedSelected] = useState<Set<string>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const [exportShot, setExportShot] = useState<string | null>(null);
  const [missionWindowOpen, setMissionWindowOpen] = useState(false);
  const [missionConditions, setMissionConditions] = useState<MissionConditionsUi>(DEFAULT_CONDITIONS);
  const [missionWindows, setMissionWindows] = useState<MissionWindowBand[]>([]);
  const [timelineOffsetHours, setTimelineOffsetHours] = useState(0);
  const [cameraStation, setCameraStation] = useState<{ stationId: string; stationName: string | null } | null>(null);
  const [cameraDetail, setCameraDetail] = useState<TrafficCameraStationDetail | null>(null);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null);
  const [stages, setStages] = useState<Record<string, string>>({});
  const loadedSources = useRef<Set<string>>(new Set());
  const [sourceData, setSourceData] = useState<Record<string, FeatureCollection>>({
    landcover:   EMPTY_FC,
    forest:      EMPTY_FC,
    water:       EMPTY_FC,
    weather:     EMPTY_FC,
    terrain:     EMPTY_FC,
    infra_roads: EMPTY_FC,
    infra_rail:  EMPTY_FC,
    cellular:    EMPTY_FC,
    traffic_cameras: EMPTY_FC,
    satellites:  EMPTY_FC,
  });

  const capabilityIds = useMemo(() => capabilities.map((c) => c.id), [capabilities]);
  const availableAnalyses = useMemo(() => analysesForCapabilities(capabilityIds), [capabilityIds]);

  const analysisLayerConfigs: LayerConfig[] = useMemo(
    () =>
      availableAnalyses.map((a) => {
        const state = analysisLayers[a.id] ?? { visible: false, opacity: 0.7 };
        return {
          id: a.id,
          label: a.label,
          sublabel: a.sublabel,
          accentColor: a.accentColor,
          visible: state.visible,
          opacity: state.opacity,
          hasData: a.hasData,
        };
      }),
    [availableAnalyses, analysisLayers],
  );

  const sourceArea = useMemo(() => {
    if (!aoi || !jobInfo) return null;
    return {
      ...bboxToArea(aoi),
      metadata: { aoi_id: jobInfo.aoiId },
    };
  }, [aoi, jobInfo]);

  const satelliteDisplayData = useMemo(
    () => buildSatelliteDisplayData(sourceData.satellites, aoi, timelineOffsetHours),
    [aoi, sourceData.satellites, timelineOffsetHours],
  );

  const weatherDisplayData = useMemo(() => {
    const raw = sourceData.weather;
    if (!raw || !raw.features || raw.features.length === 0) return EMPTY_FC;

    const selectedMs = Date.now() + timelineOffsetHours * 3_600_000;
    
    let bestTime: string | null = null;
    let minDiff = Infinity;

    for (const f of raw.features) {
      const p = f.properties;
      if (!p || !p.valid_time) continue;
      const t = toEpochMs(p.valid_time);
      if (t === null) continue;
      
      const diff = Math.abs(t - selectedMs);
      if (diff < minDiff) {
        minDiff = diff;
        bestTime = p.valid_time;
      }
    }

    if (!bestTime) return raw;

    return {
      type: "FeatureCollection",
      features: raw.features.filter(f => f.properties?.valid_time === bestTime)
    } as FeatureCollection;
  }, [sourceData.weather, timelineOffsetHours]);

  useEffect(() => {
    const currentJob = jobInfo;
    const currentCamera = cameraStation;
    if (!currentJob || !currentCamera) return;
    const aoiId = currentJob.aoiId;
    const stationId = currentCamera.stationId;
    let active = true;
    const controller = new AbortController();

    async function loadCameraDetail() {
      setCameraLoading(true);
      setCameraError(null);
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/aoi/${aoiId}/traffic_cameras/stations/${stationId}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          throw new Error(`request failed (${res.status})`);
        }
        const payload = (await res.json()) as TrafficCameraStationDetail;
        if (!active) return;
        setCameraDetail(payload);
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
        if (!active) return;
        setCameraDetail(null);
        setCameraError("Unable to load the latest camera images.");
      } finally {
        if (active) setCameraLoading(false);
      }
    }

    loadCameraDetail();

    return () => {
      active = false;
      controller.abort();
    };
  }, [cameraStation, jobInfo]);

  // Mapping from infra node id -> source id in SOURCES (if implemented)
  const INFRA_TO_SOURCE: Record<string, string | undefined> = {
    roads: "infra_roads",
    rail: "infra_rail",
    towers: "cellular",
  };

  function toggleInfra(id: string) {
    // only allow toggling infra nodes that have an implemented source
    const src = INFRA_TO_SOURCE[id];
    if (typeof src === "undefined") return;
    setInfraSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleDerived(id: string) {
    setDerivedSelected((prev) => {
      const next = new Set(prev);
      const turningOn = !next.has(id);
      if (turningOn) next.add(id);
      else next.delete(id);

      // Satellite intel filters are scoped as `satellite_intelligence:<sat_id>`.
      // On check, kick off a placeholder fetch for the next overpass + imagery.
      if (turningOn && aoi && id.startsWith("satellite_intelligence:")) {
        const satelliteId = id.split(":", 2)[1];
        fetchNextOverpass(satelliteId, aoi)
          .then((pass) => {
            console.info("[satellite-intel] next overpass", pass);
          })
          .catch(() => {
            // Placeholder API — swallow until backend lands.
          });
      }

      return next;
    });
  }

  function onExport() {
    const map = mapRef.current;
    let screenshot: string | null = null;

    if (map) {
      try {
        screenshot = map.getCanvas().toDataURL("image/png");
      } catch {
        screenshot = null;
      }
    }

    setExportShot(screenshot);
    setExportOpen(true);
  }

  function onApplyMissionWindow(cond: MissionConditionsUi) {
    setMissionConditions(cond);
    setMissionWindows(buildPlaceholderWindows(cond));
  }

  function onLayerChange(id: LayerId, patch: Partial<LayerConfig>) {
    if (availableAnalyses.some((a) => a.id === id)) {
      setAnalysisLayers((prev) => {
        const cur = prev[id] ?? { visible: false, opacity: 0.7 };
        return { ...prev, [id]: { ...cur, ...patch } };
      });
      return;
    }
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function setLayerHasData(id: LayerId, hasData: boolean) {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, hasData } : l)));
  }

  function setLayerLoadState(id: LayerId, loadState: LayerConfig["loadState"]) {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, loadState } : l)));
  }

  useEffect(() => {
    if (!aoi) {
      navigate("/aoi", { replace: true });
      return;
    }
    setArea(bboxToArea(aoi));
  }, [aoi, navigate]);

  useEffect(() => {
    if (!aoi || jobInfo) return;
    const bbox = aoi;
    const controller = new AbortController();

    async function startJob() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/aoi`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            min_lon: bbox.minLon,
            min_lat: bbox.minLat,
            max_lon: bbox.maxLon,
            max_lat: bbox.maxLat,
          }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const payload = await res.json();
        if (!payload?.aoi_id || !payload?.job_id) return;
        setJobInfo({ aoiId: payload.aoi_id, jobId: payload.job_id });
      } catch {
        // Ignore aborted or transient network errors.
      }
    }

    startJob();
    return () => controller.abort();
  }, [aoi, jobInfo]);

  useEffect(() => {
    if (!jobInfo) return;
    const currentJob = jobInfo;
    let active = true;
    let timer: number | undefined;

    async function pollStatus() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/job/${currentJob.jobId}/status`);
        if (!res.ok) return;
        const payload = await res.json();
        if (!active) return;
        setStages(payload?.stages ?? {});
        if (payload?.status === "completed" && timer) {
          window.clearInterval(timer);
        }
      } catch {
        // Keep polling active.
      }
    }

    pollStatus();
    timer = window.setInterval(pollStatus, 5000);

    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
  }, [jobInfo]);

  // When a job starts, immediately mark all tracked sources as loading
  useEffect(() => {
    if (!jobInfo) return;
    setLayers((prev) =>
      prev.map((l) => (SOURCE_STAGE[l.id] ? { ...l, loadState: "loading" as const } : l))
    );
  }, [jobInfo]);

  useEffect(() => {
    if (!containerRef.current || !aoi) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${MAPTILER_KEY}`,
      bounds: [
        [aoi.minLon, aoi.minLat],
        [aoi.maxLon, aoi.maxLat],
      ],
      fitBoundsOptions: { padding: 40 },
      minZoom: 4,
      maxZoom: 16,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
      preserveDrawingBuffer: true,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: true, showZoom: false, visualizePitch: false }),
      "top-right",
    );

    map.on("load", () => {
      // AOI boundary
      map.addSource("aoi-source", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [[
              [aoi.minLon, aoi.minLat],
              [aoi.maxLon, aoi.minLat],
              [aoi.maxLon, aoi.maxLat],
              [aoi.minLon, aoi.maxLat],
              [aoi.minLon, aoi.minLat],
            ]],
          },
        },
      });
      map.addLayer({
        id: "aoi-outline",
        type: "line",
        source: "aoi-source",
        paint: { "line-color": "#e8622a", "line-width": 1.5, "line-opacity": 0.85 },
      });

      // ── Base ──────────────────────────────────────────────────────────────
      map.addSource(MAP_SOURCE_IDS.water, { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "natural-water-fill",
        type: "fill",
        source: MAP_SOURCE_IDS.water,
        filter: ["==", ["geometry-type"], "Polygon"],
        layout: { visibility: "none" },
        paint: { "fill-color": "#2a6db5", "fill-opacity": 0.5 },
      });
      map.addLayer({
        id: "natural-water-line",
        type: "line",
        source: MAP_SOURCE_IDS.water,
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { visibility: "none" },
        paint: { "line-color": "#4e8ad1", "line-width": 1.6, "line-opacity": 0.8 },
      });

      // Landcover and forest rasters are added after the land stage completes.

      // DEM elevation grid — rendered as polygon cells so it reads like a raster surface
      map.addSource(MAP_SOURCE_IDS.terrain, { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "dem-terrain-circle",
        type: "circle",
        source: MAP_SOURCE_IDS.terrain,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            6, 2,
            10, 3,
            13, 4,
            16, 6,
          ],
          "circle-color": [
            "interpolate", ["linear"], ["coalesce", ["get", "elevation_m"], 0],
            0,   "#1e3a1e",
            30,  "#2e5c1e",
            80,  "#4a8020",
            150, "#7aa840",
            250, "#a0b860",
            400, "#c8c880",
          ],
          "circle-opacity": 0.86,
          "circle-stroke-color": "rgba(0,0,0,0.15)",
          "circle-stroke-width": 0.3,
        },
      });

      // ── Atmospheric ───────────────────────────────────────────────────────
      // Single visual: an arrow at every grid point, rotated by wind direction
      // (meteorological "from" angle + 180° → arrow points in flow direction)
      // and sized by wind speed. AoI-wide metric averages live in the side panel.
      map.addSource(MAP_SOURCE_IDS.weather, { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "natural-weather-wind-arrows",
        type: "symbol",
        source: MAP_SOURCE_IDS.weather,
        layout: {
          visibility: "none",
          "text-field": "↑",
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": [
            "interpolate", ["linear"], ["coalesce", ["get", "wind_speed_ms"], 0],
            0, 16,
            5, 22,
            15, 32,
            25, 40,
          ],
          "text-rotate": [
            "%",
            ["+", ["coalesce", ["get", "wind_dir_deg"], 0], 180],
            360,
          ],
          "text-rotation-alignment": "map",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": [
            "interpolate", ["linear"], ["coalesce", ["get", "wind_speed_ms"], 0],
            0,  "#9ec6f0",
            8,  "#f1c40f",
            16, "#e67e22",
            25, "#c0392b",
          ],
          "text-halo-color": "rgba(0,0,0,0.85)",
          "text-halo-width": 1.5,
          "text-opacity": 0.92,
        },
      });

      // ── Infrastructure ────────────────────────────────────────────────────
      map.addSource(MAP_SOURCE_IDS.infra_roads, { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "infra-roads-line",
        type: "line",
        source: MAP_SOURCE_IDS.infra_roads,
        layout: { visibility: "none" },
        paint: {
          // color by feature length (meters)
          "line-color": [
            "interpolate", ["linear"], ["coalesce", ["get", "length_m"], 0],
            0, "#ffd47a",
            100, "#f1c40f",
            1000, "#d35400",
            5000, "#c0392b",
            20000, "#7a1919",
          ],
          "line-width": [
            "interpolate", ["linear"], ["coalesce", ["get", "length_m"], 0],
            0, 0.8,
            1000, 1.4,
            5000, 2.4,
            20000, 3.5,
          ],
          "line-opacity": 0.9,
        },
      });

      map.addSource(MAP_SOURCE_IDS.infra_rail, { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "infra-rail-line",
        type: "line",
        source: MAP_SOURCE_IDS.infra_rail,
        layout: { visibility: "none" },
        paint: {
          "line-color": [
            "match",
            ["coalesce", ["get", "railway"], "other"],
            "rail", "#e0c56b",
            "light_rail", "#f2b134",
            "subway", "#c07db0",
            "tram", "#d47c2f",
            "abandoned", "#8a8a8a",
            "other", "#d47c2f",
            "#d47c2f",
          ],
          "line-width": [
            "interpolate", ["linear"], ["zoom"],
            7, 1,
            10, 1.6,
            13, 2.4,
            16, 3.2,
          ],
          "line-opacity": 0.92,
        },
      });

      // ── Surveillance ──────────────────────────────────────────────────────
      map.addSource(MAP_SOURCE_IDS.cellular, { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "cellular-halo",
        type: "circle",
        source: MAP_SOURCE_IDS.cellular,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "range"], 0],
            0, 7,
            500, 8,
            2000, 10,
            10000, 13,
            50000, 18,
          ],
          "circle-color": "#6fe0cd",
          "circle-stroke-color": "#17322f",
          "circle-stroke-width": 0.5,
          "circle-opacity": 0.18,
        },
      });
      map.addLayer({
        id: "cellular-circle",
        type: "circle",
        source: MAP_SOURCE_IDS.cellular,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "range"], 0],
            0, 4,
            500, 5,
            2000, 7,
            10000, 11,
            50000, 16,
          ],
          "circle-color": "#2a9d8a",
          "circle-stroke-color": "#111111",
          "circle-stroke-width": 1,
          "circle-opacity": 0.85,
        },
      });

      map.addSource(MAP_SOURCE_IDS.traffic_cameras, { type: "geojson", data: EMPTY_FC });
      map.addImage("traffic-camera-icon", createTrafficCameraIcon());
      map.addLayer({
        id: "traffic-camera-symbol",
        type: "symbol",
        source: MAP_SOURCE_IDS.traffic_cameras,
        layout: {
          visibility: "none",
          "icon-image": "traffic-camera-icon",
          "icon-size": 0.8,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-opacity": 0.95,
        },
      });

      map.addSource(MAP_SOURCE_IDS.satellites, { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "satellites-track-line",
        type: "line",
        source: MAP_SOURCE_IDS.satellites,
        layout: { visibility: "none" },
        paint: {
          "line-color": "#8060c8",
          "line-width": 2.5,
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "satellites-box-fill",
        type: "fill",
        source: MAP_SOURCE_IDS.satellites,
        layout: { visibility: "none" },
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": "#c6b8ff",
          "fill-opacity": 0.32,
          "fill-outline-color": "#f0e9ff",
        },
      });

      setMapReady(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [aoi]);

  // Push updated GeoJSON data into each MapLibre source
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    for (const [id, data] of Object.entries(sourceData)) {
      if (id === "terrain" || id === "landcover" || id === "forest") continue;
      const sourceId = MAP_SOURCE_IDS[id];
      if (!sourceId) continue;
      const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
      if (!src) continue;
      try {
        let payload = data;
        if (id === "satellites") payload = satelliteDisplayData;
        if (id === "weather") payload = weatherDisplayData;
        
        src.setData(payload);
        console.info(`[map] source ${sourceId} setData — features=${(payload as any).features?.length ?? 0}`);
      } catch (err) {
        console.warn(`[map] failed to setData for ${sourceId}`, err);
      }
    }
  }, [mapReady, satelliteDisplayData, weatherDisplayData, sourceData]);

  useEffect(() => {
    if (!mapReady || !aoi || !jobInfo) return;
    if (stages.land !== "done") return;

    const map = mapRef.current;
    if (!map) return;

    const sourceId = MAP_SOURCE_IDS.forest;
    const layerId = "natural-forest-raster";
    const imageUrl = `${API_BASE_URL}/api/aoi/${jobInfo.aoiId}/land/forest.png?v=${encodeURIComponent(jobInfo.jobId)}`;
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [aoi.minLon, aoi.maxLat],
      [aoi.maxLon, aoi.maxLat],
      [aoi.maxLon, aoi.minLat],
      [aoi.minLon, aoi.minLat],
    ];

    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }

    map.addSource(sourceId, {
      type: "image",
      url: imageUrl,
      coordinates,
    });
    map.addLayer({
      id: layerId,
      type: "raster",
      source: sourceId,
      layout: { visibility: layers.find((layer) => layer.id === "forest")?.visible ? "visible" : "none" },
      paint: {
        "raster-opacity": 0.72,
        "raster-resampling": "nearest",
      },
    });
  }, [aoi, jobInfo, mapReady, stages.land, layers]);

  useEffect(() => {
    if (!mapReady || !aoi || !jobInfo) return;
    if (stages.land !== "done") return;

    const map = mapRef.current;
    if (!map) return;

    const sourceId = MAP_SOURCE_IDS.landcover;
    const layerId = "natural-landcover-raster";
    const imageUrl = `${API_BASE_URL}/api/aoi/${jobInfo.aoiId}/land/cover.png?v=${encodeURIComponent(jobInfo.jobId)}`;
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [aoi.minLon, aoi.maxLat],
      [aoi.maxLon, aoi.maxLat],
      [aoi.maxLon, aoi.minLat],
      [aoi.minLon, aoi.minLat],
    ];

    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }

    map.addSource(sourceId, {
      type: "image",
      url: imageUrl,
      coordinates,
    });
    map.addLayer({
      id: layerId,
      type: "raster",
      source: sourceId,
      layout: { visibility: layers.find((layer) => layer.id === "landcover")?.visible ? "visible" : "none" },
      paint: {
        "raster-opacity": 0.82,
        "raster-resampling": "nearest",
      },
    });
  }, [aoi, jobInfo, mapReady, stages.land, layers]);

  useEffect(() => {
    if (!mapReady || !aoi || !jobInfo) return;
    if (stages.dem !== "done") return;

    const map = mapRef.current;
    if (!map) return;

    const sourceId = MAP_SOURCE_IDS.terrain;
    const layerId = "dem-terrain-raster";
    const placeholderLayerId = "dem-terrain-circle";
    const imageUrl = `${API_BASE_URL}/api/aoi/${jobInfo.aoiId}/dem/elevation.png?v=${encodeURIComponent(jobInfo.jobId)}`;
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [aoi.minLon, aoi.maxLat],
      [aoi.maxLon, aoi.maxLat],
      [aoi.maxLon, aoi.minLat],
      [aoi.minLon, aoi.minLat],
    ];

    if (map.getLayer(placeholderLayerId)) {
      map.removeLayer(placeholderLayerId);
    }
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }

    map.addSource(sourceId, {
      type: "image",
      url: imageUrl,
      coordinates,
    });
    map.addLayer({
      id: layerId,
      type: "raster",
      source: sourceId,
      layout: { visibility: layers.find((layer) => layer.id === "terrain")?.visible ? "visible" : "none" },
      paint: {
        "raster-opacity": 0.96,
        "raster-resampling": "nearest",
      },
    });
  }, [aoi, jobInfo, mapReady, stages.dem]);

  // Sync layer visibility + opacity into MapLibre
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    for (const layer of layers) {
      const mapLayerIds = MAP_LAYER_IDS[layer.id] ?? [];
      for (const mapLayerId of mapLayerIds) {
        if (!map.getLayer(mapLayerId)) continue;
        map.setLayoutProperty(mapLayerId, "visibility", layer.visible ? "visible" : "none");

        const opacityProp = MAP_LAYER_OPACITY_PROP[mapLayerId];
        if (opacityProp) {
          try {
            map.setPaintProperty(mapLayerId, opacityProp, layer.opacity);
          } catch (err) {
            console.warn(`[map] failed to set opacity for ${mapLayerId}`, err);
          }
        }
        console.info(`[map] layer ${mapLayerId} visibility=${layer.visible}`);
      }
    }
  }, [layers, mapReady]);

  // Compute AoI-wide weather averages from the loaded grid points.
  // The map already shows per-point wind arrows; the panel shows one
  // averaged value per metric so the operator gets a single summary number.
  const weatherAverages = useMemo<WeatherAverages>(() => {
    const features = weatherDisplayData?.features ?? [];
    if (features.length === 0) return EMPTY_WEATHER_AVERAGES;

    const collect: Record<string, number[]> = {};
    for (const f of features) {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      for (const key of [
        "wind_speed_ms",
        "wind_gust_ms",
        "temperature_c",
        "cloudcover_pct",
        "cloudcover_high_pct",
        "visibility_m",
      ]) {
        const v = p[key];
        if (typeof v === "number" && Number.isFinite(v)) {
          (collect[key] ??= []).push(v);
        }
      }
    }

    const dirs: number[] = [];
    for (const f of features) {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const v = p.wind_dir_deg;
      if (typeof v === "number" && Number.isFinite(v)) dirs.push(v);
    }

    const linMean = (arr?: number[]): number | null =>
      arr && arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    // Wind direction needs a circular mean — linear averaging of 350° and 10°
    // would wrongly give 180°.
    function circularMeanDeg(angles: number[]): number | null {
      if (!angles.length) return null;
      let sumSin = 0;
      let sumCos = 0;
      for (const a of angles) {
        const r = (a * Math.PI) / 180;
        sumSin += Math.sin(r);
        sumCos += Math.cos(r);
      }
      const mean = Math.atan2(sumSin / angles.length, sumCos / angles.length);
      return ((mean * 180) / Math.PI + 360) % 360;
    }

    return {
      windSpeed:   linMean(collect.wind_speed_ms),
      windDir:     circularMeanDeg(dirs),
      windGust:    linMean(collect.wind_gust_ms),
      temperature: linMean(collect.temperature_c),
      cloudAmount: linMean(collect.cloudcover_pct),
      cloudHeight: linMean(collect.cloudcover_high_pct),
      visibility:  linMean(collect.visibility_m),
    };
  }, [weatherDisplayData]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    const cameraLayerId = "traffic-camera-symbol";
    const handleClick = (event: maplibregl.MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const props = feature?.properties as Record<string, unknown> | undefined;
      const stationId = typeof props?.station_id === "string" ? props.station_id : undefined;
      if (!stationId) return;
      setCameraStation({
        stationId,
        stationName: typeof props?.name === "string" ? props.name : null,
      });
    };

    const handleEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };

    const handleLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("click", cameraLayerId, handleClick);
    map.on("mouseenter", cameraLayerId, handleEnter);
    map.on("mouseleave", cameraLayerId, handleLeave);

    return () => {
      map.off("click", cameraLayerId, handleClick);
      map.off("mouseenter", cameraLayerId, handleEnter);
      map.off("mouseleave", cameraLayerId, handleLeave);
    };
  }, [mapReady]);

  // Sync loadState badges with backend stage status.
  // Does NOT include `layers` in deps — avoids re-running when loadState itself changes.
  useEffect(() => {
    setLayers((prev) =>
      prev.map((l) => {
        const stageName = SOURCE_STAGE[l.id];
        if (!stageName) return l;
        const status = stages[stageName];
        if (status === "error") return { ...l, loadState: "error" as const };
        // "done" loadState is set by the fetch effect after data arrives
        if (status === "done") {
          if (l.id === "terrain") return { ...l, loadState: "ready" as const, hasData: true };
          return l;
        }
        // pending / running / undefined → loading
        return { ...l, loadState: "loading" as const };
      })
    );
  }, [stages]);

  // Fetch data for every source whose stage is done. No visibility check —
  // data is pre-loaded so toggling a layer on is instant.
  // `layers` intentionally NOT in deps: including it would abort in-progress
  // fetches every time loadState or opacity changes.
  useEffect(() => {
    if (!sourceArea || !mapReady) return;
    const controller = new AbortController();

    for (const source of SOURCES) {
      const stageName = SOURCE_STAGE[source.id];
      if (!stageName) continue;
      if (source.id === "terrain") continue;
      if (stages[stageName] !== "done") continue;
      if (loadedSources.current.has(source.id)) continue;

      loadedSources.current.add(source.id);

      loadSource<FeatureCollection>(source.id, sourceArea, controller.signal)
        .then((fc) => {
          setSourceData((prev) => ({ ...prev, [source.id]: fc }));
          setLayerHasData(source.id, (fc.features ?? []).length > 0);
          setLayerLoadState(source.id, "ready");
        })
        .catch((err) => {
          if ((err as Error)?.name === "AbortError") {
            loadedSources.current.delete(source.id);
            return;
          }
          setLayerLoadState(source.id, "error");
        });
    }

    return () => controller.abort();
  }, [stages, sourceArea, mapReady]);

  function newMission() {
    sessionStorage.clear();
    navigate("/login");
  }

  const infraEnabled = useMemo(() => new Set(Object.keys(INFRA_TO_SOURCE).filter(k => typeof INFRA_TO_SOURCE[k] !== "undefined")), []);
  const infraStatusById = useMemo(() => {
    const roads = layers.find((layer) => layer.id === "infra_roads");
    const rail = layers.find((layer) => layer.id === "infra_rail");
    const towers = layers.find((layer) => layer.id === "cellular");
    return {
      roads: { loadState: roads?.loadState, hasData: roads?.hasData },
      rail: { loadState: rail?.loadState, hasData: rail?.hasData },
      towers: { loadState: towers?.loadState, hasData: towers?.hasData },
    };
  }, [layers]);

  const sections: LayerSection[] = [
    {
      title: "Natural Filters",
      layers: layers.filter((l) => BASE_IDS.includes(l.id)),
    },
    {
      title: "Weather",
      layers: layers.filter((l) => ATMOS_IDS.includes(l.id)),
    },
    { title: "Demographic",     layers: layers.filter((l) => DEMO_IDS.includes(l.id)) },
    { title: "Surveillance",    layers: layers.filter((l) => SURV_IDS.includes(l.id) && l.id !== "cellular") },
  ];

  // When infra selections change, toggle the corresponding source layers' visibility.
  useEffect(() => {
    setLayers((prev) =>
      prev.map((l) => {
        if (l.id === "infra_roads") {
          return { ...l, visible: infraSelected.has("roads") };
        }
        if (l.id === "cellular") {
          return { ...l, visible: infraSelected.has("towers") };
        }
        return l;
      })
    );
  }, [infraSelected]);

  const activeCount =
    layers.filter((l) => l.visible).length +
    infraSelected.size +
    derivedSelected.size;

  const exportLegends: ExportLegendState = useMemo(() => {
    const naturalFilters = layers.filter((l) => l.visible).map((l) => l.label);
    const infrastructureFilters = Array.from(infraSelected).map((id) => id);

    const derivedLabelByKey: Record<string, string> = {};
    for (const capability of capabilities) {
      for (const filter of capability.derivedFilters) {
        derivedLabelByKey[`${capability.id}:${filter.id}`] = `${capability.label}: ${filter.label}`;
      }
    }
    const derivedFilters = Array.from(derivedSelected).map((id) => derivedLabelByKey[id] ?? id);

    return {
      naturalFilters,
      infrastructureFilters,
      derivedFilters,
    };
  }, [capabilities, derivedSelected, infraSelected, layers]);

  if (!aoi) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      <TopBar
        bbox={aoi}
        layersActive={activeCount}
        capabilitiesCount={capabilities.length}
        onBack={() => navigate("/capabilities")}
        onNewMission={newMission}
      />

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <ToolPanel
          capabilities={capabilities}
          derivedSelected={derivedSelected}
          onDerivedToggle={toggleDerived}
          onManageForces={() => navigate("/capabilities")}
          onExport={onExport}
          onMissionWindow={() => setMissionWindowOpen(true)}
        />

        <div style={{ flex: 1, position: "relative" }}>
          <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
        </div>

        <LayerPanel
          sections={sections}
          infrastructureSelected={infraSelected}
          infraEnabled={infraEnabled}
          infraStatusById={infraStatusById}
          weatherAverages={weatherAverages}
          roadLegendVisible={layers.some((l) => l.id === "infra_roads" && l.visible)}
          onInfrastructureToggle={toggleInfra}
          onChange={onLayerChange}
        />
      </div>

      <TimeSlider
        forecastHorizonHours={missionConditions.lookaheadHours}
        windows={missionWindows}
        selectedOffsetHours={timelineOffsetHours}
        onOffsetChange={setTimelineOffsetHours}
        aoiCentroid={{
          lat: (aoi.minLat + aoi.maxLat) / 2,
          lon: (aoi.minLon + aoi.maxLon) / 2,
        }}
      />

      <ExportIpbReportModal
        open={exportOpen}
        screenshotDataUrl={exportShot}
        legends={exportLegends}
        onClose={() => setExportOpen(false)}
      />

      <MissionWindowModal
        open={missionWindowOpen}
        initial={missionConditions}
        onClose={() => setMissionWindowOpen(false)}
        onApply={onApplyMissionWindow}
      />

      <TrafficCameraModal
        open={cameraStation !== null}
        loading={cameraLoading}
        error={cameraError}
        stationId={cameraStation?.stationId ?? null}
        stationName={cameraStation?.stationName ?? cameraDetail?.name ?? null}
        detail={cameraDetail}
        onClose={() => {
          setCameraStation(null);
          setCameraDetail(null);
          setCameraLoading(false);
          setCameraError(null);
        }}
      />
    </div>
  );
}

/**
 * Placeholder window generator — UI-only.
 *
 * Builds a deterministic set of "good" / "uncertain" bands across the
 * configured horizon so the timeline shows something believable when
 * the operator presses Apply. Replace with the real
 * /api/mission-window/analyse response once it's wired up.
 */
function buildPlaceholderWindows(cond: MissionConditionsUi): MissionWindowBand[] {
  const horizon = Math.max(1, cond.lookaheadHours);

  // Score each ACTIVE atmospheric threshold as a 0..1 "permissiveness".
  // Looser thresholds → longer / more confident windows.
  // Rain on (no-rain required) is treated as a strict constraint (×0.6).
  // Time-of-day on shrinks the available envelope (×0.65).
  const parts: number[] = [];
  if (cond.windEnabled)       parts.push(clamp01(cond.maxWindSpeedMs / 25));
  if (cond.gustEnabled)       parts.push(clamp01(cond.maxWindGustMs / 40));
  if (cond.cloudEnabled)      parts.push(clamp01(cond.maxCloudcoverPct / 100));
  if (cond.visibilityEnabled) parts.push(clamp01(cond.minVisibilityM / 20000));
  if (cond.rainEnabled)       parts.push(0.6);
  if (cond.timeOfDayEnabled)  parts.push(0.65);

  const looseness = parts.length === 0 ? 1 : parts.reduce((a, b) => a * b, 1);

  const seeds = [
    { center: horizon * 0.18 },
    { center: horizon * 0.40 },
    { center: horizon * 0.65 },
    { center: horizon * 0.88 },
  ];

  const baseWidth = 6 + 14 * looseness; // 6h … 20h
  const bands: MissionWindowBand[] = [];

  for (let i = 0; i < seeds.length; i++) {
    const c = seeds[i].center;
    const half = baseWidth / 2;
    const start = Math.round(Math.max(0, c - half));
    const end = Math.round(Math.min(horizon, c + half));
    if (end <= start) continue;

    // Confidence drops with forecast horizon — later windows tend to be uncertain.
    const horizonFrac = c / horizon;
    const goodChance = (1 - horizonFrac) * (0.4 + 0.6 * looseness);
    const kind: MissionWindowBand["kind"] = goodChance >= cond.minScore ? "good" : "uncertain";

    bands.push({ startHour: start, endHour: end, kind });
  }

  return bands;
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function createTrafficCameraIcon(): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new ImageData(48, 48);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(232, 98, 42, 0.18)";
  ctx.beginPath();
  ctx.arc(24, 24, 20, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#e8622a";
  roundRect(ctx, 10, 16, 28, 18, 5);
  ctx.fill();

  ctx.fillStyle = "#1f1f1f";
  roundRect(ctx, 16, 12, 10, 8, 2);
  ctx.fill();

  ctx.fillStyle = "#f6f3ef";
  ctx.beginPath();
  ctx.arc(24, 25, 6, 0, Math.PI * 2);
  ctx.fill();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

interface TopBarProps {
  bbox: BoundingBox;
  layersActive: number;
  capabilitiesCount: number;
  onBack: () => void;
  onNewMission: () => void;
}

function TopBar({ bbox, layersActive, capabilitiesCount, onBack, onNewMission }: TopBarProps) {
  return (
    <div
      style={{
        height: 40,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px",
        background: "var(--color-bg-panel)",
        borderBottom: "1px solid var(--color-border-default)",
      }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" onClick={onBack}>
          ◀ Capabilities
        </button>
        <button className="btn" onClick={onNewMission}>
          ⟳ New Mission
        </button>
      </div>

      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          color: "var(--color-text-primary)",
        }}
      >
        Operations <span style={{ color: "var(--color-text-dim)" }}>//</span>{" "}
        <span style={{ fontFamily: "var(--font-data)", color: "var(--color-accent-orange)" }}>{bboxLabel(bbox)}</span>
      </div>

      <div
        style={{
          display: "flex",
          gap: 16,
          fontFamily: "var(--font-data)",
          fontSize: 11,
          color: "var(--color-text-secondary)",
        }}
      >
        <span>{layersActive} LAYERS ACTIVE</span>
        <span>·</span>
        <span>{capabilitiesCount} CAPABILITIES</span>
      </div>
    </div>
  );
}
