import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
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
import { cache } from "../registry/cache";
import { SOURCES, loadSource } from "../sources";
import { analysesForCapabilities } from "../analyses";
import { fetchTrajectories, CONSTELLATION_COLORS, CONSTELLATION_COLOR_FALLBACK, CONSTELLATION_LABELS } from "../api/satelliteIntel";
import { forward as mgrsForward } from "mgrs";

const SOURCE_ACCENTS: Record<string, string> = {
  terrain:     "#8a7a5a",
  satellite_imagery: "#d2b26d",
  landcover:   "#5a7a5a",
  forest:      "#2a7a2a",
  water:       "#2a6db5",
  weather:     "#2a6db5",
  infra_roads: "#a8a8a0",
  cellular:    "#2a9d8a",
  traffic_cameras: "#e8622a",
};

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

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
  satellite_imagery: "natural-satellite-src",
  landcover:   "natural-landcover-src",
  forest:      "natural-forest-src",
  water:       "natural-water-src",
  weather:     "natural-weather-src",
  terrain:     "dem-terrain-src",
  infra_roads: "infra-roads-src",
  cellular:    "cellular-src",
  traffic_cameras: "traffic-cameras-src",
};

// MapLibre layer ids that each data source drives
const MAP_LAYER_IDS: Record<string, string[]> = {
  satellite_imagery: ["natural-satellite-raster"],
  landcover:   ["natural-landcover-raster"],
  forest:      ["natural-forest-raster"],
  water:       ["natural-water-fill", "natural-water-line"],
  weather:     ["natural-weather-wind-arrows"],
  terrain:     ["dem-terrain-raster"],
  infra_roads: ["infra-roads-line"],
  cellular:    ["cellular-halo", "cellular-circle"],
  traffic_cameras: ["traffic-camera-symbol"],
};

const MAP_LAYER_OPACITY_PROP: Record<string, "fill-opacity" | "line-opacity" | "circle-opacity" | "icon-opacity" | "text-opacity" | "raster-opacity"> = {
  "natural-satellite-raster": "raster-opacity",
  "natural-landcover-fill": "fill-opacity",
  "natural-landcover-line": "line-opacity",
  "natural-forest-fill":    "fill-opacity",
  "natural-landcover-raster": "raster-opacity",
  "natural-forest-raster":    "raster-opacity",
  "natural-water-fill":     "fill-opacity",
  "natural-water-line":     "line-opacity",
  "natural-weather-wind-arrows": "text-opacity",
  "dem-terrain-raster":     "raster-opacity",
  "infra-roads-line":       "line-opacity",
  "cellular-halo":          "circle-opacity",
  "cellular-circle":        "circle-opacity",
  "traffic-camera-symbol":  "icon-opacity",
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
  satellite_imagery: "satellite_imagery",
  landcover:   "land",
  forest:      "land",
  water:       "water",
  weather:     "weather",
  terrain:     "dem",
  infra_roads: "infrastructure",
  cellular:    "cellular",
  traffic_cameras: "traffic_cameras",
};

interface JobInfo {
  aoiId: string;
  jobId: string;
}

type ImageSourceWithUpdate = maplibregl.ImageSource & {
  updateImage(options: {
    url: string;
    coordinates: [[number, number], [number, number], [number, number], [number, number]];
  }): unknown;
};

interface SatelliteOverlayConfig {
  provider: string;
  tileset: string;
  image_format: string;
  tile_size: number;
  minzoom: number;
  maxzoom: number;
  attribution?: string;
}


function loadAoi(): BoundingBox | null {
  try {
    return JSON.parse(sessionStorage.getItem("aoi") ?? "null");
  } catch {
    return null;
  }
}

function loadAoiId(): string | null {
  try {
    const aoiId = sessionStorage.getItem("aoi_id");
    return aoiId && aoiId.trim() ? aoiId : null;
  } catch {
    return null;
  }
}

function buildCompletedStages(): Record<string, string> {
  const stageNames = Array.from(new Set(Object.values(SOURCE_STAGE)));
  return Object.fromEntries(stageNames.map((stageName) => [stageName, "done"])) as Record<string, string>;
}

function buildPendingStages(): Record<string, string> {
  const stageNames = Array.from(new Set(Object.values(SOURCE_STAGE)));
  return Object.fromEntries(stageNames.map((stageName) => [stageName, "pending"])) as Record<string, string>;
}

function createEmptySourceData(): Record<string, FeatureCollection> {
  return {
    landcover: EMPTY_FC,
    forest: EMPTY_FC,
    water: EMPTY_FC,
    weather: EMPTY_FC,
    terrain: EMPTY_FC,
    infra_roads: EMPTY_FC,
    cellular: EMPTY_FC,
    traffic_cameras: EMPTY_FC,
    satellites: EMPTY_FC,
  };
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
  // 4-digit MGRS = 10 m precision, formatted with grid-zone + 100k-square + easting/northing
  // (e.g. "34VFM 1234 1254"). Falls back to decimal degrees on conversion failure
  // (e.g. polar regions outside the MGRS UPS bounds at this library's coverage).
  try {
    const raw = mgrsForward([lon, lat], 4); // returns "34VFM12341254"
    const m = /^([0-9]{1,2}[A-Z])([A-Z]{2})([0-9]+)$/.exec(raw);
    if (m) {
      const half = m[3].length / 2;
      return `${m[1]}${m[2]} ${m[3].slice(0, half)} ${m[3].slice(half)}`;
    }
    return raw;
  } catch {
    const lonStr = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
    const latStr = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
    return `${latStr} ${lonStr}`;
  }
}

export default function OperationsPage() {
  const navigate = useNavigate();
  const aoi = useMemo(() => loadAoi(), []);
  const persistedAoiId = useMemo(() => loadAoiId(), []);
  const capabilities = useMemo(() => loadCapabilities(), []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const movementCorridorsImageUrlRef = useRef<string | null>(null);
  const fpvThreatImageUrlRef = useRef<string | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [layers, setLayers] = useState<LayerConfig[]>(INITIAL_LAYERS);
  const [analysisLayers, setAnalysisLayers] = useState<Record<string, { visible: boolean; opacity: number }>>({});
  const [infraSelected, setInfraSelected] = useState<Set<string>>(new Set());
  const [derivedSelected, setDerivedSelected] = useState<Set<string>>(new Set());
  const [derivedLoading, setDerivedLoading] = useState<Set<string>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const [exportShot, setExportShot] = useState<string | null>(null);
  const [missionWindowOpen, setMissionWindowOpen] = useState(false);
  const [missionConditions, setMissionConditions] = useState<MissionConditionsUi>(DEFAULT_CONDITIONS);
  const [missionWindows, setMissionWindows] = useState<MissionWindowBand[]>([]);
  const [analyzingWindows, setAnalyzingWindows] = useState(false);
  const [timelineOffsetHours, setTimelineOffsetHours] = useState(0);
  const [cameraStation, setCameraStation] = useState<{ stationId: string; stationName: string | null } | null>(null);
  const [cameraDetail, setCameraDetail] = useState<TrafficCameraStationDetail | null>(null);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [refreshingAoi, setRefreshingAoi] = useState(false);

  // Satellite trajectory state — fetched on-demand when a constellation is toggled on.
  const [satTracks, setSatTracks] = useState<FeatureCollection>(EMPTY_FC);
  const [satTracksLoadState, setSatTracksLoadState] = useState<"idle" | "loading" | "done">("idle");
  const satTracksLoaded = useRef(false);
  const satTracksLoading = useRef(false);

  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null);
  const [stages, setStages] = useState<Record<string, string>>(() => (persistedAoiId ? buildCompletedStages() : {}));
  const loadedSources = useRef<Set<string>>(new Set());
  const [sourceData, setSourceData] = useState<Record<string, FeatureCollection>>({
    satellite_imagery: EMPTY_FC,
    landcover:   EMPTY_FC,
    forest:      EMPTY_FC,
    water:       EMPTY_FC,
    weather:     EMPTY_FC,
    terrain:     EMPTY_FC,
    infra_roads: EMPTY_FC,
    infra_rail:  EMPTY_FC,
    cellular:    EMPTY_FC,
    traffic_cameras: EMPTY_FC,
  });

  const terrainElevRange = useMemo(() => {
    const elevations = sourceData.terrain.features
      .map((f) => (f.properties as Record<string, unknown> | null)?.elevation_m)
      .filter((v): v is number => typeof v === "number" && isFinite(v));
    if (elevations.length === 0) return null;
    return { min: Math.round(Math.min(...elevations)), max: Math.round(Math.max(...elevations)) };
  }, [sourceData.terrain]);

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

  const activeAoiId = jobInfo?.aoiId ?? persistedAoiId;
  const rasterVersion = jobInfo?.jobId ?? activeAoiId;

  const sourceArea = useMemo(() => {
    if (!aoi || !activeAoiId) return null;
    return {
      ...bboxToArea(aoi),
      metadata: { aoi_id: activeAoiId },
    };
  }, [aoi, activeAoiId]);

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

  const selectedWeatherValidTime = useMemo(() => {
    const feature = weatherDisplayData.features[0];
    const validTime = feature?.properties?.valid_time;
    return typeof validTime === "string" && validTime.trim() ? validTime : null;
  }, [weatherDisplayData]);

  const weatherForecastHorizonHours = useMemo(() => {
    const raw = sourceData.weather;
    if (!raw || !raw.features || raw.features.length === 0) return missionConditions.lookaheadHours;

    const nowMs = Date.now();
    let maxOffsetHours = 0;
    for (const f of raw.features) {
      const ts = toEpochMs(f.properties?.valid_time);
      if (ts === null) continue;
      const offsetHours = (ts - nowMs) / 3_600_000;
      if (offsetHours > maxOffsetHours) maxOffsetHours = offsetHours;
    }
    return Math.max(1, Math.ceil(maxOffsetHours));
  }, [sourceData.weather, missionConditions.lookaheadHours]);

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

  const INFRA_TO_SOURCE: Record<string, string | undefined> = {
    roads: "infra_roads",
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
      return next;
    });

    // Satellite intel filters are `satellite_intelligence:<constellation_id>`.
    // Fetch trajectories once (all constellations in a single request) the
    // first time any satellite filter is turned on.
    if (id.startsWith("satellite_intelligence:") && activeAoiId && !satTracksLoaded.current && !satTracksLoading.current) {
      satTracksLoading.current = true;
      setSatTracksLoadState("loading");
      fetchTrajectories(activeAoiId)
        .then((fc) => {
          setSatTracks(fc);
          // Only mark as loaded when we got actual data — allows retry if
          // the backend returned an empty collection (e.g. CelesTrak was down).
          if ((fc.features ?? []).length > 0) satTracksLoaded.current = true;
        })
        .catch((err) => {
          console.warn("[satellite-intel] trajectory fetch failed", err);
        })
        .finally(() => {
          satTracksLoading.current = false;
          setSatTracksLoadState("done");
        });
    }
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

  async function onApplyMissionWindow(cond: MissionConditionsUi) {
    setMissionConditions(cond);
    setAnalyzingWindows(true);
    try {
      // If Satellite Surveillance is required but trajectories haven't been
      // fetched yet, pull them once before the analysis runs so the filter
      // has data to check against. Mirrors the lazy fetch used by the
      // surveillance filters in the side panel.
      let tracks = satTracks;
      if ((cond.satOpticalEnabled || cond.satSarEnabled)
          && activeAoiId
          && !satTracksLoaded.current
          && !satTracksLoading.current) {
        satTracksLoading.current = true;
        setSatTracksLoadState("loading");
        try {
          const fc = await fetchTrajectories(activeAoiId);
          tracks = fc;
          setSatTracks(fc);
          satTracksLoaded.current = true;
        } catch (err) {
          console.warn("[mission-window] satellite trajectory fetch failed", err);
        } finally {
          satTracksLoading.current = false;
          setSatTracksLoadState("done");
        }
      }
      setMissionWindows(buildPlaceholderWindows(cond, sourceData.weather, tracks));
    } finally {
      setAnalyzingWindows(false);
    }
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
    setArea({
      ...bboxToArea(aoi),
      metadata: persistedAoiId ? { aoi_id: persistedAoiId } : {},
    });
  }, [aoi, navigate, persistedAoiId]);

  useEffect(() => {
    if (!jobInfo) return;
    loadedSources.current.clear();
    cache.invalidate();
    setSourceData(createEmptySourceData());
    setStages(buildPendingStages());
  }, [jobInfo?.jobId]);

  useEffect(() => {
    if (!aoi || jobInfo || persistedAoiId) return;
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
  }, [aoi, jobInfo, persistedAoiId]);

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

  // When a job starts, immediately mark all tracked sources as loading.
  // Reopened saved AOIs reuse existing data and skip this transition.
  useEffect(() => {
    if (!jobInfo) return;
    setLayers((prev) =>
      prev.map((l) => (SOURCE_STAGE[l.id] ? { ...l, loadState: "loading" as const } : l))
    );
  }, [jobInfo]);

  async function refetchCurrentAoi() {
    if (!activeAoiId || !aoi || refreshingAoi) return;
    setRefreshingAoi(true);
    try {
      cache.invalidate();
      loadedSources.current.clear();
      setSourceData(createEmptySourceData());
      setStages(buildPendingStages());

      const res = await fetch(`${API_BASE_URL}/api/aoi/${activeAoiId}/refresh`, { method: "POST" });
      if (!res.ok) {
        throw new Error(`request failed (${res.status})`);
      }
      const payload = await res.json();
      if (!payload?.aoi_id || !payload?.job_id) {
        throw new Error("missing refresh job response");
      }
      setJobInfo({ aoiId: payload.aoi_id, jobId: payload.job_id });
    } catch (error) {
      console.error("Failed to refetch AOI data", error);
    } finally {
      setRefreshingAoi(false);
    }
  }

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
    map.addControl(
      new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }),
      "bottom-right",
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
            0,   "#ffffff",
            30,  "#ffd0c0",
            80,  "#ff9070",
            150, "#ff5830",
            250, "#cc2010",
            400, "#7a0000",
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
            0,  "#b8dcff",
            8,  "#6aaee8",
            14, "#2f79c4",
            20, "#154a94",
            26, "#0a1f5c",
          ],
          "text-halo-color": "rgba(0,0,0,0.85)",
          "text-halo-width": 1.5,
          "text-opacity": 0.92,
        },
      });

      // ── Infrastructure ────────────────────────────────────────────────────
      // NLS tieviiva kohdeluokka codes:
      //   12111/12112 = moottoritie (motorway)
      //   12121/12122 = valtatie (national highway)
      //   12131/12132 = kantatie (trunk road)
      //   12141/12142 = seututie (regional road)
      //   12151–12153 = local/private/ferry → default
      //   12311–12313 = winter road/path/cycle → default
      map.addSource(MAP_SOURCE_IDS.infra_roads, { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "infra-roads-line",
        type: "line",
        source: MAP_SOURCE_IDS.infra_roads,
        layout: { visibility: "none" },
        paint: {
          "line-color": [
            "match", ["coalesce", ["get", "kohdeluokka"], 0],
            12111, "#7a1919",
            12112, "#7a1919",
            12121, "#c0392b",
            12122, "#c0392b",
            12131, "#d35400",
            12132, "#d35400",
            12141, "#f1c40f",
            12142, "#f1c40f",
            "#ffd47a",
          ] as maplibregl.ExpressionSpecification,
          "line-width": [
            "match", ["coalesce", ["get", "kohdeluokka"], 0],
            12111, 3.5,
            12112, 3.5,
            12121, 2.8,
            12122, 2.8,
            12131, 2.2,
            12132, 2.2,
            12141, 1.8,
            12142, 1.8,
            1.0,
          ] as maplibregl.ExpressionSpecification,
          "line-opacity": 0.9,
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

      // ── Satellite tracks ──────────────────────────────────────────────────
      // One GeoJSON source holds all constellation ground tracks + overpass
      // points. Layer filters control per-constellation visibility.
      const constColorExpr = [
        "match", ["get", "constellation"],
        "sentinel_1",    CONSTELLATION_COLORS.sentinel_1,
        "sentinel_2",    CONSTELLATION_COLORS.sentinel_2,
        "landsat_9",     CONSTELLATION_COLORS.landsat_9,
        "iceye_x",       CONSTELLATION_COLORS.iceye_x,
        "planet_skysat", CONSTELLATION_COLORS.planet_skysat,
        CONSTELLATION_COLOR_FALLBACK,
      ] as maplibregl.ExpressionSpecification;

      map.addSource("satellite-tracks-src", { type: "geojson", data: EMPTY_FC });

      // Ground-track lines (LineString + MultiLineString)
      map.addLayer({
        id: "satellite-tracks-line",
        type: "line",
        source: "satellite-tracks-src",
        filter: ["==", ["get", "feature_type"], "track"],
        layout: { visibility: "none", "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": constColorExpr,
          "line-width": 1.5,
          "line-opacity": 0.75,
          "line-dasharray": [4, 3],
        },
      });

      // Overpass points — separate source so time-slider filtering never touches
      // the track-line source and can be updated cheaply on every slider tick.
      // Satellite track labels — shown along each ground track line
      map.addLayer({
        id: "satellite-tracks-label",
        type: "symbol",
        source: "satellite-tracks-src",
        filter: ["==", ["get", "feature_type"], "track"],
        layout: {
          visibility: "none",
          "symbol-placement": "line",
          "symbol-spacing": 300,
          "text-field": ["get", "satellite_name"],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": 10,
          "text-offset": [0, -0.8],
          "text-allow-overlap": false,
          "text-ignore-placement": false,
          "text-keep-upright": true,
        },
        paint: {
          "text-color": constColorExpr,
          "text-halo-color": "rgba(0,0,0,0.85)",
          "text-halo-width": 1.5,
          "text-opacity": 0.9,
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
      if (id === "terrain" || id === "satellite_imagery" || id === "landcover" || id === "forest") continue;
      const sourceId = MAP_SOURCE_IDS[id];
      if (!sourceId) continue;
      const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
      if (!src) continue;
      try {
        let payload = data;
        if (id === "weather") payload = weatherDisplayData;
        
        src.setData(payload);
        console.info(`[map] source ${sourceId} setData — features=${(payload as any).features?.length ?? 0}`);
      } catch (err) {
        console.warn(`[map] failed to setData for ${sourceId}`, err);
      }
    }
  }, [mapReady, weatherDisplayData, sourceData]);

  useEffect(() => {
    if (!mapReady || !aoi || !activeAoiId || !rasterVersion) return;
    if (stages.land !== "done") return;

    const map = mapRef.current;
    if (!map) return;

    const sourceId = MAP_SOURCE_IDS.forest;
    const layerId = "natural-forest-raster";
    const imageUrl = `${API_BASE_URL}/api/aoi/${activeAoiId}/land/forest.png?v=${encodeURIComponent(rasterVersion)}`;
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
      layout: { visibility: "none" },
      paint: {
        "raster-opacity": 0.72,
        "raster-resampling": "nearest",
      },
    });
  }, [aoi, jobInfo, mapReady, stages.land, layers]);

  useEffect(() => {
    if (!mapReady || !aoi || !jobInfo) return;
    if (stages.satellite_imagery !== "done") return;
    if (!MAPTILER_KEY) return;

    const currentJob = jobInfo;
    const mapInstance = mapRef.current;
    if (!mapInstance) return;
    const map: maplibregl.Map = mapInstance;

    const controller = new AbortController();
    const sourceId = MAP_SOURCE_IDS.satellite_imagery;
    const layerId = "natural-satellite-raster";

    async function syncSatelliteOverlay() {
      const res = await fetch(
        `${API_BASE_URL}/api/aoi/${currentJob.aoiId}/satellite_imagery/overlay?v=${encodeURIComponent(currentJob.jobId)}`,
        { signal: controller.signal },
      );
      if (!res.ok) {
        throw new Error(`request failed (${res.status})`);
      }

      const overlay = (await res.json()) as SatelliteOverlayConfig;
      const tiles = [
        `https://api.maptiler.com/tiles/${overlay.tileset}/{z}/{x}/{y}.${overlay.image_format}?key=${MAPTILER_KEY}`,
      ];

      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }
      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }

      map.addSource(sourceId, {
        type: "raster",
        tiles,
        tileSize: overlay.tile_size,
        minzoom: overlay.minzoom,
        maxzoom: overlay.maxzoom,
        attribution: overlay.attribution,
      });
      map.addLayer({
        id: layerId,
        type: "raster",
        source: sourceId,
        layout: { visibility: layers.find((layer) => layer.id === "satellite_imagery")?.visible ? "visible" : "none" },
        paint: {
          "raster-opacity": layers.find((layer) => layer.id === "satellite_imagery")?.opacity ?? 0.78,
          "raster-resampling": "linear",
        },
      }, "aoi-outline");
    }

    syncSatelliteOverlay().catch((err) => {
      if ((err as Error)?.name === "AbortError") return;
      console.warn("[map] failed to load satellite imagery overlay", err);
      setLayerLoadState("satellite_imagery", "error");
    });

    return () => controller.abort();
  }, [aoi, jobInfo, layers, mapReady, stages.satellite_imagery]);

  useEffect(() => {
    if (!mapReady || !aoi || !activeAoiId || !rasterVersion) return;
    if (stages.land !== "done") return;

    const map = mapRef.current;
    if (!map) return;

    const sourceId = MAP_SOURCE_IDS.landcover;
    const layerId = "natural-landcover-raster";
    const imageUrl = `${API_BASE_URL}/api/aoi/${activeAoiId}/land/cover.png?v=${encodeURIComponent(rasterVersion)}`;
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
      layout: { visibility: "none" },
      paint: {
        "raster-opacity": 0.82,
        "raster-resampling": "nearest",
      },
    });
  }, [aoi, activeAoiId, rasterVersion, mapReady, stages.land]);

  useEffect(() => {
    if (!mapReady || !aoi || !activeAoiId || !rasterVersion) return;
    if (stages.dem !== "done") return;

    const map = mapRef.current;
    if (!map) return;

    const sourceId = MAP_SOURCE_IDS.terrain;
    const layerId = "dem-terrain-raster";
    const placeholderLayerId = "dem-terrain-circle";
    const imageUrl = `${API_BASE_URL}/api/aoi/${activeAoiId}/dem/elevation.png?v=${encodeURIComponent(rasterVersion)}`;
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
  }, [aoi, activeAoiId, rasterVersion, mapReady, stages.dem]);

  // Movement-corridors (heavy vehicles) — lazy raster derived from DEM + forest + water + roads.
  // The PNG is built on the backend the first time the URL is requested, then cached
  // on disk. We prefetch the URL once when the toggle is turned on so we can show a
  // loading spinner in ToolPanel while the backend builds the file; then we add the
  // raster source to MapLibre (which re-fetches via the browser's HTTP cache instantly).
  // Subsequent toggles flip visibility on/off without re-fetching.
  const movementCorridorsHeavyKey = "heavy_vehicles:movement_corridors";
  useEffect(() => {
    if (!mapReady || !aoi || !activeAoiId || !rasterVersion) return;
    // Wait for upstream stages so the backend has inputs ready when the
    // PNG is requested. The compute itself reads the cached files only.
    if (
      stages.dem !== "done"
      || stages.land !== "done"
      || stages.infrastructure !== "done"
      || stages.water !== "done"
    ) return;

    const map = mapRef.current;
    if (!map) return;

    const sourceId = "derived-movement-corridors-heavy-src";
    const layerId = "derived-movement-corridors-heavy-raster";
    const enabled = derivedSelected.has(movementCorridorsHeavyKey);
    const imageUrl = `${API_BASE_URL}/api/aoi/${activeAoiId}/derived/movement_corridors/heavy.png?v=${encodeURIComponent(rasterVersion)}`;
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [aoi.minLon, aoi.maxLat],
      [aoi.maxLon, aoi.maxLat],
      [aoi.maxLon, aoi.minLat],
      [aoi.minLon, aoi.minLat],
    ];

    if (!enabled) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", "none");
      }
      return;
    }

    if (map.getSource(sourceId) && movementCorridorsImageUrlRef.current === imageUrl) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", "visible");
      }
      return;
    }

    setDerivedLoading((prev) => {
      if (prev.has(movementCorridorsHeavyKey)) return prev;
      const next = new Set(prev);
      next.add(movementCorridorsHeavyKey);
      return next;
    });

    const controller = new AbortController();
    let cancelled = false;

    fetch(imageUrl, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        return res.blob();
      })
      .then(() => {
        if (cancelled) return;
        const existingSource = map.getSource(sourceId) as ImageSourceWithUpdate | undefined;
        if (existingSource) {
          existingSource.updateImage({ url: imageUrl, coordinates });
        } else {
          map.addSource(sourceId, { type: "image", url: imageUrl, coordinates });
          map.addLayer({
            id: layerId,
            type: "raster",
            source: sourceId,
            paint: {
              "raster-opacity": 0.85,
              "raster-resampling": "nearest",
            },
          });
        }
        movementCorridorsImageUrlRef.current = imageUrl;
      })
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        console.warn("[movement-corridors] fetch failed", err);
      })
      .finally(() => {
        if (cancelled) return;
        setDerivedLoading((prev) => {
          if (!prev.has(movementCorridorsHeavyKey)) return prev;
          const next = new Set(prev);
          next.delete(movementCorridorsHeavyKey);
          return next;
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [aoi, activeAoiId, rasterVersion, mapReady, stages.dem, stages.land, stages.infrastructure, stages.water, derivedSelected]);

  // FPV-threat areas (drones) — lazy raster derived from land-cover density + weather.
  // Backend computes this from raw land cover polygons (dense-forest mask) and nearest
  // wind grid, then serves a cached PNG. We prefetch once on first toggle-on so the
  // ToolPanel row can show the same loading spinner behavior as movement corridors.
  const fpvThreatAreasKey = "fpv_drones:fpv_threat_areas";
  useEffect(() => {
    if (!mapReady || !aoi || !activeAoiId || !rasterVersion) return;
    if (stages.land !== "done" || stages.weather !== "done") return;

    const map = mapRef.current;
    if (!map) return;

    const sourceId = "derived-fpv-threat-src";
    const layerId = "derived-fpv-threat-raster";
    const enabled = derivedSelected.has(fpvThreatAreasKey);
    const validTimeQuery = selectedWeatherValidTime
      ? `?valid_time=${encodeURIComponent(selectedWeatherValidTime)}&v=${encodeURIComponent(rasterVersion)}`
      : `?v=${encodeURIComponent(rasterVersion)}`;
    const imageUrl = `${API_BASE_URL}/api/aoi/${activeAoiId}/derived/fpv_threat.png${validTimeQuery}`;
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [aoi.minLon, aoi.maxLat],
      [aoi.maxLon, aoi.maxLat],
      [aoi.maxLon, aoi.minLat],
      [aoi.minLon, aoi.minLat],
    ];

    if (!enabled) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", "none");
      }
      return;
    }

    if (map.getSource(sourceId) && fpvThreatImageUrlRef.current === imageUrl) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", "visible");
      }
      return;
    }

    setDerivedLoading((prev) => {
      if (prev.has(fpvThreatAreasKey)) return prev;
      const next = new Set(prev);
      next.add(fpvThreatAreasKey);
      return next;
    });

    const controller = new AbortController();
    let cancelled = false;

    fetch(imageUrl, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        return res.blob();
      })
      .then(() => {
        if (cancelled) return;
        const existingSource = map.getSource(sourceId) as ImageSourceWithUpdate | undefined;
        if (existingSource) {
          existingSource.updateImage({ url: imageUrl, coordinates });
        } else {
          map.addSource(sourceId, { type: "image", url: imageUrl, coordinates });
          map.addLayer({
            id: layerId,
            type: "raster",
            source: sourceId,
            paint: {
              "raster-opacity": 0.78,
              "raster-resampling": "nearest",
            },
          });
        }
        fpvThreatImageUrlRef.current = imageUrl;
      })
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        console.warn("[fpv-threat] fetch failed", err);
      })
      .finally(() => {
        if (cancelled) return;
        setDerivedLoading((prev) => {
          if (!prev.has(fpvThreatAreasKey)) return prev;
          const next = new Set(prev);
          next.delete(fpvThreatAreasKey);
          return next;
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [aoi, activeAoiId, rasterVersion, mapReady, stages.land, stages.weather, derivedSelected, selectedWeatherValidTime]);

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

  // Active satellite constellation ids (e.g. "sentinel_1", "landsat_9")
  const activeSatConstellations = useMemo(() => {
    const active = new Set<string>();
    for (const filterId of derivedSelected) {
      if (filterId.startsWith("satellite_intelligence:")) {
        active.add(filterId.split(":", 2)[1]);
      }
    }
    return active;
  }, [derivedSelected]);

  // Constellations toggled on but with zero track features — only computed after fetch completes.
  const satConstellationsNoData = useMemo(() => {
    if (activeSatConstellations.size === 0 || satTracksLoadState !== "done") return new Set<string>();
    const withTracks = new Set(
      satTracks.features
        .filter((f) => f.properties?.feature_type === "track")
        .map((f) => f.properties?.constellation as string)
        .filter(Boolean)
    );
    return new Set([...activeSatConstellations].filter((c) => !withTracks.has(c)));
  }, [activeSatConstellations, satTracks, satTracksLoadState]);

  // Next overpass per active constellation — same orbital-pass grouping as the map dots.
  // Uses pass END time as the cutoff so the display stays stable throughout the brief
  // 1–3 min crossing window. Picks the closest-approach point within each pass.
  const nextOverpassByConstellation = useMemo(() => {
    if (activeSatConstellations.size === 0) return {} as Record<string, { satellite_name: string; timestamp: string; distance_km: number }>;
    const sliderMs = Date.now() + timelineOffsetHours * 3_600_000;
    const PASS_GAP_MS = 60 * 60 * 1000;

    type PassPoint = { timeMs: number; distKm: number; satName: string; timestamp: string };

    // Collect overpass points per constellation → per NORAD ID.
    const perConstSat = new Map<string, Map<string, PassPoint[]>>();
    for (const feature of satTracks.features) {
      const props = feature.properties as Record<string, unknown> | null;
      if (!props || props.feature_type !== "overpass") continue;
      const cid = props.constellation as string;
      if (!activeSatConstellations.has(cid)) continue;
      const norad = props.norad_id as string;
      const timeMs = Date.parse(props.timestamp as string);
      if (isNaN(timeMs)) continue;
      if (!perConstSat.has(cid)) perConstSat.set(cid, new Map());
      const satMap = perConstSat.get(cid)!;
      if (!satMap.has(norad)) satMap.set(norad, []);
      satMap.get(norad)!.push({ timeMs, distKm: (props.distance_km as number) ?? Infinity, satName: props.satellite_name as string, timestamp: props.timestamp as string });
    }

    const result: Record<string, { satellite_name: string; timestamp: string; distance_km: number }> = {};

    for (const [cid, satMap] of perConstSat) {
      // For each satellite, find its first upcoming pass (pass end >= sliderMs).
      // Among all satellites in the constellation, pick the one whose pass starts earliest.
      let best: { satName: string; timestamp: string; distKm: number; passStartMs: number } | null = null;

      for (const points of satMap.values()) {
        points.sort((a, b) => a.timeMs - b.timeMs);

        // Group into orbital passes.
        const passes: PassPoint[][] = [];
        let cur: PassPoint[] = [];
        for (const pt of points) {
          if (cur.length === 0 || pt.timeMs - cur[cur.length - 1].timeMs <= PASS_GAP_MS) {
            cur.push(pt);
          } else { passes.push(cur); cur = [pt]; }
        }
        if (cur.length > 0) passes.push(cur);

        // First pass whose end is still in the future.
        for (const pass of passes) {
          if (pass[pass.length - 1].timeMs < sliderMs) continue;
          const closest = pass.reduce((a, b) => (a.distKm <= b.distKm ? a : b));
          if (!best || pass[0].timeMs < best.passStartMs) {
            best = { satName: closest.satName, timestamp: closest.timestamp, distKm: closest.distKm, passStartMs: pass[0].timeMs };
          }
          break;
        }
      }

      if (best) result[cid] = { satellite_name: best.satName, timestamp: best.timestamp, distance_km: best.distKm };
    }

    return result;
  }, [satTracks, activeSatConstellations, timelineOffsetHours]);

  // Push loaded satellite tracks into the MapLibre GeoJSON source (full 72h, all constellations).
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("satellite-tracks-src") as maplibregl.GeoJSONSource | undefined;
    src?.setData(satTracks);
  }, [mapReady, satTracks]);


  // Animate the satellite track lines with a flowing dash effect.
  // We keep line-dasharray fixed at [4, 3] and animate line-dash-offset instead.
  // Changing dasharray length each frame causes MapLibre to recompile shaders,
  // which flickers / hides the layer — offset animation avoids that entirely.
  useEffect(() => {
    if (!mapReady || activeSatConstellations.size === 0) return;
    const map = mapRef.current;
    if (!map) return;

    const PERIOD = 7; // DASH(4) + GAP(3)
    const UNITS_PER_SECOND = 3;

    let offset = 0;
    let lastTs = performance.now();
    let raf: number;

    function animate(now: number) {
      offset -= ((now - lastTs) / 1000) * UNITS_PER_SECOND;
      // Keep offset in [-PERIOD, 0] to avoid float drift over long sessions.
      if (offset < -PERIOD) offset += PERIOD;
      lastTs = now;
      const m = mapRef.current;
      try {
        m?.setPaintProperty("satellite-tracks-line", "line-dash-offset", offset);
      } catch { /* layer may not exist yet on first tick */ }
      raf = requestAnimationFrame(animate);
    }

    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [mapReady, activeSatConstellations]);

  // Show / hide satellite layers and filter by active constellations.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    const activeArr = Array.from(activeSatConstellations);
    const hasActive = activeArr.length > 0;
    const vis = hasActive ? "visible" : "none";
    // Track lines/labels filter by constellation (source has all constellations).
    // Overpass and current-position sources are already pre-filtered by memos.
    const trackFilter: maplibregl.FilterSpecification = hasActive
      ? ["in", ["get", "constellation"] as maplibregl.ExpressionSpecification, ["literal", activeArr] as maplibregl.ExpressionSpecification]
      : ["==", 1, 0];

    for (const layerId of ["satellite-tracks-line", "satellite-tracks-label"]) {
      if (!map.getLayer(layerId)) continue;
      map.setLayoutProperty(layerId, "visibility", vis);
      map.setFilter(layerId, trackFilter);
    }
  }, [mapReady, activeSatConstellations]);


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
          if (l.id === "satellite_imagery") return { ...l, loadState: "ready" as const, hasData: true };
          if (l.id === "terrain")          return { ...l, loadState: "ready" as const, hasData: true };
          // forest and landcover go through the fetch effect, which is the
          // authoritative source for hasData — don't overwrite it here.
          if (l.id === "forest")           return { ...l, loadState: "ready" as const };
          if (l.id === "landcover")        return { ...l, loadState: "ready" as const };
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
      if (source.id === "terrain" || source.id === "satellite_imagery") continue;
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
    return {
      roads: { loadState: roads?.loadState, hasData: roads?.hasData },
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

  useEffect(() => {
    setLayers((prev) =>
      prev.map((l) => {
        if (l.id === "infra_roads") return { ...l, visible: infraSelected.has("roads") };
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
        onRefetch={refetchCurrentAoi}
        refetching={refreshingAoi}
      />

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <ToolPanel
          capabilities={capabilities}
          derivedSelected={derivedSelected}
          derivedLoading={derivedLoading}
          onDerivedToggle={toggleDerived}
          onManageForces={() => navigate("/capabilities")}
          onExport={onExport}
          onMissionWindow={() => setMissionWindowOpen(true)}
        />

        <div style={{ flex: 1, position: "relative" }}>
          <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
          <MapLegend
            layers={layers}
            terrainElevRange={terrainElevRange}
            derivedSelected={derivedSelected}
          />
          <SatOverpassPanel
            activeSatConstellations={activeSatConstellations}
            nextOverpassByConstellation={nextOverpassByConstellation}
            satTracksLoadState={satTracksLoadState}
            timelineOffsetHours={timelineOffsetHours}
          />
        </div>

        <LayerPanel
          sections={sections}
          infrastructureSelected={infraSelected}
          infraEnabled={infraEnabled}
          infraStatusById={infraStatusById}
          weatherAverages={weatherAverages}
          onInfrastructureToggle={toggleInfra}
          onChange={onLayerChange}
        />
      </div>

      <TimeSlider
        forecastHorizonHours={Math.max(missionConditions.lookaheadHours, weatherForecastHorizonHours)}
        windows={missionWindows}
        analyzing={analyzingWindows}
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
        analyzing={analyzingWindows}
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
 * Mission window scoring.
 *
 * Walks the loaded weather time-series and marks each forecast timestep as
 * pass/fail against every *enabled* condition. Contiguous passing timesteps
 * within the operator's lookahead horizon are emitted as one green "good"
 * band on the timeline. Disabled thresholds are skipped — the operator
 * controls which constraints are mandatory from the modal.
 *
 * Per-timestep scalar = AoI-wide mean of the grid points sharing that
 * `valid_time`. Time-of-day uses the viewer's local clock to match the
 * modal copy.
 */
const OPTICAL_CONSTELLATIONS = new Set(["sentinel_2", "landsat_9", "planet_skysat"]);
const SAR_CONSTELLATIONS     = new Set(["sentinel_1", "iceye_x"]);

function buildPlaceholderWindows(
  cond: MissionConditionsUi,
  weather: FeatureCollection,
  satTracks: FeatureCollection,
): MissionWindowBand[] {
  const features = weather?.features ?? [];
  if (features.length === 0) return [];

  // Group every grid point by its forecast timestamp.
  const buckets = new Map<string, { ts: number; features: typeof features }>();
  for (const f of features) {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const validTime = p.valid_time;
    if (typeof validTime !== "string" || !validTime) continue;
    const ts = toEpochMs(validTime);
    if (ts === null) continue;
    let bucket = buckets.get(validTime);
    if (!bucket) {
      bucket = { ts, features: [] };
      buckets.set(validTime, bucket);
    }
    bucket.features.push(f);
  }

  const nowMs = Date.now();
  const horizonH = Math.max(1, cond.lookaheadHours);
  const horizonMs = horizonH * 3_600_000;

  const steps = Array.from(buckets.values())
    .filter((b) => b.ts >= nowMs - 30 * 60_000 && b.ts - nowMs <= horizonMs)
    .sort((a, b) => a.ts - b.ts);

  if (steps.length === 0) return [];

  const bands: MissionWindowBand[] = [];
  let i = 0;
  while (i < steps.length) {
    const currentStep = steps[i];
    if (!stepSatisfiesConditions(cond, atmosphericMeans(currentStep.features), new Date(currentStep.ts))) {
      i++;
      continue;
    }
    const runStart = (currentStep.ts - nowMs) / 3_600_000;
    let runEnd = runStart;
    while (i + 1 < steps.length) {
      const nextStep = steps[i + 1];
      if (!stepSatisfiesConditions(cond, atmosphericMeans(nextStep.features), new Date(nextStep.ts))) break;
      i++;
      runEnd = (steps[i].ts - nowMs) / 3_600_000;
    }
    const nextOffset = i + 1 < steps.length ? (steps[i + 1].ts - nowMs) / 3_600_000 : runEnd + 1;
    const bandEnd = Math.min(horizonH, Math.max(runStart + 1, nextOffset));
    bands.push({
      startHour: Math.max(0, Math.floor(runStart)),
      endHour: Math.min(horizonH, Math.ceil(bandEnd)),
      kind: "good",
    });
    i++;
  }

  // Satellite surveillance: when toggled, each band must have at least one
  // overpass within its operator-defined [-before, +after] envelope. Bands
  // that fail any required check are dropped from the result; bands that pass
  // get pass=true annotations so the timeline renders the OPT/SAR badge.
  if (cond.satOpticalEnabled || cond.satSarEnabled) {
    const opticalTimes: number[] = [];
    const sarTimes: number[] = [];
    for (const feat of satTracks.features) {
      const p = feat.properties as Record<string, unknown> | undefined;
      if (!p || p.feature_type !== "overpass") continue;
      const ts = p.timestamp ? Date.parse(String(p.timestamp)) : NaN;
      if (Number.isNaN(ts)) continue;
      if (OPTICAL_CONSTELLATIONS.has(String(p.constellation))) opticalTimes.push(ts);
      if (SAR_CONSTELLATIONS.has(String(p.constellation))) sarTimes.push(ts);
    }

    return bands.filter((band) => {
      const bandStartMs = nowMs + band.startHour * 3_600_000;
      const bandEndMs = nowMs + band.endHour * 3_600_000;

      if (cond.satOpticalEnabled) {
        const lo = bandStartMs - cond.satOpticalBeforeH * 3_600_000;
        const hi = bandEndMs   + cond.satOpticalAfterH  * 3_600_000;
        const pass = opticalTimes.some((t) => t >= lo && t <= hi);
        if (!pass) return false;
        band.satOpticalPass = true;
      }

      if (cond.satSarEnabled) {
        const lo = bandStartMs - cond.satSarBeforeH * 3_600_000;
        const hi = bandEndMs   + cond.satSarAfterH  * 3_600_000;
        const pass = sarTimes.some((t) => t >= lo && t <= hi);
        if (!pass) return false;
        band.satSarPass = true;
      }

      return true;
    });
  }

  return bands;
}

interface AtmosStats {
  windMs:      number | null;
  gustMs:      number | null;
  visibilityM: number | null;
  cloudPct:    number | null;
  precipMm:    number | null;
}

function atmosphericMeans(features: FeatureCollection["features"]): AtmosStats {
  const acc: Record<keyof AtmosStats, number[]> = {
    windMs: [], gustMs: [], visibilityM: [], cloudPct: [], precipMm: [],
  };
  const keyMap: Record<string, keyof AtmosStats> = {
    wind_speed_ms:    "windMs",
    wind_gust_ms:     "gustMs",
    visibility_m:     "visibilityM",
    cloudcover_pct:   "cloudPct",
    precipitation_mm: "precipMm",
  };
  for (const f of features) {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    for (const [src, dst] of Object.entries(keyMap)) {
      const v = p[src];
      if (typeof v === "number" && Number.isFinite(v)) acc[dst].push(v);
    }
  }
  const mean = (arr: number[]) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length;
  return {
    windMs:      mean(acc.windMs),
    gustMs:      mean(acc.gustMs),
    visibilityM: mean(acc.visibilityM),
    cloudPct:    mean(acc.cloudPct),
    precipMm:    mean(acc.precipMm),
  };
}

function stepSatisfiesConditions(
  cond: MissionConditionsUi,
  stats: AtmosStats,
  when: Date,
): boolean {
  if (cond.windEnabled       && stats.windMs      !== null && stats.windMs      > cond.maxWindSpeedMs) return false;
  if (cond.gustEnabled       && stats.gustMs      !== null && stats.gustMs      > cond.maxWindGustMs)  return false;
  if (cond.visibilityEnabled && stats.visibilityM !== null && stats.visibilityM < cond.minVisibilityM) return false;
  if (cond.cloudEnabled      && stats.cloudPct    !== null && stats.cloudPct    > cond.maxCloudcoverPct) return false;
  if (cond.rainEnabled       && stats.precipMm    !== null && stats.precipMm    > 0.05) return false;
  if (cond.timeOfDayEnabled) {
    const hour = when.getHours();
    const s = cond.timeStartHourUtc;
    const e = cond.timeEndHourUtc;
    if (s === e) {
      if (hour !== s) return false;
    } else if (s < e) {
      if (hour < s || hour >= e) return false;
    } else if (!(hour >= s || hour < e)) {
      // Window crosses midnight (e.g. 22 → 06).
      return false;
    }
  }
  return true;
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

// ── Map legend overlay ────────────────────────────────────────────────────────

const LAND_LEGEND: { label: string; color: string }[] = [
  { label: "Forest",    color: "rgb(42, 122, 42)" },
  { label: "Built-up",  color: "rgb(139, 90, 43)" },
  { label: "Water",     color: "rgb(42, 109, 181)" },
  { label: "Wetland",   color: "rgb(79, 127, 91)" },
  { label: "Open Land", color: "rgb(168, 184, 95)" },
  { label: "Rock",      color: "rgb(122, 122, 122)" },
];

const HEAVY_MOVEMENT_CORRIDOR_KEY = "heavy_vehicles:movement_corridors";
const HEAVY_MOVEMENT_CORRIDOR_LEGEND: Array<{ label: string; color: string; transparent?: boolean }> = [
  { label: "Passable", color: "rgba(140, 200, 240, 0.85)" },
  { label: "Uncertain (Hidden)", color: "transparent", transparent: true },
  { label: "No-Go", color: "rgba(210, 55, 55, 0.9)" },
];

const FPV_THREAT_AREAS_KEY = "fpv_drones:fpv_threat_areas";
const FPV_THREAT_LEGEND: Array<{ label: string; color: string; transparent?: boolean }> = [
  { label: "High Threat", color: "rgba(10, 30, 110, 0.82)" },
  { label: "Moderate", color: "rgba(60, 110, 190, 0.70)" },
  { label: "Low", color: "rgba(140, 180, 230, 0.55)" },
  { label: "Hidden (Canopy)", color: "transparent", transparent: true },
  { label: "No Possibility", color: "rgba(210, 55, 55, 0.85)" },
];

function MapLegend({
  layers,
  terrainElevRange,
  derivedSelected,
}: {
  layers: LayerConfig[];
  terrainElevRange: { min: number; max: number } | null;
  derivedSelected: Set<string>;
}) {
  const landcoverOn = layers.some((l) => l.id === "landcover" && l.visible);
  const forestOn    = layers.some((l) => l.id === "forest"    && l.visible);
  const terrainOn   = layers.some((l) => l.id === "terrain"   && l.visible);
  const heavyCorridorsOn = derivedSelected.has(HEAVY_MOVEMENT_CORRIDOR_KEY);
  const fpvThreatOn = derivedSelected.has(FPV_THREAT_AREAS_KEY);
  if (!landcoverOn && !forestOn && !terrainOn && !heavyCorridorsOn && !fpvThreatOn) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 36,
        right: 12,
        background: "rgba(14, 16, 20, 0.88)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 6,
        padding: "8px 10px",
        fontFamily: "var(--font-data)",
        fontSize: 11,
        color: "var(--color-text-secondary)",
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 128,
      }}
    >
      {landcoverOn && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-text-dim)", marginBottom: 5 }}>
            Land Type
          </div>
          {LAND_LEGEND.map(({ label, color }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <div style={{ width: 11, height: 11, borderRadius: 2, background: color, flexShrink: 0, opacity: 0.85 }} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}

      {terrainOn && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-text-dim)", marginBottom: 5 }}>
            Elevation (m a.s.l.)
          </div>
          <div style={{
            height: 10,
            borderRadius: 3,
            background: "linear-gradient(to right, rgb(255,255,255), rgb(255,160,120), rgb(180,30,20), rgb(100,0,0))",
            marginBottom: 4,
          }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
            <span>{terrainElevRange ? `${terrainElevRange.min} m` : "Low"}</span>
            <span>{terrainElevRange ? `${terrainElevRange.max} m` : "High"}</span>
          </div>
        </div>
      )}

      {forestOn && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-text-dim)", marginBottom: 5 }}>
            Forest Density
          </div>
          <div style={{
            height: 10,
            borderRadius: 3,
            background: "linear-gradient(to right, rgb(200,190,40), rgb(100,160,35), rgb(15,60,10))",
            marginBottom: 4,
          }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
            <span>Sparse</span>
            <span>Dense</span>
          </div>
        </div>
      )}

      {heavyCorridorsOn && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-text-dim)", marginBottom: 5 }}>
            Heavy Vehicle Corridors
          </div>
          {HEAVY_MOVEMENT_CORRIDOR_LEGEND.map(({ label, color, transparent }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <div
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: 2,
                  flexShrink: 0,
                  border: "1px solid rgba(255,255,255,0.30)",
                  background: transparent
                    ? "repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0 3px, rgba(255,255,255,0.18) 3px 6px)"
                    : color,
                }}
              />
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}

      {fpvThreatOn && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-text-dim)", marginBottom: 5 }}>
            FPV Threat Areas
          </div>
          {FPV_THREAT_LEGEND.map(({ label, color, transparent }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <div
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: 2,
                  flexShrink: 0,
                  border: "1px solid rgba(255,255,255,0.30)",
                  background: transparent
                    ? "repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0 3px, rgba(255,255,255,0.18) 3px 6px)"
                    : color,
                }}
              />
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Satellite overpass summary panel ─────────────────────────────────────────

function formatRelativeTime(isoTimestamp: string, referenceMs: number): string {
  const diffMs = new Date(isoTimestamp).getTime() - referenceMs;
  if (diffMs <= 0) return "now";
  const totalMin = Math.round(diffMs / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatUtcTime(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mo} ${hh}:${mm}Z`;
}

function SatOverpassPanel({
  activeSatConstellations,
  nextOverpassByConstellation,
  satTracksLoadState,
  timelineOffsetHours,
}: {
  activeSatConstellations: Set<string>;
  nextOverpassByConstellation: Record<string, { satellite_name: string; timestamp: string; distance_km: number }>;
  satTracksLoadState: "idle" | "loading" | "done";
  timelineOffsetHours: number;
}) {
  const sliderMs = Date.now() + timelineOffsetHours * 3_600_000;
  if (activeSatConstellations.size === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 48,
        left: 12,
        background: "rgba(14, 16, 20, 0.88)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 6,
        padding: "8px 10px",
        fontFamily: "var(--font-data)",
        fontSize: 11,
        color: "var(--color-text-secondary)",
        pointerEvents: "none",
        minWidth: 200,
        maxWidth: 260,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-text-dim)", marginBottom: 6 }}>
        Next Overpass (AoI)
      </div>
      {satTracksLoadState === "loading" ? (
        <div style={{ color: "var(--color-text-dim)", fontSize: 10 }}>Loading…</div>
      ) : (
        Array.from(activeSatConstellations).map((cid) => {
          const entry = nextOverpassByConstellation[cid];
          const color = CONSTELLATION_COLORS[cid] ?? CONSTELLATION_COLOR_FALLBACK;
          const label = CONSTELLATION_LABELS[cid] ?? cid;
          return (
            <div key={cid} style={{ display: "flex", alignItems: "flex-start", gap: 7, marginBottom: 6 }}>
              <div style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: color, flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ color, fontWeight: 700, fontSize: 10, letterSpacing: "0.05em" }}>{label}</div>
                {entry ? (
                  <>
                    <div style={{ color: "var(--color-text-primary)", fontSize: 11 }}>
                      {entry.satellite_name} — <span style={{ color }}>{formatRelativeTime(entry.timestamp, sliderMs)}</span>
                    </div>
                    <div style={{ color: "var(--color-text-dim)", fontSize: 10 }}>
                      {formatUtcTime(entry.timestamp)} · {entry.distance_km} km ground range
                    </div>
                  </>
                ) : (
                  <div style={{ color: "var(--color-text-dim)", fontSize: 10 }}>No pass in 72h</div>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
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
  onRefetch: () => void;
  refetching: boolean;
}

function TopBar({ bbox, layersActive, capabilitiesCount, onBack, onNewMission, onRefetch, refetching }: TopBarProps) {
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
        <button className="btn" onClick={onRefetch} disabled={refetching}>
          {refetching ? "Refetching…" : "Refetch Data"}
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
