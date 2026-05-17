# IPB Map — Frontend

Tactical 2D map of Finland with a 4-step operator workflow: login → AOI selection → capability selection → operations view. React + Vite + TypeScript + MapLibre GL JS + react-router-dom + framer-motion. Tier-1 natural layers are wired to backend AOI/job APIs and render in the operations map.

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

For Vercel deployments, set `VITE_API_BASE_URL` to the Render backend URL instead of `http://localhost:8000`.

Free Maptiler key: https://maptiler.com. Other scripts: `npm run build`, `npm run preview`.

## Flow

1. **`/login`** — password gate. Match against `VITE_OPS_PASSWORD` → orange flash → `/aoi`. Auth in `sessionStorage.auth`.
2. **`/aoi`** — full-Finland map. Draw rectangle (max 30 × 30 km, clamped live) → auto-fit → confirm panel → `/capabilities`. AOI persisted to `sessionStorage.aoi` + the in-memory `area` store.
3. **`/capabilities`** — 6 force-element cards on tactical grid background. At least one required to proceed. Selection persisted to `sessionStorage.capabilities`.
4. **`/operations`** — map fit to AOI with orange outline. Left **ToolPanel** (forces with descriptions + infrastructure tree + export buttons), right **LayerPanel** (natural-geography stubs), bottom **TimeSlider** (-72h … +72h, NOW-centred).

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
│   ├── ToolPanel.tsx        # left panel: forces (with descriptions), infrastructure tree, export buttons
│   └── icons/CapabilityIcon.tsx  # 6 inline tactical SVGs
├── data/
│   ├── capabilities.ts      # CAPABILITIES list (id, label, sublabel, description, icon)
│   └── infrastructure.ts    # INFRASTRUCTURE tree (bridges, towers, power, airfields, ports, rail, fuel)
├── registry/
│   ├── types.ts             # DataSource, Derivative, Analysis interfaces + contexts
│   └── cache.ts             # in-memory ResultCache (single-flight Promises) + key helpers
├── sources/index.ts         # tier 1 — raw geospatial sources (terrain, landcover, …)
├── derivatives/index.ts     # tier 2 — geometric primitives (chokepoints, viewsheds, …)
└── analyses/index.ts        # tier 3 — capability-keyed analyses (corridors, shelter positions, …)
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

### Add an infrastructure item

Append an `InfraNode` to `INFRASTRUCTURE` in [data/infrastructure.ts](src/data/infrastructure.ts). Two-level tree only — top-level rows are toggleable, optional `children` expand inline. Selection state lives in `OperationsPage.tsx` as `infraSelected: Set<string>`; pass it to a backend query alongside the AOI when wiring real data.

### Analysis registry (sources / derivatives / analyses)

Three tiers, one cache. Code lives in `src/registry/`, `src/sources/`, `src/derivatives/`, `src/analyses/`. The right LayerPanel automatically surfaces sources by category and analyses gated by the operator's selected capabilities. Nothing pulls real data yet — every manifest entry has `hasData: false` and a `PLACEHOLDER_*` function that throws.

**Where each kind of data lands:**

| Tier | File | Cache key | Inputs | UI surface |
|---|---|---|---|---|
| Source | [src/sources/index.ts](src/sources/index.ts) | `src:<id>:<bbox>` | `(area)` | Right panel — Base / Atmospheric / Demographic sections |
| Derivative | [src/derivatives/index.ts](src/derivatives/index.ts) | `dvt:<id>:<bbox>:<params>` | `(area, source results, upstream derivatives)` | Not shown — internal building block |
| Analysis | [src/analyses/index.ts](src/analyses/index.ts) | `ana:<id>:<bbox>:<caps>:t<offset>:<params>` | `(area, sources, derivatives, capabilities, time)` | Right panel — Analyses section (gated by capability) |

**Add a new source.** Append a `DataSource` manifest to `SOURCES` in [src/sources/index.ts](src/sources/index.ts); when ready, move `load()` into `src/sources/<id>.ts` and flip `hasData: true`. Set its category — `base | atmospheric | demographic` decides which right-panel section it lands in. Add a colour to `SOURCE_ACCENTS` in [OperationsPage.tsx](src/pages/OperationsPage.tsx) for the swatch.

**Add a new derivative.** Append to `DERIVATIVES` in [src/derivatives/index.ts](src/derivatives/index.ts) with `inputs.sources` and/or `inputs.derivatives`; implement `compute(ctx)` reading `ctx.sources` / `ctx.derivatives`. The resolver loads inputs automatically.

**Add a new analysis.** Append to `ANALYSES` in [src/analyses/index.ts](src/analyses/index.ts) with `requires.capabilities` (OR-semantics — appears when any selected). Implement `run(ctx)` — `ctx.sources` and `ctx.derivatives` are pre-resolved, `ctx.capabilities` and `ctx.timeOffsetHours` are the keys driving rerun.

**Caching.** `src/registry/cache.ts` is a single in-process `ResultCache`. Values are stored as Promises, so concurrent callers single-flight. Keys encode every input that affects the result — add new dimensions by extending the key helpers, never by stuffing them into `params`. Source/derivative results are stable per AOI (cache hits forever); analysis results invalidate naturally when capabilities or time change because those values are part of the key. For weather or other time-varying sources, pass a TTL to `cache.set()` / `cache.memoize()`. To swap in persistent caching (IndexedDB, server-side), replace the `ResultCache` instance — the rest of the registry is unchanged.

**Displaying results.** Once `load/compute/run` return real GeoJSON or a raster handle, add a MapLibre source + layer in [OperationsPage.tsx](src/pages/OperationsPage.tsx)'s `map.on("load", …)` block and a `useEffect` watching `layers` / `analysisLayers` to flip visibility and opacity. Mirror the AOI outline pattern that already lives there.

### Wire the export buttons

The three buttons in [components/ToolPanel.tsx](src/components/ToolPanel.tsx) call `onExport("report" | "pdf" | "notes")`, currently a no-op in `OperationsPage.tsx`. Replace the stub with a PDF generator (e.g. `pdf-lib` or a backend endpoint) — pass `getArea()`, the active layers, the selected capabilities, and `infraSelected` as input.

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
