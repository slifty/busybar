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

A **program** is an operating mode — one thing the device is doing. Pick one,
or several, with the `BUSYBAR_PROGRAM` environment variable:

```bash
npm run dev                              # runs the default
BUSYBAR_PROGRAM=hello-world npm run dev
BUSYBAR_PROGRAM=focus,random-emoji npm run dev
```

| Program        | What it does                                             |
| -------------- | -------------------------------------------------------- |
| `hello-world`  | Scrolls "Hello, World!" across the front display         |
| `random-emoji` | Shows a random emoji, changing every five seconds        |
| `focus`        | Shows the focus block you are in and the time left of it |

An unknown name exits with the list of valid ones, and so does the same name
asked for twice.

Everything common to programs lives in the runner: connecting, drawing, waiting
until a program wants to draw again, tolerating preemption, putting failures on
the display, and clearing it on the way out. A program supplies a name, a
description, and a `draw` function. Adding one means adding a folder under
`src/programs/` and a single entry in `src/programs/index.ts`.

### Running several at once

Programs in a list run independently: none of them is told about the others,
they do not take turns, and each keeps its own schedule. There is only one
72×16 display between them, so what is actually on it at any moment is decided
by **priority** — a number in `[1, 100]` that a program can declare and
otherwise gets the default of 50.

The device gives the screen to the highest priority asking for it and answers
everyone else with a 409, which the runner treats as preemption: it says so
once and keeps trying, so the moment the interrupting program stops drawing,
the one underneath takes the screen back within a few seconds. That is the
whole of the arbitration, and it means a raised priority is a claim worth
making only for a program that speaks rarely and briefly — a meeting about to
start — rather than one that is always on.

Two consequences worth knowing before writing a list:

- **Equal priorities do not share the screen.** The device settles a tie in
  favour of whichever application is already drawing, so two ordinary programs
  run together leave the second one preempted for as long as the first keeps
  its elements up. Running `focus` and `random-emoji` together is a way to
  watch that happen, not a way to see both.
- **A program that cannot start does not stop the rest.** Its reason goes to
  the log and its red `ERROR` goes on the bar, under its own name and at its
  own priority, and the programs that did start carry on. The failure stays on
  screen, which for an ordinary program means the survivors of equal priority
  stay preempted behind it — a broken program is not quietly replaced by a
  working one. If nothing at all starts, the tool exits with the reason.

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
  alongside it. An error laid over a drawing that is already using the 72×16 it
  was given leaves neither of them readable. This means a
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

A failure during startup is left on screen deliberately. That program will not
run again, so nothing is coming to clear it, and a program that never started
is precisely when the display must not look ordinary. The next run clears it.

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
currently in: what you are doing on the left, and how long is left of it
counting down on the right, inside a coloured frame. Between blocks the bar
shows nothing and the built-in clock has the screen back.

```
┌────────────────────────────────────┐
│                                    │
│      Deep Work            44:59    │
│                                    │
└────────────────────────────────────┘
```

The colour says where you are in the block:

| Colour | When                                     |
| ------ | ---------------------------------------- |
| Blue   | The first 15 minutes — settling in       |
| Green  | The middle                               |
| Orange | The last 15 minutes — time to wrap it up |

The colour is the frame and the clock; the name itself is always white. A phase
colour on the text would dim the one thing you are trying to read — orange
lettering at wind-down worst of all — whereas a frame changing colour is
visible from further away than the words are, and costs the words nothing.

The clock takes the right quarter of the display, and the name gets the rest.
That is the countdown's real width rather than a proportion picked by eye: it
is drawn by the device in a fixed monospaced face, 17px as `MM:SS`, and 27px
once the hours appear. A block with more than an hour left therefore gives the
name ten pixels less, and takes them back at the hour mark.

A block shorter than half an hour qualifies for both ends at once. Orange wins
there, on the grounds that being told to wrap up is worth more than being told
you have just started, so a twenty-minute block reads blue for five minutes and
orange for fifteen.

### The schedule

Blocks come from a calendar, or from a JSON file when no calendar is set.
Whichever it is, it is the only part of the program that knows where blocks
come from: everything above it — resolving overlaps, picking the current block,
colouring it, drawing it — is written against a schedule rather than against a
source.

#### From a calendar

Point `BUSYBAR_FOCUS_CALENDAR` at an iCalendar feed, as either an `https` URL
or a path to an `.ics` file:

```bash
BUSYBAR_FOCUS_CALENDAR=https://calendar.google.com/calendar/ical/…/basic.ics
BUSYBAR_FOCUS_CALENDAR=local/focus.ics
```

The two are told apart by parsing the value as a URL rather than by looking for
a slash or a dot, so `local/focus.ics` stays a path and anything with an `http`
or `https` scheme is fetched. A URL is fetched afresh on each read, with a ten
second timeout.

In Google Calendar both come from the settings page of the calendar itself:
**Secret address in iCal format** is the URL, and **Export calendar** downloads
a zip with an `.ics` inside it. Prefer the URL. A downloaded file is a snapshot
and goes stale the same way a hand-written schedule does, which is the whole
problem a calendar is meant to solve. The secret address is a credential —
anyone holding it can read the calendar — so it belongs in `.env`.

One calendar is read, and every event in it is treated as a focus block. That
is what makes a calendar kept for this purpose work and a general-purpose one
not: a calendar with your dentist in it will put your dentist on the bar.

Recurring events are expanded properly, which means the parts that make
recurrence real rather than nominal: an occurrence you dragged to a different
time comes back moved, one you renamed comes back renamed, and one you deleted
does not come back. Times written in a named timezone are resolved against the
calendar's own definition of that zone, so a feed from a machine in another
timezone lands at the right hour rather than being read as UTC.

Four kinds of event are skipped rather than drawn, quietly, because a calendar
is not written for this tool and one odd entry in it should not take the whole
schedule down:

| Skipped                                | Why                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| All-day events                         | They run midnight to midnight, and by the overlap rule below a single one would suppress every real block that day |
| Events the calendar has cancelled      | The calendar already says they are off                                                                             |
| Events ending no later than they start | Nothing to count down to                                                                                           |
| Titles with nothing drawable           | A name is the whole of what a block says, and a blank row says nothing                                             |

Only what falls near now is read — from a day back to two days ahead. The
lookback exists to catch a block that started before now and is still running;
the horizon is what a recurring event has to be expanded up to, since a rule
with no end describes infinitely many occurrences.

#### From a file

Without a calendar, blocks are read from a JSON file — `local/focus.json`, or
wherever `BUSYBAR_FOCUS_FILE` points. `local/` is git-ignored wholesale, since a
schedule of what you are doing all day belongs to one machine rather than to the
repository:

```json
[
	{
		"name": "Deep Work",
		"start": "2026-08-07T09:00:00Z",
		"end": "2026-08-07T10:30:00Z"
	}
]
```

It predates the calendar reader and stays because a schedule you can type in a
text editor is the fastest way to try something without exporting anything. It
is stricter than the calendar: a block it cannot make sense of stops the tool
rather than being skipped, because a file you wrote yourself getting something
wrong is a mistake worth hearing about.

#### The file when a calendar is set

Setting a calendar turns this file around: it is written on every start rather
than read, with whatever the calendar said.

Nothing reads it while a calendar is set, so it is not a cache — it is there to
be looked at. A schedule file is the first thing anyone opens to answer "what
is the bar working from?", and one left saying something the bar stopped
showing weeks ago answers it wrongly and convincingly. Keeping it current costs
one write per start and removes a way to be misled.

What lands in it is what the bar will draw, not what the calendar holds: names
already reduced to what the fonts can render, all-day and cancelled events
already dropped, and only the blocks near enough to now to matter. So unsetting
the calendar leaves a working schedule behind rather than an empty file — which
is also the way to go back to editing it by hand, since a start with a calendar
set will otherwise overwrite whatever you typed.

If the file cannot be written — a directory that is not there, a permission
that is not given — the tool says so and carries on. It reads the calendar
directly and does not need this file to work.

#### Overlaps

Overlapping blocks are neither merged nor trimmed. The one that starts earlier
wins and the other is ignored outright, with ties settled by the order they were
read in. Blocks that merely touch both survive, since a block is half-open: one
ending at 10:00 has released the screen before one starting at 10:00 claims it.

Names are drawn as text, and the device's fonts are bitmap ASCII, so anything
outside printable ASCII — em dashes, curly quotes, emoji — is dropped from a
name before it is drawn. A name left with nothing drawable at all is an error
rather than a blank row.

#### Names that do not fit

A name is never scrolled. Scrolling turns a thing you glance at into a thing
you wait for, and it is undone by every redraw besides, since the animation
starts again from the beginning.

Instead the name is sized to the space it has. Every font the device ships was
measured — how wide each character comes out, and which rows its ink occupies —
so the program can pick the largest one the name fits in, break it across two
lines at a space when one line will not do, and centre what it ends up with on
the ink it actually has rather than on the font's nominal height. A short name
gets a large one; a long one gets smaller type and a second line.

A name too long for even that is cut at a space and ends in an ellipsis, so the
bar says that there was more rather than quietly showing you part of something.

A schedule that is missing or malformed at startup stops the tool with the
reason. The alternative is a bar that sits dark all day while the explanation
scrolls past in a log. Once running, the same problem is only a failed draw,
retried on the runner's short delay — the source belongs to whatever is writing
it, so finding it mid-write, or finding the network down, is a moment to wait
out rather than to exit on. It is also drawn on the bar; see
[When something goes wrong](#when-something-goes-wrong).

### Keeping up with a source that changes

Blocks are timestamps, not times of day, so a schedule is only ever about the
days it actually names. That makes the schedule something to keep current rather
than to write once, and the program is built to be read from while something
else is writing to it.

The schedule is read on every draw, not held from startup. A process left
running overnight therefore picks up a new day's blocks on its own, and a block
added, moved, or cancelled during the day takes effect at the next draw without
a restart. With a calendar URL that is the whole of the sync: there is no cache
and no separate process, because a read costs one request a handful of times a
day.

Between blocks, the program will not go more than fifteen minutes without
looking at the file again, even when the next block it can see is hours off —
otherwise a block added ahead of that one would be missed, and a schedule that
had run out would never be looked at again. Nothing is on screen at those
moments, so the wake-up costs a file read and no device traffic.

That cap deliberately does not apply while a block is showing. A change to a
block already on screen is picked up at its next colour change rather than
immediately, since waking up more often to find nothing has changed is traffic
spent on nothing.

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

What is left is a handful of draws for a typical block: one when it starts, one
when it turns green, one when it turns orange, and one at the hour mark if it
is long enough to have started with the hours showing — that being when the
clock narrows and the name can have the room back. The program asks to be woken
at exactly those moments rather than polling to find them, because a poll would
be a request every few seconds to redraw something that had not changed.

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
