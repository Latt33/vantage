import { formatViewerDateTimeInput } from "../utils/time";

export interface IpbReportTemplateFields {
  reportTitle: string;
  missionName: string;
  analystName: string;
  unit: string;
  datetime: string;
  areaSummary: string;
  enemySituation: string;
  friendlySituation: string;
  assumptions: string;
  recommendations: string;
}

/**
 * Editable report template for demo export flow.
 *
 * The default values are intentionally substantial — each section opens with
 * the original "Describe …" / "List …" prompt followed by a realistic-looking
 * analysis structure so a freshly generated PDF demonstrates what a finished
 * report looks like before the analyst touches anything.
 */
export const DEFAULT_IPB_TEMPLATE: IpbReportTemplateFields = {
  reportTitle: "General IPB Report",
  missionName: "Operation Name",
  analystName: "Analyst",
  unit: "Unit / Task Force",
  datetime: new Date().toISOString().slice(0, 16).replace("T", " "),

  areaSummary:
    "Describe AOI terrain, weather impacts, and notable movement constraints.\n\n" +
    "Terrain Overview. The AOI consists of mixed boreal forest and open agricultural plains intersected by two major waterways. Elevation ranges from 90 to 240 m, with the highest relief along the eastern ridge. Surface drainage is generally good, but wetlands in the south-west quadrant reduce trafficability after sustained rainfall.\n\n" +
    "Weather Impact. Current ECMWF forecast indicates moderate westerly winds (8–12 m/s) with broken low cloud and intermittent precipitation across the 72-hour horizon. Visibility is expected to remain above 5 km outside of precipitation events. Soil temperatures stay above freezing, so off-road movement is not constrained by frost-heave or ice.\n\n" +
    "Movement Constraints. The primary east–west route is canalised by the river crossings at Grid 3245 and Grid 3712, both rated for vehicles up to 60 t but vulnerable to interdiction. The dense forest belt north of the railway constrains tracked movement to existing forest roads.",

  enemySituation:
    "Describe enemy capabilities, observed activity, and likely avenues of approach.\n\n" +
    "Order of Battle. Assessed enemy strength in or adjacent to the AOI: one mechanised infantry battalion (-) with attached self-propelled artillery and a UAV detachment operating from a forward airstrip ~40 km east. No armour formations identified within 24-hour movement.\n\n" +
    "Recent Activity (last 96 h). Increased ISR activity along the northern ridge, particularly during periods of low cloud. Two confirmed FPV strikes against logistics nodes in the eastern sector. No major repositioning observed.\n\n" +
    "Likely Courses of Action. (1) Most likely: continued ISR and FPV harassment to fix friendly forces while preserving the manoeuvre battalion for a delayed counter-attack. (2) Most dangerous: rapid commitment of the manoeuvre battalion along the southern road network during the next favourable weather window.\n\n" +
    "Critical Vulnerabilities. Fuel resupply chain (single ground LOC), dependence on UAV ISR (degraded by heavy precipitation), and limited night-fighting capability in the dismounted units.",

  friendlySituation:
    "Describe friendly forces posture, intent, and supporting assets.\n\n" +
    "Force Composition. One mechanised infantry company group reinforced with an engineer platoon and a UAV team. Indirect fire support is on call from a brigade-level artillery battalion (155 mm) positioned 22 km to the rear.\n\n" +
    "Current Posture. Lead elements occupy defensive positions along the central ridge, with one platoon screening the eastern approach. Maintenance and casualty collection are co-located at the rear assembly area.\n\n" +
    "Mission Intent. Maintain observation of the eastern approach, prevent enemy ISR from establishing persistent coverage of friendly rear areas, and preserve combat power for the planned counter-reconnaissance operation in 48–72 hours.\n\n" +
    "Support & Sustainment. Class III (POL) and Class V (ammunition) stocks are sufficient for 72 hours of sustained operations. Medical evacuation is via ground to Role 2 at 35 km; air MEDEVAC is available subject to ceiling > 300 m.",

  assumptions:
    "List critical assumptions used in this estimate.\n\n" +
    "1. Enemy ISR coverage is intermittent and degrades significantly during precipitation events with visibility below 3 km.\n" +
    "2. Friendly artillery remains positioned within range of the AOI for the duration of the planning window.\n" +
    "3. No additional enemy reinforcements arrive within the 72-hour horizon.\n" +
    "4. Civilian population in the AOI is sparse and has been advised to shelter; civilian movement is not a major decision factor.\n" +
    "5. The EW environment remains permissive for friendly UAV operations at low altitude.",

  recommendations:
    "List recommended actions, priorities, and decision points.\n\n" +
    "1. Prioritise FPV threat suppression during forecast clear-weather windows by maintaining standing counter-UAV teams at platoon level.\n" +
    "2. Establish a forward fuel cache at Grid 3128 to reduce dependence on the single ground LOC.\n" +
    "3. Conduct rehearsals for the counter-reconnaissance operation during the identified suitable weather window (T+48 h to T+58 h per Mission Window Analysis).\n" +
    "4. Decision Point Alpha (T+24 h): commit the reserve platoon to the eastern screen if enemy ISR activity exceeds the established threshold.\n" +
    "5. Decision Point Bravo (T+60 h): execute or delay counter-reconnaissance based on observed weather and enemy posture.",
};
