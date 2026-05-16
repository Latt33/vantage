import { jsPDF } from "jspdf";
import { IpbReportTemplateFields } from "./template";

export interface IpbReportPayload {
  screenshotDataUrl: string | null;
  naturalFilters: string[];
  infrastructureFilters: string[];
  derivedFilters: string[];
  fields: IpbReportTemplateFields;
}

function writeSection(
  doc: jsPDF,
  title: string,
  body: string,
  x: number,
  y: number,
  width: number,
): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(title, x, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const lines = doc.splitTextToSize(body, width);
  doc.text(lines, x, y + 5);

  return y + 7 + lines.length * 4.5;
}

function writeLegendList(doc: jsPDF, title: string, items: string[], x: number, y: number, width: number): number {
  const normalized = items.length > 0 ? items : ["None selected"];
  return writeSection(doc, title, normalized.join(", "), x, y, width);
}

export function downloadIpbReportPdf(payload: IpbReportPayload): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(payload.fields.reportTitle, margin, 14);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Mission: ${payload.fields.missionName}`, margin, 21);
  doc.text(`Analyst: ${payload.fields.analystName}`, margin, 26);
  doc.text(`Unit: ${payload.fields.unit}`, margin, 31);
  doc.text(`Date/Time: ${payload.fields.datetime}`, margin, 36);

  if (payload.screenshotDataUrl) {
    try {
      doc.addImage(payload.screenshotDataUrl, "PNG", margin, 42, pageW - margin * 2, 70);
      doc.setDrawColor(60);
      doc.rect(margin, 42, pageW - margin * 2, 70);
    } catch {
      doc.setFontSize(9);
      doc.text("Map snapshot unavailable", margin, 46);
    }
  } else {
    doc.setFontSize(9);
    doc.text("Map snapshot unavailable", margin, 46);
  }

  let cursorY = 118;
  cursorY = writeLegendList(doc, "Active Natural Filters", payload.naturalFilters, margin, cursorY, pageW - margin * 2);
  cursorY = writeLegendList(doc, "Active Infrastructure", payload.infrastructureFilters, margin, cursorY + 2, pageW - margin * 2);
  cursorY = writeLegendList(doc, "Active Derived Metrics", payload.derivedFilters, margin, cursorY + 2, pageW - margin * 2);

  const pageBreakY = pageH - 30;
  const sections: Array<{ title: string; body: string }> = [
    { title: "Area Summary", body: payload.fields.areaSummary },
    { title: "Enemy Situation", body: payload.fields.enemySituation },
    { title: "Friendly Situation", body: payload.fields.friendlySituation },
    { title: "Assumptions", body: payload.fields.assumptions },
    { title: "Recommendations", body: payload.fields.recommendations },
  ];

  for (const section of sections) {
    if (cursorY > pageBreakY) {
      doc.addPage();
      cursorY = margin;
    }
    cursorY = writeSection(doc, section.title, section.body, margin, cursorY + 2, pageW - margin * 2);
  }

  const fileName = `${payload.fields.missionName || "ipb-report"}`
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "") || "ipb-report";

  doc.save(`${fileName}.pdf`);
}
