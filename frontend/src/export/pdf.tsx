/**
 * IPB report PDF — rendered with @react-pdf/renderer.
 *
 * Structure (one section per Page so ToC page numbers are deterministic):
 *   1.  Cover                       (page 1)
 *   2.  Table of Contents           (page 2)
 *   3.  Section 1 — Area Summary    (page 3)
 *   4.  Section 2 — Operational Map (page 4, image + caption + filter list)
 *   5.  Section 3 — Enemy Situation (page 5)
 *   6.  Section 4 — Friendly Situation
 *   7.  Section 5 — Assumptions
 *   8.  Section 6 — Recommendations
 */

import {
  Document,
  Image as PdfImage,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
} from "@react-pdf/renderer";

import { IpbReportTemplateFields } from "./template";

export interface IpbReportPayload {
  screenshotDataUrl: string | null;
  capabilityFilters: string[];
  naturalFilters: string[];
  infrastructureFilters: string[];
  fields: IpbReportTemplateFields;
}

// ---------------------------------------------------------------------------
// Section definitions — single source of truth for ToC numbering and body order
// ---------------------------------------------------------------------------

interface BodySection {
  number: number;
  title: string;
  page: number;            // deterministic because each section owns one Page
  hasImage?: boolean;
  bodyKey: keyof IpbReportTemplateFields;
}

function buildSections(): BodySection[] {
  // Cover = page 1, ToC = page 2 → first body section starts on page 3.
  const offset = 3;
  const titles: Array<{ title: string; bodyKey: keyof IpbReportTemplateFields; hasImage?: boolean }> = [
    { title: "Area Summary",        bodyKey: "areaSummary" },
    { title: "Operational Map",     bodyKey: "areaSummary", hasImage: true },
    { title: "Enemy Situation",     bodyKey: "enemySituation" },
    { title: "Friendly Situation",  bodyKey: "friendlySituation" },
    { title: "Assumptions",         bodyKey: "assumptions" },
    { title: "Recommendations",     bodyKey: "recommendations" },
  ];
  return titles.map((t, i) => ({
    number: i + 1,
    page: offset + i,
    ...t,
  }));
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const PALETTE = {
  ink:      "#111418",
  body:     "#2a2f36",
  muted:    "#6c727a",
  rule:     "#cfd3d8",
  accent:   "#1f4e8a",
  bgPanel:  "#f4f6f8",
  white:    "#ffffff",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 56,
    paddingHorizontal: 56,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: PALETTE.body,
    lineHeight: 1.45,
  },

  // ── Running header / footer ─────────────────────────────────────────
  runningHeader: {
    position: "absolute",
    top: 24,
    left: 56,
    right: 56,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: PALETTE.muted,
    letterSpacing: 1,
    textTransform: "uppercase",
    borderBottomWidth: 0.5,
    borderBottomColor: PALETTE.rule,
    paddingBottom: 6,
  },
  runningFooter: {
    position: "absolute",
    bottom: 24,
    left: 56,
    right: 56,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: PALETTE.muted,
    letterSpacing: 1,
    textTransform: "uppercase",
    borderTopWidth: 0.5,
    borderTopColor: PALETTE.rule,
    paddingTop: 6,
  },

  // ── Cover ───────────────────────────────────────────────────────────
  coverPage: {
    paddingTop: 56,
    paddingBottom: 56,
    paddingHorizontal: 56,
    fontFamily: "Helvetica",
    color: PALETTE.ink,
    flexDirection: "column",
  },
  coverClassification: {
    alignSelf: "center",
    fontSize: 9,
    letterSpacing: 3,
    color: PALETTE.muted,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: PALETTE.accent,
    paddingHorizontal: 24,
  },
  coverCenter: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    textAlign: "center",
  },
  coverEyebrow: {
    fontSize: 10,
    letterSpacing: 6,
    color: PALETTE.accent,
    fontFamily: "Helvetica-Bold",
    marginBottom: 18,
  },
  coverTitle: {
    fontSize: 32,
    fontFamily: "Helvetica-Bold",
    color: PALETTE.ink,
    textAlign: "center",
    lineHeight: 1.15,
    marginHorizontal: 30,
  },
  coverRule: {
    width: 80,
    height: 2,
    backgroundColor: PALETTE.accent,
    marginVertical: 18,
  },
  coverMission: {
    fontSize: 13,
    color: PALETTE.body,
    fontFamily: "Helvetica-Oblique",
  },
  coverMetaBlock: {
    alignSelf: "center",
    width: 320,
    marginBottom: 16,
    borderTopWidth: 0.5,
    borderTopColor: PALETTE.rule,
    borderBottomWidth: 0.5,
    borderBottomColor: PALETTE.rule,
    paddingVertical: 12,
  },
  coverMetaRow: {
    flexDirection: "row",
    paddingVertical: 3,
    fontSize: 10,
  },
  coverMetaLabel: {
    width: 90,
    color: PALETTE.muted,
    letterSpacing: 1,
    textTransform: "uppercase",
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
  },
  coverMetaValue: {
    flex: 1,
    color: PALETTE.ink,
  },
  coverFooter: {
    alignSelf: "center",
    fontSize: 8,
    color: PALETTE.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },

  // ── Table of contents ───────────────────────────────────────────────
  tocTitle: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: PALETTE.ink,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 18,
  },
  tocRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingVertical: 6,
    borderBottomWidth: 0.25,
    borderBottomColor: PALETTE.rule,
  },
  tocNumber: {
    width: 28,
    fontFamily: "Helvetica-Bold",
    color: PALETTE.accent,
    fontSize: 11,
  },
  tocTitleText: {
    flex: 1,
    color: PALETTE.ink,
    fontSize: 11,
  },
  tocDots: {
    color: PALETTE.muted,
    fontSize: 9,
    paddingHorizontal: 4,
  },
  tocPage: {
    width: 40,
    textAlign: "right",
    color: PALETTE.body,
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
  },

  // ── Numbered section heading ────────────────────────────────────────
  sectionEyebrow: {
    fontSize: 8,
    letterSpacing: 3,
    color: PALETTE.muted,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  sectionHeading: {
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: PALETTE.accent,
    paddingBottom: 6,
  },
  // Single line: "01  Area Summary". Same font size keeps the baselines aligned;
  // the accent color on the number provides the visual hierarchy.
  sectionTitle: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: PALETTE.ink,
  },
  sectionNumberInline: {
    fontFamily: "Helvetica-Bold",
    color: PALETTE.accent,
  },

  bodyText: {
    fontSize: 10.5,
    color: PALETTE.body,
    lineHeight: 1.55,
    textAlign: "justify",
  },

  // ── Map figure ──────────────────────────────────────────────────────
  figureWrap: {
    marginTop: 4,
    marginBottom: 14,
    borderWidth: 0.5,
    borderColor: PALETTE.rule,
    padding: 6,
  },
  figureImage: {
    width: "100%",
    objectFit: "contain",
  },
  figurePlaceholder: {
    height: 240,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PALETTE.bgPanel,
  },
  figurePlaceholderText: {
    color: PALETTE.muted,
    fontSize: 10,
  },
  figureCaption: {
    marginTop: 8,
    fontSize: 9,
    color: PALETTE.muted,
    fontFamily: "Helvetica-Oblique",
    textAlign: "center",
  },

  // ── Filter list grouped by Capabilities / Natural / Infrastructure ──
  filterBlock: {
    marginTop: 6,
    borderWidth: 0.5,
    borderColor: PALETTE.rule,
  },
  filterGroup: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 0.25,
    borderBottomColor: PALETTE.rule,
  },
  filterGroupLast: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  filterGroupTitle: {
    fontSize: 8,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: PALETTE.accent,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  filterItem: {
    flexDirection: "row",
    fontSize: 9.5,
    color: PALETTE.body,
    paddingVertical: 1,
  },
  filterBullet: {
    width: 10,
    color: PALETTE.accent,
  },
  filterEmpty: {
    fontSize: 9.5,
    color: PALETTE.muted,
    fontStyle: "italic",
  },
});

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function RunningChrome({ title }: { title: string }) {
  return (
    <>
      <View style={styles.runningHeader} fixed>
        <Text>{title || "IPB Report"}</Text>
        <Text>Confidential · Operational Use</Text>
      </View>
      <View style={styles.runningFooter} fixed>
        <Text>{new Date().getFullYear()} · AI2PB</Text>
        <Text
          render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`
          }
        />
      </View>
    </>
  );
}

function SectionHeading({ number, title }: { number: number; title: string }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionEyebrow}>Section</Text>
      <Text style={styles.sectionTitle}>
        <Text style={styles.sectionNumberInline}>{String(number).padStart(2, "0")}</Text>
        {"   "}
        {title}
      </Text>
    </View>
  );
}

function FilterGroup({
  title,
  items,
  last,
}: {
  title: string;
  items: string[];
  last?: boolean;
}) {
  return (
    <View style={last ? styles.filterGroupLast : styles.filterGroup}>
      <Text style={styles.filterGroupTitle}>{title}</Text>
      {items.length === 0 ? (
        <Text style={styles.filterEmpty}>None selected</Text>
      ) : (
        items.map((item) => (
          <View key={item} style={styles.filterItem}>
            <Text style={styles.filterBullet}>■</Text>
            <Text>{item}</Text>
          </View>
        ))
      )}
    </View>
  );
}

function MapFigure({
  screenshotDataUrl,
  captionNumber,
}: {
  screenshotDataUrl: string | null;
  captionNumber: number;
}) {
  return (
    <View style={styles.figureWrap}>
      {screenshotDataUrl ? (
        <PdfImage src={screenshotDataUrl} style={styles.figureImage} />
      ) : (
        <View style={styles.figurePlaceholder}>
          <Text style={styles.figurePlaceholderText}>Map snapshot unavailable</Text>
        </View>
      )}
      <Text style={styles.figureCaption}>
        Figure {captionNumber}. AOI map snapshot with active layers, infrastructure, and capability-derived filters at the time of export.
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function CoverPage({ fields }: { fields: IpbReportTemplateFields }) {
  return (
    <Page size="A4" style={styles.coverPage}>
      <Text style={styles.coverClassification}>UNCLASSIFIED · OPERATIONAL USE</Text>

      <View style={styles.coverCenter}>
        <Text style={styles.coverEyebrow}>INTELLIGENCE PREPARATION OF THE BATTLESPACE</Text>
        <Text style={styles.coverTitle}>{fields.reportTitle || "Untitled IPB Report"}</Text>
        <View style={styles.coverRule} />
        <Text style={styles.coverMission}>
          {fields.missionName ? `Mission · ${fields.missionName}` : "Mission not specified"}
        </Text>
      </View>

      <View style={styles.coverMetaBlock}>
        <View style={styles.coverMetaRow}>
          <Text style={styles.coverMetaLabel}>Analyst</Text>
          <Text style={styles.coverMetaValue}>{fields.analystName || "—"}</Text>
        </View>
        <View style={styles.coverMetaRow}>
          <Text style={styles.coverMetaLabel}>Unit</Text>
          <Text style={styles.coverMetaValue}>{fields.unit || "—"}</Text>
        </View>
        <View style={styles.coverMetaRow}>
          <Text style={styles.coverMetaLabel}>Date / Time</Text>
          <Text style={styles.coverMetaValue}>{fields.datetime || "—"}</Text>
        </View>
      </View>

      <Text style={styles.coverFooter}>Generated with AI2PB · {new Date().getFullYear()}</Text>
    </Page>
  );
}

function TableOfContentsPage({
  sections,
  reportTitle,
}: {
  sections: BodySection[];
  reportTitle: string;
}) {
  return (
    <Page size="A4" style={styles.page}>
      <RunningChrome title={reportTitle} />
      <Text style={styles.tocTitle}>Table of Contents</Text>
      {sections.map((s) => (
        <View key={s.number} style={styles.tocRow}>
          <Text style={styles.tocNumber}>{String(s.number).padStart(2, "0")}</Text>
          <Text style={styles.tocTitleText}>{s.title}</Text>
          <Text style={styles.tocDots}>· · · · · · · · · · · · ·</Text>
          <Text style={styles.tocPage}>{s.page}</Text>
        </View>
      ))}
    </Page>
  );
}

function BodyPage({
  section,
  fields,
  payload,
}: {
  section: BodySection;
  fields: IpbReportTemplateFields;
  payload: IpbReportPayload;
}) {
  return (
    <Page size="A4" style={styles.page}>
      <RunningChrome title={fields.reportTitle} />
      <SectionHeading number={section.number} title={section.title} />

      {section.hasImage ? (
        <>
          <Text style={styles.bodyText}>
            The following snapshot captures the AOI with every layer and filter that
            was active at the time of export. The accompanying list below the figure
            documents which sources contributed to the analyst's view, grouped by
            capabilities, natural features, and infrastructure.
          </Text>
          <MapFigure
            screenshotDataUrl={payload.screenshotDataUrl}
            captionNumber={1}
          />
          <View style={styles.filterBlock}>
            <FilterGroup title="Capabilities" items={payload.capabilityFilters} />
            <FilterGroup title="Natural Features" items={payload.naturalFilters} />
            <FilterGroup title="Infrastructure" items={payload.infrastructureFilters} last />
          </View>
        </>
      ) : (
        <Text style={styles.bodyText}>{fields[section.bodyKey] || "Not provided."}</Text>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Document + entrypoint
// ---------------------------------------------------------------------------

function IpbReportDocument({ payload }: { payload: IpbReportPayload }) {
  const sections = buildSections();
  return (
    <Document
      title={payload.fields.reportTitle || "IPB Report"}
      author={payload.fields.analystName || "AI2PB"}
      subject="Intelligence Preparation of the Battlespace"
    >
      <CoverPage fields={payload.fields} />
      <TableOfContentsPage sections={sections} reportTitle={payload.fields.reportTitle} />
      {sections.map((section) => (
        <BodyPage
          key={section.number}
          section={section}
          fields={payload.fields}
          payload={payload}
        />
      ))}
    </Document>
  );
}

export async function downloadIpbReportPdf(payload: IpbReportPayload): Promise<void> {
  const blob = await pdf(<IpbReportDocument payload={payload} />).toBlob();
  const url = URL.createObjectURL(blob);

  const fileName =
    (payload.fields.missionName || payload.fields.reportTitle || "ipb-report")
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "") || "ipb-report";

  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileName}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
