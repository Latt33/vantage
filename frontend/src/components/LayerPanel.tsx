import React, { useState } from "react";
import { INFRASTRUCTURE, InfraNode } from "../data/infrastructure";
import { LayerConfig, LayerId, LayerSection } from "../types";

interface LayerPanelProps {
  sections: LayerSection[];
  infrastructureSelected: Set<string>;
  onInfrastructureToggle: (id: string) => void;
  onChange: (id: LayerId, patch: Partial<LayerConfig>) => void;
}

export default function LayerPanel({
  sections,
  infrastructureSelected,
  onInfrastructureToggle,
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
          <SectionHeader title={section.title} />
          {section.layers.map(layer => (
            <LayerRow key={layer.id} layer={layer} onChange={onChange} />
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
          />
        ))}
      </div>
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
        <div
          style={{
            fontFamily: "var(--font-data)",
            fontSize: 11,
            color: "var(--color-text-secondary)",
          }}
        >
          {Math.round(layer.opacity * 100)}%
        </div>
      </div>

      {layer.visible && (
        <div
          style={{
            padding: "6px 12px 10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
              Opacity
            </span>
            <span
              style={{
                fontFamily: "var(--font-data)",
                fontSize: 11,
                color: "var(--color-text-secondary)",
              }}
            >
              {Math.round(layer.opacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            className="opacity-slider"
            min={0}
            max={1}
            step={0.01}
            value={layer.opacity}
            onChange={e => onChange(layer.id, { opacity: parseFloat(e.target.value) })}
          />
        </div>
      )}
    </div>
  );
}

interface InfraRowProps {
  node: InfraNode;
  selected: Set<string>;
  onToggle: (id: string) => void;
  depth?: number;
}

function InfraRow({ node, selected, onToggle, depth = 0 }: InfraRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = !!node.children && node.children.length > 0;

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
        />
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.1 }}>
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: depth === 0 ? 13 : 12,
              color: "var(--color-text-primary)",
            }}
          >
            {node.label}
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
        <InfraRow key={child.id} node={child} selected={selected} onToggle={onToggle} depth={depth + 1} />
      ))}
    </div>
  );
}
