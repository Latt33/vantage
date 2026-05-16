import React, { useState } from "react";
import { INFRASTRUCTURE, InfraNode } from "../data/infrastructure";
import { LayerConfig, LayerId, LayerSection, WeatherAverages } from "../types";

interface LayerPanelProps {
  sections: LayerSection[];
  infrastructureSelected: Set<string>;
  onInfrastructureToggle: (id: string) => void;
  infraEnabled: Set<string>;
  infraStatusById: Record<string, { loadState?: LayerConfig["loadState"]; hasData?: boolean }>;
  weatherAverages: WeatherAverages;
  onChange: (id: LayerId, patch: Partial<LayerConfig>) => void;
}

export default function LayerPanel({
  sections,
  infrastructureSelected,
  onInfrastructureToggle,
  infraEnabled,
  infraStatusById,
  weatherAverages,
  onChange,
}: LayerPanelProps) {
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  return (
    <div
      className="panel-scroll"
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
                <WeatherSummary averages={weatherAverages} />
              )}
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
      </div>

      <AddDataSourceButton onClick={() => setAddSourceOpen(true)} />
      {addSourceOpen && <AddDataSourceModal onClose={() => setAddSourceOpen(false)} />}
    </div>
  );
}

function AddDataSourceButton({ onClick }: { onClick: () => void }) {
  return (
    <div style={{ padding: "12px", borderTop: "1px solid var(--color-border-subtle)" }}>
      <button
        type="button"
        onClick={onClick}
        style={{
          width: "100%",
          minHeight: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          background: "transparent",
          border: "1px dashed var(--color-border-default)",
          color: "var(--color-text-secondary)",
          fontFamily: "var(--font-heading)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          cursor: "pointer",
        }}
      >
        <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 400 }}>+</span>
        Add Data Source
      </button>
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
    ["0 m",    "#ffffff"],
    ["30 m",   "#ffd0c0"],
    ["80 m",   "#ff9070"],
    ["150 m",  "#ff5830"],
    ["250 m",  "#cc2010"],
    ["400 m+", "#7a0000"],
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

function AddDataSourceModal({ onClose }: { onClose: () => void }) {
  const sources: Array<{ id: string; label: string; sublabel: string; provider: string }> = [
    { id: "sentinel", label: "Sentinel-2 Imagery", sublabel: "Optical satellite, 10 m", provider: "Copernicus" },
    { id: "sentinel1", label: "Sentinel-1 SAR", sublabel: "All-weather radar imagery", provider: "Copernicus" },
    { id: "ais", label: "AIS Maritime Traffic", sublabel: "Vessel position telemetry", provider: "EMSA" },
    { id: "adsb", label: "ADS-B Air Traffic", sublabel: "Civil aircraft tracking", provider: "OpenSky" },
    { id: "fmi-radar", label: "FMI Weather Radar", sublabel: "Precipitation radar mosaic", provider: "FMI" },
    { id: "digiroad", label: "Digiroad Restrictions", sublabel: "Weight & height limits", provider: "Fintraffic" },
    { id: "custom-wfs", label: "Custom WFS Endpoint", sublabel: "Connect any OGC WFS service", provider: "Custom" },
    { id: "custom-csv", label: "CSV / GeoJSON Upload", sublabel: "Upload local dataset", provider: "Custom" },
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: "90vw",
          maxHeight: "80vh",
          background: "var(--color-bg-panel)",
          border: "1px solid var(--color-border-default)",
          boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid var(--color-border-subtle)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--color-text-primary)",
            }}
          >
            Connect Data Source
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--color-border-subtle)" }}>
          <input
            type="text"
            placeholder="Search providers, datasets, endpoints…"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "6px 8px",
              background: "var(--color-bg-default)",
              border: "1px solid var(--color-border-default)",
              color: "var(--color-text-primary)",
              fontFamily: "var(--font-ui)",
              fontSize: 12,
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {sources.map((s) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 16px",
                borderBottom: "1px solid var(--color-border-subtle)",
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "var(--color-bg-default)",
                  border: "1px solid var(--color-border-default)",
                  color: "var(--color-text-secondary)",
                  fontFamily: "var(--font-data)",
                  fontSize: 11,
                }}
              >
                {s.provider.slice(0, 3).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
                <div style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--color-text-primary)" }}>
                  {s.label}
                </div>
                <div
                  style={{
                    marginTop: 2,
                    fontFamily: "var(--font-data)",
                    fontSize: 10,
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {s.provider} · {s.sublabel}
                </div>
              </div>
              <button
                type="button"
                disabled
                title="Conceptual — not wired up"
                style={{
                  padding: "4px 10px",
                  background: "transparent",
                  border: "1px solid var(--color-border-default)",
                  color: "var(--color-text-secondary)",
                  fontFamily: "var(--font-heading)",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  cursor: "not-allowed",
                  opacity: 0.7,
                }}
              >
                Connect
              </button>
            </div>
          ))}
        </div>

        <div
          style={{
            padding: "8px 16px",
            borderTop: "1px solid var(--color-border-subtle)",
            fontFamily: "var(--font-data)",
            fontSize: 10,
            color: "var(--color-text-dim)",
            textAlign: "center",
          }}
        >
          Conceptual preview — connectors are illustrative only.
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  collapsible,
  collapsed,
  onToggle,
}: {
  title: string;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const inner = (
    <>
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
      {collapsible && (
        <span style={{ color: "var(--color-text-secondary)", fontSize: 12, fontFamily: "var(--font-data)" }}>
          {collapsed ? "▸" : "▾"}
        </span>
      )}
    </>
  );

  if (!collapsible) {
    return <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px 4px 12px" }}>{inner}</div>;
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px 4px 12px",
        width: "100%",
        background: "none",
        border: "none",
        cursor: "pointer",
      }}
    >
      {inner}
    </button>
  );
}

/**
 * Renders one panel section. The Weather section is collapsible at the
 * section-header level and shows a read-only averages summary (one value per
 * metric) under the layer row — there are no per-metric toggles, since the
 * map only ever displays wind arrows.
 */
function WeatherAwareSection({
  section,
  weatherAverages,
  onChange,
}: {
  section: LayerSection;
  weatherAverages: WeatherAverages;
  onChange: (id: LayerId, patch: Partial<LayerConfig>) => void;
}) {
  const isWeather = section.title === "Weather";
  const [collapsed, setCollapsed] = useState(false);
  const showHeader = section.title !== "Demographic";
  const showBody = !isWeather || !collapsed;

  return (
    <div>
      {showHeader && (
        <SectionHeader
          title={section.title}
          collapsible={isWeather}
          collapsed={collapsed}
          onToggle={() => setCollapsed(c => !c)}
        />
      )}
      {showBody && section.layers.map(layer => (
        <div key={layer.id}>
          <LayerRow layer={layer} onChange={onChange} />
          {isWeather && layer.id === "weather" && layer.visible && (
            <WeatherSummary averages={weatherAverages} />
          )}
        </div>
      ))}
    </div>
  );
}

interface RowProps {
  layer: LayerConfig;
  onChange: (id: LayerId, patch: Partial<LayerConfig>) => void;
}

function LayerRow({ layer, onChange }: RowProps) {
  const [expanded, setExpanded] = useState(false);
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
          aria-label={expanded ? "Hide layer settings" : "Show layer settings"}
          aria-expanded={expanded}
        >
          {expanded ? "▾" : "▸"}
        </button>
      </div>
      {expanded && (
        <OpacityControl
          opacity={layer.opacity}
          onChange={(opacity) => onChange(layer.id, { opacity })}
        />
      )}
    </div>
  );
}

function OpacityControl({ opacity, onChange }: { opacity: number; onChange: (value: number) => void }) {
  const pct = Math.round(opacity * 100);
  return (
    <div
      style={{
        padding: "6px 12px 10px 36px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        borderTop: "1px dashed var(--color-border-subtle)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--color-text-secondary)",
        }}
      >
        Opacity
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        style={{ flex: 1 }}
      />
      <div
        style={{
          fontFamily: "var(--font-data)",
          fontSize: 11,
          color: "var(--color-text-secondary)",
          minWidth: 32,
          textAlign: "right",
        }}
      >
        {pct}%
      </div>
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

function compassFromDeg(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round((deg % 360) / 22.5) % 16];
}

function formatAvg(kind: "wind" | "windDir" | "temp" | "pct" | "vis", v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  switch (kind) {
    case "wind":    return `${v.toFixed(1)} m/s`;
    case "windDir": return `${Math.round(v)}° ${compassFromDeg(v)}`;
    case "temp":    return `${v.toFixed(1)} °C`;
    case "pct":     return `${Math.round(v)}%`;
    case "vis":     return v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`;
  }
}

function WeatherSummary({ averages }: { averages: WeatherAverages }) {
  const rows: Array<{ label: string; sublabel: string; value: string }> = [
    { label: "Wind",        sublabel: "10 m mean across AoI",  value: formatAvg("wind", averages.windSpeed) },
    { label: "Wind dir",    sublabel: "From (meteorological)", value: formatAvg("windDir", averages.windDir) },
    { label: "Gusts",       sublabel: "10 m peak",             value: formatAvg("wind", averages.windGust) },
    { label: "Temperature", sublabel: "2 m air",               value: formatAvg("temp", averages.temperature) },
    { label: "Cloud cover", sublabel: "Total",                 value: formatAvg("pct", averages.cloudAmount) },
    { label: "High cloud",  sublabel: "Layer proxy",           value: formatAvg("pct", averages.cloudHeight) },
    { label: "Visibility",  sublabel: "Horizontal range",      value: formatAvg("vis", averages.visibility) },
  ];

  return (
    <div style={{ padding: "6px 12px 10px 36px", display: "grid", gap: 6, borderBottom: "1px solid var(--color-border-subtle)" }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-text-secondary)" }}>
        AoI averages
      </div>
      {rows.map((row) => (
        <div key={row.label} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--color-text-primary)" }}>{row.label}</div>
            <div style={{ fontFamily: "var(--font-data)", fontSize: 10, color: "var(--color-text-secondary)" }}>{row.sublabel}</div>
          </div>
          <div style={{ fontFamily: "var(--font-data)", fontSize: 12, color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>
            {row.value}
          </div>
        </div>
      ))}
    </div>
  );
}

