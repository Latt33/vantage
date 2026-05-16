# IPB Map — Frontend

Dark, tactical 2D map of Finland with a rectangle AOI selection tool and a layer panel.
React + Vite + TypeScript + MapLibre GL JS. No backend calls yet — layer toggles update UI state only.

## Run

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Set your Maptiler key in `frontend/.env`:

```
VITE_MAPTILER_KEY=your_key_here
VITE_API_BASE_URL=http://localhost:8000
```

Free tier key: https://maptiler.com (no credit card).

Other scripts: `npm run build`, `npm run preview`.

## Layout

```
src/
├── main.tsx               # entry — imports tokens.css + maplibre css
├── App.tsx                # shell, layer + AOI state
├── config.ts              # env vars
├── types.ts               # BoundingBox, LayerConfig, LayerId
├── styles/tokens.css      # all design tokens + global reset
├── components/
│   ├── MapView.tsx        # MapLibre map + AOI rendering + draw-mode button
│   ├── LayerPanel.tsx     # right sidebar, layer rows + opacity sliders
│   └── TopBar.tsx         # 40px header, AOI coordinate readout, reset
└── hooks/useAoi.ts        # AOI rectangle draw state + pixel→LngLat conversion
```

## How to extend

**Add a new layer**
1. Add the id to the `LayerId` union in `src/types.ts`.
2. Append a `LayerConfig` to `INITIAL_LAYERS` in `src/App.tsx`.
3. In `MapView.tsx`, add a MapLibre source + layer in the `map.on("load", ...)` block.
4. In an effect that watches the `layers` prop, call `map.setLayoutProperty(id, "visibility", visible ? "visible" : "none")` and `map.setPaintProperty(id, "<paint-prop>-opacity", opacity)`.
5. Drop the `NO DATA` badge in `LayerPanel.tsx` once the layer is wired.

**Wire the backend**
- Use `API_BASE_URL` from `src/config.ts`.
- The current AOI is `BoundingBox` in `App.tsx` — pass it to a fetcher and hand the response to `MapView` via a new prop, or store it next to `layers`.

**Restyle**
- All colours, fonts, and spacing live in `src/styles/tokens.css`. Components use those vars exclusively — no hard-coded colours outside the AOI accent.
- Rules: no `border-radius`, no `box-shadow`, no white (`#ffffff`), no system fonts. See `STYLEGUIDE.md`.

**Change the map**
- Style URL, centre, zoom limits, and pitch live at the top of `MapView.tsx`'s `useEffect`. Switch the Maptiler style URL or swap for any MapLibre-compatible style JSON.
