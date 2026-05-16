/**
 * Full-screen subtle CRT scanline texture. Pure CSS, no animation,
 * pointer-events: none so it never intercepts input.
 */
export default function ScanlineOverlay() {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9999,
        opacity: 0.04,
        backgroundImage:
          "repeating-linear-gradient(to bottom, rgba(232,228,217,0.5) 0px, rgba(232,228,217,0.5) 1px, transparent 1px, transparent 3px)",
        mixBlendMode: "screen",
      }}
    />
  );
}
