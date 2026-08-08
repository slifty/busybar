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

| Program        | What it does                                      |
| -------------- | ------------------------------------------------- |
| `hello-world`  | Scrolls "Hello, World!" across the front display  |
| `random-emoji` | Shows a random emoji, changing every five seconds |

An unknown name exits with the list of valid ones.

Everything common to programs lives in the runner: connecting, drawing,
refreshing on a schedule where a program asks for one, tolerating preemption,
and clearing the display on the way out. A program supplies a name, a
description, a `draw` function, and optionally a refresh interval. Adding one
means adding a folder under `src/programs/` and a single entry in
`src/programs/index.ts`.

## Hello, World

The default program scrolls "Hello, World!" across the front display and leaves
it there until you stop it with Ctrl-C.

Two properties of the device shape how this works:

- **The greeting is drawn once, not on a loop.** Elements normally carry a
  timeout and expire, but a timeout of `0` means the element stays until it is
  cleared. That matters here because redrawing an element restarts its scroll
  animation, so a redraw loop would jerk the text back to the start on every
  tick.
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

Unlike the greeting, this one does refresh on a schedule, since the point is
that the picture changes. Its elements expire after twice the refresh interval,
so a single failed draw leaves the previous emoji up rather than blanking the
screen.

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
