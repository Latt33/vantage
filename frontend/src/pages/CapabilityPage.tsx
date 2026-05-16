import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CAPABILITIES } from "../data/capabilities";
import CapabilityCard from "../components/CapabilityCard";
import { BoundingBox } from "../types";

function loadAoi(): BoundingBox | null {
  try { return JSON.parse(sessionStorage.getItem("aoi") ?? "null"); }
  catch { return null; }
}

function fmtLon(v: number): string { return `${Math.abs(v).toFixed(2)}°${v >= 0 ? "E" : "W"}`; }
function fmtLat(v: number): string { return `${Math.abs(v).toFixed(2)}°${v >= 0 ? "N" : "S"}`; }

export default function CapabilityPage() {
  const navigate = useNavigate();
  const aoi = loadAoi();
  const [selected, setSelected] = useState<Set<string>>(() => {
    try {
      const arr = JSON.parse(sessionStorage.getItem("capabilities") ?? "[]");
      return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
  });

  useEffect(() => {
    if (!aoi) navigate("/aoi", { replace: true });
  }, [aoi, navigate]);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function proceed() {
    if (selected.size === 0) return;
    sessionStorage.setItem("capabilities", JSON.stringify([...selected]));
    navigate("/operations");
  }

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "var(--color-bg-base)",
        backgroundImage:
          "repeating-linear-gradient(0deg, rgba(232,228,217,0.025) 0 1px, transparent 1px 40px), repeating-linear-gradient(90deg, rgba(232,228,217,0.025) 0 1px, transparent 1px 40px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* TopBar */}
      <div
        style={{
          height: 40,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
          background: "var(--color-bg-panel)",
          borderBottom: "1px solid var(--color-border-default)",
        }}
      >
        <button className="btn" onClick={() => navigate("/aoi")}>◀ Redefine AOI</button>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: "var(--color-text-primary)",
          }}
        >
          Force Capabilities
        </div>
        <div
          style={{
            fontFamily: "var(--font-data)",
            fontSize: 11,
            color: "var(--color-text-secondary)",
            minWidth: 280,
            textAlign: "right",
          }}
        >
          {aoi && `${fmtLon(aoi.minLon)} ${fmtLat(aoi.minLat)} → ${fmtLon(aoi.maxLon)} ${fmtLat(aoi.maxLat)}`}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto", padding: "32px 48px", display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h2
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "var(--color-text-primary)",
            }}
          >
            Select Active Capabilities
          </h2>
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 12,
              fontWeight: 300,
              color: "var(--color-text-secondary)",
            }}
          >
            Data fusion is calibrated to selected force elements.
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 140px))",
            gap: 16,
          }}
        >
          {CAPABILITIES.map((cap, idx) => (
            <CapabilityCard
              key={cap.id}
              capability={cap}
              index={idx}
              selected={selected.has(cap.id)}
              onToggle={() => toggle(cap.id)}
            />
          ))}
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          height: 56,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          background: "var(--color-bg-panel)",
          borderTop: "1px solid var(--color-border-default)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-data)",
            fontSize: 13,
            color: selected.size > 0 ? "var(--color-text-primary)" : "var(--color-text-secondary)",
          }}
        >
          {selected.size} CAPABILITIES SELECTED
        </div>
        <button
          className={`btn ${selected.size > 0 ? "btn--active" : ""}`}
          disabled={selected.size === 0}
          onClick={proceed}
          style={{
            opacity: selected.size === 0 ? 0.4 : 1,
            cursor: selected.size === 0 ? "not-allowed" : "pointer",
          }}
        >
          Enter Operations ▶
        </button>
      </div>
    </div>
  );
}
