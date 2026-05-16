"""Shared Pydantic request/response models for the API."""

from pydantic import BaseModel, model_validator

from src.service._shared.bbox import BBox


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
