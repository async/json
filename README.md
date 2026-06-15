# @async/json

Use a JSON file or a folder of JSON files like a small database.

```bash
pnpm add @async/json
```

The package is ESM-only and supports Node.js 24 and newer.

```js
import json from '@async/json';

const users = await json('./users.json');
await users.create({ name: 'Ada Lovelace', role: 'admin' });
await users.find({ where: { role: 'admin' } });

const db = await json('./db');
await db.collection('users').find({ where: { role: 'admin' } });
await db.document('settings').get();
```

By default the visible JSON file is seed data and writes go to sidecar state
under `.async-json/state`. Use `writes: 'source'` only when the JSON file itself
should be rewritten.

`@async/json` owns standalone JSON database semantics: collection/document
runtime APIs, scalar and compound identity, append-only collections, encoded
payload validation, sidecar state, local indexes, and RedisJSON storage. Use
`@async/db` when you also need readers, schemas, generated types, REST/GraphQL,
operations, lifecycle, and store graduation.

## Identity, Logs, And Encoded Payloads

Single-field resources keep using `id` by default:

```js
const users = await json('./users.json');
await users.get('u_1');
```

Compound identity uses object keys instead of delimiter-encoded ids:

```js
const memberships = await json('./memberships.json', {
  identity: { fields: ['orgId', 'userId'] },
  indexes: ['role'],
});

await memberships.get({ orgId: 'o_1', userId: 'u_1' });
await memberships.patch({ orgId: 'o_1', userId: 'u_1' }, { role: 'admin' });
```

Append-only collections allow `append()` and block create/update/delete/replace
APIs:

```js
const events = await json('./events.json', {
  writePolicy: 'append-only',
});

await events.append({ id: 'e_1', type: 'created' });
```

Bytes fields validate JSON-safe encoded strings while keeping payloads opaque:

```js
const updates = await json('./updates.json', {
  fields: {
    id: { type: 'string', required: true },
    update: { type: 'bytes', encoding: 'base64url', required: true },
  },
});

await updates.append({ id: 'u_1', update: 'YWJjZA' });
```

## Redis JSON

```js
import json from '@async/json';
import { redisJson } from '@async/json/redis';

const db = await json('./db', {
  store: redisJson({ client, prefix: 'app:' }),
  indexes: {
    users: [{ fields: ['email'] }],
  },
});
```

Redis mode stores collection records as per-record Redis JSON keys. Declared
indexes can be mapped to Redis Search; indexes are not created implicitly from
observed queries.

## Local Development

```bash
pnpm install
pnpm run build
pnpm run test
pnpm run release:check
```

`release:check` builds the package, runs tests, verifies the API surface
ledger, and runs a package dry-run.

Generated files:

- `dist/` is build output and is not committed.
- `.async/pages/` is generated GitHub Pages output and is not committed.
- `.async/`, `.async-json/`, `node_modules/`, and `*.tgz` are local runtime,
  cache, dependency, and package output.
- `.github/workflows/async-pipeline.yml` is generated from `pipeline.ts`.

## Website

The project site is published through GitHub Pages at
https://async.github.io/json/.

## Release Status

`@async/json` publishes as a public npm package. Public API changes should
update `api-contract.json`, regenerate `API_SURFACE.md`, update this README,
and add tests in the same change.
