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

Configuration is environment variables, loaded from `.env` by Node itself —
`npm run dev` and `npm start` pass `--env-file-if-exists=.env`. There is no
`dotenv` dependency and there should not be one.

- **`--env-file-if-exists`, not `--env-file`.** The latter exits non-zero when
  the file is missing, which would make a `.env` mandatory. Every setting has a
  default, so it must not be.
- **A variable already in the environment wins over `.env`.** That is what
  makes `BUSYBAR_PROGRAM=focus npm run dev` work without editing anything.
- **Tests never see `.env`.** Vitest does not load it into `process.env`, so a
  developer's local settings cannot change what the suite does. Tests that care
  about a variable set it themselves with `vi.stubEnv`.
- **Every variable is prefixed `BUSYBAR_`**, and anything belonging to one
  program carries that program's name too — `BUSYBAR_FOCUS_FILE`. Core settings
  are read in `src/config.ts`; a program's own settings are read inside that
  program's folder, never centrally.

`.env.example` is committed and is the catalogue: one block per program, every
variable with its default. `.gitignore` ignores `.env` and `.env.*` but
re-includes `.env.example`. Adding a setting without adding it there leaves it
undiscoverable, so treat the two as one change.

## Project Structure

```
src/
├── config.ts       # Device address, draw priority, display geometry
├── display.ts      # Shared display helpers (clear, preemption detection)
├── index.ts        # Entry point: resolves the program, connects, hands off
├── program.ts      # The Program contract, including how a draw schedules the next
├── runner.ts       # Runs a program until interrupted, then cleans up
├── constants/
│   └── time.ts         # Universal constants, not device- or program-specific
├── test/               # Test tooling: helpers and factories
└── programs/
    ├── index.ts        # Registry: name -> program
    ├── focus/
    │   ├── blocks.ts   # Reads and validates the JSON schedule
    │   ├── focus.ts    # A focus block, its phases, and their colours
    │   ├── index.ts    # Draws the active block and schedules the next draw
    │   └── schedule.ts # Overlap resolution and block lookup
    ├── hello-world/
    │   └── index.ts    # Scrolling greeting
    └── random-emoji/
        ├── emoji.ts    # The firmware's built-in emoji sprites
        └── index.ts    # Picks one at random on a schedule
```

`src/constants/` is for genuinely universal values (unit conversions and the
like). Device facts belong in `src/config.ts`; anything only one program cares
about belongs in that program's folder.

`local/` is git-ignored wholesale and holds anything personal to one machine —
`focus.json` today, and credentials or caches when a program needs them. Put
runtime state there rather than adding a `.gitignore` entry per file.

The tool runs one **program** at a time — an operating mode — chosen by the
`BUSYBAR_PROGRAM` environment variable and defaulting to `hello-world`.

Core code sits at the root of `src/`; each program gets its own folder under
`src/programs/`. A program declares a `name`, a `description`, and a `draw`
function. The runner owns everything common: the first draw, waiting for the
next one, tolerating HTTP 409 preemption, holding the event loop open, retrying
after a failure, and clearing the display on exit.

**Programs schedule themselves.** `draw` returns a `DrawResult`, whose
`nextDrawInMs` says how long the runner should wait before drawing again.
Returning `{}` means "do not come back". There is no fixed poll interval,
because the moments that matter are rarely evenly spaced and redrawing costs
something (see below). A draw that _fails_ is retried on the runner's own short
delay instead, since the program never got to say what it wanted.

**Preparation that can fail belongs in `start`.** A program may declare an
optional `start`, run once before the first draw. Failing there is fatal and
exits the tool with the reason, unlike a failed draw, which is retried — the
distinction being that a draw fails for reasons that pass (a focus session owns
the screen) whereas preparation fails because the program cannot work at all (a
missing schedule file). `focus` uses it to read and validate its blocks.

Two things to keep in mind when adding one:

- **`name` doubles as the device-side application name**, so it has to match
  `^[a-zA-Z0-9._-]+$`. Elements are namespaced by it, which is what lets the
  runner clear one program without disturbing anything else.
- **Ask for the next draw only when something will actually change.** Redrawing
  restarts animations, so a program whose output the device sustains on its own
  (a scroll, an animation, a countdown) should draw with `timeout: 0` and
  return `{}` rather than waking up to redraw the same thing.

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
  all, clamps at `00:00` rather than going negative, and widens to `H:MM:SS`
  past an hour, which still fits 72px. There is no `font` option — the face is
  fixed, and about ten pixels tall.
- **`tiny` fits 18 characters across the front display.** Its widest glyph is
  four pixels, so 18 of them exactly fill 72px. It pairs with a countdown
  underneath inside the 16px height. Text wider than the display is clipped at
  both ends unless the element is given a `width`, which makes it scroll
  instead.
- **Redrawing restarts animations.** Reusing an element `id` replaces the
  element rather than stacking a second one, but a scrolling text element
  restarts its scroll from the beginning. Draw-once plus `timeout: 0` is the
  way to keep a smooth scroll.
- **Frame grabs are base64 BGR.** `/api/screen?display=0` returns a base64 body
  that decodes to 72x16x3 bytes in BGR order, despite the spec advertising
  `image/bmp`. The back display is 160x80.
- **Errors are plain `Error`s.** `busy-lib` attaches `status`, `statusText`,
  and `body` via `Object.assign` and exports no error class, so HTTP status has
  to be read off an `unknown` by duck typing.
- **A signal handler does not keep Node alive.** Registering `SIGINT` is not
  scheduled work, so a program that draws once and waits needs a timer (or
  similar ref'd handle) to hold the event loop open.

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
- **Fake the clock, not the event loop.** Anything reading `new Date()` gets
  `vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime(...)`. Faking
  timers wholesale would stall the real file reads these suites await.
- **Prefer a real temporary file to a mocked `fs`.** `blocks.test.ts` writes
  schedules into a `mkdtemp` directory and points `BUSYBAR_FOCUS_FILE` at them
  with `vi.stubEnv`. Reading and validating a file is the entire job of that
  module, so mocking the filesystem would leave the part worth testing
  untested — and it lets the suite pin down the exact error message a mistyped
  schedule produces.

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
