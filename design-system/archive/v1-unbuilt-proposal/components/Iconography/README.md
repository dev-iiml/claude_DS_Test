# Iconography

Icons are **Lucide** (ISC licence — already shadcn's default), drawn at 1.5px stroke on a 24px grid, rendered at 20px (16px in dense tables, 24px in empty states).

## Rules
- Outline only, `currentColor`, round caps and joins. No filled, duotone or 3D icons.
- Icons label, they don't decorate: every icon sits beside a word, except universally understood controls (close, back, search, more) which carry an `aria-label`.
- Platforms (Instagram, YouTube…) are shown with **neutral glyphs** (camera, video, mic) plus the platform's name in text — no vendor logos or colours in tokens.
- Status icons pair with semantic colour: `circle-check` success, `triangle-alert` warning, `circle-alert` danger, `info` info.
- Gen Alpha test: an icon must still read at 16px and in one colour.

The asset group **Icons** holds the approved set as SVG files (ink `#121110`; recolour by inlining).
