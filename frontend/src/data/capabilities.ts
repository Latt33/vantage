import { CapabilityIconName } from "../components/icons/CapabilityIcon";

export interface Capability {
  id: string;
  label: string;
  sublabel: string;
  description: string;
  icon: CapabilityIconName;
  derivedFilters: CapabilityFilter[];
}

export interface CapabilityFilter {
  id: string;
  label: string;
  sublabel?: string;
}

export const CAPABILITIES: Capability[] = [
  {
    id: "heavy_vehicles",
    label: "Heavy Vehicles",
    sublabel: "MBT · IFV · APC",
    description: "Requires paved/hardened routes, bridges rated 60t+",
    icon: "tank",
    derivedFilters: [
      { id: "movement_corridors", label: "Movement Corridors", sublabel: "Terrain + weather derived" },
    ],
  },
  {
    id: "light_infantry",
    label: "Light Infantry",
    sublabel: "Dismounted",
    description: "Cross-country movement, terrain concealment critical",
    icon: "infantry",
    derivedFilters: [
      { id: "movement_corridors", label: "Movement Corridors", sublabel: "Terrain + weather derived" },
    ],
  },
  {
    id: "towed_artillery",
    label: "Towed Artillery",
    sublabel: "155mm · 122mm",
    description: "Requires survey control, firing positions, ammo supply",
    icon: "artillery",
    derivedFilters: [
      { id: "artillery_positions", label: "Artillery Positions", sublabel: "Terrain + weather derived" },
    ],
  },
  {
    id: "logistics",
    label: "Logistics",
    sublabel: "Supply · Medical",
    description: "Route capacity, chokepoints, medical facilities",
    icon: "logistics",
    derivedFilters: [
      { id: "logistic_chokepoints", label: "Logistic Chokepoints", sublabel: "Terrain + weather derived" },
    ],
  },
  {
    id: "fpv_drones",
    label: "FPV Drones",
    sublabel: "UAS · ISR",
    description: "Wind speed, precipitation, RF environment critical",
    icon: "drone",
    derivedFilters: [
      { id: "fpv_threat_areas", label: "FPV Threat Areas", sublabel: "Terrain + weather derived" },
    ],
  },
  {
    id: "fortification",
    label: "Fortification",
    sublabel: "Prepared positions",
    description: "Soil type, drainage, concealment from air/sat",
    icon: "fortification",
    derivedFilters: [
      { id: "diggable_ground", label: "Diggable Ground", sublabel: "Terrain + weather derived" },
      { id: "sightlines", label: "Sightlines", sublabel: "Terrain + weather derived" },
    ],
  },
  {
    id: "satellite_intelligence",
    label: "Satellite Intel",
    sublabel: "ISR · Overhead",
    description: "Track overpasses and queue imagery from candidate satellites",
    icon: "satellite",
    derivedFilters: [
      { id: "sentinel_2",  label: "Sentinel-2",  sublabel: "ESA · 10 m optical" },
      { id: "sentinel_1",  label: "Sentinel-1",  sublabel: "ESA · C-band SAR" },
      { id: "landsat_9",   label: "Landsat 9",   sublabel: "USGS · 30 m multispectral" },
      { id: "iceye_x",     label: "ICEYE",       sublabel: "Commercial · X-band SAR" },
      { id: "planet_skysat", label: "SkySat",    sublabel: "Planet · 0.5 m optical" },
    ],
  },
];
