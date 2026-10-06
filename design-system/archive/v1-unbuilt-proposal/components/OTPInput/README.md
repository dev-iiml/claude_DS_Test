# OTPInput

Six cells, 52px, monospaced digits. Auto-advance, paste fills all, SMS autofill (`autocomplete="one-time-code"`).

## States
active (focus ring + caret) · filled · error (all cells `danger`, message below, cells keep digits for correction) · verified (success border, then auto-continue after 400ms).

## Copy
"Enter the 6-digit code sent to +91 98200 41xxx" · "Resend in 0:24" · on error "That code didn't match. Try again or resend."
