import { LayerConfig } from "../types";

interface LayerPanelProps {
  layers: LayerConfig[];
  onChange: (id: string, patch: Partial<LayerConfig>) => void;
}

export default function LayerPanel({ layers, onChange }: LayerPanelProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 260,
        background: "var(--color-bg-panel)",
        borderLeft: "1px solid var(--color-border-default)",
        overflowY: "auto",
        zIndex: 5,
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
        Layers
      </div>

      <div>
        {layers.map(layer => (
          <LayerRow key={layer.id} layer={layer} onChange={onChange} />
        ))}
      </div>
    </div>
  );
}

interface LayerRowProps {
  layer: LayerConfig;
  onChange: (id: string, patch: Partial<LayerConfig>) => void;
}

function LayerRow({ layer, onChange }: LayerRowProps) {
  return (
    <div style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
      <div
        style={{
          height: 32,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "0 var(--space-3)",
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
              gap: "var(--space-2)",
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              color: "var(--color-text-primary)",
            }}
          >
            <span>{layer.label}</span>
            {layer.visible && <span className="badge badge--warn">No Data</span>}
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
            padding: "var(--space-2) var(--space-3) var(--space-3) var(--space-3)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-1)",
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
