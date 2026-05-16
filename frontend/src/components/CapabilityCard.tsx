import { motion } from "framer-motion";
import { Capability } from "../data/capabilities";
import CapabilityIcon from "./icons/CapabilityIcon";

interface Props {
  capability: Capability;
  selected: boolean;
  index: number;
  onToggle: () => void;
}

export default function CapabilityCard({ capability, selected, index, onToggle }: Props) {
  const borderColor = selected ? "var(--color-accent-orange)" : "var(--color-border-default)";
  const iconColor = selected ? "var(--color-accent-orange)" : "var(--color-text-secondary)";
  const bg = selected ? "rgba(232, 98, 42, 0.06)" : "transparent";

  return (
    <motion.button
      type="button"
      onClick={onToggle}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 * index, duration: 0.3, ease: "easeOut" }}
      whileHover={{ backgroundColor: selected ? "rgba(232, 98, 42, 0.10)" : "var(--color-bg-hover)" }}
      style={{
        position: "relative",
        width: 140,
        height: 160,
        border: `1px solid ${borderColor}`,
        background: bg,
        cursor: "pointer",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-heading)",
        transition: "border-color 0.1s",
      }}
    >
      {selected && (
        <span
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: 12,
            height: 12,
            background: "var(--color-accent-orange)",
          }}
        />
      )}
      <CapabilityIcon name={capability.icon} size={56} color={iconColor} />
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--color-text-primary)",
          }}
        >
          {capability.label}
        </div>
      </div>
    </motion.button>
  );
}
