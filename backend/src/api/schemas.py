"""Shared Pydantic request/response models for the API."""

from pydantic import BaseModel, model_validator

from src.service._shared.bbox import BBox


# ---------------------------------------------------------------------------
# AOI lifecycle
# ---------------------------------------------------------------------------

class PrepareRequest(BaseModel):
    """AOI bounding box payload used by POST /api/aoi."""

    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float

    @model_validator(mode="after")
    def validate_bbox(self) -> "PrepareRequest":
        BBox(self.min_lon, self.min_lat, self.max_lon, self.max_lat).validate()
        return self

    def to_bbox(self) -> BBox:
        return BBox(self.min_lon, self.min_lat, self.max_lon, self.max_lat)

    def to_dict(self) -> dict:
        return {
            "min_lon": self.min_lon,
            "min_lat": self.min_lat,
            "max_lon": self.max_lon,
            "max_lat": self.max_lat,
        }


# ---------------------------------------------------------------------------
# Mission window analysis
# ---------------------------------------------------------------------------

class MissionConditions(BaseModel):
    """Operator-supplied thresholds for mission window analysis.

    Every threshold is optional. Only conditions explicitly provided are
    scored — unset conditions are ignored entirely, never assumed met.
    """

    aoi_id: str

    max_wind_speed_ms: float | None = None
    max_wind_gust_ms: float | None = None
    max_wind_speed_120m_ms: float | None = None
    min_visibility_m: float | None = None
    max_cloudcover_pct: float | None = None
    max_cloudcover_low_pct: float | None = None
    max_precipitation_mm: float | None = None
    max_snowfall_cm: float | None = None
    max_snow_depth_m: float | None = None
    min_temperature_c: float | None = None
    max_temperature_c: float | None = None
    max_soil_moisture: float | None = None

    time_window_start_hour_utc: int | None = None
    time_window_end_hour_utc: int | None = None

    lookahead_hours: int = 168
    min_window_duration_hours: float = 1.0
    min_score: float = 0.5


class HourlyDetail(BaseModel):
    timestamp_utc: str
    score: float
    confidence: float
    condition_scores: dict[str, float]


class WindowScore(BaseModel):
    start_utc: str
    end_utc: str
    duration_hours: float
    score: float
    peak_score: float
    confidence: float
    adjusted_score: float
    breakdown: dict[str, float]
    limiting_factor: str | None
    grid_coverage: float
    hours: list[HourlyDetail]


class MissionWindowResponse(BaseModel):
    aoi_id: str
    windows: list[WindowScore]
    best_window: WindowScore | None
    total_hours_analysed: int
    hours_above_threshold: int
    conditions_applied: list[str]
    forecast_model: str
    forecast_generated_at: str
