# MetricBlock

A labelled figure (`<dl>`): footnote label, `text-title-1` bold tabular value, optional hint.

Source: `src/components/creatorco/metric-block.tsx`. Props: `label`, `value`, `hint?`, `className?`.

## Use

Risk console summary tiles. Figures use tabular numerals and Indian grouping (`en-IN`: 1,50,000; lakh/crore in prose). Zero states say so in the hint ("None yet").

Never put a credit figure in a MetricBlock next to status information.
