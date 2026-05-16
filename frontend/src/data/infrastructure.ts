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
    id: "bridges",
    label: "Bridges",
    sublabel: "Crossings · Choke points",
    children: [
      { id: "bridges_civilian", label: "Civilian rated" },
      { id: "bridges_military", label: "Military · 60t+" },
      { id: "bridges_rail",     label: "Rail crossings" },
    ],
  },
  {
    id: "towers",
    label: "Cell & Comms Towers",
    sublabel: "RF · Relays",
    children: [
      { id: "towers_5g",    label: "5G macro sites" },
      { id: "towers_4g",    label: "4G base stations" },
      { id: "towers_radio", label: "Broadcast / radio" },
    ],
  },
  {
    id: "power",
    label: "Power Grid",
    sublabel: "Substations · Lines",
    children: [
      { id: "power_substation",   label: "Substations" },
      { id: "power_transmission", label: "Transmission lines" },
      { id: "power_plant",        label: "Generation plants" },
    ],
  },
  {
    id: "airfields",
    label: "Airfields",
    sublabel: "Runways · Aprons",
    children: [
      { id: "airfields_civ", label: "Civilian" },
      { id: "airfields_mil", label: "Military" },
    ],
  },
  {
    id: "ports",
    label: "Ports & Harbours",
    sublabel: "Maritime nodes",
  },
  {
    id: "rail",
    label: "Rail Network",
    sublabel: "Track · Yards · Junctions",
  },
  {
    id: "fuel",
    label: "Fuel & POL",
    sublabel: "Storage · Pipelines",
  },
];
