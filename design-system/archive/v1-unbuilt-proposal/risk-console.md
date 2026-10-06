# Risk console

The internal console for risk analysts uses the **same tokens** at a **higher density**. The brand shows up as precision, not flair.

## Density

- Text: `small` (13px) for cells and panels, `caption` for metadata, `mono` for IDs, reason codes, model versions and consent references.
- Controls: `control-sm` (36px) buttons, inputs and filter chips. Table rows 40px.
- Layout: 232px sidebar · queue table · 440px detail panel. Desktop only (≥ 1280px recommended).

## What changes from the creator app

- No display serif except the creator's name in the panel heading; no italic flourishes.
- No Rani, no tier materials, no photography, no wit.
- Status is always a badge with a word: Needs review (warning), Recommended (success), With partner (info), Incomplete (neutral), Hold (danger).

## Patterns

- **Queue table** — ID (mono), creator + category, completeness (5-segment minibar + %), Traditional vs Creator-enhanced recommendation (tabular, right-aligned), fraud flag count, status. Filter chips in one row above; pagination below.
- **Comparison** — two side-by-side tiles, Traditional and Creator-enhanced; the creator-enhanced tile has the stronger border. Below: component scores as paired bars (`chart-1` Traditional, `chart-2` Creator-enhanced) with a legend; "n/a" where the traditional model has no signal.
- **Reason codes** — mono code, plain sentence, signed marker (+ / · / −) with an accessible label.
- **Fraud flags** — `flag` icon + count in a danger badge; the panel lists each flag with source and time.
- **Completeness, model version, consent version** — key/value rows; always visible.
- **Audit trail** — a timeline of every event with time (IST), actor and channel.

## Language

Analysts **recommend** to the partner ("Recommend to partner", "Request documents", "Hold"). The console never says "approve", "sanction" or "disburse" — those are the partner's actions.
