import { AppMode } from "../types";
import { AreaContext } from "../area";

interface TopBarProps {
  mode: AppMode;
  area: AreaContext | null;
  onReset: () => void;
}

function fmtLon(v: number): string {
  const hemi = v >= 0 ? "E" : "W";
  return `${Math.abs(v).toFixed(4)}°${hemi}`;
}

function fmtLat(v: number): string {
  const hemi = v >= 0 ? "N" : "S";
  return `${Math.abs(v).toFixed(4)}°${hemi}`;
}

const STEPS: { id: AppMode; label: string }[] = [
  { id: "select",  label: "1 · Select" },
  { id: "confirm", label: "2 · Confirm" },
  { id: "analyze", label: "3 · Analyze" },
];

export default function TopBar({ mode, area, onReset }: TopBarProps) {
  const bbox = area?.bbox ?? null;
  return (
    <div
      style={{
        height: 40,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 var(--space-3)",
        background: "var(--color-bg-panel)",
        borderBottom: "1px solid var(--color-border-default)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--color-text-primary)",
          }}
        >
          IPB · Tactical Map
        </div>
        <div style={{ display: "flex", gap: "var(--space-3)" }}>
          {STEPS.map(step => {
            const active = step.id === mode;
            return (
              <span
                key={step.id}
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: active ? "var(--color-accent-orange)" : "var(--color-text-dim)",
                }}
              >
                {step.label}
              </span>
            );
          })}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          fontFamily: "var(--font-data)",
          fontSize: 11,
          color: "var(--color-text-secondary)",
        }}
      >
        {bbox && (
          <span>
            AOI&nbsp;&nbsp;{fmtLon(bbox.minLon)}&nbsp;&nbsp;{fmtLat(bbox.minLat)}
            &nbsp;&nbsp;→&nbsp;&nbsp;{fmtLon(bbox.maxLon)}&nbsp;&nbsp;{fmtLat(bbox.maxLat)}
          </span>
        )}
      </div>

      <div style={{ minWidth: 100, display: "flex", justifyContent: "flex-end" }}>
        {area && mode === "analyze" && (
          <button className="btn" onClick={onReset}>
            ✕ Clear AOI
          </button>
        )}
      </div>
    </div>
  );
}
