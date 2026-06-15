import { jsonDbError } from './error.js';
import type { JsonIndexDefinition, JsonStoreFactory } from './index.js';
import type { CollectionRecord } from './query.js';
import type { JsonRuntimeResource } from './storage.js';

export type RedisJsonClient = {
  json?: {
    get(key: string, options?: unknown): Promise<unknown> | unknown;
    set(key: string, path: string, value: unknown): Promise<unknown> | unknown;
    del?: (key: string, path?: string) => Promise<unknown> | unknown;
  };
  ft?: {
    create(index: string, schema: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown> | unknown;
  };
  sendCommand?: (command: Array<string | number>) => Promise<unknown> | unknown;
  call?: (command: string, ...args: Array<string | number>) => Promise<unknown> | unknown;
  get?: (key: string) => Promise<string | null | undefined> | string | null | undefined;
  set?: (key: string, value: string) => Promise<unknown> | unknown;
  del?: (key: string) => Promise<unknown> | unknown;
  close?: () => void | Promise<void>;
  end?: () => void | Promise<void>;
  quit?: () => void | Promise<void>;
  disconnect?: () => void | Promise<void>;
};

export type RedisJsonOptions = {
  client: RedisJsonClient;
  prefix?: string;
  close?: boolean | ((client: RedisJsonClient) => void | Promise<void>);
  createIndexes?: boolean;
};

export const redisJsonStoreCapabilities = {
  writable: true,
  persistence: 'redis-json',
  atomicity: 'record',
  liveEvents: true,
  staticExport: false,
  production: 'small-app',
};

export function redisJson(options: RedisJsonOptions): JsonStoreFactory {
  const {
    client,
    prefix = 'async-json:',
    close = false,
    createIndexes = true,
  } = options;
  assertRedisJsonClient(client);
  const queues = new Map<string, Promise<unknown>>();

  return ({ storeName }) => ({
    name: storeName,
    capabilities: redisJsonStoreCapabilities,
    hydrate() {},
    async readResource(resource: JsonRuntimeResource, fallback: unknown) {
      if (resource.kind === 'collection') {
        const ids = await readIds(resource);
        if (!ids) return fallback;
        const rows: unknown[] = [];
        for (const id of ids) {
          const record = await jsonGet(recordKey(resource, id));
          if (record !== null && record !== undefined) rows.push(record);
        }
        return rows;
      }
      const value = await jsonGet(documentKey(resource));
      return value === null || value === undefined ? fallback : value;
    },
    async writeResource(resource: JsonRuntimeResource, value: unknown) {
      if (resource.kind === 'collection') {
        await writeCollection(resource, Array.isArray(value) ? value as CollectionRecord[] : []);
      } else {
        await jsonSet(documentKey(resource), value);
      }
    },
    async createIndexes(resource: JsonRuntimeResource, _value: unknown, indexes: JsonIndexDefinition[]) {
      if (!createIndexes || indexes.length === 0) return;
      await createSearchIndexes(resource, indexes);
    },
    withResourceWrite<T>(resource: JsonRuntimeResource, operation: () => T | Promise<T>) {
      const queueKey = keyBase(resource);
      const previous = queues.get(queueKey) ?? Promise.resolve();
      const current = previous.then(operation, operation);
      const stored = current.catch(() => {});
      queues.set(queueKey, stored);
      stored.finally(() => {
        if (queues.get(queueKey) === stored) queues.delete(queueKey);
      });
      return current;
    },
    close() {
      if (typeof close === 'function') return close(client);
      if (!close) return undefined;
      return client.close?.() ?? client.quit?.() ?? client.disconnect?.() ?? client.end?.();
    },
  });

  async function readIds(resource: JsonRuntimeResource): Promise<string[] | null> {
    const value = await jsonGet(idsKey(resource));
    return Array.isArray(value) ? value.map(String) : null;
  }

  async function writeCollection(resource: JsonRuntimeResource, records: CollectionRecord[]): Promise<void> {
    const previousIds = new Set((await readIds(resource)) ?? []);
    const nextIds = records.map((record) => identityKeyString(resource, record));
    for (const record of records) {
      await jsonSet(recordKey(resource, identityKeyString(resource, record)), record);
    }
    for (const staleId of previousIds) {
      if (!nextIds.includes(staleId)) {
        await deleteKey(recordKey(resource, staleId));
      }
    }
    await jsonSet(idsKey(resource), nextIds);
  }

  async function createSearchIndexes(resource: JsonRuntimeResource, indexes: JsonIndexDefinition[]): Promise<void> {
    for (const index of indexes) {
      const fields = typeof index === 'string' ? [index] : index.fields;
      const indexName = `${prefix}idx:${resource.name}:${fields.join(':')}`;
      const keyPrefix = resource.kind === 'collection'
        ? `${prefix}${encodeURIComponent(resource.name)}:records:`
        : `${prefix}${encodeURIComponent(resource.name)}:doc`;
      if (client.ft?.create) {
        await client.ft.create(
          indexName,
          Object.fromEntries(fields.map((field) => [`$.${field}`, { AS: field, type: 'TAG' }])),
          { ON: 'JSON', PREFIX: keyPrefix },
        );
        continue;
      }
      if (client.sendCommand || client.call) {
        await command([
          'FT.CREATE',
          indexName,
          'ON',
          'JSON',
          'PREFIX',
          1,
          keyPrefix,
          'SCHEMA',
          ...fields.flatMap((field) => [`$.${field}`, 'AS', field, 'TAG']),
        ]);
        continue;
      }
      throw jsonDbError(
        'JSON_REDIS_SEARCH_UNSUPPORTED',
        `Redis JSON store cannot create declared indexes for "${resource.name}" with this client.`,
        {
          status: 500,
          hint: 'Pass a client with ft.create(), sendCommand(), or call(), or disable index creation for this adapter.',
          details: { resource: resource.name, fields },
        },
      );
    }
  }

  async function jsonGet(key: string): Promise<unknown> {
    if (client.json?.get) return await client.json.get(key);
    if (client.sendCommand || client.call) return await command(['JSON.GET', key, '$']);
    const raw = await client.get?.(key);
    return raw ? JSON.parse(raw) : null;
  }

  async function jsonSet(key: string, value: unknown): Promise<void> {
    if (client.json?.set) {
      await client.json.set(key, '$', value);
      return;
    }
    if (client.sendCommand || client.call) {
      await command(['JSON.SET', key, '$', JSON.stringify(value)]);
      return;
    }
    if (client.set) {
      await client.set(key, JSON.stringify(value));
      return;
    }
    throw jsonDbError(
      'JSON_REDIS_CLIENT_UNSUPPORTED',
      'Redis JSON store requires JSON.SET support, sendCommand/call support, or a string set fallback.',
      { status: 500 },
    );
  }

  async function deleteKey(key: string): Promise<void> {
    if (client.json?.del) {
      await client.json.del(key, '$');
      return;
    }
    if (client.del) {
      await client.del(key);
      return;
    }
    if (client.sendCommand || client.call) {
      await command(['DEL', key]);
    }
  }

  async function command(args: Array<string | number>): Promise<unknown> {
    if (client.sendCommand) return await client.sendCommand(args);
    if (client.call) {
      const [commandName, ...rest] = args;
      return await client.call(String(commandName), ...rest);
    }
    throw jsonDbError('JSON_REDIS_COMMAND_UNSUPPORTED', 'Redis client does not support commands.', { status: 500 });
  }

  function keyBase(resource: JsonRuntimeResource): string {
    return `${prefix}${encodeURIComponent(resource.name)}`;
  }

  function idsKey(resource: JsonRuntimeResource): string {
    return `${keyBase(resource)}:ids`;
  }

  function recordKey(resource: JsonRuntimeResource, id: string): string {
    return `${keyBase(resource)}:records:${encodeURIComponent(id)}`;
  }

  function documentKey(resource: JsonRuntimeResource): string {
    return `${keyBase(resource)}:doc`;
  }
}

export const redisJsonStore = redisJson;

function identityFields(resource: JsonRuntimeResource): [string, ...string[]] {
  const fields = Array.isArray(resource.identity?.fields)
    ? resource.identity.fields.map(String).filter(Boolean)
    : [];
  return fields.length > 0
    ? fields as [string, ...string[]]
    : [String(resource.idField ?? 'id')];
}

function identityKeyString(resource: JsonRuntimeResource, record: CollectionRecord): string {
  const fields = identityFields(resource);
  if (fields.length === 1) {
    return String(record[fields[0]]);
  }
  return JSON.stringify(Object.fromEntries(fields.map((field) => [field, record[field]])));
}

function assertRedisJsonClient(client: RedisJsonClient | null | undefined): asserts client is RedisJsonClient {
  if (client && (client.json?.get || client.sendCommand || client.call || client.get)) return;
  throw jsonDbError(
    'JSON_REDIS_CLIENT_REQUIRED',
    'redisJson() requires an injected Redis JSON, Redis command, or Redis-like string client.',
    {
      status: 500,
      hint: 'Pass a client with json.get/json.set, sendCommand(), call(), or get/set fallback methods.',
    },
  );
}
