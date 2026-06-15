# @async/json API Surface Ledger

This file is the generated review ledger for semantic API contract features. It is current-state contract documentation, not a changelog or tutorial.

## Async JSON Package Exports

Contract: `@async/json.package`

### Exports

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `export.redis` | @async/json/redis provides an optional Redis JSON store adapter | beta | preview | active |  | [docs](https://github.com/async/json/blob/main/README.md) |
| `export.root` | @async/json opens a JSON file or folder as a small database and exposes JSON engine helpers | public | stable | active |  | [docs](https://github.com/async/json/blob/main/README.md) |

## Async JSON Runtime

Contract: `@async/json.runtime`

### Runtime

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `runtime.file-folder` | JSON file and folder paths open as collection/document resources with sidecar state by default | public | stable | active |  | [docs](https://github.com/async/json/blob/main/README.md) |
| `runtime.local-engine` | Local JSON engine owns atomic writes, sidecar state, version history, recovery, advisory locks, and declared indexes | public | stable | active |  | [docs](https://github.com/async/json/blob/main/README.md) |
| `runtime.query` | Collection query helpers support where, orderBy, limit, offset, count, and aggregate | public | stable | active |  | [docs](https://github.com/async/json/blob/main/README.md) |
| `runtime.redis-json` | Redis JSON adapter stores collection records under per-record JSON keys and creates only declared search indexes | beta | preview | active |  | [docs](https://github.com/async/json/blob/main/README.md) |

## Supported Surfaces

| Contract | Hash | Features |
| --- | --- | --- |
| `@async/json.package` | `sha256:fadc5b04de3d99e776b4b373420cf7e28eecf725ac4d848098cb3462f3820161` | `export.redis`, `export.root` |
| `@async/json.runtime` | `sha256:84cafe2532edffbc8cb4c1eaa64ecacdca0950bfa76c4e4d6f60cfdc2766520e` | `runtime.file-folder`, `runtime.local-engine`, `runtime.query`, `runtime.redis-json` |
