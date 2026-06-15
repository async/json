# Repository Guide For AI Agents

## Project Shape

This repo is a dependency-light Node.js ESM package named `@async/json`.

Core responsibilities:

- Open a `.json` file as a collection or document database.
- Open a folder of `.json` files as a small database with named resources.
- Keep source JSON as seed data by default, with writable sidecar state under
  `.async-json/state`.
- Provide explicit source-write mode with `writes: 'source'`.
- Provide local query helpers, atomic JSON state writes, WAL/version helpers,
  recovery, encryption hooks, and declared local indexes.
- Provide an optional RedisJSON-style adapter from `@async/json/redis` without
  a mandatory Redis dependency.

Relationship to `@async/db`:

- `@async/json` owns direct JSON file/folder runtime storage.
- `@async/db` owns readers, schemas, generated types, REST/GraphQL,
  operations, lifecycle, store selection, and graduation to Redis/SQLite/Postgres/custom stores.
- Keep `@async/db/json` as a compatibility re-export in the `@async/db` repo.

Important files:

- `src/index.ts`: standalone file/folder API and collection/document runtime.
- `src/storage.ts`: JSON state paths, atomic writes, versioning, recovery, encryption, and storage helpers.
- `src/query.ts`: local collection query evaluator.
- `src/redis.ts`: optional RedisJSON-style adapter.
- `api-contract.json`: public API contract manifest.
- `API_SURFACE.md`: generated public surface ledger.
- `pipeline.ts`: source of truth for generated GitHub Actions.
- `tests/*.test.js`: Node test runner suite.

## Commands

Use these while actively editing the package:

```bash
pnpm run build
pnpm run test
pnpm run api-surface:check
pnpm run pipeline:sync:check
pnpm run pipeline:github:check
pnpm run pipeline:pages
```

Run this before handing off releaseable changes:

```bash
pnpm run release:check
```

Useful direct checks:

```bash
npm pack --dry-run
node --test tests/*.test.js
```

## Generated Files

`dist/` is build output and stays uncommitted.

`.async/pages/` is generated GitHub Pages output and stays uncommitted.

`.async/`, `.async-json/`, `node_modules/`, and `*.tgz` are local runtime,
cache, dependency, and package output and stay uncommitted.

`.github/workflows/async-pipeline.yml` is generated from `pipeline.ts`. Do not
hand-edit it; update `pipeline.ts`, then run:

```bash
pnpm run pipeline:github:generate
```

`API_SURFACE.md` is generated from `api-contract.json`. Update the manifest,
then run:

```bash
pnpm run api-surface:generate
```

## Implementation Rules

- Keep the package ESM with `"type": "module"` and explicit `.js` import
  extensions in TypeScript source.
- Preserve Node.js 24 and newer support.
- Keep the package dependency-light. Do not add a mandatory Redis client or
  framework dependency.
- Default standalone writes must use sidecar state. Source JSON writes require
  explicit `writes: 'source'`.
- Missing collection IDs are generated into runtime state; source files are not
  rewritten unless source-write mode is selected.
- Physical local indexes are created only for declared indexes.
- RedisJSON indexes are created only from declared index metadata.
- Public API changes require updates to `api-contract.json`, regenerated
  `API_SURFACE.md`, README usage docs, and tests.
- Version bumps and changelog entries must move together before publishing.

## Testing Guidance

Use `node:test` and temporary project directories under the system temp
directory. Tests should create their own JSON fixtures and avoid depending on
generated repo state.

Add tests for every behavior change that touches:

- file or folder open behavior
- sidecar writes
- source-write mode
- generated IDs
- query helpers
- WAL/version/recovery helpers
- declared local indexes
- RedisJSON key layout, hydration, index creation, and capability errors
- package exports
