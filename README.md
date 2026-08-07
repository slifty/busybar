![CI](https://github.com/slifty/busybar/actions/workflows/ci.yml/badge.svg)

# busybar

A personal tool for interfacing with a [BUSY Bar](https://busy.app) — a
productivity multi-tool with an LED pixel display, a built-in Pomodoro timer,
and a small app platform.

The BUSY Bar exposes an [HTTP API](https://docs.busy.app/bar/dev/http-api) and
publishes an official TypeScript library,
[`@busy-app/busy-lib`](https://www.npmjs.com/package/@busy-app/busy-lib), which
is what this project intends to build on.

> **Status:** scaffolding only. The tooling, CI, and dependency automation are
> in place; nothing talks to a device yet.

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
- Tabs for indentation, single quotes, enforced by
  [`.editorconfig`](.editorconfig) and Prettier
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
