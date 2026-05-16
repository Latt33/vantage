import { useState } from "react";
import { LayerConfig, BoundingBox, AppMode } from "./types";
import { useArea, setArea, bboxToArea } from "./area";
import MapView from "./components/MapView";
import LayerPanel from "./components/LayerPanel";
import TopBar from "./components/TopBar";

const INITIAL_LAYERS: LayerConfig[] = [
  { id: "terrain",        label: "Terrain",        sublabel: "Elevation · DEM",         accentColor: "#8a7a5a", visible: false, opacity: 0.7 },
  { id: "weather",        label: "Weather",         sublabel: "Open-Meteo forecast",      accentColor: "#2a6db5", visible: false, opacity: 0.6 },
  { id: "landcover",      label: "Land Cover",      sublabel: "Forest density · OSM",     accentColor: "#2a7a2a", visible: false, opacity: 0.65 },
  { id: "infrastructure", label: "Infrastructure",  sublabel: "Roads · bridges · towers", accentColor: "#d4a017", visible: false, opacity: 0.8 },
  { id: "population",     label: "Population",      sublabel: "Density distribution",     accentColor: "#e8622a", visible: false, opacity: 0.55 },
];

export default function App() {
  const [layers, setLayers] = useState<LayerConfig[]>(INITIAL_LAYERS);
  const area = useArea();
  const [mode, setMode] = useState<AppMode>("select");

  function handleLayerChange(id: string, patch: Partial<LayerConfig>) {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  }

  function handleAoiDrawn(bbox: BoundingBox) {
    setArea(bboxToArea(bbox));
    setMode("confirm");
  }

  function handleConfirm() {
    if (area) setMode("analyze");
  }

  function handleReset() {
    setArea(null);
    setMode("select");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <TopBar mode={mode} area={area} onReset={handleReset} />
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <MapView
          mode={mode}
          layers={layers}
          area={area}
          onAoiDrawn={handleAoiDrawn}
          onConfirm={handleConfirm}
          onRedraw={handleReset}
        />
        {mode === "analyze" && (
          <LayerPanel layers={layers} onChange={handleLayerChange} />
        )}
      </div>
    </div>
  );
}
