import { useCallback, useRef, useState } from "react";
import type maplibregl from "maplibre-gl";
import type { Feature, Polygon } from "geojson";
import { BoundingBox, MAX_AOI_KM } from "../types";

interface LngLat {
  lng: number;
  lat: number;
}

export interface UseAoiReturn {
  drawMode: boolean;
  setDrawMode: (v: boolean) => void;
  toggleDrawMode: () => void;
  handleMouseDown: (e: MouseEvent, map: maplibregl.Map) => void;
  handleMouseMove: (e: MouseEvent, map: maplibregl.Map) => void;
  handleMouseUp: (
    e: MouseEvent,
    map: maplibregl.Map,
    onAoiChange: (b: BoundingBox) => void
  ) => void;
  getLiveGeoJSON: () => Feature<Polygon> | null;
}

const KM_PER_DEG_LAT = 111;

function kmPerDegLon(lat: number): number {
  return KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

// Clamp `end` so that the bbox formed with `start` stays within maxKm in both dims.
function clampToMaxKm(start: LngLat, end: LngLat, maxKm: number): LngLat {
  const latDiff = end.lat - start.lat;
  const lonDiff = end.lng - start.lng;
  const meanLat = (start.lat + end.lat) / 2;

  const latKm = Math.abs(latDiff) * KM_PER_DEG_LAT;
  const lonKm = Math.abs(lonDiff) * kmPerDegLon(meanLat);

  let clampedLat = end.lat;
  let clampedLng = end.lng;

  if (latKm > maxKm) {
    const sign = latDiff >= 0 ? 1 : -1;
    clampedLat = start.lat + (sign * maxKm) / KM_PER_DEG_LAT;
  }
  if (lonKm > maxKm) {
    const sign = lonDiff >= 0 ? 1 : -1;
    const refLat = (start.lat + clampedLat) / 2;
    clampedLng = start.lng + (sign * maxKm) / kmPerDegLon(refLat);
  }
  return { lng: clampedLng, lat: clampedLat };
}

function rectPolygon(a: LngLat, b: LngLat): Feature<Polygon> {
  const minLon = Math.min(a.lng, b.lng);
  const maxLon = Math.max(a.lng, b.lng);
  const minLat = Math.min(a.lat, b.lat);
  const maxLat = Math.max(a.lat, b.lat);
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ]],
    },
  };
}

function canvasPoint(e: MouseEvent, map: maplibregl.Map): [number, number] {
  const rect = map.getCanvas().getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
}

export function useAoi(): UseAoiReturn {
  const [drawMode, setDrawModeState] = useState(false);
  const startRef = useRef<LngLat | null>(null);
  const liveRef = useRef<Feature<Polygon> | null>(null);
  const [, forceRender] = useState(0);

  const setDrawMode = useCallback((v: boolean) => {
    if (!v) {
      startRef.current = null;
      liveRef.current = null;
    }
    setDrawModeState(v);
  }, []);

  const toggleDrawMode = useCallback(() => {
    setDrawModeState(prev => {
      const next = !prev;
      if (!next) {
        startRef.current = null;
        liveRef.current = null;
      }
      return next;
    });
  }, []);

  const handleMouseDown = useCallback((e: MouseEvent, map: maplibregl.Map) => {
    const [x, y] = canvasPoint(e, map);
    startRef.current = map.unproject([x, y]);
    liveRef.current = rectPolygon(startRef.current, startRef.current);
    forceRender(n => n + 1);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent, map: maplibregl.Map) => {
    if (!startRef.current) return;
    const [x, y] = canvasPoint(e, map);
    const raw = map.unproject([x, y]);
    const end = clampToMaxKm(startRef.current, raw, MAX_AOI_KM);
    liveRef.current = rectPolygon(startRef.current, end);
    forceRender(n => n + 1);
  }, []);

  const handleMouseUp = useCallback(
    (e: MouseEvent, map: maplibregl.Map, onAoiChange: (b: BoundingBox) => void) => {
      if (!startRef.current) return;
      const [x, y] = canvasPoint(e, map);
      const raw = map.unproject([x, y]);
      const end = clampToMaxKm(startRef.current, raw, MAX_AOI_KM);
      const start = startRef.current;
      const bbox: BoundingBox = {
        minLon: Math.min(start.lng, end.lng),
        maxLon: Math.max(start.lng, end.lng),
        minLat: Math.min(start.lat, end.lat),
        maxLat: Math.max(start.lat, end.lat),
      };
      startRef.current = null;
      liveRef.current = null;
      setDrawModeState(false);
      onAoiChange(bbox);
    },
    []
  );

  const getLiveGeoJSON = useCallback(() => liveRef.current, []);

  return {
    drawMode,
    setDrawMode,
    toggleDrawMode,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    getLiveGeoJSON,
  };
}

// Exported helper for size readouts elsewhere.
export function bboxSizeKm(b: BoundingBox): { widthKm: number; heightKm: number } {
  const meanLat = (b.minLat + b.maxLat) / 2;
  return {
    widthKm: (b.maxLon - b.minLon) * kmPerDegLon(meanLat),
    heightKm: (b.maxLat - b.minLat) * KM_PER_DEG_LAT,
  };
}
