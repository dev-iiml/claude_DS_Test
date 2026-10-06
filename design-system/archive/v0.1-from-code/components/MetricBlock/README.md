# MetricBlock

MetricBlock shows one labelled figure: an eyebrow-style label, a serif tabular value and an optional hint, with `<dl>` semantics.

Source: `src/components/creatorco/metric-block.tsx`.

## Use
- Dashboard figures: "Complete 82%", "Current status Member".
- Pair with `ProgressMeter` for completion.
- Values are short — a number with unit or a single word.

## Props
`label`, `value`, `hint?`, `className?`

## Don't
Don't show credit amounts or limits here until Financial Eligibility exists with its own consent and partner-lender wording.

_Preview: static HTML rendition styled by `components/bundle.css`._
