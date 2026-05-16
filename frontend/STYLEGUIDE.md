# STYLEGUIDE.md — IPB Map Frontend

Tactical / militaristic UI. Hard edges, thin lines, dark surfaces.
Inspired by operational intelligence displays and wildfire monitoring dashboards.
Every pixel should feel purposeful and information-dense.

---

## Design Principles

- **No rounded corners.** `border-radius: 0` everywhere. Sharp geometry only.
- **No gradients on UI surfaces.** Flat fills only. Gradients are reserved for data visualisation (heatmaps, layer colour ramps on the map).
- **No drop shadows.** Depth is created by border contrast, not elevation.
- **Thin lines as structure.** Borders are `1px`. Dividers are `1px`. Nothing heavier unless it is a data accent.
- **Information density over breathing room.** Panels are compact. Labels are small. Whitespace is deliberate, not generous.
- **Monospace for data, sans-serif for labels.** Numbers, coordinates, timestamps → monospace. Panel headings, layer names → sans-serif.

---

## Colour Palette

All CSS custom properties. Define in `src/styles/tokens.css` and import globally.

```css
:root {
  /* Backgrounds — true black to very dark grey */
  --color-bg-base:        #0a0a0a;  /* map canvas backdrop, deepest surface */
  --color-bg-panel:       #111111;  /* side panels, layer panel */
  --color-bg-raised:      #181818;  /* cards, dropdowns, popovers */
  --color-bg-hover:       #202020;  /* hover state on interactive rows */
  --color-bg-active:      #252525;  /* active / selected row */

  /* Borders */
  --color-border-subtle:  #2a2a2a;  /* panel inner dividers */
  --color-border-default: #3a3a3a;  /* panel edges, input borders */
  --color-border-strong:  #555555;  /* focused inputs, active elements */

  /* Text */
  --color-text-primary:   #e8e4d9;  /* main readable text — warm off-white */
  --color-text-secondary: #8a8880;  /* muted labels, units */
  --color-text-dim:       #555550;  /* disabled, placeholder */

  /* Accents — one dominant operational orange, supporting colours */
  --color-accent-orange:  #e8622a;  /* primary CTA, active indicators, fire/heat data */
  --color-accent-amber:   #c87d2a;  /* secondary data accent, day hotspot */
  --color-accent-yellow:  #d4a017;  /* warning states, escalating */
  --color-accent-red:     #c0392b;  /* critical alerts, night hotspot, threats */
  --color-accent-teal:    #2a9d8a;  /* own forces, safe zones, confirmed data */
  --color-accent-blue:    #2a6db5;  /* informational, weather data */

  /* Status */
  --color-status-ok:      #2a9d5c;
  --color-status-warn:    #d4a017;
  --color-status-crit:    #c0392b;

  /* Map overlay opacities — standard starting points */
  --overlay-opacity-high:   0.75;
  --overlay-opacity-medium: 0.55;
  --overlay-opacity-low:    0.35;
}
```

### Colour Usage Rules

- Use `--color-accent-orange` for: selected state, active toggle, the AOI rectangle draw outline, the timeline scrubber handle.
- Use `--color-accent-red` for: critical layer badges, threat markers, night-time detections.
- Use `--color-accent-teal` for: confirmed / friendly elements, success states.
- Use `--color-text-secondary` for all unit labels, coordinate readouts, layer sublabels.
- Never use pure white (`#ffffff`). Maximum brightness is `--color-text-primary` (`#e8e4d9`).
- Never use pure black (`#000000`) as a border — use `--color-border-subtle` instead so panels have visual separation without glowing edges.

---

## Typography

```css
/* In index.html or main.css — import from Google Fonts */
@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow:wght@300;400;500;600&family=Barlow+Condensed:wght@400;600&display=swap');

:root {
  --font-ui:      'Barlow', sans-serif;          /* panel labels, buttons, nav */
  --font-data:    'Share Tech Mono', monospace;  /* coordinates, values, timestamps */
  --font-heading: 'Barlow Condensed', sans-serif; /* panel titles, layer names */
}
```

### Type Scale

| Role | Font | Size | Weight | Transform |
|---|---|---|---|---|
| App title / brand | `--font-heading` | 13px | 600 | `uppercase` + `letter-spacing: 0.12em` |
| Panel section heading | `--font-heading` | 11px | 600 | `uppercase` + `letter-spacing: 0.1em` |
| Layer name | `--font-ui` | 13px | 400 | none |
| Body / description | `--font-ui` | 12px | 300 | none |
| Data value (large) | `--font-data` | 20px | — | none |
| Data value (inline) | `--font-data` | 12px | — | none |
| Coordinate / bbox | `--font-data` | 11px | — | none |
| Button | `--font-heading` | 11px | 600 | `uppercase` + `letter-spacing: 0.08em` |
| Status badge | `--font-heading` | 10px | 600 | `uppercase` + `letter-spacing: 0.1em` |

---

## Spacing

Use a 4px base unit. All spacing values are multiples of 4.

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
}
```

Panel internal padding: `--space-3` (12px) horizontal, `--space-2` (8px) vertical.
Row height for list items: 32px.
Section separator: `1px solid var(--color-border-subtle)` with `--space-3` vertical margin.

---

## Component Patterns

### Panels

```css
.panel {
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border-default);
  border-radius: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border-subtle);
  font-family: var(--font-heading);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}
```

### Buttons

No fill. Border only. Active state fills with accent.

```css
.btn {
  background: transparent;
  border: 1px solid var(--color-border-default);
  border-radius: 0;
  color: var(--color-text-primary);
  font-family: var(--font-heading);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
  transition: border-color 0.1s, color 0.1s;
}

.btn:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text-primary);
}

.btn--active,
.btn:active {
  border-color: var(--color-accent-orange);
  color: var(--color-accent-orange);
}
```

### Toggle (layer visibility)

Square checkbox, no rounding. Checked state uses accent orange.

```css
.toggle {
  appearance: none;
  width: 12px;
  height: 12px;
  border: 1px solid var(--color-border-strong);
  border-radius: 0;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
}

.toggle:checked {
  background: var(--color-accent-orange);
  border-color: var(--color-accent-orange);
}
```

### Opacity Slider

Thin track, no rounding.

```css
.opacity-slider {
  appearance: none;
  width: 100%;
  height: 2px;
  background: var(--color-border-default);
  border-radius: 0;
  outline: none;
}

.opacity-slider::-webkit-slider-thumb {
  appearance: none;
  width: 8px;
  height: 12px;
  background: var(--color-accent-orange);
  border-radius: 0;
  cursor: pointer;
}
```

### Status Badge

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-family: var(--font-heading);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 2px var(--space-2);
  border: 1px solid currentColor;
  border-radius: 0;
}

.badge--ok   { color: var(--color-status-ok); }
.badge--warn { color: var(--color-status-warn); }
.badge--crit { color: var(--color-status-crit); }
```

### Data Readout (coordinates, values)

```css
.data-value {
  font-family: var(--font-data);
  font-size: 12px;
  color: var(--color-text-primary);
}

.data-label {
  font-family: var(--font-heading);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}
```

---

## Layout

### App Shell

```
┌─────────────────────────────────────────────────┐
│ TopBar (40px, full width)                        │
├──────────────────────────────────┬──────────────┤
│                                  │              │
│  Map Canvas (fills remainder)    │ LayerPanel   │
│                                  │ (260px)      │
│                                  │              │
│                                  ├──────────────┤
│                                  │ FiltersPanel │
│                                  │ (stub)       │
└──────────────────────────────────┴──────────────┘
```

- TopBar: `height: 40px`, `background: var(--color-bg-panel)`, `border-bottom: 1px solid var(--color-border-default)`. Contains app name, AOI coordinates, reset button.
- Right panels: fixed `260px` wide, `border-left: 1px solid var(--color-border-default)`, no shadow.
- Map canvas: fills all remaining space. Zero padding against panel edges.

---

## Map Styles

### MapLibre Base Style

Use Maptiler's `dataviz-dark` or a custom dark style. The base map should feel like a tactical plotting surface — dark grey land, near-black ocean, muted road network. The data layers are the signal; the base map is the grid.

Recommended Maptiler style: `https://api.maptiler.com/maps/dataviz-dark/style.json?key={KEY}`

### AOI Draw Rectangle

- Outline: `2px` dashed, `var(--color-accent-orange)`, no fill on drag
- Confirmed AOI: `1px` solid `var(--color-accent-orange)` outline, `rgba(232, 98, 42, 0.08)` fill

### Layer Colour Ramps (MapLibre paint expressions)

| Layer | Ramp | Notes |
|---|---|---|
| Weather (wind speed) | `#2a6db5` → `#d4a017` → `#c0392b` | calm → moderate → high |
| Land cover / forest | `#1a3a1a` → `#2a7a2a` → `#4aaa4a` | sparse → dense |
| Population density | `#1a1a2a` → `#2a4a8a` → `#e8622a` | empty → dense |
| Infrastructure roads | `#d4a017` at `0.8` opacity | amber lines on dark base |
| Infrastructure bridges | `#c0392b` point markers | red = choke point |
| Infrastructure towers | `#2a9d8a` point markers | teal = comms asset |

### 3D Terrain

- Exaggeration: `1.8` (adjust per region — increase for flat terrain)
- Sky layer: `sky-type: atmosphere`, muted — do not let it compete with the map
- Pitch default: `50deg`, bearing: `0`
- Fog: add a subtle fog effect to reinforce depth on the far edge of the AOI

```typescript
map.setFog({
  color: 'rgba(10, 10, 10, 0.6)',
  'high-color': '#0a0a0a',
  'horizon-blend': 0.05,
});
```

---

## Motion

Minimal. Tactical tools do not animate for decoration.

- Panel open/close: `transition: width 0.15s ease` or `transform 0.15s ease`. Nothing slower.
- Layer toggle visibility: instant — no fade. The data is either present or not.
- Opacity slider: `map.setPaintProperty` is called on `input` event, no debounce needed — MapLibre handles it.
- AOI transition (2D → 3D): `map.flyTo({ pitch: 50, duration: 800 })`. Single purposeful camera move.
- Status indicators (e.g. data loading): a simple `opacity` pulse at `1s` interval using CSS `@keyframes`. No spinners.

```css
@keyframes pulse-opacity {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}

.loading-indicator {
  animation: pulse-opacity 1s ease-in-out infinite;
  color: var(--color-accent-orange);
}
```

---

## Do Not

- Do not use `border-radius` anywhere in the UI shell or panels.
- Do not use box-shadow for elevation — use border contrast.
- Do not use Inter, Roboto, or system-ui as the UI font.
- Do not use bright white text — use `--color-text-primary` (`#e8e4d9`).
- Do not use filled buttons except for the single primary destructive action (if any).
- Do not add animation delays or staggered reveals — this is a tool, not a marketing page.
- Do not use colour alone to encode meaning — pair colour with a label or icon.
- Do not round map markers — use square or diamond shapes to match the UI language.