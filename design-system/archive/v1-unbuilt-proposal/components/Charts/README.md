# Charts

Charts are restrained: thin 2px lines, 4px-rounded bars, recessive gridlines (`chart-grid`), labels in text tokens (never in series colour), direct labels on ≤ 4 series plus a legend, a crosshair tooltip on hover, and a table view for every chart.

## Palette (validated for colour-vision deficiency, both themes)
Fixed order, never cycled: `chart-1` brass · `chart-2` slate · `chart-3` clay · `chart-4` teal · `chart-5` plum. A 6th series folds into "Other". Scatter/bubble charts: first two slots only. Sequential: `seq-100…600` (brass). Diverging: `chart-diverge-neg` ↔ `chart-diverge-mid` ↔ `chart-diverge-pos`.

## Rules
- One y-axis per chart. Two measures → two charts.
- Money axes use Indian compact units (₹50k, ₹1.5L, ₹2Cr) and tabular numerals.
- No 3D, no gradients, no donut for close values, no Rani in charts, no status colours as series colours.
- Creator-facing charts celebrate consistency, not virality: earnings over time, repeat partners — never follower growth as the hero.
