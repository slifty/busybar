# `random-emoji`

The `random-emoji` program shows a random emoji, changing every five seconds.

Emoji cannot be drawn as text: the bar's fonts are bitmap ASCII and the API
rejects anything outside `^[\x20-\x7E]+$`. The firmware ships emoji as image
sprites, though, so this program references those by `stock_path` and uploads
nothing at all — no image encoding, no asset management, no bundled files.

Unlike the greeting, this one asks to be drawn again every five seconds, since
the point is that the picture changes. Its elements expire after twice that, so
a single failed draw leaves the previous emoji up rather than blanking the
screen.

## Settings

None.

---

[← All programs](../../../README.md#programs)
