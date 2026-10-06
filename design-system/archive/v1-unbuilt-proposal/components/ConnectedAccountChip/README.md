# ConnectedAccountChip

Platforms appear as neutral chips: a generic glyph (camera = photo platform, video = video platform, mic = audio/podcast), the platform **name in text**, the handle, and a connection state.

## States
connected (`circle-check`, success) · declared, not connected (dashed border, subtle) · needs reconnect (danger border + `circle-alert`) · syncing (spinner).

## Rules
- No vendor logos or brand colours in tokens or components — names are data.
- Never show follower counts on the chip.
