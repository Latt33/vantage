export interface InfraNode {
  id: string;
  label: string;
  sublabel?: string;
  children?: InfraNode[];
}

/**
 * Built-environment items the operator can highlight on the map.
 * Tree shape supports parent toggle + expand-to-children. Conceptual only —
 * no map rendering wired yet.
 */
export const INFRASTRUCTURE: InfraNode[] = [
  {
    id: "roads",
    label: "Roads",
    sublabel: "Highways · Local roads",
  },
  {
    id: "towers",
    label: "Cell Towers",
    sublabel: "Cell & comms sites",
  },
];
