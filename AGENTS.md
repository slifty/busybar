# Agent Guide for busybar

This document provides context for LLM agents contributing to the `busybar`
repository.

## Project Overview

`busybar` is a personal TypeScript tool for interfacing with a
[BUSY Bar](https://busy.app), a desk device with an LED pixel display, a
Pomodoro timer, and a small app platform.

**Key Technologies:**

- Node.js (see `.node-version` for the current version) with TypeScript
- ESM throughout — `package.json` sets `"type": "module"`
- ESLint (flat config) with `eslint-config-love` as the base
- Prettier for formatting
- Vitest for tests

For specific dependency versions, consult `package.json`.

**Status:** early. Tooling, CI, and dependency automation are in place, and the
tool talks to a real device: `npm run dev` scrolls "Hello, World!" across the
front display over USB.

## The BUSY Bar SDK

The intended integration path is the official library,
[`@busy-app/busy-lib`](https://www.npmjs.com/package/@busy-app/busy-lib)
(source: https://github.com/busy-app/busylib-ts). It ships three modules, and
only one of them is usable from Node:

| Module           | Transport                | Runtime                       |
| ---------------- | ------------------------ | ----------------------------- |
| `BusyBar`        | HTTP (`fetch`)           | Node **and** browser          |
| `StateStream`    | WebSocket + protobuf     | Browser only (`SharedWorker`) |
| `ScreenRenderer` | WebGL2 onto a `<canvas>` | Browser only (needs `window`) |

Anything running in this project's Node process should use `BusyBar`. Do not
reach for `StateStream` or `ScreenRenderer` here without first solving the
browser-runtime dependency — the upstream README is explicit that a Node
implementation of `StateStream` is possible but not planned.

`BusyBar` connects to a device address (defaulting to `http://10.0.4.20` over
USB-Ethernet), or to `https://api.busy.app` with a bearer token for remote
proxy access. Local network access may additionally require an HTTP access
password. Every method is async and may reject — see the upstream README for
the error taxonomy (HTTP errors, `TimeoutError`, `AbortError`, native `fetch`
failures).

Reference documentation: https://docs.busy.app/bar/dev/http-api

## Quick Reference Commands

```bash
# Install dependencies
npm ci

# Run from source with reload on change
npm run dev

# Lint everything (eslint, prettier, tsc)
npm run lint

# Auto-fix formatting and fixable lint errors
npm run format

# Run the tests once
npm test

# Re-run tests on change
npm run test:watch

# Run the tests with a coverage report
npm run test:coverage

# Build to dist/
npm run build

# Run the built output
npm start
```

## After Making Changes

**Always run the formatter and linter after making ANY changes, including
documentation, configuration, and JSON files:**

```bash
# Auto-fix formatting issues (run this first)
npm run format

# Check for remaining problems
npm run lint
```

`npm run format` fixes Prettier formatting and ESLint auto-fixable rules
(including import ordering). `npm run lint` additionally runs `tsc --noEmit`
against `tsconfig.dev.json`.

## Configuration

Configuration is one YAML file, `local/config.yml`, read by `src/config/`.
There are no environment variables, no `.env`, and no second place a setting
can come from — that is the point of it, and adding one back would undo it.

```yaml
device:
  address: 10.0.4.20

programs:
  focus:
    calendar: https://…/basic.ics
    file: local/focus.json
  random-emoji:
```

- **The `programs` block is both the run list and the settings.** A program
  runs because it is listed there, and what is written under it is its block.
  The names are resolved by `resolvePrograms` in `src/programs/index.ts`, where
  an unknown or repeated name rejects the whole list rather than running the
  part that parsed, and an empty list falls back to the default program rather
  than running nothing.
- **The command line decides only what the file cannot.** Programs named there
  run instead of the listed ones for that run (`npm run dev -- focus`), and
  `--config <file>` reads settings from somewhere else. See `src/cli.ts`.
  Anything else worth setting is worth writing down where it can carry a
  comment.
- **Nothing is mandatory.** Every setting has a default and a missing file is
  ordinary, so the tool runs with no configuration at all. A file named with
  `--config` is the exception: asking for one by name and silently getting the
  defaults would answer a question nobody asked.
- **Read once, at startup.** What a program works _from_ is re-read as it goes
  — `focus` reads its schedule on every draw, because something else writes it
  — but the configuration is the tool's own and does not change under a running
  process.
- **A program reads its own settings, from `ProgramContext.config`.** Nothing
  central knows what `focus` takes. They go in a `settings.ts` beside the
  program, so "what can this be told to do?" is one file rather than a search.
- **Read them in `start`.** The runner calls `done()` on the block once
  preparation is over, which refuses any key the program did not read. A
  setting first read during a draw is one the file would be told it does not
  have.
- **Every value goes through `ConfigSection`** (`src/config/section.ts`) rather
  than being pulled out of a plain object: it carries where a value came from
  into the message about it, treats a blank as absent, and is what remembers
  which keys were read. `src/test/config.ts` builds one from a literal, which
  is how a suite configures a program without a file.

`config.example.yml` is committed at the root and is the catalogue: one block
per program, every setting with its default and the prose explaining it. Adding
a setting without adding it there leaves it undiscoverable, so treat the two as
one change. `local/` is git-ignored wholesale, which is why the real file lives
there — a secret calendar address is a credential.

Facts about the hardware — the default address, the default draw priority, the
display geometry — are not configuration and live in
`src/constants/device.ts`.

## Project Structure

```
src/
├── cli.ts          # The command line: which config file, which programs
├── display.ts      # Shared display helpers (clear, preemption detection)
├── errors.ts       # Turns a thrown thing into a line, causes and all
├── fonts.ts        # Measured font and countdown metrics
├── index.ts        # Entry point: reads settings, resolves the programs, hands off
├── program.ts      # The Program contract, including how a draw schedules the next
├── runner.ts       # Runs programs until interrupted, then cleans up
├── text.ts         # Fits a string into a region: picks a font, wraps, places
├── config/
│   ├── index.ts        # Reads local/config.yml into settings, once
│   └── section.ts      # A block of it: typed reads, where they came from, what was never read
├── constants/
│   ├── device.ts       # Default address, default draw priority, display geometry
│   └── time.ts         # Universal constants, not device- or program-specific
├── test/               # Test tooling: helpers and factories
└── programs/
    ├── index.ts        # Registry: name -> program, and what a list of names resolves to
    ├── focus/
    │   ├── README.md   # What it draws and why, its schedule sources, its settings
    │   ├── blocks.ts   # Picks the source, reads it, mirrors a calendar to the file
    │   ├── calendar.ts # Turns an iCalendar feed into blocks
    │   ├── focus.ts    # A focus block, its phases, and their colours
    │   ├── index.ts    # Draws the active block and schedules the next draw
    │   ├── name.ts     # Drops what the bitmap fonts cannot draw
    │   ├── schedule.ts # Overlap resolution and block lookup
    │   └── settings.ts # What this program can be told to do
    ├── hello-world/
    │   ├── README.md   # What it draws and why
    │   └── index.ts    # Scrolling greeting
    └── random-emoji/
        ├── README.md   # What it draws and why
        ├── emoji.ts    # The firmware's built-in emoji sprites
        └── index.ts    # Picks one at random on a schedule
```

`src/constants/` is for values that were measured or given rather than decided:
unit conversions in `time.ts`, facts about the hardware in `device.ts`. The
measured font and countdown metrics belong to the same family but are bulky
enough to have `src/fonts.ts` to themselves; anything only one program cares
about belongs in that program's folder, and anything somebody chose belongs in
the config file.

`local/` is git-ignored wholesale and holds anything personal to one machine —
`config.yml` and `focus.json` today, and credentials or caches when a program
needs them. Put runtime state there rather than adding a `.gitignore` entry per
file.

`tools/` is the opposite: committed scripts that talk to a device but are not
part of the build, and are run by hand with `node tools/<name>.ts`. They are
what regenerates the tables in `src/fonts.ts` and what shows a layout without
waiting for the schedule to reach an interesting moment. ESLint only covers
`src/`, so these are held to Prettier and nothing else.

**Invented data never goes in `local/`, and never wears a real name.** A
made-up schedule written to `local/focus.json` is indistinguishable from the
real one at a glance, and a made-up block called "Standup" is indistinguishable
from a real meeting — so the bar ends up reporting a day that does not exist,
and every conclusion drawn from it is about nothing. This has already cost
hours once. Test schedules go to a temp directory (`mkdtemp`), under a name
that says what they are, holding blocks named `TEST ...`. Where a fixture has
to be realistic in shape — a length, a descender, a word too long to break —
keep the shape and change the words. The same applies to verifying anything
that writes a file: point it at a scratch path, never at the configured one.

A **program** is an operating mode. The tool runs the ones listed under
`programs` in the config file, or the ones named on the command line instead,
defaulting to `hello-world` when neither says anything.

Core code sits at the root of `src/`; each program gets its own folder under
`src/programs/`. A program declares a `name`, a `description`, an optional
`priority`, and a `draw` function. The runner owns everything common: the first
draw, waiting for the next one, tolerating HTTP 409 preemption, holding the
event loop open, retrying after a failure, putting failures on the display, and
clearing it on exit.

**Programs run concurrently and are not coordinated.** Each has its own draw
loop, schedule, application namespace, and log prefix, and none of them is told
about the others. The only thing that decides which is on screen is
`priority` — `DEFAULT_DRAW_PRIORITY` (50) unless a program declares its own —
because the device gives the display to the highest priority asking for it and
409s the rest. A program that outranks another therefore interrupts it for
exactly as long as it keeps drawing, and the runner's retry on preemption is
what hands the screen back afterwards. Equal priorities do not share: the
incumbent application keeps the screen, so two ordinary programs run together
leave the second preempted.

`ProgramContext` carries the resolved `priority`, and every draw uses it —
including `showError`. A program never imports the constant itself, so a
failure is reported as loudly as the program speaks.

**One program failing to start does not stop the others.** `start` failures are
per-program: the reason is logged, the red `ERROR` goes on the bar under that
program's name, and the rest carry on. That failure is deliberately never
cleared — nothing is coming back to clear it — so an ordinary program's failure
does hold the screen against its equal-priority peers, which is the intended
direction. Only when nothing starts at all does the tool exit, carrying the
first reason out with it.

**Failure is drawn, not just logged.** The bar falls back to its clock whenever
nothing is drawn over it, so a broken program and an idle one look the same.
The runner draws a red `<program>: ERROR` on any draw failure that is not
preemption, and on a fatal `start`. Three constraints on that, all from how the
device arbitrates the screen: it goes under the program's own application name
(the device gives a priority tie to the incumbent application, so an error
under any other name is one the program can never draw over); it clears the
program's elements first rather than overlaying them; and it is taken down
before each retry rather than after a success, or it would block the recovery
that clears it. See `showError` in `src/display.ts`.

**Programs schedule themselves.** `draw` returns a `DrawResult`, whose
`nextDrawInMs` says how long the runner should wait before drawing again.
Returning `{}` means "do not come back". There is no fixed poll interval,
because the moments that matter are rarely evenly spaced and redrawing costs
something (see below). A draw that _fails_ is retried on the runner's own short
delay instead, since the program never got to say what it wanted.

**Preparation that can fail belongs in `start`.** A program may declare an
optional `start`, run once before the first draw — all of them at once, so one
program's slow calendar fetch does not hold up another's first draw. Failing
there is fatal to that program, unlike a failed draw, which is retried — the
distinction being that a draw fails for reasons that pass (a focus session owns
the screen) whereas preparation fails because the program cannot work at all (a
missing schedule file). `focus` uses it to validate its schedule, which it then
re-reads on every draw rather than holding from startup — a file someone else
writes has to be read when it is needed, not once. It also uses it to write
that schedule back out when a calendar is what it read: see `mirrorBlocks`.

It is also where a program reads its settings, whether or not it reads them
again later: once `start` is over, the runner holds the program's block to the
keys it asked for and refuses the rest, so a setting first read during a draw
would be reported as one the program does not have.

**A program can log, and should only do so for what it is carrying on from.**
`ProgramContext` carries the runner's own `log`, so a program reports through
the same channel as everything else rather than writing to the terminal on its
own account. The bar is for anything that stops the program working — throw,
and the runner draws it — and the log is for what is worth knowing and not
worth failing over, like a mirror file that could not be written.

Three things to keep in mind when adding one:

- **`name` doubles as the device-side application name**, so it has to match
  `^[a-zA-Z0-9._-]+$`. Elements are namespaced by it, which is what lets the
  runner clear one program without disturbing anything else.
- **Ask for the next draw only when something will actually change.** Redrawing
  restarts animations, so a program whose output the device sustains on its own
  (a scroll, an animation, a countdown) should draw with `timeout: 0` and
  return `{}` rather than waking up to redraw the same thing.
- **Leave `priority` alone unless the program exists to interrupt.** Raising it
  takes the screen from everything below for as long as the program keeps
  drawing, so it belongs to something brief and occasional. A program that is
  always on and outranks the rest is a program that has replaced them.

**Each program documents itself in a `README.md` beside its code**, linked from
the table in the root README: what it draws, why it draws it that way, and what
it can be told to do. The root README keeps only what is common to all of them —
the run list, priority arbitration, failure reporting — so prose about one
program goes in that program's folder rather than being added there. A program's
settings therefore have three homes and all three are one change: `settings.ts`
reads them, `config.example.yml` catalogues them with their defaults, and the
program's README explains them.

The structure will grow as the tool does. Update this section when it does.

## Device Notes

Facts about the hardware that are easy to rediscover the hard way. All verified
against firmware reporting `api_semver` 25.0.0.

- **The device's OpenAPI spec is the authority.** It is served by the bar
  itself at `http://10.0.4.20/openapi.yaml`, with a Swagger UI at `/docs`, and
  describes the exact firmware in front of you. Prefer it over the published
  docs.
- **Text is printable ASCII only.** A text element's content is validated
  against `^[\x20-\x7E]+$` because the fonts are bitmap ASCII. Emoji and
  accented characters cannot be drawn as text — they have to be images.
- **`extra_large` is uppercase-only.** It renders lowercase input as capitals,
  and is wide enough that short strings overflow the 72px front display, which
  is what triggers scrolling.
- **Draws are preempted by priority.** Built-in apps sit at 10, an active BUSY
  or CUSTOM focus session at 90, and the API default is 50. Losing the race
  returns HTTP 409, so anything long-running has to expect it.
- **Equal priority does not win, despite the docs.** The spec says a draw is
  accepted when its priority is `>=` the current app's, and that equal-priority
  requests from a different `application_name` override what is on screen.
  Measured behaviour is stricter: while one application holds the screen at
  priority 50, another application drawing at 50 gets 409, and only 51 or
  higher succeeds. The practical consequence is that a program which exits
  without clearing — especially one holding a `timeout: 0` element, which never
  expires — locks every other program out of the display until something clears
  it. `DELETE /api/display/draw` with no `application_name` clears everything.
- **The firmware ships sprites.** `/ext/apps_assets/shared/images` holds emoji,
  food, hearts, and status icons. Reference them from an image element with
  `stock_path: "shared/<file>.image"`, which skips asset upload entirely.
  `/api/storage/list?path=/ext/apps_assets/shared/images` enumerates them.
- **`opacity` is required by the generated types.** `openapi-typescript` turns
  documented defaults into required properties, so image elements must pass it
  explicitly even though the device would default it.
- **Draws expire unless told not to.** Every element carries a `timeout` in
  seconds, where `0` means "never expire", or a `display_until` timestamp.
  Anything drawn with a real timeout has to be redrawn to persist.
- **`display_until` is the better expiry when the end time is known.** It takes
  a seconds-based Unix timestamp as a string and is mutually exclusive with
  `timeout`. Verified: elements vanish on their own at that instant and the
  built-in clock reclaims the screen, so a process that dies mid-way cannot
  leave a finished thing on display.
- **`countdown` is an element type, and the device ticks it.** It takes
  `timestamp` (seconds-based Unix, as a string), `direction` (`time_left` or
  `time_since`), and `show_hours`. Verified: it counts down with no redraws at
  all, and clamps at `00:00` rather than going negative. There is no `font`
  option — the face is fixed. Measured, it is five pixels tall and monospaced,
  17px wide as `MM:SS` and 27px as `HH:MM:SS`, and its box carries two pixels
  of padding past the last digit, which shows up only when the element is
  right-aligned. `src/fonts.ts` holds those numbers.
- **Text is clipped, not wrapped.** Text wider than the display is cut off at
  both ends unless the element is given a `width`, which makes it scroll
  instead. There is no newline: `\n` is outside the printable range the API
  accepts, so more than one line means more than one element.
- **Redrawing restarts animations.** Reusing an element `id` replaces the
  element rather than stacking a second one, but a scrolling text element
  restarts its scroll from the beginning. Draw-once plus `timeout: 0` is the
  way to keep a smooth scroll.
- **An element `id` outlives the drawing that stopped using it.** Elements go
  away when they expire or are drawn over, and not before, so a drawing made of
  a variable number of elements has to send the same ids every time — with the
  unused ones blanked — or a line from the previous draw stays on screen. A
  text element of a single space is valid and draws nothing.
- **A negative `y` is fine.** Ink sits two or three rows below the y an element
  is drawn at, so placing ink at the top of the display means a y above it. The
  device accepts that rather than clamping.
- **`radius` thickens a thin rectangle's corners before it rounds them.** On a
  1px outline, radius 2 adds a pixel to each side of every corner and rounds
  nothing; only at 3 does it start cutting the corner, at a cost of three
  pixels on a display sixteen tall. Square corners are the sane default here.
- **Frame grabs are base64 BGR.** `/api/screen?display=0` returns a base64 body
  that decodes to 72x16x3 bytes in BGR order, despite the spec advertising
  `image/bmp`. The back display is 160x80.
- **Errors are plain `Error`s.** `busy-lib` attaches `status`, `statusText`,
  and `body` via `Object.assign` and exports no error class, so HTTP status has
  to be read off an `unknown` by duck typing.
- **A signal handler does not keep Node alive.** Registering `SIGINT` is not
  scheduled work, so a program that draws once and waits needs a timer (or
  similar ref'd handle) to hold the event loop open.

## Laying Out the Display

72x16 is small enough that a layout is decided in single pixels, and the API
will not help: it takes a font by name and offers no way to ask how wide a
string will come out, or where its ink will land. Everything below was measured
off a real bar and is written down in `src/fonts.ts` so it never has to be
guessed at again.

**Measure by drawing and reading the frame back.** `/api/screen?display=0`
returns the front display as pixels, so anything about how the device renders
can be settled in a loop: draw, capture, count lit pixels. `tools/` holds the
scripts that produced the tables — `measure-fonts.ts` for advance widths,
`measure-glyph-rows.ts` for the rows each glyph's ink occupies — and
`tools/preview.ts`, which draws the focus program for a set of made-up blocks
and prints the frames as text. Reach for that before reasoning about a layout
in your head; it is faster and it is not a guess.

Two things about measuring that are easy to get wrong:

- **An advance is not the ink.** Take it as `width("cc") - width("c")` so the
  glyph's side bearings cancel, rather than assuming ink starts at the anchor.
  On this device every advance turned out to be the ink plus one pixel of
  spacing, so a string's ink is its advances less one.
- **Pack the measurement, or it takes all afternoon.** Several characters in
  one draw, each in its own column of the display, is one round trip instead of
  five.

**What the fonts measure.** `tiny`, `small`, `normal`, `bold` and `large` are
the useful ones. `condensed` measured identical to `normal` in every glyph, and
`extra_large` renders lowercase input as capitals, which changes what a name
says rather than only how big it is. Ink starts one or two rows below the
element's y; capitals run 4, 5, 7, 7 and 9 rows tall respectively, and
descenders add one or two more. Bracket and quote characters reach a couple of
rows above the capitals and below the descenders, which the tables record but
nothing sizes to — doing so would cost a whole line of text for characters
that never appear in a block name.

**Fit text, do not scroll it.** `src/text.ts` takes a string and a region and
returns the largest font whose wrapped lines fit, along with where to draw each
one. Scrolling turns a thing you glance at into a thing you wait for, and any
redraw restarts it from the beginning. Three rules it follows are worth keeping
if it is ever rewritten:

- **Reject a font that has to break a word**, and try a smaller one instead. A
  broken word is a font that is too big, not a wrap that came out long.
- **Space lines by the nominal box, centre them by the cap band.** The band is
  the tops of the letters down to the line they stand on; a descender is a tail
  hanging off it. Centring on the whole ink instead sits every name carrying a
  tail a row above every name without one, in the same font, on the same bar —
  which reads exactly as it is: wrong. With no tail the band is the ink, so
  this is one rule rather than a rule and an exception.
- **Round the leftover row upwards.** Five rows of digits in ten leaves one
  over and there is no centring it; the only choice is which way it misses.
  Text a row low reads as centred, text a row high reads as a mistake. This
  was measured on the bar, not reasoned about.
- **Lend a padding row to tails.** A region only just deep enough for a font
  has no slack: the tail hits the bottom, the clamp pushes the text back up,
  and the evenness the band bought is lost. `Region.tailRoom` says how many
  rows below itself a descender may reach into — one of the two padding rows,
  here — and nothing but a tail may use it. It is deliberately not counted
  when deciding whether a font fits: a font chosen on the strength of lent
  room would put a tail in the padding on every name that had one.
- **Ask whether the ink fits, not how many lines there are.** A frame and two
  pixels of padding leave ten rows. `large` is eleven rows on paper and nine in
  fact for a name with no descender, so a rule counting nominal line heights
  would never reach for it, and most names would be drawn a size smaller than
  they need to be.

## Code Conventions

### TypeScript

1. **No default exports** — always use named exports

   ```typescript
   // Good
   export { doThing };

   // Bad
   export default doThing;
   ```

2. **No magic numbers** — pull them out into named constants

3. **Import ordering** — auto-sorted: builtin, external, internal, parent,
   sibling, index, object, type. No blank lines between groups.

4. **Explicit return types** — required for all functions (except test files)

5. **Type-only imports** — `verbatimModuleSyntax` is on, so type-only imports
   must use `import type`

### Module system and file extensions

This is an ESM project configured so Node can run the TypeScript sources
directly via native type stripping (`npm run dev`). That imposes two rules:

- **Relative imports carry an explicit `.ts` extension** —
  `import { thing } from './thing.ts'`. `allowImportingTsExtensions` and
  `rewriteRelativeImportExtensions` are enabled, so `tsc` rewrites these to
  `.js` on emit.
- **`erasableSyntaxOnly` is on** — no `enum`, no parameter properties, no
  namespaces with runtime output. Use `const` objects with `as const` and
  union types in place of enums.

### Testing

Vitest, configured in `vitest.config.ts`.

**Tests never live outside a `__tests__` folder.** A test for
`src/programs/random-emoji/emoji.ts` goes in
`src/programs/random-emoji/__tests__/emoji.test.ts` — beside the code it covers,
but in its own directory, never loose next to the source file.

**Fixtures belong to the suite that uses them**, in a `fixtures/` directory
inside that `__tests__` folder — `__tests__/fixtures/valid-schedule.ts`. One
file per fixture, named for what it is rather than for the suite that reads it,
so the import at the top of a test says what the data represents. Keeping them
here means reading a test never sends you across the tree to find out what it
is working with.

**`src/test/` holds tooling — helpers and factories, not fixtures.** The
distinction is reuse and shape: a factory builds a value to order and is worth
sharing across suites, while a fixture is one fixed example that belongs to one
suite. If it takes arguments and several suites want it, it goes in `src/test/`;
if it is a literal that answers "what does a block look like here", it stays
beside the test.

Test files keep the `.test.ts` suffix. Vitest gives `__tests__` no special
meaning of its own — unlike Jest, its matching is suffix-based — so the suffix
is what makes a file run.

The supporting configuration, which has to stay in step with the above:

- `vitest.config.ts` matches `src/**/__tests__/**/*.test.ts`.
- `tsconfig.json` excludes `**/*.test.ts`, `**/__tests__` and `src/test`, so
  no test code reaches `dist/`. It is all still type-checked, by
  `npm run lint:tsc` via `tsconfig.dev.json`, which includes it.
- `eslint.config.mjs` relaxes explicit return types and magic numbers across
  all three of those patterns, so fixtures and factories get the same treatment
  as the suites using them.

Import the helpers explicitly — `import { describe, expect, it } from "vitest"`.
Globals are deliberately off, which keeps tests consistent with the named-export
rule and means nothing is in scope that was not imported. Relative imports carry
the `.ts` extension in tests exactly as they do in `src/`.

#### How the existing suites do it

`src/programs/focus/__tests__/` is the worked example. Four conventions there
are worth copying rather than reinventing:

- **`describe` names the thing under test, `it` finishes a sentence about it.**
  `describe("phaseAt")` with `it("is 14 minutes in -> rampUp")`. Nested
  `describe`s set up a case once — "a block shorter than both bands combined" —
  so the individual assertions stay short.
- **Fake the device, never the network.** `src/test/bar.ts` provides
  `createFakeBar()`, which records what it was asked to draw and hands back
  something cast to `BusyBar`. Only the methods a program actually calls exist,
  so reaching for anything else fails loudly instead of quietly doing nothing.
  Assert against the recorded elements rather than against HTTP.
- **Drive the runner through `src/test/runner.ts`.** It provides a program that
  really draws (`stubProgram`), a run that a test starts, advances, and stops,
  and the queries for what each program drew, cleared, and logged. Two suites
  use it — `runner.test.ts` for one program and `runner-programs.test.ts` for
  several at once — which is why it is tooling rather than a fixture.
- **Fake the clock, not the event loop.** Anything reading `new Date()` gets
  `vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime(...)`. Faking
  timers wholesale would stall the real file reads these suites await.
- **Prefer a real temporary file to a mocked `fs`.** `blocks.test.ts` writes
  schedules into a `mkdtemp` directory and points a settings block built by
  `sectionOf` at them; the config suites do the same with real YAML files.
  Reading and validating a file is the entire job of those modules, so mocking
  the filesystem would leave the part worth testing untested — and it lets a
  suite pin down the exact error message a mistyped schedule produces.

Test the behaviour a caller depends on, not the shape of the implementation.
The suites assert that a short block never reads as settled, that
`nextPhaseChangeAt` always points strictly forwards, and that no two blocks
returned by `withoutOverlaps` overlap — properties that stay true through a
rewrite, and that catch far more than a line-by-line transcription would.

### Coverage

`npm run test:coverage`, via `@vitest/coverage-v8`. Output lands in `coverage/`,
which is git-ignored.

Two settings in `vitest.config.ts` are doing deliberate work, because Vitest 4's
defaults are wrong for this repository:

- **`coverage.include` is set to `src/**/*.ts`.** Left at its default of
  `undefined`, coverage only counts files a test happened to import, so a module
  with no tests at all would be missing from the report rather than showing as
  0% — which flatters the number badly. Setting it explicitly makes untested
  code visible as untested.
- **`coverage.exclude` lists `src/test/**` and `src/**/__tests__/**`.** Vitest
  4 ships an empty default exclude, so without this the helpers in `src/test/`
  would be measured as if they were production code — and they are always fully
  covered by definition, which would inflate the total.

### Formatting

Tabs for indentation, double quotes. Do not hand-format; run `npm run format`.

There is no Prettier config file and no `prettier` key in `package.json`, so
Prettier runs on its defaults. The one thing that shifts those defaults is
`.editorconfig`, which Prettier reads automatically:

- `indent_style = tab` is what produces tabs. Prettier on its own would use two
  spaces.
- `.editorconfig` does not set `quote_type`, so Prettier's default
  `singleQuote: false` stands and strings are double-quoted.

Adding a Prettier config to change this is a deliberate decision, not a
cleanup — it would reformat every file in the repository.

## Version Constraints

Two dependencies are deliberately held back. `.github/dependabot.yml` ignores
major updates for both, and the reasons are worth preserving:

- **TypeScript stays on 6.x.** `typescript-eslint` declares a peer range of
  `typescript: ">=4.8.4 <6.1.0"`. TypeScript 7 exists but the linter cannot
  consume it yet.
- **ESLint stays on 9.x.** `eslint-config-love` declares a peer of
  `eslint: "^9.35.0"`, so ESLint 10 is out of reach until that widens.

If you are asked to upgrade either, verify the upstream peer ranges first
rather than assuming they have moved.

## CI

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests, with
one job apiece for:

- `actionlint` — workflow file validity
- `npm-install` — verifies `package-lock.json` is in sync with `package.json`
- `eslint`, `prettier`, `tsc` — the three parts of `npm run lint`
- `test` — runs `npm run test:coverage` and uploads the result to Codecov
- `build` — verifies `npm run build` succeeds

**The Codecov upload is skipped for Dependabot.** The step carries
`if: github.actor != 'dependabot[bot]'`, and that is not a preference so much as
a requirement: GitHub runs Dependabot-triggered workflows without access to
repository secrets, so `CODECOV_TOKEN` would be empty and the upload would fail.
The tests themselves still run on those pull requests — only the upload is
skipped. `fail_ci_if_error` is on, so a genuinely broken upload fails the job
rather than passing silently; turn it off if Codecov outages become a nuisance.

`.github/codecov.yml` sets both the project and patch statuses to
`informational`, so Codecov reports a number without ever blocking a merge —
appropriate while the suite is empty and every patch would otherwise fail a
coverage gate. It also re-states the `src/test` and `src/**/__tests__`
exclusions that `vitest.config.ts` already applies, so the two cannot drift into
disagreeing about what counts as covered code.

## Maintaining This Document

Keep this document current as the codebase evolves. Update it when:

- New patterns or conventions are established
- The project structure changes
- New npm scripts or CI jobs are added
- Version constraints are lifted or added

**Guidelines for updates:**

- Keep the document user-agnostic (no local paths or developer-specific
  references)
- Reference version files (`.node-version`, `package.json`) rather than
  hardcoding versions
- Remove outdated information rather than letting it accumulate
