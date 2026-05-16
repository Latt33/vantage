import { useEffect, useMemo, useState } from "react";

/**
 * Mission Window Analysis — UI-only overlay.
 *
 * Each threshold has an `*Enabled` flag. When false the row is grayed and
 * the threshold is ignored downstream. When true the row colorises and the
 * value contributes to the placeholder scoring in OperationsPage.
 */

export interface MissionConditionsUi {
  // Atmospheric — each value is paired with an Enabled flag.
  maxWindSpeedMs:      number;  windEnabled:        boolean;
  maxWindGustMs:       number;  gustEnabled:        boolean;
  minVisibilityM:      number;  visibilityEnabled:  boolean;
  maxCloudcoverPct:    number;  cloudEnabled:       boolean;
  rainEnabled:         boolean;                                // "no rain allowed" when true

  // Operating hours (viewer local time) — start/end hour-of-day,
  // inclusive start / exclusive end. Field names keep `Utc` for backwards
  // compatibility with persisted state; the displayed values follow the viewer clock.
  timeOfDayEnabled:    boolean;
  timeStartHourUtc:    number;
  timeEndHourUtc:      number;

  // Derived metrics — UI preview only.
  maxSlopeDeg:           number;  slopeEnabled:           boolean;
  minTrafficabilityPct:  number;  trafficabilityEnabled:  boolean;
  minLineOfSightKm:      number;  losEnabled:             boolean;

  // Analysis parameters
  lookaheadHours: number;
  minScore:       number;
}

export const VISIBILITY_STEPS_M = [50, 100, 200, 500, 1000, 5000, 10000, 20000] as const;

export const DEFAULT_CONDITIONS: MissionConditionsUi = {
  maxWindSpeedMs:        10, windEnabled:        true,
  maxWindGustMs:         15, gustEnabled:        true,
  minVisibilityM:        1000, visibilityEnabled: true,
  maxCloudcoverPct:      70, cloudEnabled:       false,
  rainEnabled:           false,

  timeOfDayEnabled: false,
  timeStartHourUtc: 6,
  timeEndHourUtc:   18,

  maxSlopeDeg:           20,  slopeEnabled:           false,
  minTrafficabilityPct:  60,  trafficabilityEnabled:  false,
  minLineOfSightKm:      3,   losEnabled:             false,

  lookaheadHours: 72,
  minScore:       0.6,
};

// Red → yellow → green gradient for "below = better" (wind, gust, cloud).
const GRADIENT_BELOW = "linear-gradient(to right, rgba(120,200,120,0.55) 0%, rgba(232,200,60,0.55) 50%, rgba(232,80,60,0.55) 100%)";
// Mirror for "above = better" (visibility).
const GRADIENT_ABOVE = "linear-gradient(to right, rgba(232,80,60,0.55) 0%, rgba(232,200,60,0.55) 50%, rgba(120,200,120,0.55) 100%)";
const GRADIENT_NEUTRAL = "linear-gradient(to right, rgba(80,120,180,0.45) 0%, rgba(200,160,80,0.45) 50%, rgba(80,120,180,0.45) 100%)";

interface Props {
  open: boolean;
  initial: MissionConditionsUi;
  onClose: () => void;
  onApply: (conditions: MissionConditionsUi) => void;
}

export default function MissionWindowModal({ open, initial, onClose, onApply }: Props) {
  const [cond, setCond] = useState<MissionConditionsUi>(initial);

  useEffect(() => {
    if (open) setCond(initial);
  }, [open, initial]);

  const summary = useMemo(() => buildSummary(cond), [cond]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(10, 10, 10, 0.82)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(960px, 100%)", maxHeight: "92vh",
          background: "var(--color-bg-panel)",
          border: "1px solid var(--color-border-default)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <ModalHeader onClose={onClose} />

        <div
          style={{
            flex: 1, overflowY: "auto", padding: 16,
            display: "flex", flexDirection: "column", gap: 18,
          }}
        >
          {/* ── Atmospheric ────────────────────────────────────────────── */}
          <Section title="Atmospheric Conditions" subtitle="Forecast-derived weather thresholds">
            <GradientRow
              label="Wind Speed (10 m)"
              enabled={cond.windEnabled}
              onToggle={(v) => setCond((c) => ({ ...c, windEnabled: v }))}
              value={cond.maxWindSpeedMs}
              min={0} max={25} step={0.5}
              format={(v) => `≤ ${v.toFixed(1)} m/s`}
              gradient={GRADIENT_BELOW}
              onChange={(v) => setCond((c) => ({ ...c, maxWindSpeedMs: v }))}
            />
            <GradientRow
              label="Wind Gusts"
              enabled={cond.gustEnabled}
              onToggle={(v) => setCond((c) => ({ ...c, gustEnabled: v }))}
              value={cond.maxWindGustMs}
              min={0} max={40} step={0.5}
              format={(v) => `≤ ${v.toFixed(1)} m/s`}
              gradient={GRADIENT_BELOW}
              onChange={(v) => setCond((c) => ({ ...c, maxWindGustMs: v }))}
            />
            <VisibilityRow
              enabled={cond.visibilityEnabled}
              onToggle={(v) => setCond((c) => ({ ...c, visibilityEnabled: v }))}
              valueM={cond.minVisibilityM}
              onChange={(m) => setCond((c) => ({ ...c, minVisibilityM: m }))}
            />
            <GradientRow
              label="Cloud Cover"
              enabled={cond.cloudEnabled}
              onToggle={(v) => setCond((c) => ({ ...c, cloudEnabled: v }))}
              value={cond.maxCloudcoverPct}
              min={0} max={100} step={1}
              format={(v) => `≤ ${Math.round(v)} %`}
              gradient={GRADIENT_BELOW}
              onChange={(v) => setCond((c) => ({ ...c, maxCloudcoverPct: v }))}
            />
            <ToggleRow
              label="Rain"
              activeLabel="No rain allowed"
              inactiveLabel="Rain ignored"
              enabled={cond.rainEnabled}
              onToggle={(v) => setCond((c) => ({ ...c, rainEnabled: v }))}
            />
          </Section>

          {/* ── Operating hours ───────────────────────────────────────── */}
          <Section title="Operating Hours" subtitle="Hard time-of-day gate (viewer local time)">
            <ToggleRow
              label="Restrict to time-of-day window"
              activeLabel={`Active · ${fmtHour(cond.timeStartHourUtc)} → ${fmtHour(cond.timeEndHourUtc)} local time`}
              inactiveLabel="Any hour permitted"
              enabled={cond.timeOfDayEnabled}
              onToggle={(v) => setCond((c) => ({ ...c, timeOfDayEnabled: v }))}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <GradientRow
                label="Start Hour"
                enabled={cond.timeOfDayEnabled}
                showToggle={false}
                value={cond.timeStartHourUtc}
                min={0} max={23} step={1}
                format={(v) => fmtHour(v) + " local time"}
                gradient={GRADIENT_NEUTRAL}
                onChange={(v) => setCond((c) => ({ ...c, timeStartHourUtc: Math.round(v) }))}
              />
              <GradientRow
                label="End Hour"
                enabled={cond.timeOfDayEnabled}
                showToggle={false}
                value={cond.timeEndHourUtc}
                min={0} max={23} step={1}
                format={(v) => fmtHour(v) + " local time"}
                gradient={GRADIENT_NEUTRAL}
                onChange={(v) => setCond((c) => ({ ...c, timeEndHourUtc: Math.round(v) }))}
              />
            </div>
            {cond.timeOfDayEnabled && cond.timeStartHourUtc === cond.timeEndHourUtc && (
              <HintText warn>Start and end are identical — window covers a single hour only.</HintText>
            )}
            {cond.timeOfDayEnabled && cond.timeEndHourUtc < cond.timeStartHourUtc && (
              <HintText>Window crosses midnight (end is the following day).</HintText>
            )}
          </Section>

          {/* ── Derived metrics (preview) ─────────────────────────────── */}
          <Section title="Derived Metrics" subtitle="Terrain-derived — UI preview, not scored yet">
            <GradientRow
              label="Max Terrain Slope"
              enabled={cond.slopeEnabled}
              onToggle={(v) => setCond((c) => ({ ...c, slopeEnabled: v }))}
              value={cond.maxSlopeDeg}
              min={0} max={45} step={1}
              format={(v) => `≤ ${Math.round(v)}°`}
              gradient={GRADIENT_BELOW}
              onChange={(v) => setCond((c) => ({ ...c, maxSlopeDeg: v }))}
            />
            <GradientRow
              label="Min Trafficability"
              enabled={cond.trafficabilityEnabled}
              onToggle={(v) => setCond((c) => ({ ...c, trafficabilityEnabled: v }))}
              value={cond.minTrafficabilityPct}
              min={0} max={100} step={1}
              format={(v) => `≥ ${Math.round(v)} %`}
              gradient={GRADIENT_ABOVE}
              onChange={(v) => setCond((c) => ({ ...c, minTrafficabilityPct: v }))}
            />
            <GradientRow
              label="Min Line-of-Sight Range"
              enabled={cond.losEnabled}
              onToggle={(v) => setCond((c) => ({ ...c, losEnabled: v }))}
              value={cond.minLineOfSightKm}
              min={0} max={20} step={0.5}
              format={(v) => `≥ ${v.toFixed(1)} km`}
              gradient={GRADIENT_ABOVE}
              onChange={(v) => setCond((c) => ({ ...c, minLineOfSightKm: v }))}
            />
          </Section>

          {/* ── Analysis params ───────────────────────────────────────── */}
          <Section title="Analysis Parameters" subtitle="Search horizon and acceptance threshold">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <GradientRow
                label="Forecast Horizon"
                enabled
                showToggle={false}
                value={cond.lookaheadHours}
                min={24} max={168} step={12}
                format={(v) => `${Math.round(v)} h`}
                gradient={GRADIENT_NEUTRAL}
                onChange={(v) => setCond((c) => ({ ...c, lookaheadHours: Math.round(v) }))}
              />
              <GradientRow
                label="Min Window Score"
                enabled
                showToggle={false}
                value={cond.minScore}
                min={0} max={1} step={0.05}
                format={(v) => v.toFixed(2)}
                gradient={GRADIENT_ABOVE}
                onChange={(v) => setCond((c) => ({ ...c, minScore: v }))}
              />
            </div>
          </Section>
        </div>

        <ModalFooter
          summary={summary}
          onClose={onClose}
          onApply={() => { onApply(cond); onClose(); }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Headers / footers / shared bits
// ---------------------------------------------------------------------------

function ModalHeader({ onClose }: { onClose: () => void }) {
  return (
    <div style={{
      height: 40, flexShrink: 0, padding: "0 12px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      borderBottom: "1px solid var(--color-border-default)",
      background: "var(--color-bg-panel)",
    }}>
      <div style={{
        fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 600,
        letterSpacing: "0.15em", textTransform: "uppercase",
        color: "var(--color-text-primary)",
      }}>
        Mission Window Analysis
      </div>
      <button className="btn" type="button" onClick={onClose}>✕ Close</button>
    </div>
  );
}

function ModalFooter({
  summary, onClose, onApply,
}: { summary: string[]; onClose: () => void; onApply: () => void }) {
  return (
    <div style={{
      minHeight: 56, flexShrink: 0, padding: "8px 12px",
      display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between",
      borderTop: "1px solid var(--color-border-default)",
      background: "var(--color-bg-panel)",
    }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {summary.length === 0 ? (
          <span style={{ fontFamily: "var(--font-data)", fontSize: 11, color: "var(--color-text-dim)" }}>
            No active thresholds — enable at least one to constrain the search
          </span>
        ) : (
          summary.map((label) => (
            <span key={label} style={{
              fontFamily: "var(--font-data)", fontSize: 10,
              color: "var(--color-text-secondary)",
              border: "1px solid var(--color-border-subtle)", padding: "2px 6px",
            }}>{label}</span>
          ))
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <button className="btn" type="button" onClick={onClose}>Cancel</button>
        <button className="btn btn--active" type="button" onClick={onApply}>Apply ▶</button>
      </div>
    </div>
  );
}

function Section({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 10,
      border: "1px solid var(--color-border-subtle)", padding: "12px 14px",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div style={{
          fontFamily: "var(--font-heading)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.12em", textTransform: "uppercase",
          color: "var(--color-text-primary)",
        }}>{title}</div>
        {subtitle && (
          <div style={{
            fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 300,
            color: "var(--color-text-dim)",
          }}>{subtitle}</div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

function HintText({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <div style={{
      fontFamily: "var(--font-data)", fontSize: 10,
      color: warn ? "var(--color-accent-orange)" : "var(--color-text-dim)",
    }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row components
// ---------------------------------------------------------------------------

interface GradientRowProps {
  label: string;
  value: number;
  min: number; max: number; step: number;
  format: (v: number) => string;
  gradient: string;
  enabled: boolean;
  showToggle?: boolean;
  onToggle?: (v: boolean) => void;
  onChange: (v: number) => void;
}

function GradientRow({
  label, value, min, max, step, format, gradient,
  enabled, showToggle = true, onToggle, onChange,
}: GradientRowProps) {
  const dim = !enabled;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {showToggle && (
          <input
            type="checkbox"
            className="toggle"
            checked={enabled}
            onChange={(e) => onToggle?.(e.target.checked)}
          />
        )}
        <span style={{
          flex: 1,
          fontFamily: "var(--font-ui)", fontSize: 12,
          color: dim ? "var(--color-text-dim)" : "var(--color-text-primary)",
          transition: "color 0.1s",
        }}>{label}</span>
        <span style={{
          fontFamily: "var(--font-data)", fontSize: 12,
          color: dim ? "var(--color-text-dim)" : "var(--color-text-primary)",
          minWidth: 110, textAlign: "right",
          transition: "color 0.1s",
        }}>{format(value)}</span>
      </div>
      <input
        type="range"
        className="gradient-slider"
        min={min} max={max} step={step}
        value={value}
        disabled={dim}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ ["--gradient" as string]: gradient }}
      />
    </div>
  );
}

interface VisibilityRowProps {
  enabled: boolean;
  onToggle: (v: boolean) => void;
  valueM: number;
  onChange: (m: number) => void;
}

function VisibilityRow({ enabled, onToggle, valueM, onChange }: VisibilityRowProps) {
  const dim = !enabled;
  // Snap whatever value comes in to the nearest categorical step.
  const idx = Math.max(0, VISIBILITY_STEPS_M.findIndex((s) => s >= valueM));
  const safeIdx = idx === -1 ? VISIBILITY_STEPS_M.length - 1 : idx;
  const display = formatVisibility(VISIBILITY_STEPS_M[safeIdx]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          className="toggle"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span style={{
          flex: 1,
          fontFamily: "var(--font-ui)", fontSize: 12,
          color: dim ? "var(--color-text-dim)" : "var(--color-text-primary)",
        }}>Min Visibility</span>
        <span style={{
          fontFamily: "var(--font-data)", fontSize: 12,
          color: dim ? "var(--color-text-dim)" : "var(--color-text-primary)",
          minWidth: 110, textAlign: "right",
        }}>≥ {display}</span>
      </div>
      <input
        type="range"
        className="gradient-slider"
        min={0}
        max={VISIBILITY_STEPS_M.length - 1}
        step={1}
        value={safeIdx}
        disabled={dim}
        onChange={(e) => onChange(VISIBILITY_STEPS_M[parseInt(e.target.value, 10)])}
        style={{ ["--gradient" as string]: GRADIENT_ABOVE }}
      />
      {/* Tick labels — show every categorical step under the slider. */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        marginTop: 2,
        fontFamily: "var(--font-data)", fontSize: 9,
        color: dim ? "var(--color-text-dim)" : "var(--color-text-secondary)",
      }}>
        {VISIBILITY_STEPS_M.map((s) => (
          <span key={s}>{formatVisibility(s)}</span>
        ))}
      </div>
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  activeLabel: string;
  inactiveLabel: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
}

function ToggleRow({ label, activeLabel, inactiveLabel, enabled, onToggle }: ToggleRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input
        type="checkbox"
        className="toggle"
        checked={enabled}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <span style={{
        flex: 1,
        fontFamily: "var(--font-ui)", fontSize: 12,
        color: enabled ? "var(--color-text-primary)" : "var(--color-text-dim)",
      }}>{label}</span>
      <span style={{
        fontFamily: "var(--font-data)", fontSize: 11,
        color: enabled ? "var(--color-accent-orange)" : "var(--color-text-dim)",
      }}>
        {enabled ? activeLabel : inactiveLabel}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtHour(h: number): string {
  return `${String(Math.max(0, Math.min(23, Math.round(h)))).padStart(2, "0")}:00`;
}

function formatVisibility(m: number): string {
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km`;
}

function buildSummary(c: MissionConditionsUi): string[] {
  const out: string[] = [];
  if (c.windEnabled)       out.push(`Wind ≤ ${c.maxWindSpeedMs.toFixed(1)} m/s`);
  if (c.gustEnabled)       out.push(`Gust ≤ ${c.maxWindGustMs.toFixed(1)} m/s`);
  if (c.visibilityEnabled) out.push(`Vis ≥ ${formatVisibility(c.minVisibilityM)}`);
  if (c.cloudEnabled)      out.push(`Cloud ≤ ${Math.round(c.maxCloudcoverPct)} %`);
  if (c.rainEnabled)       out.push("No rain");
  if (c.timeOfDayEnabled)  out.push(`Hours ${fmtHour(c.timeStartHourUtc)}–${fmtHour(c.timeEndHourUtc)}`);
  if (c.slopeEnabled)          out.push(`Slope ≤ ${Math.round(c.maxSlopeDeg)}°`);
  if (c.trafficabilityEnabled) out.push(`Traffic ≥ ${Math.round(c.minTrafficabilityPct)} %`);
  if (c.losEnabled)            out.push(`LOS ≥ ${c.minLineOfSightKm.toFixed(1)} km`);
  return out;
}
