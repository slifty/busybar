![CI](https://github.com/slifty/busybar/actions/workflows/ci.yml/badge.svg)

# busybar

A personal tool for interfacing with a [BUSY Bar](https://busy.app) — a
productivity multi-tool with an LED pixel display, a built-in Pomodoro timer,
and a small app platform.

The BUSY Bar exposes an [HTTP API](https://docs.busy.app/bar/dev/http-api) and
publishes an official TypeScript library,
[`@busy-app/busy-lib`](https://www.npmjs.com/package/@busy-app/busy-lib), which
is what this project intends to build on.

> **Status:** early. The tooling, CI, and dependency automation are in place,
> and the tool draws its first thing on a real device.

## Connecting

Everything here expects a BUSY Bar connected over USB. The device appears as a
USB-Ethernet adapter at the fixed address `10.0.4.20` — printed on its back
cover — and USB is treated as a trusted channel, so no token or password is
involved. Wi-Fi and cloud access both need credentials and are not wired up.

## Programs

The bar runs one **program** at a time — an operating mode, one thing the
device is doing. Pick one with the `BUSYBAR_PROGRAM` environment variable:

```bash
npm run dev                              # runs the default
BUSYBAR_PROGRAM=hello-world npm run dev
```

| Program        | What it does                                             |
| -------------- | -------------------------------------------------------- |
| `hello-world`  | Scrolls "Hello, World!" across the front display         |
| `random-emoji` | Shows a random emoji, changing every five seconds        |
| `focus`        | Shows the focus block you are in and the time left of it |

An unknown name exits with the list of valid ones.

Everything common to programs lives in the runner: connecting, drawing, waiting
until a program wants to draw again, tolerating preemption, putting failures on
the display, and clearing it on the way out. A program supplies a name, a
description, and a `draw` function. Adding one means adding a folder under
`src/programs/` and a single entry in `src/programs/index.ts`.

### When something goes wrong

A failure goes on the bar, in red, as well as into the log:

```
focus: ERROR
```

The reason it is there at all is that failure is otherwise invisible. The bar
falls back to its built-in clock whenever nothing is drawn over it, so a
program between focus blocks, a program retrying a draw it will never land, and
a program that died half an hour ago all look identical from across the room —
and only the first of those is fine. Anything that leaves you believing the bar
will do something it will not is the thing worth preventing.

It names the program rather than the problem. There is no version of an HTTP
error or a parse failure that reads well on 72×16 pixels, and none of it is
actionable from across the room; the terminal has the reason in full. What the
bar is for is telling you to go and look.

Three details follow from how the device arbitrates the screen:

- **A failure replaces what the program had drawn**, rather than appearing
  alongside it. Two text elements on 72×16 leaves both unreadable. This means a
  single failed draw takes down a drawing that may still have been correct,
  which is the intended direction — a bar showing the last thing that worked is
  exactly the impression being avoided.
- **It is drawn under the program's own application name.** Draws are ranked by
  priority, and the device settles a tie in favour of whichever application
  already holds the screen. An error kept under a name of its own would be one
  the program could never draw over, so the report of the failure would become
  the thing preventing the recovery.
- **It comes down before each retry, not after one succeeds**, for the same
  reason.

A failure during startup is left on screen deliberately. The process exits, so
nothing is coming to clear it, and a tool that never started is precisely when
the display must not look ordinary. The next run clears it before its first
draw, so a leftover error never sits underneath what that run draws.

Preemption is not a failure. An active BUSY or CUSTOM session outranking this
tool is the device working as intended, so it is reported to the log and left
off the display — where it could not be drawn anyway.

Programs schedule themselves rather than being polled: `draw` returns the
number of milliseconds until it wants to be called again, or nothing at all if
the device can sustain what was drawn on its own. The interesting moments are
rarely evenly spaced — a focus block changes colour at two known instants and
is static in between — and redrawing is not free, since it restarts scroll
animations. Asking to be woken at the exact moment something changes keeps the
screen correct without redrawing to check.

## Hello, World

The default program scrolls "Hello, World!" across the front display and leaves
it there until you stop it with Ctrl-C.

Two properties of the device shape how this works:

- **The greeting is drawn once, not on a loop.** Elements normally carry a
  timeout and expire, but a timeout of `0` means the element stays until it is
  cleared. That matters here because redrawing an element restarts its scroll
  animation, so a redraw loop would jerk the text back to the start on every
  tick. Its draw asks for no follow-up.
- **A focus session outranks us.** Draws are priority-ranked, and an active
  BUSY or CUSTOM session sits above the default. The greeting reports that it
  was preempted rather than pretending it drew something.

Because the greeting never expires on its own, the program clears it on the way
out.

## Random emoji

`BUSYBAR_PROGRAM=random-emoji` shows a random emoji, changing every five
seconds.

Emoji cannot be drawn as text: the bar's fonts are bitmap ASCII and the API
rejects anything outside `^[\x20-\x7E]+$`. The firmware ships emoji as image
sprites, though, so this program references those by `stock_path` and uploads
nothing at all — no image encoding, no asset management, no bundled files.

Unlike the greeting, this one asks to be drawn again every five seconds, since
the point is that the picture changes. Its elements expire after twice that, so
a single failed draw leaves the previous emoji up rather than blanking the
screen.

## Focus blocks

`BUSYBAR_PROGRAM=focus` turns the bar into a view of the focus block you are
currently in: its name along the top, and the time left of it counting down
below. Between blocks the bar shows nothing and the built-in clock has the
screen back.

The colour says where you are in the block:

| Colour | When                                     |
| ------ | ---------------------------------------- |
| Blue   | The first 15 minutes — settling in       |
| Green  | The middle                               |
| Orange | The last 15 minutes — time to wrap it up |

A block shorter than half an hour qualifies for both ends at once. Orange wins
there, on the grounds that being told to wrap up is worth more than being told
you have just started, so a twenty-minute block reads blue for five minutes and
orange for fifteen.

### The schedule

Blocks are read from a JSON file — `local/focus.json`, or wherever
`BUSYBAR_FOCUS_FILE` points. `local/` is git-ignored wholesale, since a
schedule of what you are doing all day belongs to one machine rather than to
the repository:

```json
[
	{
		"name": "Deep Work",
		"start": "2026-08-07T09:00:00Z",
		"end": "2026-08-07T10:30:00Z"
	}
]
```

The file is a stand-in for a real calendar, and deliberately the only part of
the program that knows where blocks come from. Everything above it — resolving
overlaps, picking the current block, colouring it, drawing it — is written
against a schedule rather than against a file.

Overlapping blocks are neither merged nor trimmed. The one that starts earlier
wins and the other is ignored outright, with ties settled by their order in the
file. Blocks that merely touch both survive, since a block is half-open: one
ending at 10:00 has released the screen before one starting at 10:00 claims it.

Names are drawn as text, and the device's fonts are bitmap ASCII, so anything
outside printable ASCII — em dashes, curly quotes, emoji — is dropped from a
name before it is drawn. A name left with nothing drawable at all is an error
rather than a blank row.

A schedule that is missing or malformed at startup stops the tool with the
reason. The alternative is a bar that sits dark all day while the explanation
scrolls past in a log. Once running, the same problem is only a failed draw,
retried on the runner's short delay — the file belongs to whatever is writing
it, so finding it mid-write is a moment to wait out rather than to exit on.

### Keeping up with a file that changes

Blocks are timestamps, not times of day, so a schedule is only ever about the
days it actually names. That makes the file something to keep current rather
than something to write once, and the program is built to be read from while
someone else is writing to it.

The schedule is read on every draw, not held from startup. A process left
running overnight therefore picks up a new day's blocks on its own, and a block
added, moved, or cancelled during the day takes effect at the next draw without
a restart.

Between blocks, the program will not go more than fifteen minutes without
looking at the file again, even when the next block it can see is hours off —
otherwise a block added ahead of that one would be missed, and a schedule that
had run out would never be looked at again. Nothing is on screen at those
moments, so the wake-up costs a file read and no device traffic.

That cap deliberately does not apply while a block is showing. Cutting a
block's wait short would redraw it, and redrawing restarts the scroll on its
name, so a change to a block already on screen is picked up at its next colour
change rather than immediately.

An exhausted schedule is treated as one that has not been filled in yet, since
that is what it usually is. The program keeps checking rather than stopping,
which is what lets a sync that has not run yet, or a file written later in the
day, still reach the bar.

### What the device does for itself

Two properties of the hardware keep a block to a handful of requests:

- **The countdown is a device-side element.** It takes the block's end as a
  Unix timestamp and ticks down by itself, so nothing has to redraw it to keep
  the time honest.
- **Elements are given an expiry rather than a timeout.** They carry the
  block's end as `display_until`, so the device takes them down on time and
  releases the screen on its own — even if this process is not around to do it.
  The countdown reaching zero and the drawing disappearing are the same moment.

What is left is three draws for a typical block: one when it starts, one when
it turns green, one when it turns orange. The program asks to be woken at
exactly those moments rather than polling to find them. That is not only
tidiness — a block name too long for 72px scrolls, and redrawing restarts the
scroll, so polling would jerk the name back to the start on every tick.

## Configuration

Everything configurable is read from the environment. Node loads a `.env` file
natively, so there is no `dotenv` dependency:

```bash
cp .env.example .env
```

[`.env.example`](.env.example) lists every variable and its default, in a block
per program — add a block there whenever a program gains a setting, so there is
one place to discover what can be set. `.env` itself is git-ignored.

Running without a `.env` is fine. Every setting has a default, and the scripts
use `--env-file-if-exists`, which carries on when the file is absent rather
than failing the way plain `--env-file` does. It does print a one-line notice
to stderr saying so.

A variable set in the environment beats the same variable in `.env`, so a
one-off run needs no edit:

```bash
BUSYBAR_PROGRAM=focus npm run dev
```

## Development

### Requirements

- Node — see [`.node-version`](.node-version) for the expected version

### Setup

Install dependencies:

```bash
npm ci
```

### Common Commands

To type check, lint, and check formatting:

```bash
npm run lint
```

To automatically fix what can be fixed:

```bash
npm run format
```

To run the tests:

```bash
npm test              # once
npm run test:watch    # re-running on change
npm run test:coverage # once, with a coverage report in coverage/
```

Tests are [Vitest](https://vitest.dev). They live in a `__tests__/` directory
beside the code they cover — `src/programs/random-emoji/__tests__/emoji.test.ts`
covers `src/programs/random-emoji/emoji.ts` — and never loose next to the source
file. Fixtures sit in that same `__tests__` folder, beside the suite that uses
them; shared tooling — helpers and factories — goes in `src/test/`.

To build the project:

```bash
npm run build
```

To run the built output:

```bash
npm start
```

To run directly from source with reload on change:

```bash
npm run dev
```

The `dev` script relies on Node's native TypeScript type stripping, so it runs
`src/index.ts` without a separate transpile step. Because of that, relative
imports in `src/` are written with explicit `.ts` extensions; `tsc` rewrites
them to `.js` when it emits to `dist/`.

### Conventions

- ESM throughout (`"type": "module"`)
- Named exports only — no default exports
- Tabs for indentation, double quotes — Prettier runs on its defaults, taking
  the tabs from [`.editorconfig`](.editorconfig). There is no Prettier config
  file.
- ESLint uses [`eslint-config-love`](https://github.com/mightyiam/eslint-config-love)
  as its base

## Version Constraints

Two pieces of tooling are deliberately held back, and Dependabot is configured
to leave them alone:

- **TypeScript is pinned to 6.x.** `typescript-eslint` declares a peer range of
  `>=4.8.4 <6.1.0`, so TypeScript 7 is not usable with the linter yet.
- **ESLint is pinned to 9.x.** `eslint-config-love` declares a peer of `^9.35.0`
  and does not yet accept ESLint 10.

Revisit both when the upstream ranges widen.

## License

[AGPL-3.0](LICENSE)
