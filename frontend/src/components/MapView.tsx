import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { LayerConfig, BoundingBox, AppMode, MAX_AOI_KM } from "../types";
import { AreaContext } from "../area";
import { MAPTILER_KEY } from "../config";
import { useAoi, bboxSizeKm } from "../hooks/useAoi";

interface MapViewProps {
  mode: AppMode;
  layers: LayerConfig[];
  area: AreaContext | null;
  onAoiDrawn: (bbox: BoundingBox) => void;
  onConfirm: () => void;
  onRedraw: () => void;
}

const AOI_SOURCE = "aoi-source";
const AOI_FILL = "aoi-fill";
const AOI_OUTLINE = "aoi-outline";

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export default function MapView({
  mode,
  layers: _layers,
  area,
  onAoiDrawn,
  onConfirm,
  onRedraw,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const {
    drawMode,
    setDrawMode,
    toggleDrawMode,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    getLiveGeoJSON,
  } = useAoi();

  const onAoiDrawnRef = useRef(onAoiDrawn);
  onAoiDrawnRef.current = onAoiDrawn;

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${MAPTILER_KEY}`,
      center: [25.0, 64.5],
      zoom: 5,
      minZoom: 4,
      maxZoom: 16,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    map.on("load", () => {
      map.addSource(AOI_SOURCE, { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: AOI_FILL,
        type: "fill",
        source: AOI_SOURCE,
        paint: { "fill-color": "#e8622a", "fill-opacity": 0.06 },
      });
      map.addLayer({
        id: AOI_OUTLINE,
        type: "line",
        source: AOI_SOURCE,
        paint: { "line-color": "#e8622a", "line-width": 1.5 },
      });
      setMapReady(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Render AOI: live polygon (dashed) while drawing, confirmed (solid) otherwise.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource(AOI_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const live = getLiveGeoJSON();
    if (live) {
      src.setData(live);
      map.setPaintProperty(AOI_OUTLINE, "line-width", 2);
      map.setPaintProperty(AOI_OUTLINE, "line-dasharray", [2, 2]);
      map.setPaintProperty(AOI_FILL, "fill-opacity", 0.08);
    } else if (area) {
      src.setData(area.geometry);
      map.setPaintProperty(AOI_OUTLINE, "line-width", 1.5);
      map.setPaintProperty(AOI_OUTLINE, "line-dasharray", [1, 0]);
      map.setPaintProperty(AOI_FILL, "fill-opacity", 0.06);
    } else {
      src.setData(EMPTY_FC);
    }
  }, [area, mapReady, drawMode, getLiveGeoJSON]);

  // Live geometry refresh on each render (useAoi triggers re-renders during drag).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const live = getLiveGeoJSON();
    if (live) {
      const src = map.getSource(AOI_SOURCE) as maplibregl.GeoJSONSource | undefined;
      src?.setData(live);
    }
  });

  // Fit to AOI bounds whenever an area is confirmed for review/analysis.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !area) return;
    if (mode !== "confirm" && mode !== "analyze") return;
    const { bbox } = area;
    map.fitBounds(
      [[bbox.minLon, bbox.minLat], [bbox.maxLon, bbox.maxLat]],
      { padding: 80, duration: 800, maxZoom: 13 }
    );
  }, [mode, area, mapReady]);

  useEffect(() => {
    if (mode !== "select" && drawMode) setDrawMode(false);
  }, [mode, drawMode, setDrawMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const canvas = map.getCanvas();

    if (!drawMode) {
      canvas.style.cursor = "";
      map.dragPan.enable();
      map.boxZoom.disable();
      return;
    }

    canvas.style.cursor = "crosshair";
    map.dragPan.disable();
    map.boxZoom.disable();

    let isDown = false;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      isDown = true;
      e.preventDefault();
      handleMouseDown(e, map);
    };
    const onMove = (e: MouseEvent) => {
      if (!isDown) return;
      handleMouseMove(e, map);
    };
    const onUp = (e: MouseEvent) => {
      if (!isDown) return;
      isDown = false;
      handleMouseUp(e, map, onAoiDrawnRef.current);
    };

    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      canvas.style.cursor = "";
      map.dragPan.enable();
    };
  }, [drawMode, mapReady, handleMouseDown, handleMouseMove, handleMouseUp]);

  const showDrawButton = mode === "select";
  const showHint = mode === "select" && !drawMode;
  const showConfirmBar = mode === "confirm" && area !== null;

  return (
    <>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {showDrawButton && (
        <button
          className={`btn draw-toggle ${drawMode ? "btn--active" : ""}`}
          onClick={toggleDrawMode}
          style={{ position: "absolute", top: 12, left: 12, zIndex: 10 }}
        >
          {drawMode ? "■ Cancel" : "⊹ Select AOI"}
        </button>
      )}

      {showHint && <SelectHint />}
      {drawMode && <DrawHint />}

      {showConfirmBar && area && (
        <ConfirmBar bbox={area.bbox} onConfirm={onConfirm} onRedraw={onRedraw} />
      )}
    </>
  );
}

function SelectHint() {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        padding: "6px 12px",
        background: "var(--color-bg-panel)",
        border: "1px solid var(--color-border-default)",
        fontFamily: "var(--font-heading)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--color-text-secondary)",
      }}
    >
      Step 1 — Click <span style={{ color: "var(--color-accent-orange)" }}>Select AOI</span> to begin
    </div>
  );
}

function DrawHint() {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        padding: "6px 12px",
        background: "var(--color-bg-panel)",
        border: "1px solid var(--color-accent-orange)",
        fontFamily: "var(--font-heading)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--color-accent-orange)",
      }}
    >
      Drag to draw — max {MAX_AOI_KM} × {MAX_AOI_KM} km
    </div>
  );
}

interface ConfirmBarProps {
  bbox: BoundingBox;
  onConfirm: () => void;
  onRedraw: () => void;
}

function ConfirmBar({ bbox, onConfirm, onRedraw }: ConfirmBarProps) {
  const { widthKm, heightKm } = bboxSizeKm(bbox);
  return (
    <div
      style={{
        position: "absolute",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        display: "flex",
        alignItems: "stretch",
        background: "var(--color-bg-panel)",
        border: "1px solid var(--color-border-default)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "var(--space-2) var(--space-3)",
          borderRight: "1px solid var(--color-border-subtle)",
          minWidth: 160,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--color-text-secondary)",
          }}
        >
          Area Selected
        </span>
        <span
          style={{
            fontFamily: "var(--font-data)",
            fontSize: 13,
            color: "var(--color-text-primary)",
            marginTop: 2,
          }}
        >
          {widthKm.toFixed(1)} × {heightKm.toFixed(1)} km
        </span>
      </div>
      <button
        className="btn"
        onClick={onRedraw}
        style={{ border: "none", borderRight: "1px solid var(--color-border-subtle)", padding: "0 var(--space-4)" }}
      >
        ✕ Redraw
      </button>
      <button
        className="btn btn--active"
        onClick={onConfirm}
        style={{ border: "none", padding: "0 var(--space-4)" }}
      >
        ✓ Confirm Selection
      </button>
    </div>
  );
}
