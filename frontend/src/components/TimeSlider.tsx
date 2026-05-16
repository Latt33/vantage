import { useMemo, useState } from "react";

/**
 * One contiguous mission-window block to render on the timeline.
 * Hours are offsets from "now" (always ≥ 0 — only future is shown).
 */
export interface MissionWindowBand {
  startHour: number;
  endHour: number;
  kind: "good" | "uncertain";
}

interface Props {
  /** Forecast horizon (hours). Defaults to 72 when no analysis is active. */
  forecastHorizonHours?: number;
  /** Future-only bands drawn over the timeline track. */
  windows?: MissionWindowBand[];
  /** AOI centroid — required for the daylight strip. If missing, strip is hidden. */
  aoiCentroid?: { lat: number; lon: number };
}

const DEFAULT_FUTURE_HOURS = 72;

// Finnish standard time = UTC+2 (DST is intentionally ignored — operators
// asked for a fixed offset, not Europe/Helsinki wall-clock).
const FIN_OFFSET_HOURS = 2;

function fmt(offsetHours: number): string {
  const d = new Date();
  d.setHours(d.getHours() + offsetHours, 0, 0, 0);
  // Shift into UTC+2 by adding the offset, then read the UTC fields so the
  // result is independent of the browser's local zone.
  const shifted = new Date(d.getTime() + FIN_OFFSET_HOURS * 3_600_000);
  return shifted.toISOString().replace("T", "  ").slice(0, 16) + " UTC+2";
}

// ---------------------------------------------------------------------------
// Daylight strip
//
// Approximate solar elevation (NOAA simplified). Accurate to ~0.5° — fine for
// a visual day/twilight/night indicator. Not for navigation.
// ---------------------------------------------------------------------------

function solarElevationDeg(date: Date, lat: number, lon: number): number {
  const rad = Math.PI / 180;

  // Day of year (1-based, UTC).
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - yearStart) / 86_400_000);

  // Equation-of-time correction (minutes) + solar declination (radians).
  const B = ((360 / 365) * (dayOfYear - 81)) * rad;
  const eotMin = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const declRad = 23.45 * rad * Math.sin(((360 / 365) * (dayOfYear - 81)) * rad);

  // Local solar time (hours).
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const solarHours = utcHours + lon / 15 + eotMin / 60;

  const hourAngleRad = (solarHours - 12) * 15 * rad;
  const latRad = lat * rad;

  const sinElev =
    Math.sin(latRad) * Math.sin(declRad) +
    Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);

  return Math.asin(Math.max(-1, Math.min(1, sinElev))) / rad;
}

// Lerp from night → day. Civil twilight (-6°) is the half-way point so the
// transition reads as "blue → muddy → yellow" across dusk/dawn.
function daylightColor(elevDeg: number): string {
  const t = Math.max(0, Math.min(1, (elevDeg + 12) / 24));
  // Night: deep blue.  Day: warm yellow.
  const r = Math.round(20  + (235 - 20)  * t);
  const g = Math.round(34  + (200 - 34)  * t);
  const b = Math.round(72  + (80  - 72)  * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function buildDaylightGradient(
  lat: number,
  lon: number,
  horizonHours: number,
  samples = 96,
): string {
  const now = Date.now();
  const stops: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const frac = i / samples;
    const hourOffset = frac * horizonHours;
    const elev = solarElevationDeg(new Date(now + hourOffset * 3_600_000), lat, lon);
    stops.push(`${daylightColor(elev)} ${(frac * 100).toFixed(2)}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

function buildTicks(max: number): number[] {
  // Always include 0 (NOW) and the horizon endpoint; fill with frequent ticks.
  // Aim for ~12 visible labels and snap to a "nice" step (6, 12, 24).
  const targetCount = 12;
  const stepRaw = max / targetCount;
  const niceSteps = [3, 6, 12, 24];
  const step = niceSteps.find((s) => s >= stepRaw) ?? Math.ceil(stepRaw / 24) * 24;

  const ticks = new Set<number>([0, max]);
  for (let t = 0; t <= max; t += step) ticks.add(t);
  return Array.from(ticks).filter((t) => t >= 0 && t <= max).sort((a, b) => a - b);
}

export default function TimeSlider({
  forecastHorizonHours = DEFAULT_FUTURE_HOURS,
  windows = [],
  aoiCentroid,
}: Props) {
  const max = Math.max(1, forecastHorizonHours);
  const min = 0;
  const span = max - min;

  const [offset, setOffset] = useState(0);
  // Clamp the offset to the current bounds whenever the horizon changes.
  const safeOffset = Math.min(Math.max(offset, min), max);

  const display = useMemo(() => fmt(safeOffset), [safeOffset]);
  const ticks = useMemo(() => buildTicks(max), [max]);

  // Daylight gradient for the AOI centroid across the horizon. The
  // `nowEpochHour` term forces re-memo when the wall clock crosses an hour
  // so the strip doesn't show stale sun positions for a session that's been
  // sitting open.
  const nowEpochHour = Math.floor(Date.now() / 3_600_000);
  const daylightGradient = useMemo(
    () =>
      aoiCentroid
        ? buildDaylightGradient(aoiCentroid.lat, aoiCentroid.lon, max)
        : null,
    [aoiCentroid?.lat, aoiCentroid?.lon, max, nowEpochHour],
  );

  return (
    <div
      style={{
        height: 104,
        background: "var(--color-bg-panel)",
        borderTop: "1px solid var(--color-border-default)",
        padding: "8px 16px 12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          className="btn"
          type="button"
          onClick={() => setOffset((o) => Math.max(min, o - 6))}
        >
          ◀
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => setOffset((o) => Math.min(max, o + 6))}
        >
          ▶
        </button>
        <div
          style={{
            flex: 1,
            textAlign: "center",
            fontFamily: "var(--font-data)",
            fontSize: 13,
            color: "var(--color-text-primary)",
          }}
        >
          {display}
        </div>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: safeOffset === 0 ? "var(--color-accent-orange)" : "var(--color-text-secondary)",
            minWidth: 64,
            textAlign: "right",
          }}
        >
          {safeOffset === 0 ? "NOW" : `+${safeOffset}h`}
        </div>
      </div>

      {/* Daylight strip — sun elevation at the AOI centroid over the horizon. */}
      {daylightGradient && (
        <div
          title="Daylight at AOI centroid (dark blue = night · yellow = day)"
          style={{
            position: "relative",
            height: 6,
            background: daylightGradient,
            border: "1px solid var(--color-border-subtle)",
          }}
        />
      )}

      <div style={{ position: "relative", height: 28 }}>
        {/* Mission-window bands — drawn over the future track. */}
        {windows.map((w, i) => {
          const start = Math.max(0, Math.min(w.startHour, max));
          const end = Math.max(start, Math.min(w.endHour, max));
          if (end <= start) return null;
          const leftPct = ((start - min) / span) * 100;
          const widthPct = ((end - start) / span) * 100;
          const color =
            w.kind === "good"
              ? "rgba(120, 200, 120, 0.45)"
              : "rgba(232, 200, 60, 0.45)";
          const border =
            w.kind === "good"
              ? "rgba(150, 220, 150, 0.85)"
              : "rgba(232, 200, 60, 0.85)";
          return (
            <div
              key={`band-${i}`}
              title={`${w.kind === "good" ? "Suitable" : "Uncertain"} window: +${w.startHour}h → +${w.endHour}h`}
              style={{
                position: "absolute",
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                top: 2,
                bottom: 14,
                background: color,
                borderTop: `1px solid ${border}`,
                borderBottom: `1px solid ${border}`,
                pointerEvents: "none",
              }}
            />
          );
        })}

        {/* NOW vertical marker — left edge of the track */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 12,
            width: 1,
            background: "var(--color-accent-orange)",
            pointerEvents: "none",
            opacity: 0.6,
          }}
        />

        <input
          type="range"
          className="time-slider"
          min={min}
          max={max}
          step={1}
          value={safeOffset}
          onChange={(e) => setOffset(parseInt(e.target.value, 10))}
          style={{ position: "absolute", inset: "0 0 12px 0", width: "100%" }}
        />

        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 12,
            fontFamily: "var(--font-data)",
            fontSize: 10,
            fontWeight: 500,
            color: "#ffffff",
          }}
        >
          {ticks.map((t) => {
            const leftPct = ((t - min) / span) * 100;
            // Keep edge labels inside the track instead of running off the panel.
            const transform =
              t === min ? "translateX(0)" : t === max ? "translateX(-100%)" : "translateX(-50%)";
            return (
              <span
                key={t}
                style={{
                  position: "absolute",
                  left: `${leftPct}%`,
                  transform,
                  whiteSpace: "nowrap",
                  color: t === 0 ? "var(--color-accent-orange)" : "#ffffff",
                }}
              >
                {t === 0 ? "NOW" : `+${t}h`}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
