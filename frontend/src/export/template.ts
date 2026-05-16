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
 * Keep this in a dedicated folder so it can be adjusted without touching UI logic.
 */
export const DEFAULT_IPB_TEMPLATE: IpbReportTemplateFields = {
  reportTitle: "General IPB Report",
  missionName: "Operation Name",
  analystName: "Analyst",
  unit: "Unit / Task Force",
  datetime: new Date().toISOString().slice(0, 16).replace("T", " "),
  areaSummary:
    "Describe AOI terrain, weather impacts, and notable movement constraints.",
  enemySituation:
    "Summarize likely enemy avenues of approach, observed activity, and threats.",
  friendlySituation:
    "Summarize friendly forces posture, intent, and supporting assets.",
  assumptions:
    "List critical assumptions used in this estimate.",
  recommendations:
    "List recommended actions, priorities, and decision points.",
};
