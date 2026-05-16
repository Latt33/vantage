import { useState } from "react";
import { Capability } from "../data/capabilities";
import { INFRASTRUCTURE, InfraNode } from "../data/infrastructure";
import CapabilityIcon from "./icons/CapabilityIcon";

interface ToolPanelProps {
  capabilities: Capability[];
  infrastructureSelected: Set<string>;
  onInfrastructureToggle: (id: string) => void;
  onManageForces: () => void;
  onExport: (kind: "report" | "pdf" | "notes") => void;
}

export default function ToolPanel({
  capabilities,
  infrastructureSelected,
  onInfrastructureToggle,
  onManageForces,
  onExport,
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

      <div style={{ flex: 1, overflowY: "auto" }}>
        <SectionHeader title="Forces & Capabilities" />
        {capabilities.length === 0 ? (
          <EmptyState text="No forces selected" />
        ) : (
          capabilities.map(c => <ForceRow key={c.id} capability={c} />)
        )}
        <div style={{ padding: "8px 12px 12px 12px" }}>
          <button className="btn" style={{ width: "100%" }} onClick={onManageForces}>
            ⤺ Manage Forces
          </button>
        </div>

        <SectionHeader title="Infrastructure" />
        {INFRASTRUCTURE.map(node => (
          <InfraRow
            key={node.id}
            node={node}
            selected={infrastructureSelected}
            onToggle={onInfrastructureToggle}
          />
        ))}
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
        <ExportButton icon="▣" label="Generate IPB Report" onClick={() => onExport("report")} />
        <ExportButton icon="⤓" label="Export PDF" onClick={() => onExport("pdf")} />
        <ExportButton icon="✎" label="Add Notes" onClick={() => onExport("notes")} />
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

function ForceRow({ capability }: { capability: Capability }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "10px 12px",
        borderBottom: "1px solid var(--color-border-subtle)",
      }}
    >
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
      <div style={{ flex: 1, minWidth: 0 }}>
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
        <div
          style={{
            fontFamily: "var(--font-data)",
            fontSize: 10,
            color: "var(--color-text-secondary)",
            marginTop: 2,
          }}
        >
          {capability.sublabel}
        </div>
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 11,
            fontWeight: 300,
            color: "var(--color-text-secondary)",
            marginTop: 6,
            lineHeight: 1.35,
          }}
        >
          {capability.description}
        </div>
      </div>
    </div>
  );
}

interface InfraRowProps {
  node: InfraNode;
  selected: Set<string>;
  onToggle: (id: string) => void;
  depth?: number;
}

function InfraRow({ node, selected, onToggle, depth = 0 }: InfraRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = !!node.children && node.children.length > 0;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: depth === 0 ? "6px 12px" : "4px 12px 4px 36px",
          borderBottom: depth === 0 ? "1px solid var(--color-border-subtle)" : "none",
        }}
      >
        <input
          type="checkbox"
          className="toggle"
          checked={selected.has(node.id)}
          onChange={() => onToggle(node.id)}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: depth === 0 ? 13 : 12,
              color: "var(--color-text-primary)",
              lineHeight: 1.1,
            }}
          >
            {node.label}
          </div>
          {node.sublabel && (
            <div
              style={{
                fontFamily: "var(--font-data)",
                fontSize: 10,
                color: "var(--color-text-secondary)",
                marginTop: 2,
              }}
            >
              {node.sublabel}
            </div>
          )}
        </div>
        {hasChildren && (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            style={{
              background: "none",
              border: "none",
              padding: "0 4px",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
              fontFamily: "var(--font-data)",
              fontSize: 12,
            }}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? "▾" : "▸"}
          </button>
        )}
      </div>
      {expanded && hasChildren && node.children!.map(child => (
        <InfraRow key={child.id} node={child} selected={selected} onToggle={onToggle} depth={depth + 1} />
      ))}
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
