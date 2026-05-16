"""Shared BBox primitive used by every service."""

from dataclasses import dataclass


@dataclass
class BBox:
    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float

    def validate(self) -> None:
        """Raise ValueError if coordinates are out of range or inverted."""
        if not (-180 <= self.min_lon <= 180 and -180 <= self.max_lon <= 180):
            raise ValueError("Longitude must be between -180 and 180")
        if not (-90 <= self.min_lat <= 90 and -90 <= self.max_lat <= 90):
            raise ValueError("Latitude must be between -90 and 90")
        if self.min_lon >= self.max_lon:
            raise ValueError("min_lon must be less than max_lon")
        if self.min_lat >= self.max_lat:
            raise ValueError("min_lat must be less than max_lat")

    def as_tuple(self) -> tuple[float, float, float, float]:
        return (self.min_lon, self.min_lat, self.max_lon, self.max_lat)

    def __str__(self) -> str:
        return f"{self.min_lon},{self.min_lat},{self.max_lon},{self.max_lat}"
