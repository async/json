# @async/json API Surface Ledger

This file is the generated review ledger for semantic API contract features. It is current-state contract documentation, not a changelog or tutorial.

## Async JSON Package Exports

Contract: `@async/json.package`

### Exports

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `export.redis` | @async/json/redis provides an optional Redis JSON store adapter | beta | preview | active |  | [docs](https://github.com/async/json/blob/main/README.md) |
| `export.root` | @async/json opens JSON file/folder databases and exports stable JSON helpers | public | stable | active |  | [docs](https://github.com/async/json/blob/main/README.md) |

## Async JSON Runtime

Contract: `@async/json.runtime`

### Runtime

| Feature | Title | Release | Stability | Lifecycle | Replacement | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `runtime.append-only` | Append-only collections allow append writes and block create, update, delete, and replace-all mutations | public | stable | active |  | [docs](https://github.com/async/json/blob/main/README.md) |
| `runtime.encoded-payloads` | Bytes field metadata validates base64, base64url, and hex JSON-safe payload strings | public | stable | active |  | [docs](https://github.com/async/json/blob/main/README.md) |
| `runtime.file-folder` | JSON file and folder paths open as collection/document resources with sidecar state by default | public | stable | active |  | [docs](https://github.com/async/json/blob/main/README.md) |
| `runtime.identity` | Collections support scalar idField identity and compound object-key identity without encoded fake ids | public | stable | active |  | [docs](https://github.com/async/json/blob/main/README.md) |
| `runtime.local-engine` | Local JSON engine owns atomic writes, sidecar state, version history, recovery, advisory locks, and declared indexes | public | stable | active |  | [docs](https://github.com/async/json/blob/main/README.md) |
| `runtime.query` | Collection query helpers support where, orderBy, limit, offset, count, and aggregate | public | stable | active |  | [docs](https://github.com/async/json/blob/main/README.md) |
| `runtime.redis-json` | Redis JSON adapter stores collection records under per-record canonical identity keys and creates only declared search indexes | beta | preview | active |  | [docs](https://github.com/async/json/blob/main/README.md) |
| `runtime.stable-json` | Stable JSON helpers provide deterministic stringify, JSON5-compatible parse, ref-aware revivers, and an opt-in JSON shim | public | stable | active |  | [docs](https://github.com/async/json/blob/main/README.md) |

## Supported Surfaces

| Contract | Hash | Features |
| --- | --- | --- |
| `@async/json.package` | `sha256:fadc5b04de3d99e776b4b373420cf7e28eecf725ac4d848098cb3462f3820161` | `export.redis`, `export.root` |
| `@async/json.runtime` | `sha256:c67ec0353fa480c916f76761415fa9bc65eb75e1c6e0933d2bcdaa3273954bbd` | `runtime.append-only`, `runtime.encoded-payloads`, `runtime.file-folder`, `runtime.identity`, `runtime.local-engine`, `runtime.query`, `runtime.redis-json`, `runtime.stable-json` |
