import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useAnimation } from "framer-motion";

const OPS_PASSWORD = (import.meta.env.VITE_OPS_PASSWORD ?? "") as string;

export default function LoginPage() {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const [flash, setFlash] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const shake = useAnimation();

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (value === OPS_PASSWORD && OPS_PASSWORD.length > 0) {
      sessionStorage.setItem("auth", "true");
      setFlash(true);
      setTimeout(() => navigate("/aoi"), 120);
    } else {
      setError(true);
      await shake.start({
        x: [0, -8, 8, -6, 6, -3, 3, 0],
        transition: { duration: 0.4 },
      });
    }
  }

  const stagger = {
    hidden: {},
    show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
  };
  const item = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "var(--color-bg-base)",
        backgroundImage:
          "repeating-linear-gradient(0deg, rgba(232,228,217,0.025) 0 1px, transparent 1px 40px), repeating-linear-gradient(90deg, rgba(232,228,217,0.025) 0 1px, transparent 1px 40px)",
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes draw-in {
          to { stroke-dashoffset: 0; }
        }
        @keyframes blink-once {
          0%, 100% { opacity: 1; }
          25%, 75% { opacity: 0.2; }
        }
        @keyframes blink-cursor {
          0%, 50% { opacity: 1; }
          50.01%, 100% { opacity: 0; }
        }
        .logo-stroke { stroke-dasharray: 400; stroke-dashoffset: 400; animation: draw-in 800ms ease-out forwards; }
        .logo-stroke-d1 { animation-delay: 100ms; }
        .logo-stroke-d2 { animation-delay: 300ms; }
        .logo-stroke-d3 { animation-delay: 500ms; }
        .blink-once { animation: blink-once 600ms ease-in-out 1; }
        .terminal-input { background: transparent; border: none; border-bottom: 1px solid var(--color-border-strong); color: var(--color-text-primary); font-family: var(--font-data); font-size: 16px; letter-spacing: 0.3em; padding: 6px 4px; width: 320px; outline: none; transition: border-color 120ms; }
        .terminal-input:focus { border-bottom-color: var(--color-accent-orange); }
      `}</style>

      <ClassificationBar />

      {flash && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--color-accent-orange)",
            opacity: 0.1,
            zIndex: 100,
            pointerEvents: "none",
          }}
        />
      )}

      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        style={{
          position: "absolute",
          top: "50%",
          left: "42%",
          transform: "translate(-50%, -50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 24,
        }}
      >
        <motion.div variants={item}>
          <Logo />
        </motion.div>

        <motion.div variants={item} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "var(--color-text-primary)",
            }}
          >
            IPB Intelligence Platform
          </h1>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: "var(--color-text-secondary)",
            }}
          >
            Terrain · Weather · Forces
          </div>
        </motion.div>

        <motion.form variants={item} onSubmit={submit} animate={shake} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "var(--color-text-secondary)",
            }}
          >
            Access Code
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              ref={inputRef}
              type="password"
              autoFocus
              autoComplete="off"
              className="terminal-input"
              value={value}
              onChange={e => {
                setValue(e.target.value);
                if (error) setError(false);
              }}
            />
            <span
              style={{
                width: 8,
                height: 16,
                background: "var(--color-accent-orange)",
                animation: "blink-cursor 900ms steps(2, end) infinite",
                opacity: value.length > 0 ? 0 : 1,
              }}
            />
          </div>
          {error && (
            <div
              style={{
                fontFamily: "var(--font-data)",
                fontSize: 11,
                color: "var(--color-accent-red)",
              }}
            >
              ACCESS DENIED — INVALID CODE
            </div>
          )}
        </motion.form>

        <motion.div variants={item}>
          <button type="button" className="btn btn--active" onClick={() => submit()}>
            Authenticate ▶
          </button>
        </motion.div>

        <motion.div
          variants={item}
          style={{
            fontFamily: "var(--font-data)",
            fontSize: 10,
            color: "var(--color-text-dim)",
          }}
        >
          SYSTEM VERSION 0.1.0 · HACKATHON BUILD
        </motion.div>
      </motion.div>
    </div>
  );
}

function ClassificationBar() {
  return (
    <div
      className="blink-once"
      style={{
        height: 28,
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        borderBottom: "1px solid var(--color-accent-orange)",
        fontFamily: "var(--font-heading)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        color: "var(--color-accent-orange)",
        background: "var(--color-bg-panel)",
      }}
    >
      ▪ UNCLASSIFIED // EXERCISE // IPB-1
    </div>
  );
}

function Logo() {
  return (
    <svg width={88} height={88} viewBox="0 0 88 88" style={{ display: "block" }}>
      {/* Outer square */}
      <rect
        x="6" y="6" width="76" height="76"
        fill="none"
        stroke="var(--color-border-strong)"
        strokeWidth="1"
        className="logo-stroke logo-stroke-d1"
      />
      {/* Corner brackets */}
      <polyline
        points="6,18 6,6 18,6"
        fill="none"
        stroke="var(--color-accent-orange)"
        strokeWidth="1.5"
        className="logo-stroke logo-stroke-d2"
      />
      <polyline
        points="70,6 82,6 82,18"
        fill="none"
        stroke="var(--color-accent-orange)"
        strokeWidth="1.5"
        className="logo-stroke logo-stroke-d2"
      />
      <polyline
        points="82,70 82,82 70,82"
        fill="none"
        stroke="var(--color-accent-orange)"
        strokeWidth="1.5"
        className="logo-stroke logo-stroke-d2"
      />
      <polyline
        points="18,82 6,82 6,70"
        fill="none"
        stroke="var(--color-accent-orange)"
        strokeWidth="1.5"
        className="logo-stroke logo-stroke-d2"
      />
      {/* Crosshair */}
      <line x1="44" y1="14" x2="44" y2="36" stroke="var(--color-accent-orange)" strokeWidth="1" className="logo-stroke logo-stroke-d3" />
      <line x1="44" y1="52" x2="44" y2="74" stroke="var(--color-accent-orange)" strokeWidth="1" className="logo-stroke logo-stroke-d3" />
      <line x1="14" y1="44" x2="36" y2="44" stroke="var(--color-accent-orange)" strokeWidth="1" className="logo-stroke logo-stroke-d3" />
      <line x1="52" y1="44" x2="74" y2="44" stroke="var(--color-accent-orange)" strokeWidth="1" className="logo-stroke logo-stroke-d3" />
      <rect x="42" y="42" width="4" height="4" fill="var(--color-accent-orange)" />
    </svg>
  );
}
