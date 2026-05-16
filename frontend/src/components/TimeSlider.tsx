import { useMemo, useState } from "react";

const MIN = -72;
const MAX = 72;

function fmt(offsetHours: number): string {
  const d = new Date();
  d.setHours(d.getHours() + offsetHours, 0, 0, 0);
  return d.toISOString().replace("T", "  ").slice(0, 16) + " UTC";
}

const TICKS = [-72, -48, -24, 0, 24, 48, 72];

export default function TimeSlider() {
  const [offset, setOffset] = useState(0);
  const display = useMemo(() => fmt(offset), [offset]);

  return (
    <div
      style={{
        height: 88,
        background: "var(--color-bg-panel)",
        borderTop: "1px solid var(--color-border-default)",
        padding: "8px 16px 12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn" type="button" onClick={() => setOffset(o => Math.max(MIN, o - 24))}>
          ◀◀
        </button>
        <button className="btn" type="button">
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
            color: offset === 0 ? "var(--color-accent-orange)" : "var(--color-text-secondary)",
            minWidth: 64,
            textAlign: "right",
          }}
        >
          {offset === 0 ? "NOW" : `${offset > 0 ? "+" : ""}${offset}h`}
        </div>
      </div>

      <div style={{ position: "relative", height: 28 }}>
        {/* NOW vertical marker at 50% */}
        <div
          style={{
            position: "absolute",
            left: "50%",
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
          min={MIN}
          max={MAX}
          step={1}
          value={offset}
          onChange={e => setOffset(parseInt(e.target.value, 10))}
          style={{ position: "absolute", inset: "0 0 12px 0", width: "100%" }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            justifyContent: "space-between",
            fontFamily: "var(--font-data)",
            fontSize: 9,
            color: "var(--color-text-dim)",
          }}
        >
          {TICKS.map(t => (
            <span key={t}>{t === 0 ? "NOW" : `${t > 0 ? "+" : ""}${t}h`}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
