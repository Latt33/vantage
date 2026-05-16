import { useState } from "react";
import { Capability } from "../data/capabilities";
import CapabilityIcon from "./icons/CapabilityIcon";

interface ToolPanelProps {
  capabilities: Capability[];
  derivedSelected: Set<string>;
  derivedLoading?: Set<string>;
  onDerivedToggle: (id: string) => void;
  onManageForces: () => void;
  onExport: () => void;
  onMissionWindow: () => void;
}

export default function ToolPanel({
  capabilities,
  derivedSelected,
  derivedLoading,
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
              derivedLoading={derivedLoading}
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
  derivedLoading?: Set<string>;
  onDerivedToggle: (id: string) => void;
}

function ForceRow({ capability, derivedSelected, derivedLoading, onDerivedToggle }: ForceRowProps) {
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

          {capability.id === "towed_artillery" && <FiringDirectionField />}

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

              {expanded && capability.derivedFilters.map(filter => {
                const key = `${capability.id}:${filter.id}`;
                const isLoading = derivedLoading?.has(key) ?? false;
                return (
                  <label
                    key={key}
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
                      checked={derivedSelected.has(key)}
                      onChange={() => onDerivedToggle(key)}
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
                    {isLoading && <DerivedSpinner />}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DerivedSpinner() {
  return (
    <>
      <span
        aria-label="Loading"
        role="status"
        style={{
          width: 10,
          height: 10,
          marginLeft: 4,
          borderRadius: "50%",
          border: "1.5px solid rgba(232, 98, 42, 0.35)",
          borderTopColor: "var(--color-accent-orange)",
          display: "inline-block",
          animation: "derived-spinner-rotate 0.8s linear infinite",
          flexShrink: 0,
        }}
      />
      <style>{`@keyframes derived-spinner-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

/**
 * Firing direction (azimuth) input in the Finnish 6000-mil (piiru) system.
 *
 * Accepts "HH-UU" where HH ∈ [00, 60] and UU ∈ [00, 99]. 00-00 → 0°,
 * 60-00 → 360°. Echoes the equivalent degrees below the field so the
 * operator can sanity-check the input.
 */
function FiringDirectionField() {
  const [raw, setRaw] = useState("");
  const [touched, setTouched] = useState(false);

  const parsed = parseMils6000(raw);
  const valid = !touched || raw.trim() === "" || parsed !== null;
  const degrees = parsed === null ? null : (parsed / 6000) * 360;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        marginTop: 6,
        padding: "6px 8px",
        border: "1px solid var(--color-border-subtle)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--color-text-secondary)",
          }}
        >
          Firing Direction
        </span>
        <input
          type="text"
          inputMode="numeric"
          placeholder="00-00"
          maxLength={5}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-label="Firing direction in mils (6000-mil system)"
          style={{
            width: 64,
            background: "transparent",
            border: `1px solid ${valid ? "var(--color-border-default)" : "var(--color-status-crit)"}`,
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-data)",
            fontSize: 12,
            textAlign: "center",
            padding: "2px 4px",
            outline: "none",
          }}
        />
      </div>
      <div
        style={{
          fontFamily: "var(--font-data)",
          fontSize: 10,
          color: valid ? "var(--color-text-dim)" : "var(--color-status-crit)",
          minHeight: 12,
        }}
      >
        {!valid
          ? "Expected HH-UU between 00-00 and 60-00"
          : degrees !== null
            ? `≈ ${degrees.toFixed(1)}° · range 00-00 → 60-00`
            : "Mils (6000-mil system) · 00-00 → 60-00 = 0° → 360°"}
      </div>
    </div>
  );
}

function parseMils6000(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  // Accept "HH-UU" or "HHUU"; reject anything else.
  const m = /^(\d{1,2})[-]?(\d{1,2})$/.exec(trimmed);
  if (!m) return null;
  const hundreds = parseInt(m[1], 10);
  const units = parseInt(m[2], 10);
  if (Number.isNaN(hundreds) || Number.isNaN(units)) return null;
  const mils = hundreds * 100 + units;
  if (mils < 0 || mils > 6000) return null;
  return mils;
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
