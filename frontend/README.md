# IPB Map — Frontend

Tactical 2D map of Finland with a 4-step operator workflow: login → AOI selection → capability selection → operations view. React + Vite + TypeScript + MapLibre GL JS + react-router-dom + framer-motion. No backend calls yet — layer toggles and time slider are UI-only.

## Run

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Env vars in `frontend/.env`:

```
VITE_MAPTILER_KEY=your_key_here
VITE_API_BASE_URL=http://localhost:8000
VITE_OPS_PASSWORD=OPSEC
```

Free Maptiler key: https://maptiler.com. Other scripts: `npm run build`, `npm run preview`.

## Flow

1. **`/login`** — password gate. Match against `VITE_OPS_PASSWORD` → orange flash → `/aoi`. Auth in `sessionStorage.auth`.
2. **`/aoi`** — full-Finland map. Draw rectangle (max 30 × 30 km, clamped live) → auto-fit → confirm panel → `/capabilities`. AOI persisted to `sessionStorage.aoi` + the in-memory `area` store.
3. **`/capabilities`** — 6 force-element cards on tactical grid background. At least one required to proceed. Selection persisted to `sessionStorage.capabilities`.
4. **`/operations`** — map fit to AOI with orange outline, sectioned layer panel (Base / Intelligence, all stubs), capability strip bottom-left, time slider bottom (-72h … +72h, NOW-centred).

Page transitions are a left-to-right `clipPath` wipe (180 ms in / 120 ms out) via `AnimatePresence`.

## Layout

```
src/
├── App.tsx                  # mounts RouterProvider + ScanlineOverlay
├── router.tsx               # RootLayout with AnimatePresence + auth guard
├── types.ts                 # BoundingBox, LayerConfig, LayerId, LayerSection, AppMode, MAX_AOI_KM
├── area.ts                  # AreaContext store + GeoJSON serializers (see below)
├── config.ts                # env vars
├── pages/
│   ├── LoginPage.tsx        # logo draw-in, classification bar, password (shake on error)
│   ├── AoiSelectPage.tsx    # map + draw → auto-fit → confirm panel
│   ├── CapabilityPage.tsx   # capability grid (data from data/capabilities.ts)
│   └── OperationsPage.tsx   # map + sectioned LayerPanel + TimeSlider + CapabilityStrip
├── components/
│   ├── ScanlineOverlay.tsx  # full-screen CRT texture (z 9999, pointer-events none)
│   ├── PageTransition.tsx   # clipPath wipe wrapper
│   ├── CapabilityCard.tsx   # 140×160 tile, staggered entrance, orange swatch when selected
│   ├── TimeSlider.tsx       # -72h…+72h range, NOW marker, time readout
│   ├── LayerPanel.tsx       # sectioned right panel, square toggle, opacity slider, NO DATA badge
│   └── icons/CapabilityIcon.tsx  # 6 inline tactical SVGs
├── data/capabilities.ts     # CAPABILITIES list (id, label, sublabel, description, icon)
├── hooks/useAoi.ts          # 30 km-clamped AOI draw state + pixel→LngLat
└── styles/tokens.css        # all design tokens + global reset + slider/toggle/btn styles
```

## How to extend

### Add a new page

1. Create `src/pages/MyPage.tsx`.
2. Register in [router.tsx](src/router.tsx) under the `children` array. Add `loader: requireAuth` if it should be gated.
3. Wrap navigation links with `useNavigate()`; the `<PageTransition>` runs automatically because the route key changes.

### Add a new layer to Operations

1. Add the id to `LayerId` in [types.ts](src/types.ts).
2. Append a `LayerConfig` to `INITIAL_LAYERS` in [OperationsPage.tsx](src/pages/OperationsPage.tsx); add the id to `BASE_IDS` or `INTEL_IDS` to choose the section.
3. Set `hasData: true` once a real data source is wired (removes the `NO DATA` badge).
4. To render data on the map, add a MapLibre source/layer inside the `map.on("load", …)` block, then add a `useEffect` keyed on `layers` that flips visibility and applies opacity (mirror the existing AOI outline pattern).

### Add a new capability

Append an entry to `CAPABILITIES` in [data/capabilities.ts](src/data/capabilities.ts). For a new icon, add a `case` to [components/icons/CapabilityIcon.tsx](src/components/icons/CapabilityIcon.tsx) — geometric, stroke-only, no curves.

### Wire the backend

[area.ts](src/area.ts) is the single source of truth for the AOI. Use it anywhere:

```ts
import { getArea, areaAsFeature, areaAsBBoxArray } from "./area";

const area = getArea();
if (!area) return;
fetch(`${API_BASE_URL}/weather`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ geometry: areaAsFeature(area) }),
});
```

For React components use `useArea()`. Store derived per-area data via `patchAreaMetadata({ ... })` — `AreaContext.metadata` is the typed expansion slot for future fields (terrain stats, weather summaries, etc.).

The selected capability ids live in `sessionStorage.capabilities`; pass them to fusion endpoints alongside the AOI.

### Change the auth gate

Edit `requireAuth` in [router.tsx](src/router.tsx). The current implementation checks `sessionStorage.auth === "true"`; swap in real auth (JWT, cookies) here without touching pages.

### Restyle

All colours, fonts, spacing in [src/styles/tokens.css](src/styles/tokens.css). Component-level styling uses these vars exclusively. Rules: no `border-radius`, no `box-shadow`, no `#ffffff`, no system fonts. See [STYLEGUIDE.md](STYLEGUIDE.md).

### Change the map

Style URL, centre, zoom limits, and pitch live at the top of each page's MapLibre `useEffect`. Swap for any MapLibre-compatible style JSON.
