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
