import { CapabilityIconName } from "../components/icons/CapabilityIcon";

export interface Capability {
  id: string;
  label: string;
  sublabel: string;
  description: string;
  icon: CapabilityIconName;
}

export const CAPABILITIES: Capability[] = [
  {
    id: "heavy_vehicles",
    label: "Heavy Vehicles",
    sublabel: "MBT · IFV · APC",
    description: "Requires paved/hardened routes, bridges rated 60t+",
    icon: "tank",
  },
  {
    id: "light_infantry",
    label: "Light Infantry",
    sublabel: "Dismounted",
    description: "Cross-country movement, terrain concealment critical",
    icon: "infantry",
  },
  {
    id: "towed_artillery",
    label: "Towed Artillery",
    sublabel: "155mm · 122mm",
    description: "Requires survey control, firing positions, ammo supply",
    icon: "artillery",
  },
  {
    id: "logistics",
    label: "Logistics",
    sublabel: "Supply · Medical",
    description: "Route capacity, chokepoints, medical facilities",
    icon: "logistics",
  },
  {
    id: "fpv_drones",
    label: "FPV Drones",
    sublabel: "UAS · ISR",
    description: "Wind speed, precipitation, RF environment critical",
    icon: "drone",
  },
  {
    id: "fortification",
    label: "Fortification",
    sublabel: "Prepared positions",
    description: "Soil type, drainage, concealment from air/sat",
    icon: "fortification",
  },
];
