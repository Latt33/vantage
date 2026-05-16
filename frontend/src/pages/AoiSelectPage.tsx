import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import type { Feature, Polygon } from "geojson";
import { BoundingBox, MAX_AOI_KM } from "../types";
import { setArea, bboxToArea } from "../area";
import { MAPTILER_KEY, API_BASE_URL } from "../config";
import { useAoi, bboxSizeKm } from "../hooks/useAoi";

const AOI_SOURCE = "aoi-source";
const AOI_FILL = "aoi-fill";
const AOI_OUTLINE = "aoi-outline";

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function bboxToFeature(b: BoundingBox): Feature<Polygon> {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[
        [b.minLon, b.minLat],
        [b.maxLon, b.minLat],
        [b.maxLon, b.maxLat],
        [b.minLon, b.maxLat],
        [b.minLon, b.minLat],
      ]],
    },
  };
}

function fmtLon(v: number): string {
  return `${Math.abs(v).toFixed(2)}°${v >= 0 ? "E" : "W"}`;
}
function fmtLat(v: number): string {
  return `${Math.abs(v).toFixed(2)}°${v >= 0 ? "N" : "S"}`;
}

export default function AoiSelectPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [bbox, setBbox] = useState<BoundingBox | null>(null);
  const navigate = useNavigate();

  const {
    drawMode,
    setDrawMode,
    toggleDrawMode,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    getLiveGeoJSON,
  } = useAoi();

  const existingAoisRef = useRef<any[]>([]);
  const selectHandlerRef = useRef<(aoi: any) => void>();

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
      // Saved AOIs layer
      map.addSource("saved-aois", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "saved-aois-fill",
        type: "fill",
        source: "saved-aois",
        paint: { "fill-color": "#ff3333", "fill-opacity": 0.15 },
      });
      map.addLayer({
        id: "saved-aois-outline",
        type: "line",
        source: "saved-aois",
        paint: { "line-color": "#ff3333", "line-width": 1, "line-dasharray": [3, 3] },
      });

      // Active AOI layer
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

      map.on("click", "saved-aois-fill", (e) => {
        if (!e.features || e.features.length === 0) return;
        const clickedId = e.features[0].properties?.aoi_id;
        const found = existingAoisRef.current.find(a => a.aoi_id === clickedId);
        if (found && selectHandlerRef.current) {
          selectHandlerRef.current(found);
        }
      });

      map.on("mouseenter", "saved-aois-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "saved-aois-fill", () => {
        map.getCanvas().style.cursor = "";
      });

      setMapReady(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // AOI source rendering
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
    } else if (bbox) {
      src.setData(bboxToFeature(bbox));
      map.setPaintProperty(AOI_OUTLINE, "line-width", 1.5);
      map.setPaintProperty(AOI_OUTLINE, "line-dasharray", [1, 0]);
      map.setPaintProperty(AOI_FILL, "fill-opacity", 0.06);
    } else {
      src.setData(EMPTY_FC);
    }
  });

  // Mouse handlers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const canvas = map.getCanvas();

    if (!drawMode) {
      canvas.style.cursor = "";
      map.dragPan.enable();
      return;
    }

    canvas.style.cursor = "crosshair";
    map.dragPan.disable();

    let isDown = false;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      isDown = true;
      e.preventDefault();
      handleMouseDown(e, map);
    };
    const onMove = (e: MouseEvent) => { if (isDown) handleMouseMove(e, map); };
    const onUp = (e: MouseEvent) => {
      if (!isDown) return;
      isDown = false;
      handleMouseUp(e, map, (b) => {
        setBbox(b);
        map.fitBounds(
          [[b.minLon, b.minLat], [b.maxLon, b.maxLat]],
          { padding: 80, duration: 800, maxZoom: 13 }
        );
      });
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

  const [existingAois, setExistingAois] = useState<any[]>([]);
  const [selectedAoiId, setSelectedAoiId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/aoi`)
      .then((res) => res.json())
      .then((data) => setExistingAois(data))
      .catch((err) => console.error("Failed to fetch AOIs", err));
  }, []);

  useEffect(() => {
    existingAoisRef.current = existingAois;
  }, [existingAois]);

  function handleSelectExisting(aoi: any) {
    if (selectedAoiId === aoi.aoi_id) {
      setBbox(null);
      setDrawMode(false);
      setSelectedAoiId(null);
      if (mapRef.current) {
        setTimeout(() => {
          mapRef.current?.flyTo({
            center: [25.0, 64.5],
            zoom: 5,
            duration: 800,
          });
        }, 50);
      }
      return;
    }

    const b: BoundingBox = {
      minLon: aoi.bbox.min_lon,
      minLat: aoi.bbox.min_lat,
      maxLon: aoi.bbox.max_lon,
      maxLat: aoi.bbox.max_lat,
    };
    setBbox(b);
    setDrawMode(false);
    setSelectedAoiId(aoi.aoi_id);
    if (mapRef.current) {
      setTimeout(() => {
        mapRef.current?.fitBounds(
          [[b.minLon, b.minLat], [b.maxLon, b.maxLat]],
          { padding: 80, duration: 800, maxZoom: 13 }
        );
      }, 50);
    }
  }

  useEffect(() => {
    selectHandlerRef.current = handleSelectExisting;
  });

  // Sync saved AOIs to map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("saved-aois") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const uniqueBboxes = new Set<string>();
    const features: Feature<Polygon>[] = [];

    existingAois.forEach(aoi => {
      const key = `${aoi.bbox.min_lon},${aoi.bbox.min_lat},${aoi.bbox.max_lon},${aoi.bbox.max_lat}`;
      if (!uniqueBboxes.has(key)) {
        uniqueBboxes.add(key);
        const b: BoundingBox = {
          minLon: aoi.bbox.min_lon,
          minLat: aoi.bbox.min_lat,
          maxLon: aoi.bbox.max_lon,
          maxLat: aoi.bbox.max_lat,
        };
        const f = bboxToFeature(b);
        f.properties = { aoi_id: aoi.aoi_id };
        features.push(f);
      }
    });

    src.setData({ type: "FeatureCollection", features });
  }, [existingAois, mapReady]);

  function handleProceed() {
    if (!bbox) return;
    sessionStorage.setItem("aoi", JSON.stringify(bbox));
    setArea(bboxToArea(bbox));
    navigate("/capabilities");
  }

  function handleLogout() {
    sessionStorage.clear();
    navigate("/login");
  }

  function handleCancel() {
    setBbox(null);
    setDrawMode(false);
    setSelectedAoiId(null);
    if (mapRef.current) {
      setTimeout(() => {
        mapRef.current?.flyTo({
          center: [25.0, 64.5],
          zoom: 5,
          duration: 800,
        });
      }, 50);
    }
  }

  function handleRedraw() {
    setBbox(null);
    setDrawMode(true);
    setSelectedAoiId(null);
    if (mapRef.current) {
      setTimeout(() => {
        mapRef.current?.flyTo({
          center: [25.0, 64.5],
          zoom: 5,
          duration: 800,
        });
      }, 50);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      <TopBar
        onLogout={handleLogout}
        bbox={bbox}
        drawing={drawMode}
      />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

          <div style={{ position: "absolute", top: 12, left: 12, zIndex: 10, display: "flex", gap: 8 }}>
            <button
              className={`btn draw-toggle ${drawMode ? "btn--active" : ""}`}
              onClick={toggleDrawMode}
            >
              {drawMode ? "■ Cancel" : "⊹ Define AOI"}
            </button>
          </div>

          {drawMode && (
            <Hint accent>
              Drag to draw — max {MAX_AOI_KM} × {MAX_AOI_KM} km
            </Hint>
          )}
          {!drawMode && !bbox && (
            <Hint>
              Step 1 — Click <span style={{ color: "var(--color-accent-orange)" }}>Define AOI</span> or select a saved area
            </Hint>
          )}

          {bbox && !drawMode && <ConfirmPanel bbox={bbox} onProceed={handleProceed} onCancel={handleCancel} onRedraw={handleRedraw} />}
        </div>

        {existingAois.length > 0 && (
          <div
            style={{
              width: 240,
              background: "var(--color-bg-panel)",
              borderLeft: "1px solid var(--color-border-default)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "12px 12px 8px",
                borderBottom: "1px solid var(--color-border-subtle)",
                fontFamily: "var(--font-heading)",
                fontSize: 10,
                fontWeight: 600,
                color: "var(--color-text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              Saved Areas ({existingAois.length})
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {existingAois.map((aoi, idx) => {
                const date = new Date(aoi.created_at).toLocaleString(undefined, { 
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
                });
                return (
                  <button
                    key={aoi.aoi_id}
                    onClick={() => handleSelectExisting(aoi)}
                    style={{
                      background: selectedAoiId === aoi.aoi_id ? "rgba(232, 98, 42, 0.15)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${selectedAoiId === aoi.aoi_id ? "var(--color-accent-orange)" : "var(--color-border-subtle)"}`,
                      padding: "6px 10px",
                      textAlign: "left",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      borderRadius: 2,
                    }}
                  >
                    <div style={{ fontFamily: "var(--font-heading)", fontSize: 11, color: "var(--color-text-primary)" }}>
                      Area {idx + 1}
                    </div>
                    <div style={{ fontFamily: "var(--font-data)", fontSize: 9, color: "var(--color-text-dim)" }}>
                      {date}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TopBar({ onLogout, bbox, drawing }: { onLogout: () => void; bbox: BoundingBox | null; drawing: boolean }) {
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
      <button className="btn" onClick={onLogout}>◀ Logout</button>
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
        Select Operations Area
      </div>
      <div
        style={{
          fontFamily: "var(--font-data)",
          fontSize: 11,
          color: "var(--color-text-secondary)",
          minWidth: 280,
          textAlign: "right",
        }}
      >
        {bbox
          ? `${fmtLon(bbox.minLon)} ${fmtLat(bbox.minLat)} → ${fmtLon(bbox.maxLon)} ${fmtLat(bbox.maxLat)}`
          : drawing
            ? "DRAWING…"
            : "DRAW RECTANGLE TO DEFINE AOI"}
      </div>
    </div>
  );
}

function Hint({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
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
        border: `1px solid ${accent ? "var(--color-accent-orange)" : "var(--color-border-default)"}`,
        fontFamily: "var(--font-heading)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: accent ? "var(--color-accent-orange)" : "var(--color-text-secondary)",
      }}
    >
      {children}
    </div>
  );
}

function ConfirmPanel({ bbox, onProceed, onCancel, onRedraw }: { bbox: BoundingBox; onProceed: () => void; onCancel: () => void; onRedraw: () => void }) {
  const { widthKm, heightKm } = bboxSizeKm(bbox);
  return (
    <div
      style={{
        position: "absolute",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        background: "var(--color-bg-panel)",
        border: "1px solid var(--color-border-default)",
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 480,
        alignItems: "center",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          color: "var(--color-accent-orange)",
        }}
      >
        AOI Confirmed · {widthKm.toFixed(1)} × {heightKm.toFixed(1)} km
      </div>
      <div
        style={{
          fontFamily: "var(--font-data)",
          fontSize: 11,
          color: "var(--color-text-secondary)",
        }}
      >
        {fmtLon(bbox.minLon)} {fmtLat(bbox.minLat)} → {fmtLon(bbox.maxLon)} {fmtLat(bbox.maxLat)}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" onClick={onCancel}>✕ Cancel</button>
        <button className="btn" onClick={onRedraw}>⟲ Redraw</button>
        <button className="btn btn--active" onClick={onProceed}>Proceed to Capabilities ▶</button>
      </div>
    </div>
  );
}
