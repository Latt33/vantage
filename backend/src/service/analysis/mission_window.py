"""Mission Window Analysis (MWA).

Reads the ECMWF forecast parquet for an AOI, scores every forecast hour
against operator-defined environmental conditions, and returns ranked
suitable time windows with per-condition breakdowns and forecast-horizon
confidence.

This is a pure analytical service — no external calls, no data fetching.
It does not import from the weather service module.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import pandas as pd

from src.api.schemas import (
    HourlyDetail,
    MissionConditions,
    MissionWindowResponse,
    WindowScore,
)
from src.service._shared.formats import read_parquet_grid
from src.service._shared.storage import category_file, read_json

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Condition registry
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ConditionSpec:
    """One scorable condition. Add an entry here to expose a new threshold."""

    name: str
    condition_field: str
    parquet_column: str
    direction: Literal["below", "above"]
    ramp_pct: float = 0.25


# Column names match `forecast.parquet` exactly per DATA_TYPES.md.
CONDITION_REGISTRY: list[ConditionSpec] = [
    ConditionSpec("Wind speed",        "max_wind_speed_ms",       "wind_speed_ms",        "below"),
    ConditionSpec("Wind gusts",        "max_wind_gust_ms",        "wind_gust_ms",         "below"),
    ConditionSpec("Upper wind",        "max_wind_speed_120m_ms",  "wind_speed_120m_ms",   "below"),
    ConditionSpec("Visibility",        "min_visibility_m",        "visibility_m",         "above"),
    ConditionSpec("Cloud cover",       "max_cloudcover_pct",      "cloudcover_pct",       "below"),
    ConditionSpec("Low cloud",         "max_cloudcover_low_pct",  "cloudcover_low_pct",   "below"),
    ConditionSpec("Precipitation",     "max_precipitation_mm",    "precipitation_mm",     "below"),
    ConditionSpec("Snowfall",          "max_snowfall_cm",         "snowfall_cm",          "below"),
    ConditionSpec("Snow depth",        "max_snow_depth_m",        "snow_depth_m",         "below"),
    ConditionSpec("Temperature min",   "min_temperature_c",       "temperature_c",        "above"),
    ConditionSpec("Temperature max",   "max_temperature_c",       "temperature_c",        "below"),
    ConditionSpec("Soil moisture",     "max_soil_moisture",       "soil_moisture_m3m3",   "below"),
]

_FULL_MET_SCORE = 0.9   # threshold above which a grid point "fully meets" all conditions
_MAX_WINDOWS = 20


# ---------------------------------------------------------------------------
# Public errors
# ---------------------------------------------------------------------------

class MissionWindowError(Exception):
    """Base error for MWA. Carries an HTTP status hint for the router."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


# ---------------------------------------------------------------------------
# Scoring primitives
# ---------------------------------------------------------------------------

def _score_value(value: float, threshold: float, direction: str, ramp_pct: float) -> float:
    """Score a single value against a threshold with a smooth ramp.

    NaN is treated as worst-case (0.0) — a missing reading is never assumed
    to be a meet.
    """
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return 0.0

    half_ramp = abs(threshold) * ramp_pct / 2.0
    # If threshold is exactly 0 (e.g. "no precipitation"), the ramp collapses
    # to a hard binary at the threshold, which is the intended behaviour.
    lower = threshold - half_ramp
    upper = threshold + half_ramp

    if direction == "below":
        if value <= lower:
            return 1.0
        if value >= upper:
            return 0.0
        return float((upper - value) / (upper - lower))

    # direction == "above"
    if value >= upper:
        return 1.0
    if value <= lower:
        return 0.0
    return float((value - lower) / (upper - lower))


def _active_specs(conditions: MissionConditions) -> list[tuple[ConditionSpec, float]]:
    """Return (spec, threshold) pairs for conditions the operator actually set."""
    active: list[tuple[ConditionSpec, float]] = []
    for spec in CONDITION_REGISTRY:
        threshold = getattr(conditions, spec.condition_field, None)
        if threshold is None:
            continue
        active.append((spec, float(threshold)))
    return active


def _in_time_of_day(ts: pd.Timestamp, start_hour: int | None, end_hour: int | None) -> bool:
    """Hard binary gate on hour-of-day (UTC). Handles midnight crossing."""
    if start_hour is None and end_hour is None:
        return True
    if start_hour is None or end_hour is None:
        return True  # both required to apply the gate
    hour = int(ts.hour)
    if start_hour == end_hour:
        return hour == start_hour
    if start_hour < end_hour:
        return start_hour <= hour < end_hour
    # Midnight-crossing window (e.g. 22:00–04:00)
    return hour >= start_hour or hour < end_hour


# ---------------------------------------------------------------------------
# Confidence decay
# ---------------------------------------------------------------------------

def _confidence(hours_ahead: float) -> float:
    """Piecewise-linear confidence decay vs. forecast horizon (hours from fetched_at)."""
    if hours_ahead <= 0:
        return 0.95
    if hours_ahead <= 24:
        return 0.95
    if hours_ahead <= 72:
        return 0.95 + (0.75 - 0.95) * (hours_ahead - 24) / (72 - 24)
    if hours_ahead <= 120:
        return 0.75 + (0.50 - 0.75) * (hours_ahead - 72) / (120 - 72)
    if hours_ahead <= 168:
        return 0.50 + (0.35 - 0.50) * (hours_ahead - 120) / (168 - 120)
    return 0.35


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def _load_forecast(aoi_id: str) -> tuple[pd.DataFrame, dict]:
    """Load forecast.parquet and weather/meta.json for an AOI."""
    parquet_path: Path = category_file(aoi_id, "weather", "forecast.parquet")
    if not parquet_path.exists():
        raise MissionWindowError(404, f"No weather forecast found for AOI {aoi_id}")

    try:
        df = read_parquet_grid(parquet_path)
    except Exception as exc:
        logger.warning("Could not read %s: %s", parquet_path, exc)
        raise MissionWindowError(422, "Forecast data is malformed or incomplete") from exc

    if df.empty:
        raise MissionWindowError(422, "Forecast data is malformed or incomplete")

    required = {"lon", "lat", "valid_time"} | {s.parquet_column for s in CONDITION_REGISTRY}
    missing = required - set(df.columns)
    if missing:
        logger.warning("Forecast for %s missing columns: %s", aoi_id, sorted(missing))
        raise MissionWindowError(422, "Forecast data is malformed or incomplete")

    meta = read_json(category_file(aoi_id, "weather", "meta.json")) or {}
    if not isinstance(meta, dict):
        meta = {}

    df = df.copy()
    df["valid_time"] = pd.to_datetime(df["valid_time"], utc=True)
    return df, meta


# ---------------------------------------------------------------------------
# Hourly scoring
# ---------------------------------------------------------------------------

@dataclass
class _HourScore:
    timestamp: pd.Timestamp
    score: float                     # mean across grid-point rows
    condition_scores: dict[str, float]   # per-condition mean across rows
    grid_coverage: float             # fraction of rows that fully meet all conditions
    confidence: float


def _score_hours(
    df: pd.DataFrame,
    active: list[tuple[ConditionSpec, float]],
    conditions: MissionConditions,
    fetched_at: datetime,
) -> list[_HourScore]:
    """Aggregate per-hour scores across all grid points."""
    horizon_limit = pd.Timedelta(hours=int(conditions.lookahead_hours))
    cutoff = pd.Timestamp(fetched_at) + horizon_limit
    df = df[df["valid_time"] <= cutoff]
    if df.empty:
        return []

    start_hour = conditions.time_window_start_hour_utc
    end_hour = conditions.time_window_end_hour_utc

    results: list[_HourScore] = []
    for ts, group in df.groupby("valid_time", sort=True):
        ts_py: pd.Timestamp = ts  # type: ignore[assignment]
        hours_ahead = (ts_py - pd.Timestamp(fetched_at)).total_seconds() / 3600.0
        confidence = _confidence(hours_ahead)

        # Hard time-of-day gate — outside hours → unconditional zero.
        if not _in_time_of_day(ts_py, start_hour, end_hour):
            results.append(
                _HourScore(
                    timestamp=ts_py,
                    score=0.0,
                    condition_scores={spec.name: 0.0 for spec, _ in active},
                    grid_coverage=0.0,
                    confidence=confidence,
                )
            )
            continue

        per_condition_means: dict[str, float] = {}
        # row_min[i] = min score across all active conditions for row i — used for grid coverage.
        row_min_scores: list[float] = [1.0] * len(group)
        rows = group.reset_index(drop=True)
        for spec, threshold in active:
            col = rows[spec.parquet_column].astype(float)
            scores = [
                _score_value(float(v) if not pd.isna(v) else float("nan"),
                             threshold, spec.direction, spec.ramp_pct)
                for v in col
            ]
            per_condition_means[spec.name] = float(sum(scores) / len(scores))
            for i, s in enumerate(scores):
                if s < row_min_scores[i]:
                    row_min_scores[i] = s

        # Mean per-condition score across rows, then mean across conditions = hour score.
        hour_score = (
            sum(per_condition_means.values()) / len(per_condition_means)
            if per_condition_means else 0.0
        )
        coverage = (
            sum(1 for s in row_min_scores if s >= _FULL_MET_SCORE) / len(row_min_scores)
            if row_min_scores else 0.0
        )

        results.append(
            _HourScore(
                timestamp=ts_py,
                score=hour_score,
                condition_scores=per_condition_means,
                grid_coverage=coverage,
                confidence=confidence,
            )
        )
    return results


# ---------------------------------------------------------------------------
# Window merging
# ---------------------------------------------------------------------------

def _group_consecutive(hours: list[_HourScore]) -> list[list[_HourScore]]:
    """Split into runs where each successive timestamp is ~1 hour after the previous."""
    if not hours:
        return []
    runs: list[list[_HourScore]] = [[hours[0]]]
    for prev, curr in zip(hours, hours[1:]):
        gap = (curr.timestamp - prev.timestamp).total_seconds() / 3600.0
        if gap <= 1.0 + 1e-6:
            runs[-1].append(curr)
        else:
            runs.append([curr])
    return runs


def _build_window(run: list[_HourScore], condition_names: list[str]) -> WindowScore:
    n = len(run)
    scores = [h.score for h in run]
    confidences = [h.confidence for h in run]
    mean_score = sum(scores) / n
    mean_confidence = sum(confidences) / n
    peak_score = max(scores)

    breakdown: dict[str, float] = {}
    for name in condition_names:
        per_hour = [h.condition_scores.get(name, 0.0) for h in run]
        breakdown[name] = sum(per_hour) / n

    limiting_factor = min(breakdown, key=breakdown.get) if breakdown else None
    grid_coverage = sum(h.grid_coverage for h in run) / n

    hourly = [
        HourlyDetail(
            timestamp_utc=h.timestamp.isoformat(),
            score=round(h.score, 4),
            confidence=round(h.confidence, 4),
            condition_scores={k: round(v, 4) for k, v in h.condition_scores.items()},
        )
        for h in run
    ]

    return WindowScore(
        start_utc=run[0].timestamp.isoformat(),
        end_utc=run[-1].timestamp.isoformat(),
        duration_hours=float(n),
        score=round(mean_score, 4),
        peak_score=round(peak_score, 4),
        confidence=round(mean_confidence, 4),
        adjusted_score=round(mean_score * mean_confidence, 4),
        breakdown={k: round(v, 4) for k, v in breakdown.items()},
        limiting_factor=limiting_factor,
        grid_coverage=round(grid_coverage, 4),
        hours=hourly,
    )


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def analyse(aoi_id: str, conditions: MissionConditions) -> MissionWindowResponse:
    """Score forecast hours, merge into windows, return ranked response."""
    active = _active_specs(conditions)
    if not active:
        raise MissionWindowError(422, "At least one mission condition must be specified")

    df, meta = _load_forecast(aoi_id)

    fetched_at_raw = meta.get("fetched_at")
    if fetched_at_raw:
        try:
            fetched_at = datetime.fromisoformat(fetched_at_raw)
            if fetched_at.tzinfo is None:
                fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        except ValueError:
            fetched_at = datetime.now(timezone.utc)
    else:
        fetched_at = datetime.now(timezone.utc)

    hours = _score_hours(df, active, conditions, fetched_at)
    if not hours:
        return MissionWindowResponse(
            aoi_id=aoi_id,
            windows=[],
            best_window=None,
            total_hours_analysed=0,
            hours_above_threshold=0,
            conditions_applied=[spec.name for spec, _ in active],
            forecast_model=str(meta.get("model") or "ecmwf_ifs04"),
            forecast_generated_at=fetched_at.isoformat(),
        )

    qualifying = [h for h in hours if h.score >= conditions.min_score]
    runs = _group_consecutive(qualifying)
    condition_names = [spec.name for spec, _ in active]

    windows: list[WindowScore] = []
    for run in runs:
        if len(run) < conditions.min_window_duration_hours:
            continue
        windows.append(_build_window(run, condition_names))

    windows.sort(key=lambda w: w.adjusted_score, reverse=True)
    windows = windows[:_MAX_WINDOWS]

    return MissionWindowResponse(
        aoi_id=aoi_id,
        windows=windows,
        best_window=windows[0] if windows else None,
        total_hours_analysed=len(hours),
        hours_above_threshold=len(qualifying),
        conditions_applied=condition_names,
        forecast_model=str(meta.get("model") or "ecmwf_ifs04"),
        forecast_generated_at=fetched_at.isoformat(),
    )
