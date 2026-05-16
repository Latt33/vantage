import { SVGProps } from "react";

export type CapabilityIconName =
  | "tank"
  | "infantry"
  | "artillery"
  | "logistics"
  | "drone"
  | "fortification";

interface Props extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: CapabilityIconName;
  size?: number;
  color?: string;
}

export default function CapabilityIcon({ name, size = 48, color = "currentColor", ...rest }: Props) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 48 48",
    fill: "none",
    stroke: color,
    strokeWidth: 1.5,
    strokeLinecap: "square" as const,
    strokeLinejoin: "miter" as const,
    ...rest,
  };

  switch (name) {
    case "tank":
      return (
        <svg {...common}>
          <rect x="4" y="24" width="40" height="10" />
          <rect x="8" y="34" width="6" height="6" />
          <rect x="21" y="34" width="6" height="6" />
          <rect x="34" y="34" width="6" height="6" />
          <rect x="14" y="16" width="20" height="8" />
          <rect x="32" y="18" width="14" height="4" />
        </svg>
      );
    case "infantry":
      return (
        <svg {...common}>
          <rect x="20" y="6" width="8" height="8" />
          <rect x="16" y="16" width="16" height="16" />
          <line x1="20" y1="32" x2="18" y2="44" />
          <line x1="28" y1="32" x2="30" y2="44" />
          <line x1="12" y1="22" x2="16" y2="22" />
          <line x1="32" y1="22" x2="36" y2="22" />
        </svg>
      );
    case "artillery":
      return (
        <svg {...common}>
          <line x1="6" y1="32" x2="44" y2="14" />
          <rect x="3" y="30" width="8" height="6" />
          <polygon points="12,32 22,32 18,42 16,42" />
          <rect x="13" y="40" width="4" height="4" />
          <rect x="22" y="40" width="4" height="4" />
          <rect x="31" y="40" width="4" height="4" />
        </svg>
      );
    case "logistics":
      return (
        <svg {...common}>
          <rect x="4" y="16" width="14" height="18" />
          <rect x="18" y="22" width="26" height="12" />
          <rect x="7" y="34" width="6" height="6" />
          <rect x="23" y="34" width="6" height="6" />
          <rect x="35" y="34" width="6" height="6" />
          <line x1="22" y1="26" x2="40" y2="26" />
        </svg>
      );
    case "drone":
      return (
        <svg {...common}>
          <rect x="20" y="20" width="8" height="8" />
          <line x1="10" y1="10" x2="20" y2="20" />
          <line x1="38" y1="10" x2="28" y2="20" />
          <line x1="10" y1="38" x2="20" y2="28" />
          <line x1="38" y1="38" x2="28" y2="28" />
          <rect x="6" y="6" width="6" height="6" />
          <rect x="36" y="6" width="6" height="6" />
          <rect x="6" y="36" width="6" height="6" />
          <rect x="36" y="36" width="6" height="6" />
        </svg>
      );
    case "fortification":
      return (
        <svg {...common}>
          <rect x="4" y="28" width="40" height="14" />
          <polyline points="4,28 10,18 18,28 26,18 34,28 42,18 44,18 44,28" />
          <line x1="14" y1="34" x2="14" y2="42" />
          <line x1="24" y1="34" x2="24" y2="42" />
          <line x1="34" y1="34" x2="34" y2="42" />
        </svg>
      );
  }
}
