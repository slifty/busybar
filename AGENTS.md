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

## Project Structure

```
src/
├── config.ts       # Device address, draw priority, greeting appearance
├── display.ts      # Draw and clear calls against the front display
└── index.ts        # Entry point: connects, draws, cleans up
```

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
- **Draws are preempted by priority.** A draw is accepted when its priority is
  at least that of the app currently on screen. Built-in apps sit at 10, an
  active BUSY or CUSTOM focus session at 90, and the API default is 50. Losing
  the race returns HTTP 409, so anything long-running has to expect it.
- **Draws expire unless told not to.** Every element carries a `timeout` in
  seconds, where `0` means "never expire", or a `display_until` timestamp.
  Anything drawn with a real timeout has to be redrawn to persist.
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
- `build` — verifies `npm run build` succeeds

`.github/workflows/auto-merge.yml` enables auto-merge on Dependabot PRs once
checks pass.

Test jobs will be added when there are tests.

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
