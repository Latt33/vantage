import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { BoundingBox, LayerConfig, LayerId, LayerSection } from "../types";
import { bboxToArea, setArea } from "../area";
import { API_BASE_URL, MAPTILER_KEY } from "../config";
import { CAPABILITIES, Capability } from "../data/capabilities";
import { INFRASTRUCTURE } from "../data/infrastructure";
import LayerPanel from "../components/LayerPanel";
import TimeSlider from "../components/TimeSlider";
import ToolPanel from "../components/ToolPanel";
import ExportIpbReportModal, { ExportLegendState } from "../export/ExportIpbReportModal";
import { SOURCES, loadSource } from "../sources";
import { analysesForCapabilities } from "../analyses";
import { fetchNextOverpass } from "../api/satelliteIntel";

const SOURCE_ACCENTS: Record<string, string> = {
  terrain: "#8a7a5a",
  landcover: "#5a7a5a",
  forest: "#2a7a2a",
  water: "#2a6db5",
  weather: "#2a6db5",
  population: "#e8622a",
};

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

const INITIAL_LAYERS: LayerConfig[] = SOURCES.map((s) => ({
  id: s.id,
  label: s.label,
  sublabel: s.sublabel,
  accentColor: SOURCE_ACCENTS[s.id] ?? "#8a8880",
  visible: false,
  opacity: 0.7,
  hasData: s.hasData,
}));

const BASE_IDS: LayerId[] = SOURCES.filter((s) => s.category === "base").map((s) => s.id);
const ATMOS_IDS: LayerId[] = SOURCES.filter((s) => s.category === "atmospheric").map((s) => s.id);
const DEMO_IDS: LayerId[] = SOURCES.filter((s) => s.category === "demographic").map((s) => s.id);

const MAP_SOURCE_IDS: Record<string, string> = {
  landcover: "natural-landcover-src",
  forest: "natural-forest-src",
  water: "natural-water-src",
  weather: "natural-weather-src",
};

const MAP_LAYER_IDS: Record<string, string[]> = {
  landcover: ["natural-landcover-fill", "natural-landcover-line"],
  forest: ["natural-forest-fill"],
  water: ["natural-water-fill", "natural-water-line"],
  weather: ["natural-weather-points"],
};

const MAP_LAYER_OPACITY_PROP: Record<string, "fill-opacity" | "line-opacity" | "circle-opacity"> = {
  "natural-landcover-fill": "fill-opacity",
  "natural-landcover-line": "line-opacity",
  "natural-forest-fill": "fill-opacity",
  "natural-water-fill": "fill-opacity",
  "natural-water-line": "line-opacity",
  "natural-weather-points": "circle-opacity",
};

const SOURCE_STAGE: Record<string, string> = {
  landcover: "land",
  forest: "land",
  water: "water",
  weather: "weather",
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

function flattenInfraLabels(): Record<string, string> {
  const map: Record<string, string> = {};

  const walk = (items: typeof INFRASTRUCTURE) => {
    for (const item of items) {
      map[item.id] = item.label;
      if (item.children && item.children.length > 0) {
        walk(item.children);
      }
    }
  };

  walk(INFRASTRUCTURE);
  return map;
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

  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null);
  const [stages, setStages] = useState<Record<string, string>>({});
  const loadedSources = useRef<Set<string>>(new Set());
  const [sourceData, setSourceData] = useState<Record<string, FeatureCollection>>({
    landcover: EMPTY_FC,
    forest: EMPTY_FC,
    water: EMPTY_FC,
    weather: EMPTY_FC,
  });

  const capabilityIds = useMemo(() => capabilities.map((c) => c.id), [capabilities]);
  const availableAnalyses = useMemo(() => analysesForCapabilities(capabilityIds), [capabilityIds]);
  const infraLabelById = useMemo(() => flattenInfraLabels(), []);

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

  function toggleInfra(id: string) {
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
    timer = window.setInterval(pollStatus, 2000);

    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
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

    map.on("load", () => {
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

      map.addSource(MAP_SOURCE_IDS.landcover, { type: "geojson", data: EMPTY_FC });
      map.addSource(MAP_SOURCE_IDS.forest, { type: "geojson", data: EMPTY_FC });
      map.addSource(MAP_SOURCE_IDS.water, { type: "geojson", data: EMPTY_FC });
      map.addSource(MAP_SOURCE_IDS.weather, { type: "geojson", data: EMPTY_FC });

      map.addLayer({
        id: "natural-landcover-fill",
        type: "fill",
        source: MAP_SOURCE_IDS.landcover,
        layout: { visibility: "none" },
        paint: { "fill-color": "#5a7a5a", "fill-opacity": 0.45 },
      });

      map.addLayer({
        id: "natural-landcover-line",
        type: "line",
        source: MAP_SOURCE_IDS.landcover,
        layout: { visibility: "none" },
        paint: { "line-color": "#7c9b7c", "line-width": 0.7, "line-opacity": 0.55 },
      });

      map.addLayer({
        id: "natural-forest-fill",
        type: "fill",
        source: MAP_SOURCE_IDS.forest,
        layout: { visibility: "none" },
        paint: { "fill-color": "#2a7a2a", "fill-opacity": 0.45 },
      });

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

      map.addLayer({
        id: "natural-weather-points",
        type: "circle",
        source: MAP_SOURCE_IDS.weather,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4, 10, 8],
          "circle-color": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "wind_speed_ms"], 0],
            0,
            "#2a6db5",
            8,
            "#d4a017",
            16,
            "#c0392b",
          ],
          "circle-stroke-color": "#111111",
          "circle-stroke-width": 0.8,
          "circle-opacity": 0.75,
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

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    for (const [id, data] of Object.entries(sourceData)) {
      const sourceId = MAP_SOURCE_IDS[id];
      if (!sourceId) continue;
      const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
      if (!src) continue;
      src.setData(data);
    }
  }, [mapReady, sourceData]);

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
          map.setPaintProperty(mapLayerId, opacityProp, layer.opacity);
        }
      }
    }
  }, [layers, mapReady]);

  useEffect(() => {
    if (!sourceArea || !mapReady) return;

    const controller = new AbortController();
    const visibleSourceLayers = layers.filter((layer) => layer.visible && SOURCE_STAGE[layer.id]);

    for (const layer of visibleSourceLayers) {
      const stageName = SOURCE_STAGE[layer.id];
      if (stages[stageName] === "error") {
        setLayerHasData(layer.id, false);
        continue;
      }
      if (stages[stageName] !== "done") continue;
      if (loadedSources.current.has(layer.id)) continue;

      loadSource<FeatureCollection>(layer.id, sourceArea, controller.signal)
        .then((fc) => {
          loadedSources.current.add(layer.id);
          setSourceData((prev) => ({ ...prev, [layer.id]: fc }));
          setLayerHasData(layer.id, (fc.features ?? []).length > 0);
        })
        .catch(() => {
          setLayerHasData(layer.id, false);
        });
    }

    return () => controller.abort();
  }, [layers, mapReady, sourceArea, stages]);

  function newMission() {
    sessionStorage.clear();
    navigate("/login");
  }

  const sections: LayerSection[] = [
    {
      title: "Natural Filters",
      layers: layers.filter((l) => BASE_IDS.includes(l.id) || ATMOS_IDS.includes(l.id)),
    },
    { title: "Demographic", layers: layers.filter((l) => DEMO_IDS.includes(l.id)) },
  ];

  const activeCount =
    layers.filter((l) => l.visible).length +
    infraSelected.size +
    derivedSelected.size;

  const exportLegends: ExportLegendState = useMemo(() => {
    const naturalFilters = layers.filter((l) => l.visible).map((l) => l.label);
    const infrastructureFilters = Array.from(infraSelected).map((id) => infraLabelById[id] ?? id);

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
  }, [capabilities, derivedSelected, infraLabelById, infraSelected, layers]);

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
        />

        <div style={{ flex: 1, position: "relative" }}>
          <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
        </div>

        <LayerPanel
          sections={sections}
          infrastructureSelected={infraSelected}
          onInfrastructureToggle={toggleInfra}
          onChange={onLayerChange}
        />
      </div>

      <TimeSlider />

      <ExportIpbReportModal
        open={exportOpen}
        screenshotDataUrl={exportShot}
        legends={exportLegends}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
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
