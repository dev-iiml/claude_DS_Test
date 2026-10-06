# VerificationMark

Verification glyph with a screen-reader word — never colour alone.

Source: `src/components/creatorco/verification.tsx`. Props: `state`, `className?`. `VERIFICATION_LABELS` gives the words.

| State       | Glyph         | Colour     | Word            |
| ----------- | ------------- | ---------- | --------------- |
| `verified`  | circle-check  | success    | Verified        |
| `declared`  | circle-dot    | ink-subtle | Self-declared   |
| `attention` | circle-alert  | warning    | Needs attention |
| `missing`   | circle-dashed | ink-subtle | Not provided    |

Use as `ListRow` `leading`, with the row's detail saying what to do. A fifth state, **derived**, and attribute-level wording are proposed (P-01).
