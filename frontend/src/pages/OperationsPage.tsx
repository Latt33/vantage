import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { BoundingBox, LayerConfig, LayerId, LayerSection } from "../types";
import { setArea, bboxToArea } from "../area";
import { API_BASE_URL, MAPTILER_KEY } from "../config";
import { CAPABILITIES, Capability } from "../data/capabilities";
import LayerPanel from "../components/LayerPanel";
import TimeSlider from "../components/TimeSlider";
import ToolPanel from "../components/ToolPanel";
import { SOURCES } from "../sources";
import { analysesForCapabilities } from "../analyses";

const SOURCE_ACCENTS: Record<string, string> = {
  terrain:    "#8a7a5a",
  landcover:  "#5a7a5a",
  forest:     "#2a7a2a",
  weather:    "#2a6db5",
  population: "#e8622a",
};

// Tier-1 source layers derived from the SOURCES registry.
const INITIAL_LAYERS: LayerConfig[] = SOURCES.map(s => ({
  id: s.id,
  label: s.label,
  sublabel: s.sublabel,
  accentColor: SOURCE_ACCENTS[s.id] ?? "#8a8880",
  visible: false,
  opacity: 0.7,
  hasData: s.hasData,
}));

const BASE_IDS: LayerId[]   = SOURCES.filter(s => s.category === "base").map(s => s.id);
const ATMOS_IDS: LayerId[]  = SOURCES.filter(s => s.category === "atmospheric").map(s => s.id);
const DEMO_IDS: LayerId[]   = SOURCES.filter(s => s.category === "demographic").map(s => s.id);

function loadAoi(): BoundingBox | null {
  try { return JSON.parse(sessionStorage.getItem("aoi") ?? "null"); }
  catch { return null; }
}

function loadCapabilities(): Capability[] {
  try {
    const ids = JSON.parse(sessionStorage.getItem("capabilities") ?? "[]") as string[];
    return CAPABILITIES.filter(c => ids.includes(c.id));
  } catch { return []; }
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

  const capabilityIds = useMemo(() => capabilities.map(c => c.id), [capabilities]);
  const availableAnalyses = useMemo(() => analysesForCapabilities(capabilityIds), [capabilityIds]);
  const analysisLayerConfigs: LayerConfig[] = useMemo(() => availableAnalyses.map(a => {
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
  }), [availableAnalyses, analysisLayers]);

  function toggleInfra(id: string) {
    setInfraSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onExport(_kind: "report" | "pdf" | "notes") {
    // Conceptual — wiring deferred. No-op for now.
  }

  useEffect(() => {
    if (!aoi) {
      navigate("/aoi", { replace: true });
      return;
    }
    setArea(bboxToArea(aoi));
  }, [aoi, navigate]);

  useEffect(() => {
    if (!containerRef.current || !aoi) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${MAPTILER_KEY}`,
      bounds: [[aoi.minLon, aoi.minLat], [aoi.maxLon, aoi.maxLat]],
      fitBoundsOptions: { padding: 40 },
      minZoom: 4,
      maxZoom: 16,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    map.on("load", () => {
      // Draw AOI rectangle so the operator sees the operational area outline
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

      map.addSource(CAMERA_SOURCE, { type: "geojson", data: EMPTY_FC });
      map.loadImage(cameraIconUrl, (error, image) => {
        if (error || !image || map.hasImage("traffic-camera-icon")) return;
        map.addImage("traffic-camera-icon", image, { sdf: false });
        map.addLayer({
          id: CAMERA_LAYER,
          type: "symbol",
          source: CAMERA_SOURCE,
          layout: {
            "icon-image": "traffic-camera-icon",
            "icon-size": 0.7,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "visibility": "none",
          },
        });

        map.on("mouseenter", CAMERA_LAYER, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", CAMERA_LAYER, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("click", CAMERA_LAYER, (event) => {
          const feature = event.features?.[0];
          const url = feature?.properties?.image_url as string | undefined;
          if (url) window.open(url, "_blank", "noopener");
        });
      });
      setMapReady(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [aoi]);

  function onLayerChange(id: LayerId, patch: Partial<LayerConfig>) {
    // Analyses live in their own state so they re-derive cleanly from the registry.
    if (availableAnalyses.some(a => a.id === id)) {
      setAnalysisLayers(prev => {
        const cur = prev[id] ?? { visible: false, opacity: 0.7 };
        return { ...prev, [id]: { ...cur, ...patch } };
      });
      return;
    }
    setLayers(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l)));
  }

  function setLayerHasData(id: LayerId, hasData: boolean) {
    setLayers(prev => prev.map(l => (l.id === id ? { ...l, hasData } : l)));
  }

  useEffect(() => {
    const cameraLayer = layers.find(layer => layer.id === "traffic_cameras");
    if (!aoi || jobInfo || !mapReady || !cameraLayer?.visible) return;
    const controller = new AbortController();

    async function startJob() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/aoi`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            min_lon: aoi.minLon,
            min_lat: aoi.minLat,
            max_lon: aoi.maxLon,
            max_lat: aoi.maxLat,
          }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const payload = await res.json();
        if (!payload?.aoi_id || !payload?.job_id) return;
        setJobInfo({ aoiId: payload.aoi_id, jobId: payload.job_id });
      } catch {
        // Ignore aborted or network errors; panel will show no data.
      }
    }

    startJob();
    return () => controller.abort();
  }, [aoi, jobInfo, mapReady, layers]);

  useEffect(() => {
    if (!jobInfo) return;
    let active = true;
    let timer: number | undefined;

    async function pollStatus() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/job/${jobInfo.jobId}/status`);
        if (!res.ok) return;
        const payload = await res.json();
        const stage = payload?.stages?.traffic_cameras;
        if (stage === "done") {
          await loadCameraLayer(jobInfo.aoiId);
          if (timer) window.clearInterval(timer);
        }
      } catch {
        // Leave polling active to retry.
      }
    }

    async function loadCameraLayer(aoiId: string) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/aoi/${aoiId}/layers/traffic_cameras/stations.geojson`);
        if (!res.ok) return;
        const fc = await res.json();
        if (!active || fc?.type !== "FeatureCollection") return;
        setCameraData(fc);
        setLayerHasData("traffic_cameras", (fc.features ?? []).length > 0);
      } catch {
        // Ignore fetch errors; leave data empty.
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
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource(CAMERA_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(cameraData);
  }, [cameraData, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const cameraLayer = layers.find(layer => layer.id === "traffic_cameras");
    if (!cameraLayer) return;
    if (map.getLayer(CAMERA_LAYER)) {
      map.setLayoutProperty(
        CAMERA_LAYER,
        "visibility",
        cameraLayer.visible ? "visible" : "none",
      );
    }
  }, [layers, mapReady]);

  function newMission() {
    sessionStorage.clear();
    navigate("/login");
  }

  const sections: LayerSection[] = [
    { title: "Base Layers",  layers: layers.filter(l => BASE_IDS.includes(l.id))  },
    { title: "Atmospheric",  layers: layers.filter(l => ATMOS_IDS.includes(l.id)) },
    { title: "Demographic",  layers: layers.filter(l => DEMO_IDS.includes(l.id))  },
    ...(analysisLayerConfigs.length > 0
      ? [{ title: "Analyses", layers: analysisLayerConfigs }]
      : []),
  ];

  const activeCount =
    layers.filter(l => l.visible).length +
    analysisLayerConfigs.filter(l => l.visible).length;

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

      <TimeSlider />
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
        <button className="btn" onClick={onBack}>◀ Capabilities</button>
        <button className="btn" onClick={onNewMission}>⟳ New Mission</button>
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
        <span style={{ fontFamily: "var(--font-data)", color: "var(--color-accent-orange)" }}>
          {bboxLabel(bbox)}
        </span>
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

