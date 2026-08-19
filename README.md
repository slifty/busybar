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
USB-Ethernet adapter at a fixed address — `10.0.4.20` unless `device.address`
says otherwise, and printed on the back cover of the bar — and USB is treated
as a trusted channel, so no token or password is involved. Wi-Fi and cloud
access both need credentials and are not wired up.

## Programs

A **program** is an operating mode — one thing the device is doing. Which
programs run is which of them are listed in the config file:

```yaml
programs:
  focus:
  random-emoji:
```

Naming programs on the command line runs those instead, for one run:

```bash
npm run dev                       # runs what the file lists
npm run dev -- hello-world
npm run dev -- focus random-emoji
```

| Program                                               | What it does                                             |
| ----------------------------------------------------- | -------------------------------------------------------- |
| [`hello-world`](src/programs/hello-world/README.md)   | Scrolls "Hello, World!" across the front display         |
| [`random-emoji`](src/programs/random-emoji/README.md) | Shows a random emoji, changing every five seconds        |
| [`focus`](src/programs/focus/README.md)               | Shows the focus block you are in and the time left of it |
| [`event`](src/programs/event/README.md)               | Interrupts you before an appointment starts              |

Each program documents itself in a `README.md` beside its code, which is where
its settings and the reasoning behind what it draws live.

An unknown name exits with the list of valid ones, and so does the same name
asked for twice.

Everything common to programs lives in the runner: connecting, drawing, waiting
until a program wants to draw again, tolerating preemption, putting failures on
the display, listening to the bar's buttons, and clearing it on the way out. A
program supplies a name, a description, and a `draw` function. Adding one means
adding a folder under `src/programs/`, a single entry in
`src/programs/index.ts`, and a `README.md` in the folder linked from the table
above.

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

`event` is the one program that makes that claim. It draws at 91, one above an
active BUSY or CUSTOM session, so an appointment alert interrupts everything
including a focus session you started — for the five or thirty minutes it is up,
and not a moment longer, since the alert takes itself down once it is answered
or has run out of time. Running it alongside `focus` is what it is for.

**An interrupting program has to hand the screen back.** The device does not
cover the elements underneath a higher-priority draw — it destroys them, and
never puts them back. The program underneath cannot tell, since its own draw
succeeded and it will not draw again until whatever it scheduled comes round. So
a program that stops occupying the display says so, and the runner draws every
other program immediately. Without it, acknowledging a meeting alert leaves the
bar blank until `focus` next has a reason of its own to draw.

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

### Pressing the bar

A program can react to the bar's three buttons as well as to the clock, by
declaring an `onButton` handler. `event` is the one that does: a press answers
the alert on screen, which stops the sound and takes it down.

The runner owns one connection for the whole process and opens it only if some
program declares a handler, so a run with nothing listening never opens a socket
at all. Every listening program then hears every press — the device has three
buttons and no notion of what is on screen, so deciding whether a press is
anything to do with you is the program's own business, and the honest answer is
usually no.

This is the only part of the tool that is not HTTP. `POST /api/input` sends a
keypress _to_ the bar and nothing reports one coming back, so presses are read
off the device's own state stream — protobuf over the WebSocket at
`/api/status/ws`. `busy-lib` wraps that stream in a `SharedWorker` and is
therefore browser-only, but the protocol underneath is not:
[`src/input/`](src/input/) connects with a plain `WebSocket` and decodes the four
fields a press occupies without a protobuf runtime.

Losing that connection costs acknowledgement and nothing else. Everything a
program draws, and any sound it plays, is HTTP — so a bar whose buttons cannot be
heard behaves exactly as it would otherwise, and the runner keeps reconnecting in
the background while it says so once in the log.

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
gives up a pixel of its progress line at twenty-seven more — and redrawing is not free,
since it restarts scroll animations. Asking to be woken at the exact moment
something changes keeps the screen correct without redrawing to check.

## Configuration

Everything configurable lives in one file, `local/config.yml`:

```bash
cp config.example.yml local/config.yml
```

```yaml
device:
  address: 10.0.4.20

programs:
  focus:
    calendar: https://calendar.google.com/calendar/ical/…/basic.ics
    file: local/focus.json
  random-emoji:
```

A program runs because it is listed under `programs`, and is configured by what
is written under it. Comment a block out to stop running it and its settings
stay where you left them. What a given program takes is in [its own
README](#programs).

[`config.example.yml`](config.example.yml) is committed and is the catalogue:
every setting, with its default, in a block per program — add to it whenever a
program gains a setting, so there is one place to discover what can be set. The
copy in `local/` is git-ignored along with everything else in there, which is
where a secret calendar address belongs.

YAML rather than JSON because a setting is worth a sentence of explanation, and
the sentence should live in the file you are editing rather than in a separate
example you have to diff against. Reading it is the one dependency this adds.

Running with no config file at all is fine. Every setting has a default, and
the tool says which file it did not find on the way past.

Two things are decided on the command line rather than in the file, because
they cannot be in it:

```bash
npm run dev -- focus                # run these programs, whatever the file lists
npm run dev -- --config other.yml   # read settings from somewhere else
npm run dev -- --help
```

Settings are read once, at startup. What a program works _from_ is re-read as
it goes — `focus` reads its schedule on every draw, because something else is
writing it — but the configuration is the tool's own, and a setting that
changed under a running process would leave the log describing a run that is no
longer happening. Restart to change one.

Unknown settings are refused rather than ignored: a program is held to the
settings it read, so `calender` stops that program with a message naming what
it should have said. A misspelling that was quietly accepted would be a line in
the file that plainly says what the bar should do while doing nothing at all.

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
