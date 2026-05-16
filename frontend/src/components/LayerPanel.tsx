import React, { useState } from "react";
import { INFRASTRUCTURE, InfraNode } from "../data/infrastructure";
import { LayerConfig, LayerId, LayerSection, WeatherMetricId } from "../types";

interface LayerPanelProps {
  sections: LayerSection[];
  infrastructureSelected: Set<string>;
  onInfrastructureToggle: (id: string) => void;
  infraEnabled: Set<string>;
  infraStatusById: Record<string, { loadState?: LayerConfig["loadState"]; hasData?: boolean }>;
  weatherMetrics: Record<WeatherMetricId, boolean>;
  onWeatherMetricToggle: (id: WeatherMetricId) => void;
  roadLegendVisible: boolean;
  onChange: (id: LayerId, patch: Partial<LayerConfig>) => void;
}

export default function LayerPanel({
  sections,
  infrastructureSelected,
  onInfrastructureToggle,
  infraEnabled,
  infraStatusById,
  weatherMetrics,
  onWeatherMetricToggle,
  roadLegendVisible,
  onChange,
}: LayerPanelProps) {
  return (
    <div
      style={{
        width: 260,
        flexShrink: 0,
        background: "var(--color-bg-panel)",
        borderLeft: "1px solid var(--color-border-default)",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--color-text-secondary)",
          padding: "var(--space-2) var(--space-3)",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        Layer Panel
      </div>

      {sections.map(section => (
        <div key={section.title}>
          {section.title !== "Demographic" && <SectionHeader title={section.title} />}
          {section.layers.map(layer => (
            <div key={layer.id}>
              <LayerRow layer={layer} onChange={onChange} />
              {layer.id === "weather" && layer.visible && (
                <WeatherControls metrics={weatherMetrics} onToggle={onWeatherMetricToggle} />
              )}
              {layer.id === "landcover" && layer.visible && <LandcoverLegend />}
              {layer.id === "terrain" && layer.visible && <TerrainLegend />}
            </div>
          ))}
        </div>
      ))}

      <div>
        <SectionHeader title="Infrastructure" />
        {INFRASTRUCTURE.map(node => (
          <InfraRow
            key={node.id}
            node={node}
            selected={infrastructureSelected}
            onToggle={onInfrastructureToggle}
            enabled={infraEnabled.has(node.id)}
            loadState={infraStatusById[node.id]?.loadState}
            hasData={infraStatusById[node.id]?.hasData}
          />
        ))}
        {roadLegendVisible && (
          <div style={{ padding: "8px 12px", borderTop: "1px dashed var(--color-border-subtle)" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6 }}>Road size</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <LegendSwatch color="#ffd47a" label="small" />
              <LegendSwatch color="#f1c40f" label="local" />
              <LegendSwatch color="#d35400" label="primary" />
              <LegendSwatch color="#c0392b" label="major" />
              <LegendSwatch color="#7a1919" label="highway" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LandcoverLegend() {
  const items = [
    ["Forest", "#2a7a2a"],
    ["Built-up", "#8b5a2b"],
    ["Water", "#2a6db5"],
    ["Wetland", "#4f7f5b"],
    ["Open land", "#a8b85f"],
    ["Rock", "#7a7a7a"],
    ["Other", "#5a7a5a"],
  ] as const;

  return (
    <div style={{ padding: "6px 12px 10px 36px", borderBottom: "1px solid var(--color-border-subtle)" }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-text-secondary)", marginBottom: 6 }}>
        Land Type Colors
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {items.map(([label, color]) => <LegendRow key={label} label={label} color={color} />)}
      </div>
    </div>
  );
}

function TerrainLegend() {
  const items = [
    ["0 m", "#1e3a1e"],
    ["30 m", "#2e5c1e"],
    ["80 m", "#4a8020"],
    ["150 m", "#7aa840"],
    ["250 m", "#a0b860"],
    ["400 m+", "#c8c880"],
  ] as const;

  return (
    <div style={{ padding: "6px 12px 10px 36px", borderBottom: "1px solid var(--color-border-subtle)" }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-text-secondary)", marginBottom: 6 }}>
        Elevation Colors
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {items.map(([label, color]) => <LegendRow key={label} label={label} color={color} />)}
      </div>
    </div>
  );
}

function LegendRow({ label, color }: { label: string; color: string }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <div style={{ width: 18, height: 10, background: color, border: "1px solid rgba(0,0,0,0.15)" }} />
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{label}</div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px 4px 12px",
      }}
    >
      <div style={{ flexShrink: 0, height: 1, width: 12, background: "var(--color-border-default)" }} />
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-text-dim)",
        }}
      >
        {title}
      </div>
      <div style={{ flex: 1, height: 1, background: "var(--color-border-default)" }} />
    </div>
  );
}

interface RowProps {
  layer: LayerConfig;
  onChange: (id: LayerId, patch: Partial<LayerConfig>) => void;
}

function LayerRow({ layer, onChange }: RowProps) {
  let badge: React.ReactNode = null;
  if (layer.loadState === "error") {
    badge = <span className="badge badge--crit">Error</span>;
  } else if (layer.loadState === "ready") {
    if (layer.hasData !== true) badge = <span className="badge badge--warn">No Data</span>;
  } else if (layer.loadState === "loading") {
    badge = <span className="badge badge--info">Loading</span>;
  }
  // loadState undefined (e.g. population with no backend stage) → no badge

  return (
    <div style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
      <div
        style={{
          minHeight: 32,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 12px",
        }}
      >
        <input
          type="checkbox"
          className="toggle"
          checked={layer.visible}
          onChange={e => onChange(layer.id, { visible: e.target.checked })}
        />
        <span
          style={{
            width: 8,
            height: 8,
            background: layer.accentColor,
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              color: "var(--color-text-primary)",
            }}
          >
            <span>{layer.label}</span>
            {badge}
          </div>
          <div
            style={{
              fontFamily: "var(--font-data)",
              fontSize: 10,
              color: "var(--color-text-secondary)",
              marginTop: 2,
            }}
          >
            {layer.sublabel}
          </div>
        </div>
        {/* opacity percentage removed from row - no opacity controls in UI */}
      </div>
      {/* Opacity controls intentionally omitted */}
    </div>
  );
}

interface InfraRowProps {
  node: InfraNode;
  selected: Set<string>;
  onToggle: (id: string) => void;
  depth?: number;
  enabled?: boolean;
  loadState?: LayerConfig["loadState"];
  hasData?: boolean;
}

function InfraRow({ node, selected, onToggle, depth = 0, enabled = true, loadState, hasData }: InfraRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = !!node.children && node.children.length > 0;
  let badge: React.ReactNode = null;
  if (loadState === "error") {
    badge = <span className="badge badge--crit">Error</span>;
  } else if (loadState === "ready") {
    if (hasData !== true) badge = <span className="badge badge--warn">No Data</span>;
  } else if (loadState === "loading") {
    badge = <span className="badge badge--info">Loading</span>;
  }

  return (
    <div style={{ borderBottom: depth === 0 ? "1px solid var(--color-border-subtle)" : "none" }}>
      <div
        style={{
          minHeight: 30,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: depth === 0 ? "0 12px" : "0 12px 0 28px",
        }}
      >
        <input
          type="checkbox"
          className="toggle"
          checked={selected.has(node.id)}
          onChange={() => onToggle(node.id)}
          disabled={!enabled}
          title={enabled ? undefined : "Not implemented"}
        />
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.1 }}>
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: depth === 0 ? 13 : 12,
              color: "var(--color-text-primary)",
            }}
          >
            <span>{node.label}</span>{" "}
            {badge}
          </div>
          {node.sublabel && (
            <div
              style={{
                marginTop: 2,
                fontFamily: "var(--font-data)",
                fontSize: 10,
                color: "var(--color-text-secondary)",
              }}
            >
              {node.sublabel}
            </div>
          )}
        </div>
        {hasChildren && (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            style={{
              background: "none",
              border: "none",
              padding: "0 2px",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
              fontFamily: "var(--font-data)",
              fontSize: 12,
            }}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? "▾" : "▸"}
          </button>
        )}
      </div>

      {expanded && hasChildren && node.children!.map(child => (
        <InfraRow
          key={child.id}
          node={child}
          selected={selected}
          onToggle={onToggle}
          depth={depth + 1}
          loadState={loadState}
          hasData={hasData}
        />
      ))}
    </div>
  );
}

function WeatherControls({ metrics, onToggle }: { metrics: Record<WeatherMetricId, boolean>; onToggle: (id: WeatherMetricId) => void }) {
  const items: Array<{ id: WeatherMetricId; label: string; sublabel: string }> = [
    { id: "cloudAmount", label: "Cloud Amount", sublabel: "Cloud cover percentage" },
    { id: "cloudHeight", label: "Cloud Height", sublabel: "High cloud layer proxy" },
    { id: "visibility", label: "Visibility", sublabel: "Visibility range" },
    { id: "temperature", label: "Temperature", sublabel: "2 m air temperature" },
    { id: "windSpeed", label: "Wind Speed", sublabel: "10 m wind speed" },
  ];

  return (
    <div style={{ padding: "6px 12px 10px 36px", display: "grid", gap: 6, borderBottom: "1px solid var(--color-border-subtle)" }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-text-secondary)" }}>
        Weather Settings
      </div>
      {items.map((item) => (
        <label key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" className="toggle" checked={metrics[item.id]} onChange={() => onToggle(item.id)} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--color-text-primary)" }}>{item.label}</div>
            <div style={{ fontFamily: "var(--font-data)", fontSize: 10, color: "var(--color-text-secondary)" }}>{item.sublabel}</div>
          </div>
        </label>
      ))}
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <div style={{ width: 18, height: 10, background: color, border: "1px solid rgba(0,0,0,0.15)" }} />
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{label}</div>
    </div>
  );
}
