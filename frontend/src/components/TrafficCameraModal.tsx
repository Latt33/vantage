import { formatViewerDateTime } from "../utils/time";

interface TrafficCameraImage {
  preset_id: string;
  image_url: string;
  thumbnail_url: string;
  measured_at: string | null;
}

export interface TrafficCameraStationDetail {
  station_id: string;
  aoi_id: string;
  name: string | null;
  municipality: string | null;
  province: string | null;
  road_number: string | number | null;
  collection_status: string | null;
  updated_at: string | null;
  location: { lon: number | null; lat: number | null };
  images: TrafficCameraImage[];
  latest_image: TrafficCameraImage | null;
}

interface Props {
  open: boolean;
  loading: boolean;
  error: string | null;
  stationId: string | null;
  stationName: string | null;
  detail: TrafficCameraStationDetail | null;
  onClose: () => void;
}

function fmtTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return formatViewerDateTime(value, { includeSeconds: true, includeZone: true });
}

export default function TrafficCameraModal({
  open,
  loading,
  error,
  stationId,
  stationName,
  detail,
  onClose,
}: Props) {
  if (!open) return null;

  const images = detail?.images ?? [];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "rgba(10, 10, 10, 0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(1100px, 100%)",
          maxHeight: "92vh",
          background: "var(--color-bg-panel)",
          border: "1px solid var(--color-border-default)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: 12, borderBottom: "1px solid var(--color-border-subtle)" }}>
          <div>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-text-secondary)" }}>
              Road Camera
            </div>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 18, color: "var(--color-text-primary)", marginTop: 4 }}>
              {stationName ?? "Camera station"}
            </div>
            <div style={{ fontFamily: "var(--font-data)", fontSize: 11, color: "var(--color-text-secondary)", marginTop: 4 }}>
              {stationId ? `Station ${stationId}` : "Station unknown"}
              {detail?.municipality ? ` · ${detail.municipality}` : ""}
              {detail?.province ? ` · ${detail.province}` : ""}
            </div>
          </div>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "grid", gap: 12 }}>
          {loading && (
            <div style={{ fontFamily: "var(--font-data)", fontSize: 12, color: "var(--color-text-secondary)" }}>
              Loading latest camera images...
            </div>
          )}

          {error && (
            <div style={{ border: "1px solid rgba(192,57,43,0.45)", background: "rgba(192,57,43,0.12)", padding: 10, color: "#ffb0a9", fontFamily: "var(--font-ui)", fontSize: 12 }}>
              {error}
            </div>
          )}

          {detail && (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                <InfoCard label="Collection" value={detail.collection_status ?? "Unknown"} />
                <InfoCard label="Updated" value={fmtTime(detail.updated_at)} />
                <InfoCard label="Latitude" value={detail.location.lat?.toFixed(5) ?? "Unknown"} />
                <InfoCard label="Longitude" value={detail.location.lon?.toFixed(5) ?? "Unknown"} />
              </div>

              <div style={{ fontFamily: "var(--font-heading)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-text-secondary)" }}>
                Latest Images
              </div>

              {images.length > 0 ? (
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                  {images.map((image) => (
                    <div key={image.preset_id} style={{ border: "1px solid var(--color-border-subtle)", background: "rgba(255,255,255,0.02)" }}>
                      <img src={image.thumbnail_url} alt={`${stationName ?? stationId ?? "Camera"} ${image.preset_id}`} style={{ width: "100%", display: "block", aspectRatio: "16 / 9", objectFit: "cover" }} />
                      <div style={{ padding: 10, display: "grid", gap: 4 }}>
                        <div style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--color-text-primary)" }}>{image.preset_id}</div>
                        <div style={{ fontFamily: "var(--font-data)", fontSize: 11, color: "var(--color-text-secondary)" }}>Measured {fmtTime(image.measured_at)}</div>
                        <a href={image.image_url} target="_blank" rel="noreferrer" style={{ fontFamily: "var(--font-data)", fontSize: 11, color: "var(--color-accent-orange)" }}>
                          Open full image
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontFamily: "var(--font-data)", fontSize: 12, color: "var(--color-text-secondary)" }}>
                  No image data returned for this station yet.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--color-border-subtle)", padding: 10, display: "grid", gap: 4 }}>
      <div style={{ fontFamily: "var(--font-heading)", fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-text-secondary)" }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-data)", fontSize: 13, color: "var(--color-text-primary)" }}>{value}</div>
    </div>
  );
}