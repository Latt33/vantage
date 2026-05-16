import { useState } from "react";
import { Capability } from "../data/capabilities";
import CapabilityIcon from "./icons/CapabilityIcon";

interface ToolPanelProps {
  capabilities: Capability[];
  derivedSelected: Set<string>;
  onDerivedToggle: (id: string) => void;
  onManageForces: () => void;
  onExport: () => void;
  onMissionWindow: () => void;
}

export default function ToolPanel({
  capabilities,
  derivedSelected,
  onDerivedToggle,
  onManageForces,
  onExport,
  onMissionWindow,
}: ToolPanelProps) {
  return (
    <div
      style={{
        width: 300,
        flexShrink: 0,
        background: "var(--color-bg-panel)",
        borderRight: "1px solid var(--color-border-default)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <PanelHeader title="Tools" />

      <div className="panel-scroll" style={{ flex: 1, overflowY: "auto" }}>
        <SectionHeader title="Forces & Capabilities" />
        {capabilities.length === 0 ? (
          <EmptyState text="No forces selected" />
        ) : (
          capabilities.map(c => (
            <ForceRow
              key={c.id}
              capability={c}
              derivedSelected={derivedSelected}
              onDerivedToggle={onDerivedToggle}
            />
          ))
        )}
        <div style={{ padding: "8px 12px 12px 12px" }}>
          <button className="btn" style={{ width: "100%" }} onClick={onManageForces}>
            ⤺ Manage Forces
          </button>
        </div>
      </div>

      <div
        style={{
          flexShrink: 0,
          borderTop: "1px solid var(--color-border-default)",
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          background: "var(--color-bg-panel)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--color-text-dim)",
            marginBottom: 4,
          }}
        >
          Mission Window
        </div>
        <ExportButton icon="◷" label="Analyse Conditions" onClick={onMissionWindow} />
      </div>

      <div
        style={{
          flexShrink: 0,
          borderTop: "1px solid var(--color-border-default)",
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          background: "var(--color-bg-panel)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--color-text-dim)",
            marginBottom: 4,
          }}
        >
          Export
        </div>
        <ExportButton icon="⤓" label="Export IPB Report" onClick={onExport} />
      </div>
    </div>
  );
}

function PanelHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-heading)",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--color-text-secondary)",
        padding: "8px 12px",
        borderBottom: "1px solid var(--color-border-subtle)",
        flexShrink: 0,
      }}
    >
      {title}
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
        padding: "12px 12px 4px 12px",
      }}
    >
      <div style={{ flexShrink: 0, width: 12, height: 1, background: "var(--color-border-default)" }} />
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

function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        fontFamily: "var(--font-data)",
        fontSize: 11,
        color: "var(--color-text-dim)",
      }}
    >
      {text}
    </div>
  );
}

interface ForceRowProps {
  capability: Capability;
  derivedSelected: Set<string>;
  onDerivedToggle: (id: string) => void;
}

function ForceRow({ capability, derivedSelected, onDerivedToggle }: ForceRowProps) {
  const [expanded, setExpanded] = useState(true);
  const hasDerived = capability.derivedFilters.length > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "4px 12px",
        borderBottom: "1px solid var(--color-border-subtle)",
      }}
    >
      <div style={{ display: "flex", gap: 10 }}>
        <div
          style={{
            flexShrink: 0,
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid var(--color-border-default)",
          }}
        >
          <CapabilityIcon name={capability.icon} size={20} color="var(--color-accent-teal)" />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              color: "var(--color-text-primary)",
              lineHeight: 1.1,
            }}
          >
            {capability.label}
          </div>

          {hasDerived && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <button
                type="button"
                onClick={() => setExpanded(e => !e)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-text-secondary)",
                  cursor: "pointer",
                  fontFamily: "var(--font-heading)",
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  padding: "4px 0 2px 0",
                  textAlign: "left",
                }}
                aria-label={expanded ? "Collapse derived filters" : "Expand derived filters"}
              >
                {expanded ? "▾" : "▸"} Derived Filters
              </button>

              {expanded && capability.derivedFilters.map(filter => (
                <label
                  key={`${capability.id}:${filter.id}`}
                  style={{
                    minHeight: 20,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    className="toggle"
                    checked={derivedSelected.has(`${capability.id}:${filter.id}`)}
                    onChange={() => onDerivedToggle(`${capability.id}:${filter.id}`)}
                  />
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: 11,
                      color: "var(--color-text-primary)",
                      lineHeight: 1.1,
                    }}
                  >
                    {filter.label}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ExportButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      className="btn"
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        justifyContent: "flex-start",
      }}
    >
      <span style={{ color: "var(--color-accent-orange)", fontFamily: "var(--font-data)", fontSize: 12 }}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}
