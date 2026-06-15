import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import json from '../dist/index.js';
import { redisJson } from '../dist/redis.js';

function fakeRedisJsonClient() {
  const values = new Map();
  const indexes = [];
  return {
    values,
    indexes,
    json: {
      get(key) {
        return values.get(key) ?? null;
      },
      set(key, _path, value) {
        values.set(key, structuredClone(value));
      },
      del(key) {
        values.delete(key);
      },
    },
    ft: {
      create(index, schema, options) {
        indexes.push({ index, schema, options });
      },
    },
  };
}

test('redisJson stores collections as per-record JSON keys', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'async-json-redis-test-'));
  const file = path.join(cwd, 'users.json');
  await writeFile(file, JSON.stringify([{ id: 'u_1', email: 'ada@example.com' }]));
  const client = fakeRedisJsonClient();

  const users = await json(file, {
    store: redisJson({ client, prefix: 'app:' }),
    indexes: ['email'],
  });
  await users.create({ id: 'u_2', email: 'grace@example.com' });

  assert.deepEqual(client.values.get('app:users:ids'), ['u_1', 'u_2']);
  assert.deepEqual(client.values.get('app:users:records:u_1'), { id: 'u_1', email: 'ada@example.com' });
  assert.deepEqual(client.values.get('app:users:records:u_2'), { id: 'u_2', email: 'grace@example.com' });
  assert.equal(client.indexes[0].index, 'app:idx:users:email');
});

test('redisJson stores documents under document keys', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'async-json-redis-test-'));
  const file = path.join(cwd, 'settings.json');
  await writeFile(file, JSON.stringify({ theme: 'dark' }));
  const client = fakeRedisJsonClient();

  const settings = await json(file, { store: redisJson({ client, prefix: 'app:' }) });
  await settings.set('theme', 'light');

  assert.deepEqual(client.values.get('app:settings:doc'), { theme: 'light' });
});
