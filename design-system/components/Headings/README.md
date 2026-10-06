# Headings

The type roles as components: `Eyebrow`, `DisplayHeading`, `PageHeading`, `SectionHeading`, `GroupLabel`, `Lede`.

Source: `src/components/creatorco/heading.tsx`.

| Component        | Element | Style                                                             |
| ---------------- | ------- | ----------------------------------------------------------------- |
| `Eyebrow`        | `p`     | footnote, semibold, uppercase, `--tracking-eyebrow`, `ink-subtle` |
| `DisplayHeading` | `h1`    | 40 → 56 → 64px bold, tight tracking (landing, welcome)            |
| `PageHeading`    | `h1`    | `text-large-title` (34px) bold — iOS Large Title                  |
| `SectionHeading` | `h2`    | `text-title-2` (22px) bold                                        |
| `GroupLabel`     | `h2`    | footnote caps, `ink-subtle` — list section headers                |
| `Lede`           | `p`     | body, `ink-muted`, `max-w-prose`                                  |

## Rules

- One `h1` per page (PageHeading or DisplayHeading).
- Gold in a heading is a brand moment only (the landing's second line); serif (Newsreader) only for the wordmark and editorial moments.
- Display sizes are a documented exception to the type scale (CHANGELOG › Left as exceptions).
