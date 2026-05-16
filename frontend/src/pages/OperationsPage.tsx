import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { BoundingBox, LayerConfig, LayerId, LayerSection } from "../types";
import { bboxToArea, setArea } from "../area";
import { API_BASE_URL, MAPTILER_KEY } from "../config";
import { CAPABILITIES, Capability } from "../data/capabilities";
import LayerPanel from "../components/LayerPanel";
import TimeSlider from "../components/TimeSlider";
import ToolPanel from "../components/ToolPanel";
import { SOURCES, loadSource } from "../sources";
import { analysesForCapabilities } from "../analyses";

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

// ─── Map source / layer registries ───────────────────────────────────────────

const SOURCE_ACCENTS: Record<string, string> = {
  terrain:    "#8a7a5a",
  landcover:  "#5a7a5a",
  forest:     "#2a7a2a",
  water:      "#2a6db5",
  cameras:    "#e8622a",
  cellular:   "#8a7a5a",
  weather:    "#2a6db5",
  satellites: "#2a9d8a",
  population: "#e8622a",
};

const INITIAL_LAYERS: LayerConfig[] = SOURCES.map((s) => ({
  id: s.id,
  label: s.label,
  sublabel: s.sublabel,
  accentColor: SOURCE_ACCENTS[s.id] ?? "#8a8880",
  visible: false,
  opacity: 0.7,
  hasData: s.hasData,
}));

const BASE_IDS: LayerId[]  = SOURCES.filter((s) => s.category === "base").map((s) => s.id);
const ATMOS_IDS: LayerId[] = SOURCES.filter((s) => s.category === "atmospheric").map((s) => s.id);
const DEMO_IDS: LayerId[]  = SOURCES.filter((s) => s.category === "demographic").map((s) => s.id);

/** source-id → MapLibre GeoJSON source id */
const MAP_SOURCE_IDS: Record<string, string> = {
  terrain:    "terrain-src",
  landcover:  "natural-landcover-src",
  forest:     "natural-forest-src",
  water:      "natural-water-src",
  weather:    "natural-weather-src",
  satellites: "satellites-src",
  cameras:    "cameras-src",
  cellular:   "cellular-src",
};

/** source-id → MapLibre layer ids */
const MAP_LAYER_IDS: Record<string, string[]> = {
  terrain:    ["terrain-heatmap"],
  landcover:  ["natural-landcover-fill", "natural-landcover-line"],
  forest:     ["natural-forest-fill"],
  water:      ["natural-water-fill", "natural-water-line"],
  weather:    ["natural-weather-points"],
  satellites: ["satellites-points"],
  cameras:    ["cameras-points"],
  cellular:   ["cellular-points"],
};

/** layer-id → paint opacity property name */
const MAP_LAYER_OPACITY_PROP: Record<string, "fill-opacity" | "line-opacity" | "circle-opacity" | "heatmap-opacity"> = {
  "natural-landcover-fill":  "fill-opacity",
  "natural-landcover-line":  "line-opacity",
  "natural-forest-fill":     "fill-opacity",
  "natural-water-fill":      "fill-opacity",
  "natural-water-line":      "line-opacity",
  "natural-weather-points":  "circle-opacity",
  "terrain-heatmap":         "heatmap-opacity",
  "satellites-points":       "circle-opacity",
  "cameras-points":          "circle-opacity",
  "cellular-points":         "circle-opacity",
};

/** stage name for each source-id (must match orchestrator STAGE names) */
const SOURCE_STAGE: Record<string, string> = {
  terrain:    "dem",
  landcover:  "land",
  forest:     "land",
  water:      "water",
  weather:    "weather",
  satellites: "satellites",
  cameras:    "traffic_cameras",
  cellular:   "cellular",
};

// ─── Infrastructure toggle → API endpoint mapping ────────────────────────────

const INFRA_ENDPOINT_MAP: Record<string, string> = {
  bridges:           "bridges",
  bridges_civilian:  "bridges",
  bridges_military:  "bridges",
  bridges_rail:      "bridges",
  fuel:              "fuel",
  power:             "power",
  power_substation:  "power",
  power_transmission:"power",
  power_plant:       "power",
};

const INFRA_MAP_SOURCES: Record<string, string> = {
  bridges: "infra-bridges-src",
  fuel:    "infra-fuel-src",
  power:   "infra-power-src",
};

const INFRA_MAP_LAYERS: Record<string, string[]> = {
  bridges: ["infra-bridges-line"],
  fuel:    ["infra-fuel-circle"],
  power:   ["infra-power-line", "infra-power-circle"],
};

// ─── Helper ──────────────────────────────────────────────────────────────────

async function loadGeoJson(url: string): Promise<FeatureCollection> {
  try {
    const res = await fetch(url);
    if (!res.ok) return EMPTY_FC;
    const json = await res.json();
    if (json?.type === "FeatureCollection" && Array.isArray(json.features)) return json as FeatureCollection;
  } catch {
    // swallow — return empty below
  }
  return EMPTY_FC;
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

interface JobInfo { aoiId: string; jobId: string; }

function loadAoi(): BoundingBox | null {
  try { return JSON.parse(sessionStorage.getItem("aoi") ?? "null"); }
  catch { return null; }
}

function loadCapabilities(): Capability[] {
  try {
    const ids = JSON.parse(sessionStorage.getItem("capabilities") ?? "[]") as string[];
    return CAPABILITIES.filter((c) => ids.includes(c.id));
  } catch { return []; }
}

function bboxLabel(b: BoundingBox): string {
  const lon = (b.minLon + b.maxLon) / 2;
  const lat = (b.minLat + b.maxLat) / 2;
  const lonStr = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  const latStr = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
  return `${latStr} ${lonStr}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OperationsPage() {
  const navigate     = useNavigate();
  const aoi          = useMemo(() => loadAoi(), []);
  const capabilities = useMemo(() => loadCapabilities(), []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);

  const [mapReady,       setMapReady]       = useState(false);
  const [layers,         setLayers]         = useState<LayerConfig[]>(INITIAL_LAYERS);
  const [analysisLayers, setAnalysisLayers] = useState<Record<string, { visible: boolean; opacity: number }>>({});
  const [infraSelected,  setInfraSelected]  = useState<Set<string>>(new Set());
  const [jobInfo,        setJobInfo]        = useState<JobInfo | null>(null);
  const [stages,         setStages]         = useState<Record<string, string>>({});
  const [weatherOffset,  setWeatherOffset]  = useState(0);

  const [sourceData, setSourceData] = useState<Record<string, FeatureCollection>>({
    terrain:    EMPTY_FC,
    landcover:  EMPTY_FC,
    forest:     EMPTY_FC,
    water:      EMPTY_FC,
    weather:    EMPTY_FC,
    satellites: EMPTY_FC,
    cameras:    EMPTY_FC,
    cellular:   EMPTY_FC,
  });

  const loadedSources    = useRef<Set<string>>(new Set());
  const loadedInfra      = useRef<Set<string>>(new Set());
  const sourceAborts     = useRef<Map<string, AbortController>>(new Map());

  // ── Derived ─────────────────────────────────────────────────────────────────

  const capabilityIds      = useMemo(() => capabilities.map((c) => c.id), [capabilities]);
  const availableAnalyses  = useMemo(() => analysesForCapabilities(capabilityIds), [capabilityIds]);

  const analysisLayerConfigs: LayerConfig[] = useMemo(
    () => availableAnalyses.map((a) => {
      const state = analysisLayers[a.id] ?? { visible: false, opacity: 0.7 };
      return { id: a.id, label: a.label, sublabel: a.sublabel, accentColor: a.accentColor,
               visible: state.visible, opacity: state.opacity, hasData: a.hasData };
    }),
    [availableAnalyses, analysisLayers],
  );

  const sourceArea = useMemo(() => {
    if (!aoi || !jobInfo) return null;
    return { ...bboxToArea(aoi), metadata: { aoi_id: jobInfo.aoiId } };
  }, [aoi, jobInfo]);

  /** Weather filtered to the closest valid_time for the current slider offset. */
  const filteredWeather = useMemo<FeatureCollection>(() => {
    const all = sourceData.weather;
    if (!all.features.length) return EMPTY_FC;
    const uniqueTimes = [...new Set(
      all.features.map(f => (f.properties?.valid_time as string | null) ?? "").filter(Boolean)
    )].sort();
    if (!uniqueTimes.length) return all;
    const target = Date.now() + weatherOffset * 3_600_000;
    const closest = uniqueTimes.reduce((best, t) =>
      Math.abs(new Date(t).getTime() - target) < Math.abs(new Date(best).getTime() - target) ? t : best
    );
    return { type: "FeatureCollection", features: all.features.filter(f => f.properties?.valid_time === closest) };
  }, [sourceData.weather, weatherOffset]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function toggleInfra(id: string) {
    setInfraSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function onExport(_kind: "report" | "pdf" | "notes") { /* deferred */ }

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
    setLayers((prev) => {
      const cur = prev.find((l) => l.id === id);
      if (!cur || cur.hasData === hasData) return prev;
      return prev.map((l) => (l.id === id ? { ...l, hasData } : l));
    });
  }

  function newMission() { sessionStorage.clear(); navigate("/login"); }

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!aoi) { navigate("/aoi", { replace: true }); return; }
    setArea(bboxToArea(aoi));
  }, [aoi, navigate]);

  // Start job
  useEffect(() => {
    if (!aoi || jobInfo) return;
    const bbox = aoi;
    const controller = new AbortController();
    async function startJob() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/aoi`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ min_lon: bbox.minLon, min_lat: bbox.minLat, max_lon: bbox.maxLon, max_lat: bbox.maxLat }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const payload = await res.json();
        if (!payload?.aoi_id || !payload?.job_id) return;
        setJobInfo({ aoiId: payload.aoi_id, jobId: payload.job_id });
      } catch { /* abort or network error */ }
    }
    startJob();
    return () => controller.abort();
  }, [aoi, jobInfo]);

  // Poll job status
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
        setStages(prev => {
          const next = payload?.stages ?? {};
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        });
        if (payload?.status === "completed" && timer) window.clearInterval(timer);
      } catch { /* keep polling */ }
    }
    pollStatus();
    timer = window.setInterval(pollStatus, 2000);
    return () => { active = false; if (timer) window.clearInterval(timer); };
  }, [jobInfo]);

  // Initialise MapLibre
  useEffect(() => {
    if (!containerRef.current || !aoi) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${MAPTILER_KEY}`,
      bounds: [[aoi.minLon, aoi.minLat], [aoi.maxLon, aoi.maxLat]],
      fitBoundsOptions: { padding: 40 },
      minZoom: 4, maxZoom: 16, pitch: 0, bearing: 0,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    map.on("load", () => {
      // AoI bounding box outline
      map.addSource("aoi-source", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[ [aoi.minLon, aoi.minLat], [aoi.maxLon, aoi.minLat], [aoi.maxLon, aoi.maxLat], [aoi.minLon, aoi.maxLat], [aoi.minLon, aoi.minLat] ]] } },
      });
      map.addLayer({ id: "aoi-outline", type: "line", source: "aoi-source",
        paint: { "line-color": "#e8622a", "line-width": 1.5, "line-opacity": 0.85 } });

      // ── GeoJSON sources ───────────────────────────────────────────────────
      for (const srcId of Object.values(MAP_SOURCE_IDS)) {
        map.addSource(srcId, { type: "geojson", data: EMPTY_FC });
      }
      for (const srcId of Object.values(INFRA_MAP_SOURCES)) {
        map.addSource(srcId, { type: "geojson", data: EMPTY_FC });
      }

      // ── Terrain heatmap ───────────────────────────────────────────────────
      map.addLayer({ id: "terrain-heatmap", type: "heatmap", source: MAP_SOURCE_IDS.terrain,
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["coalesce", ["get", "elevation_m"], 0], 0, 0, 500, 1],
          "heatmap-intensity": 0.8,
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)", 0.2, "#2a5fb5", 0.5, "#5a9a5a", 0.8, "#d4a017", 1.0, "#c0392b"],
          "heatmap-radius": 15,
          "heatmap-opacity": 0.7,
        },
      });

      // ── Land cover ────────────────────────────────────────────────────────
      map.addLayer({ id: "natural-landcover-fill", type: "fill", source: MAP_SOURCE_IDS.landcover,
        layout: { visibility: "none" }, paint: { "fill-color": "#5a7a5a", "fill-opacity": 0.45 } });
      map.addLayer({ id: "natural-landcover-line", type: "line", source: MAP_SOURCE_IDS.landcover,
        layout: { visibility: "none" }, paint: { "line-color": "#7c9b7c", "line-width": 0.7, "line-opacity": 0.55 } });

      // ── Forest ────────────────────────────────────────────────────────────
      map.addLayer({ id: "natural-forest-fill", type: "fill", source: MAP_SOURCE_IDS.forest,
        layout: { visibility: "none" }, paint: { "fill-color": "#2a7a2a", "fill-opacity": 0.45 } });

      // ── Water ─────────────────────────────────────────────────────────────
      map.addLayer({ id: "natural-water-fill", type: "fill", source: MAP_SOURCE_IDS.water,
        filter: ["==", ["geometry-type"], "Polygon"],
        layout: { visibility: "none" }, paint: { "fill-color": "#2a6db5", "fill-opacity": 0.5 } });
      map.addLayer({ id: "natural-water-line", type: "line", source: MAP_SOURCE_IDS.water,
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { visibility: "none" }, paint: { "line-color": "#4e8ad1", "line-width": 1.6, "line-opacity": 0.8 } });

      // ── Weather ───────────────────────────────────────────────────────────
      map.addLayer({ id: "natural-weather-points", type: "circle", source: MAP_SOURCE_IDS.weather,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4, 10, 8],
          "circle-color": ["interpolate", ["linear"], ["coalesce", ["get", "wind_speed_ms"], 0],
            0, "#2a6db5", 8, "#d4a017", 16, "#c0392b"],
          "circle-stroke-color": "#111111", "circle-stroke-width": 0.8, "circle-opacity": 0.75,
        },
      });

      // ── Satellites ────────────────────────────────────────────────────────
      map.addLayer({ id: "satellites-points", type: "circle", source: MAP_SOURCE_IDS.satellites,
        layout: { visibility: "none" },
        paint: { "circle-radius": 7, "circle-color": "#2a9d8a",
          "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5, "circle-opacity": 0.85 },
      });

      // ── Traffic cameras ───────────────────────────────────────────────────
      map.addLayer({ id: "cameras-points", type: "circle", source: MAP_SOURCE_IDS.cameras,
        layout: { visibility: "none" },
        paint: { "circle-radius": 5, "circle-color": "#e8622a",
          "circle-stroke-color": "#ffffff", "circle-stroke-width": 1, "circle-opacity": 0.85 },
      });

      // ── Cell towers ───────────────────────────────────────────────────────
      map.addLayer({ id: "cellular-points", type: "circle", source: MAP_SOURCE_IDS.cellular,
        layout: { visibility: "none" },
        paint: { "circle-radius": 4, "circle-color": "#8a7a5a",
          "circle-stroke-color": "#ffffff", "circle-stroke-width": 0.5, "circle-opacity": 0.75 },
      });

      // ── Infrastructure (hidden until toggled in ToolPanel) ────────────────
      map.addLayer({ id: "infra-bridges-line", type: "line", source: INFRA_MAP_SOURCES.bridges,
        layout: { visibility: "none" },
        paint: { "line-color": "#e8622a", "line-width": 3, "line-opacity": 0.9 },
      });
      map.addLayer({ id: "infra-fuel-circle", type: "circle", source: INFRA_MAP_SOURCES.fuel,
        layout: { visibility: "none" },
        paint: { "circle-radius": 7, "circle-color": "#d4a017",
          "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5, "circle-opacity": 0.9 },
      });
      map.addLayer({ id: "infra-power-line", type: "line", source: INFRA_MAP_SOURCES.power,
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { visibility: "none" },
        paint: { "line-color": "#f0c040", "line-width": 1.5, "line-opacity": 0.8 },
      });
      map.addLayer({ id: "infra-power-circle", type: "circle", source: INFRA_MAP_SOURCES.power,
        filter: ["==", ["geometry-type"], "Point"],
        layout: { visibility: "none" },
        paint: { "circle-radius": 5, "circle-color": "#f0c040",
          "circle-stroke-color": "#ffffff", "circle-stroke-width": 1, "circle-opacity": 0.85 },
      });

      setMapReady(true);
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [aoi]);

  // Push non-weather source data into map
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    for (const [id, data] of Object.entries(sourceData)) {
      if (id === "weather") continue; // handled by filteredWeather effect
      const sourceId = MAP_SOURCE_IDS[id];
      if (!sourceId) continue;
      const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
      src?.setData(data);
    }
  }, [mapReady, sourceData]);

  // Push time-filtered weather into map
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource(MAP_SOURCE_IDS.weather) as maplibregl.GeoJSONSource | undefined;
    src?.setData(filteredWeather);
  }, [mapReady, filteredWeather]);

  // Sync layer visibility + opacity with map
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
        if (opacityProp) map.setPaintProperty(mapLayerId, opacityProp, layer.opacity);
      }
    }
  }, [layers, mapReady]);

  // Abort all pending source fetches on unmount.
  useEffect(() => {
    const aborts = sourceAborts.current;
    return () => { for (const ctrl of aborts.values()) ctrl.abort(); };
  }, []);

  // Lazy-load source data when layer becomes visible and backend stage is done.
  // Each fetch gets its own AbortController so stage transitions don't cancel
  // in-flight requests (the previous shared-controller pattern caused an
  // abort-retry loop: every stage transition re-ran this effect, aborting the
  // fetch and removing it from loadedSources, which immediately retried it).
  useEffect(() => {
    if (!sourceArea || !mapReady) return;
    const visibleSourceLayers = layers.filter((layer) => layer.visible && SOURCE_STAGE[layer.id]);
    for (const layer of visibleSourceLayers) {
      const stageName = SOURCE_STAGE[layer.id];
      if (stages[stageName] === "error") { setLayerHasData(layer.id, false); continue; }
      if (stages[stageName] !== "done") continue;
      if (loadedSources.current.has(layer.id)) continue;
      loadedSources.current.add(layer.id);
      const ctrl = new AbortController();
      sourceAborts.current.set(layer.id, ctrl);
      loadSource<FeatureCollection>(layer.id, sourceArea, ctrl.signal)
        .then((fc) => {
          sourceAborts.current.delete(layer.id);
          setSourceData((prev) => ({ ...prev, [layer.id]: fc }));
          setLayerHasData(layer.id, (fc.features ?? []).length > 0);
        })
        .catch((err) => {
          sourceAborts.current.delete(layer.id);
          if (err?.name === "AbortError") loadedSources.current.delete(layer.id);
          else setLayerHasData(layer.id, false);
        });
    }
  }, [layers, mapReady, sourceArea, stages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Infrastructure: fetch and show/hide layers based on ToolPanel toggles
  useEffect(() => {
    if (!mapReady || !sourceArea || stages.infrastructure !== "done") return;
    const map = mapRef.current;
    if (!map) return;
    const aoiId = sourceArea.metadata.aoi_id as string;

    const selectedEndpoints = new Set(
      [...infraSelected].map(id => INFRA_ENDPOINT_MAP[id]).filter((ep): ep is string => Boolean(ep))
    );

    for (const endpoint of Object.keys(INFRA_MAP_LAYERS)) {
      const visible = selectedEndpoints.has(endpoint);
      for (const lid of INFRA_MAP_LAYERS[endpoint]) {
        if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", visible ? "visible" : "none");
      }
      if (visible && !loadedInfra.current.has(endpoint)) {
        loadedInfra.current.add(endpoint); // mark before fetch to prevent duplicate requests
        loadGeoJson(`${API_BASE_URL}/api/aoi/${aoiId}/infrastructure/${endpoint}`).then(fc => {
          const srcId = INFRA_MAP_SOURCES[endpoint];
          if (!srcId) return;
          const gSrc = map.getSource(srcId) as maplibregl.GeoJSONSource | undefined;
          gSrc?.setData(fc);
        });
      }
    }
  }, [infraSelected, mapReady, sourceArea, stages.infrastructure]);

  // ── Render ────────────────────────────────────────────────────────────────

  const sections: LayerSection[] = [
    { title: "Base Layers", layers: layers.filter((l) => BASE_IDS.includes(l.id)) },
    { title: "Atmospheric",  layers: layers.filter((l) => ATMOS_IDS.includes(l.id)) },
    { title: "Demographic",  layers: layers.filter((l) => DEMO_IDS.includes(l.id)) },
    ...(analysisLayerConfigs.length > 0 ? [{ title: "Analyses", layers: analysisLayerConfigs }] : []),
  ];

  const activeCount = layers.filter((l) => l.visible).length + analysisLayerConfigs.filter((l) => l.visible).length;

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
          infrastructureSelected={infraSelected}
          onInfrastructureToggle={toggleInfra}
          onManageForces={() => navigate("/capabilities")}
          onExport={onExport}
        />

        <div style={{ flex: 1, position: "relative" }}>
          <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
        </div>

        <LayerPanel sections={sections} onChange={onLayerChange} />
      </div>

      <TimeSlider onTimeChange={setWeatherOffset} />
    </div>
  );
}

// ─── TopBar ───────────────────────────────────────────────────────────────────

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
        height: 40, flexShrink: 0, display: "flex", alignItems: "center",
        justifyContent: "space-between", padding: "0 12px",
        background: "var(--color-bg-panel)", borderBottom: "1px solid var(--color-border-default)",
      }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" onClick={onBack}>◀ Capabilities</button>
        <button className="btn" onClick={onNewMission}>⟳ New Mission</button>
      </div>

      <div style={{ fontFamily: "var(--font-heading)", fontSize: 13, fontWeight: 600,
        letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--color-text-primary)" }}>
        Operations <span style={{ color: "var(--color-text-dim)" }}>//</span>{" "}
        <span style={{ fontFamily: "var(--font-data)", color: "var(--color-accent-orange)" }}>
          {bboxLabel(bbox)}
        </span>
      </div>

      <div style={{ display: "flex", gap: 16, fontFamily: "var(--font-data)",
        fontSize: 11, color: "var(--color-text-secondary)" }}>
        <span>{layersActive} LAYERS ACTIVE</span>
        <span>·</span>
        <span>{capabilitiesCount} CAPABILITIES</span>
      </div>
    </div>
  );
}
