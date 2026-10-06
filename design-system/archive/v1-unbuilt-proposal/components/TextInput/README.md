# TextInput

Text inputs are 48px, `surface` fill, `border-strong` outline (≥3:1), radius-sm. Labels sit above, helper text below.

## States
default · hover (border darkens) · focus (2px `focus` outline) · filled · valid (success border + check message) · error (`danger` border, message with icon) · disabled (`surface-sunken`).

## Indian formats
- Amounts: `₹` prefix, digits grouped Indian-style as typed (1,50,000).
- Mobile: `+91` prefix, 10 digits, numeric keypad.
- PAN/GSTIN: monospaced on review screens only; never echoed back after an error, never logged.

## Copy
Errors say what to do: "Enter your 10-digit mobile number", not "Invalid input".
