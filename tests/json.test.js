import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import json, {
  atomicWriteJsonVersioned,
  jsonStateVersionsDir,
  listJsonStateVersions,
  readJsonState,
  restoreJsonStateVersion,
} from '../dist/index.js';

async function tempProject() {
  return await mkdtemp(path.join(tmpdir(), 'async-json-test-'));
}

test('opens one JSON collection file with sidecar writes by default', async () => {
  const cwd = await tempProject();
  const file = path.join(cwd, 'users.json');
  await writeFile(file, `${JSON.stringify([{ name: 'Ada', role: 'admin' }], null, 2)}\n`);

  const users = await json(file);
  assert.equal(users.kind, 'collection');
  assert.deepEqual(await users.find({ where: { role: 'admin' } }), [{ id: '1', name: 'Ada', role: 'admin' }]);

  await users.create({ name: 'Grace', role: 'user' });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), [{ name: 'Ada', role: 'admin' }]);
  assert.deepEqual(await readJsonState(path.join(cwd, '.async-json/state/users.json'), []), [
    { name: 'Ada', role: 'admin', id: '1' },
    { name: 'Grace', role: 'user', id: '2' },
  ]);
});

test('source write mode rewrites the selected JSON file', async () => {
  const cwd = await tempProject();
  const file = path.join(cwd, 'users.json');
  await writeFile(file, '[]\n');

  const users = await json(file, { writes: 'source' });
  await users.create({ name: 'Ada' });

  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), [{ name: 'Ada', id: '1' }]);
});

test('opens a JSON folder as collection and document resources', async () => {
  const cwd = await tempProject();
  const dbDir = path.join(cwd, 'db');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(dbDir));
  await writeFile(path.join(dbDir, 'users.json'), JSON.stringify([{ id: 'u_1', role: 'admin' }]));
  await writeFile(path.join(dbDir, 'settings.json'), JSON.stringify({ theme: 'dark' }));

  const db = await json(dbDir);
  assert.deepEqual(db.resourceNames().sort(), ['settings', 'users']);
  assert.deepEqual(await db.collection('users').find({ where: { role: 'admin' } }), [{ id: 'u_1', role: 'admin' }]);
  assert.equal(await db.document('settings').get('theme'), 'dark');
});

test('declared local indexes write sidecar index files', async () => {
  const cwd = await tempProject();
  const file = path.join(cwd, 'users.json');
  await writeFile(file, JSON.stringify([{ id: 'u_1', email: 'ada@example.com' }]));

  const users = await json(file, { indexes: ['email'] });
  await users.create({ id: 'u_2', email: 'grace@example.com' });

  const indexFile = path.join(cwd, '.async-json/indexes/users.email.json');
  assert.deepEqual(await readJsonState(indexFile, {}), {
    '["ada@example.com"]': ['u_1'],
    '["grace@example.com"]': ['u_2'],
  });
});

test('compound identity accepts object keys and writes canonical index ids', async () => {
  const cwd = await tempProject();
  const file = path.join(cwd, 'memberships.json');
  await writeFile(file, JSON.stringify([
    { orgId: 'o_1', userId: 'u_1', role: 'owner' },
  ]));

  const memberships = await json(file, {
    identity: { fields: ['orgId', 'userId'] },
    indexes: ['role'],
  });

  assert.deepEqual(await memberships.get({ orgId: 'o_1', userId: 'u_1' }), {
    orgId: 'o_1',
    userId: 'u_1',
    role: 'owner',
  });

  await memberships.patch({ orgId: 'o_1', userId: 'u_1' }, { role: 'admin', userId: 'changed' });
  assert.deepEqual(await memberships.get({ orgId: 'o_1', userId: 'u_1' }), {
    orgId: 'o_1',
    userId: 'u_1',
    role: 'admin',
  });
  await memberships.create({ orgId: 'o_1', userId: 'u_2', role: 'member' });

  await assert.rejects(
    () => memberships.create({ orgId: 'o_1', userId: 'u_2', role: 'member' }),
    /identity already exists/,
  );
  await assert.rejects(
    () => memberships.get('o_1:u_1'),
    /object key/,
  );

  const indexFile = path.join(cwd, '.async-json/indexes/memberships.role.json');
  assert.deepEqual(await readJsonState(indexFile, {}), {
    '["admin"]': ['{"orgId":"o_1","userId":"u_1"}'],
    '["member"]': ['{"orgId":"o_1","userId":"u_2"}'],
  });
});

test('append-only resources only allow append writes', async () => {
  const cwd = await tempProject();
  const file = path.join(cwd, 'events.json');
  await writeFile(file, '[]\n');

  const events = await json(file, { writePolicy: 'append-only' });
  await events.append({ id: 'e_1', type: 'created' });

  await assert.rejects(() => events.create({ id: 'e_2', type: 'updated' }), /append-only/);
  await assert.rejects(() => events.patch('e_1', { type: 'patched' }), /append-only/);
  await assert.rejects(() => events.delete('e_1'), /append-only/);
  await assert.rejects(() => events.replaceAll([]), /append-only/);
});

test('bytes metadata validates JSON-safe encoded payload strings', async () => {
  const cwd = await tempProject();
  const file = path.join(cwd, 'updates.json');
  await writeFile(file, '[]\n');

  const updates = await json(file, {
    fields: {
      id: { type: 'string', required: true },
      update: { type: 'bytes', encoding: 'base64url', required: true },
    },
  });

  await updates.create({ id: 'u_1', update: 'YWJjZA' });
  await assert.rejects(
    () => updates.create({ id: 'u_2', update: 'not+base64url' }),
    /base64url-encoded string/,
  );
});

test('version helpers keep and restore JSON snapshots', async () => {
  const cwd = await tempProject();
  const file = path.join(cwd, 'state.json');
  await atomicWriteJsonVersioned(file, { n: 1 });
  await atomicWriteJsonVersioned(file, { n: 2 });
  assert.equal((await listJsonStateVersions(file)).length, 1);
  await restoreJsonStateVersion(file);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { n: 1 });
  await stat(jsonStateVersionsDir(file));
});
