import { useEffect, useMemo, useState } from "react";
import { DEFAULT_IPB_TEMPLATE, IpbReportTemplateFields } from "./template";
import { downloadIpbReportPdf } from "./pdf";

export interface ExportLegendState {
  naturalFilters: string[];
  infrastructureFilters: string[];
  derivedFilters: string[];
}

interface ExportIpbReportModalProps {
  open: boolean;
  screenshotDataUrl: string | null;
  legends: ExportLegendState;
  onClose: () => void;
}

function FieldLabel({ text }: { text: string }) {
  return (
    <label
      style={{
        fontFamily: "var(--font-heading)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--color-text-secondary)",
      }}
    >
      {text}
    </label>
  );
}

function TextInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        background: "var(--color-bg-base)",
        border: "1px solid var(--color-border-default)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-ui)",
        fontSize: 12,
        padding: "6px 8px",
        outline: "none",
      }}
    />
  );
}

function TextAreaInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={3}
      style={{
        width: "100%",
        resize: "vertical",
        background: "var(--color-bg-base)",
        border: "1px solid var(--color-border-default)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-ui)",
        fontSize: 12,
        padding: "6px 8px",
        outline: "none",
      }}
    />
  );
}

function LegendBlock({ title, values }: { title: string; values: string[] }) {
  return (
    <div style={{ border: "1px solid var(--color-border-subtle)", padding: "8px" }}>
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--color-text-secondary)",
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--color-text-primary)" }}>
        {values.length > 0 ? values.join(", ") : "None selected"}
      </div>
    </div>
  );
}

export default function ExportIpbReportModal({
  open,
  screenshotDataUrl,
  legends,
  onClose,
}: ExportIpbReportModalProps) {
  const [fields, setFields] = useState<IpbReportTemplateFields>(DEFAULT_IPB_TEMPLATE);

  useEffect(() => {
    if (open) {
      setFields({
        ...DEFAULT_IPB_TEMPLATE,
        datetime: new Date().toISOString().slice(0, 16).replace("T", " "),
      });
    }
  }, [open]);

  const totalLegendCount = useMemo(
    () => legends.naturalFilters.length + legends.infrastructureFilters.length + legends.derivedFilters.length,
    [legends],
  );

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(10, 10, 10, 0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        style={{
          width: "min(1100px, 100%)",
          maxHeight: "92vh",
          background: "var(--color-bg-panel)",
          border: "1px solid var(--color-border-default)",
          display: "grid",
          gridTemplateColumns: "minmax(280px, 0.95fr) minmax(360px, 1.2fr)",
          overflow: "hidden",
        }}
      >
        <div style={{ borderRight: "1px solid var(--color-border-subtle)", overflowY: "auto", padding: "12px" }}>
          <div style={{ display: "grid", gap: 10 }}>
            <FieldLabel text="Report Title" />
            <TextInput value={fields.reportTitle} onChange={(reportTitle) => setFields((prev) => ({ ...prev, reportTitle }))} />

            <FieldLabel text="Mission Name" />
            <TextInput value={fields.missionName} onChange={(missionName) => setFields((prev) => ({ ...prev, missionName }))} />

            <FieldLabel text="Analyst" />
            <TextInput value={fields.analystName} onChange={(analystName) => setFields((prev) => ({ ...prev, analystName }))} />

            <FieldLabel text="Unit" />
            <TextInput value={fields.unit} onChange={(unit) => setFields((prev) => ({ ...prev, unit }))} />

            <FieldLabel text="Date / Time" />
            <TextInput value={fields.datetime} onChange={(datetime) => setFields((prev) => ({ ...prev, datetime }))} />

            <FieldLabel text="Area Summary" />
            <TextAreaInput value={fields.areaSummary} onChange={(areaSummary) => setFields((prev) => ({ ...prev, areaSummary }))} />

            <FieldLabel text="Enemy Situation" />
            <TextAreaInput value={fields.enemySituation} onChange={(enemySituation) => setFields((prev) => ({ ...prev, enemySituation }))} />

            <FieldLabel text="Friendly Situation" />
            <TextAreaInput value={fields.friendlySituation} onChange={(friendlySituation) => setFields((prev) => ({ ...prev, friendlySituation }))} />

            <FieldLabel text="Assumptions" />
            <TextAreaInput value={fields.assumptions} onChange={(assumptions) => setFields((prev) => ({ ...prev, assumptions }))} />

            <FieldLabel text="Recommendations" />
            <TextAreaInput value={fields.recommendations} onChange={(recommendations) => setFields((prev) => ({ ...prev, recommendations }))} />
          </div>
        </div>

        <div style={{ overflowY: "auto", padding: "12px", display: "grid", gap: 10 }}>
          <div
            style={{
              borderBottom: "1px solid var(--color-border-subtle)",
              paddingBottom: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--color-text-primary)",
              }}
            >
              IPB Report Preview
            </div>
            <div style={{ fontFamily: "var(--font-data)", fontSize: 11, color: "var(--color-text-secondary)" }}>
              {totalLegendCount} Active Legends
            </div>
          </div>

          <div style={{ border: "1px solid var(--color-border-subtle)", padding: "8px" }}>
            {screenshotDataUrl ? (
              <img
                src={screenshotDataUrl}
                alt="AOI map snapshot"
                style={{ width: "100%", maxHeight: 280, objectFit: "cover", display: "block" }}
              />
            ) : (
              <div style={{ fontFamily: "var(--font-data)", fontSize: 11, color: "var(--color-text-secondary)" }}>
                Map snapshot unavailable
              </div>
            )}
          </div>

          <LegendBlock title="Natural Filters" values={legends.naturalFilters} />
          <LegendBlock title="Infrastructure" values={legends.infrastructureFilters} />
          <LegendBlock title="Derived Metrics" values={legends.derivedFilters} />

          <div style={{ border: "1px solid var(--color-border-subtle)", padding: "8px", display: "grid", gap: 6 }}>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--color-text-primary)" }}>{fields.reportTitle}</div>
            <div style={{ fontFamily: "var(--font-data)", fontSize: 11, color: "var(--color-text-secondary)" }}>
              Mission: {fields.missionName} | Analyst: {fields.analystName} | Unit: {fields.unit} | Date: {fields.datetime}
            </div>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--color-text-primary)", lineHeight: 1.4 }}>
              <strong>Area:</strong> {fields.areaSummary}
            </div>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--color-text-primary)", lineHeight: 1.4 }}>
              <strong>Enemy:</strong> {fields.enemySituation}
            </div>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--color-text-primary)", lineHeight: 1.4 }}>
              <strong>Friendly:</strong> {fields.friendlySituation}
            </div>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--color-text-primary)", lineHeight: 1.4 }}>
              <strong>Assumptions:</strong> {fields.assumptions}
            </div>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--color-text-primary)", lineHeight: 1.4 }}>
              <strong>Recommendations:</strong> {fields.recommendations}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" onClick={onClose}>
              Close
            </button>
            <button
              className="btn btn--active"
              onClick={() => {
                downloadIpbReportPdf({
                  screenshotDataUrl,
                  naturalFilters: legends.naturalFilters,
                  infrastructureFilters: legends.infrastructureFilters,
                  derivedFilters: legends.derivedFilters,
                  fields,
                });
              }}
            >
              Download PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
