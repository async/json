import path from 'node:path';
import {
  aggregateCollectionRecords,
  applyCollectionQuery,
  countCollectionRecords,
  type CollectionAggregate,
  type CollectionQuery,
  type CollectionRecord,
} from './query.js';
import {
  atomicWriteJson,
  atomicWriteJsonVersioned,
  DEFAULT_MAX_JSON_STATE_VERSIONS,
  fileStorage,
  jsonStatePathForResource,
  jsonStatePathForResource as statePathForResource,
  jsonStateVersionsDir,
  jsonStore,
  jsonStoreCapabilities,
  listJsonStateVersions,
  readJsonState,
  recoverJsonStateDir,
  restoreJsonStateVersion,
  s3Storage,
  withJsonStateWrite,
  writeJsonState,
  type JsonFileStorage,
  type JsonRuntimeResource,
  type JsonS3Storage,
  type JsonStateRecoveryReport,
  type JsonStateResource,
  type JsonStateVersion,
  type JsonStateWriteOptions,
  type JsonStoreCapabilities,
  type JsonStoreEncryptionOptions,
  type JsonStoreOptions,
} from './storage.js';
import { jsonDbError } from './error.js';
import { nodeFileSystem, type JsonFileSystem } from './fs.js';

export {
  aggregateCollectionRecords,
  applyCollectionQuery,
  atomicWriteJson,
  atomicWriteJsonVersioned,
  countCollectionRecords,
  DEFAULT_MAX_JSON_STATE_VERSIONS,
  fileStorage,
  jsonStatePathForResource,
  statePathForResource,
  jsonStateVersionsDir,
  jsonStore,
  jsonStoreCapabilities,
  listJsonStateVersions,
  readJsonState,
  recoverJsonStateDir,
  restoreJsonStateVersion,
  s3Storage,
  withJsonStateWrite,
  writeJsonState,
};

export { JsonDbError, jsonDbError } from './error.js';
export { nodeFileSystem, type JsonFileSystem } from './fs.js';
export type {
  CollectionAggregate,
  CollectionAggregateMetric,
  CollectionOrderBy,
  CollectionQuery,
  CollectionRecord,
  CollectionWhere,
  CollectionWhereOperator,
  CollectionWhereValue,
} from './query.js';
export type {
  JsonFileStorage,
  JsonRuntimeResource,
  JsonS3Storage,
  JsonStateRecoveryReport,
  JsonStateResource,
  JsonStateVersion,
  JsonStateWriteOptions,
  JsonStoreCapabilities,
  JsonStoreEncryptionOptions,
  JsonStoreOptions,
};

export type JsonWritesMode = 'sidecar' | 'source';

export type JsonIndexDefinition =
  | string
  | { fields: string[] };

export type JsonOpenOptions = {
  cwd?: string;
  fs?: JsonFileSystem;
  writes?: JsonWritesMode;
  stateDir?: string;
  indexes?: JsonIndexDefinition[] | Record<string, JsonIndexDefinition[]>;
  store?: JsonStoreFactory | JsonStoreInstance;
};

export type JsonStoreInstance = {
  name?: string;
  statePath?: (resource: JsonRuntimeResource) => unknown;
  hydrate?: (resources: JsonRuntimeResource[]) => unknown | Promise<unknown>;
  readResource(resource: JsonRuntimeResource, fallback: unknown): unknown | Promise<unknown>;
  writeResource(resource: JsonRuntimeResource, value: unknown): unknown | Promise<unknown>;
  withResourceWrite?<T>(resource: JsonRuntimeResource, operation: () => T | Promise<T>): T | Promise<T>;
  createIndexes?: (resource: JsonRuntimeResource, value: unknown, indexes: JsonIndexDefinition[]) => unknown | Promise<unknown>;
  close?: () => unknown | Promise<unknown>;
};

export type JsonStoreFactory = (context: {
  config: { cwd: string; stateDir: string; fs?: JsonFileSystem };
  resources: JsonRuntimeResource[];
  storeName: string;
}) => JsonStoreInstance;

export type JsonCollection = {
  kind: 'collection';
  name: string;
  all(): Promise<CollectionRecord[]>;
  get(id: string): Promise<CollectionRecord | null>;
  exists(id: string): Promise<boolean>;
  find(query?: CollectionQuery): Promise<CollectionRecord[]>;
  count(query?: CollectionQuery): Promise<number>;
  aggregate(query: CollectionAggregate): Promise<CollectionRecord[]>;
  create(record: CollectionRecord): Promise<CollectionRecord>;
  append(record: CollectionRecord): Promise<CollectionRecord>;
  update(id: string, patch: CollectionRecord): Promise<CollectionRecord | null>;
  patch(id: string, patch: CollectionRecord): Promise<CollectionRecord | null>;
  delete(id: string): Promise<boolean>;
  replaceAll(records: CollectionRecord[]): Promise<CollectionRecord[]>;
};

export type JsonDocumentPath = string | Array<string | number>;

export type JsonDocument = {
  kind: 'document';
  name: string;
  all(): Promise<unknown>;
  get(path?: JsonDocumentPath): Promise<unknown>;
  put(value: unknown): Promise<unknown>;
  set(path: JsonDocumentPath, value: unknown): Promise<unknown>;
  update(patch: Record<string, unknown>): Promise<unknown>;
};

export type JsonDatabase = {
  kind: 'database';
  resourceNames(): string[];
  collection(name: string): JsonCollection;
  document(name: string): JsonDocument;
  close(): Promise<void>;
};

export type JsonOpenResult = JsonCollection | JsonDocument | JsonDatabase;

export default async function json(target: string, options: JsonOpenOptions = {}): Promise<JsonOpenResult> {
  const baseCwd = path.resolve(options.cwd ?? process.cwd());
  const fs = options.fs ?? nodeFileSystem;
  const absoluteTarget = path.isAbsolute(target) ? target : path.resolve(baseCwd, target);
  const stats = await fs.stat?.(absoluteTarget).catch(() => null);
  if (!stats) {
    throw jsonDbError('JSON_TARGET_NOT_FOUND', `JSON target does not exist: ${absoluteTarget}`, { status: 404, details: { target: absoluteTarget } });
  }
  const cwd = path.resolve(options.cwd ?? (stats.isDirectory?.() ? path.dirname(absoluteTarget) : path.dirname(absoluteTarget)));

  if (stats.isDirectory?.()) {
    return openJsonFolder(absoluteTarget, { ...options, cwd, fs });
  }
  if (stats.isFile?.() || absoluteTarget.endsWith('.json')) {
    return openJsonFile(absoluteTarget, { ...options, cwd, fs });
  }
  throw jsonDbError('JSON_TARGET_UNSUPPORTED', `JSON target must be a .json file or folder: ${absoluteTarget}`, { status: 400, details: { target: absoluteTarget } });
}

async function openJsonFile(filePath: string, options: RequiredRuntimeOptions): Promise<JsonCollection | JsonDocument> {
  const name = resourceNameForFile(filePath);
  const seed = await readJsonState(filePath, null, options.fs);
  const resource = resourceForSeed(name, filePath, seed);
  const runtime = await createStandaloneRuntime([resource], options);
  return resource.kind === 'collection'
    ? createCollection(runtime, resource)
    : createDocument(runtime, resource);
}

async function openJsonFolder(folderPath: string, options: RequiredRuntimeOptions): Promise<JsonDatabase> {
  const entries = await options.fs.readdir(folderPath, { withFileTypes: true });
  const resources: JsonRuntimeResource[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.startsWith('.')) continue;
    const filePath = path.join(folderPath, entry.name);
    const seed = await readJsonState(filePath, null, options.fs);
    resources.push(resourceForSeed(resourceNameForFile(filePath), filePath, seed));
  }
  const runtime = await createStandaloneRuntime(resources, options);
  return {
    kind: 'database',
    resourceNames() {
      return resources.map((resource) => resource.name);
    },
    collection(name: string) {
      const resource = requireResource(resources, name, 'collection');
      return createCollection(runtime, resource);
    },
    document(name: string) {
      const resource = requireResource(resources, name, 'document');
      return createDocument(runtime, resource);
    },
    close() {
      return runtime.close();
    },
  };
}

type RequiredRuntimeOptions = JsonOpenOptions & {
  cwd: string;
  fs: JsonFileSystem;
};

type StandaloneRuntime = {
  read(resource: JsonRuntimeResource): Promise<unknown>;
  write(resource: JsonRuntimeResource, value: unknown): Promise<void>;
  withWrite<T>(resource: JsonRuntimeResource, operation: () => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
};

async function createStandaloneRuntime(resources: JsonRuntimeResource[], options: RequiredRuntimeOptions): Promise<StandaloneRuntime> {
  const stateDir = path.resolve(options.cwd, options.stateDir ?? '.async-json');
  const store = resolveStore(resources, stateDir, options);
  await store.hydrate?.(resources);
  for (const resource of resources) {
    const seed = normalizedSeed(await readJsonState(resource.dataPath as string, resource.kind === 'collection' ? [] : {}, options.fs), resource);
    const existing = await store.readResource(resource, MISSING);
    if (existing === MISSING) {
      await store.writeResource(resource, seed);
      await store.createIndexes?.(resource, seed, indexesFor(resource.name, options.indexes));
    } else {
      await store.createIndexes?.(resource, existing, indexesFor(resource.name, options.indexes));
    }
  }
  return {
    async read(resource) {
      return await store.readResource(resource, resource.kind === 'collection' ? [] : {});
    },
    async write(resource, value) {
      await store.writeResource(resource, value);
      await store.createIndexes?.(resource, value, indexesFor(resource.name, options.indexes));
    },
    async withWrite(resource, operation) {
      if (store.withResourceWrite) {
        return await store.withResourceWrite(resource, operation);
      }
      return await operation();
    },
    async close() {
      await store.close?.();
    },
  };
}

const MISSING: unique symbol = Symbol('async-json-missing-resource');

function resolveStore(resources: JsonRuntimeResource[], stateDir: string, options: RequiredRuntimeOptions): JsonStoreInstance {
  if (options.store) {
    return typeof options.store === 'function'
      ? options.store({ config: { cwd: options.cwd, stateDir, fs: options.fs }, resources, storeName: 'json' })
      : options.store;
  }
  if (options.writes === 'source') {
    return sourceStore(options.fs);
  }
  return localSidecarStore({ cwd: options.cwd, stateDir, fs: options.fs });
}

function localSidecarStore(config: { cwd: string; stateDir: string; fs: JsonFileSystem }): JsonStoreInstance {
  const stateRoot = path.join(config.stateDir, 'state');
  const indexRoot = path.join(config.stateDir, 'indexes');
  return {
    name: 'json',
    statePath(resource) {
      return path.join(stateRoot, `${resource.name}.json`);
    },
    async hydrate() {
      await recoverJsonStateDir(stateRoot, config.fs);
    },
    readResource(resource, fallback) {
      return readJsonState(path.join(stateRoot, `${resource.name}.json`), fallback, config.fs);
    },
    writeResource(resource, value) {
      return writeJsonState(path.join(stateRoot, `${resource.name}.json`), value, config.fs);
    },
    withResourceWrite(resource, operation) {
      return withJsonStateWrite(path.join(stateRoot, `${resource.name}.json`), operation, { fs: config.fs, crossProcessLock: config.fs === nodeFileSystem });
    },
    async createIndexes(resource, value, indexes) {
      await writeLocalIndexes(indexRoot, resource, value, indexes, config.fs);
    },
  };
}

function sourceStore(fs: JsonFileSystem): JsonStoreInstance {
  return {
    name: 'source',
    readResource(resource, fallback) {
      return readJsonState(resource.dataPath as string, fallback, fs);
    },
    writeResource(resource, value) {
      return writeJsonState(resource.dataPath as string, value, fs);
    },
    withResourceWrite(resource, operation) {
      return withJsonStateWrite(resource.dataPath as string, operation, { fs, crossProcessLock: fs === nodeFileSystem });
    },
  };
}

async function writeLocalIndexes(
  indexRoot: string,
  resource: JsonRuntimeResource,
  value: unknown,
  indexes: JsonIndexDefinition[],
  fs: JsonFileSystem,
): Promise<void> {
  if (indexes.length === 0 || !Array.isArray(value)) return;
  for (const index of indexes) {
    const fields = typeof index === 'string' ? [index] : index.fields;
    const rows: Record<string, unknown[]> = {};
    for (const record of value as CollectionRecord[]) {
      const key = JSON.stringify(fields.map((field) => (record as Record<string, unknown>)[field]));
      const id = record[String(resource.idField ?? 'id')];
      rows[key] ??= [];
      rows[key].push(id);
    }
    await writeJsonState(path.join(indexRoot, `${resource.name}.${fields.join('_')}.json`), rows, fs);
  }
}

function createCollection(runtime: StandaloneRuntime, resource: JsonRuntimeResource): JsonCollection {
  const idField = String(resource.idField ?? 'id');
  return {
    kind: 'collection',
    name: resource.name,
    async all() {
      const value = await runtime.read(resource);
      return Array.isArray(value) ? value as CollectionRecord[] : [];
    },
    async get(id) {
      return (await this.all()).find((record) => idMatches(record[idField], id)) ?? null;
    },
    async exists(id) {
      return await this.get(id) !== null;
    },
    async find(query = {}) {
      return applyCollectionQuery(await this.all(), query);
    },
    async count(query = {}) {
      return countCollectionRecords(await this.all(), query);
    },
    async aggregate(query) {
      return aggregateCollectionRecords(await this.all(), query);
    },
    async create(record) {
      return createRecord(runtime, resource, record);
    },
    async append(record) {
      return createRecord(runtime, resource, record);
    },
    async update(id, patch) {
      return patchRecord(runtime, resource, id, patch);
    },
    async patch(id, patch) {
      return patchRecord(runtime, resource, id, patch);
    },
    async delete(id) {
      return runtime.withWrite(resource, async () => {
        const records = Array.isArray(await runtime.read(resource)) ? await runtime.read(resource) as CollectionRecord[] : [];
        const next = records.filter((record) => !idMatches(record[idField], id));
        if (next.length === records.length) return false;
        await runtime.write(resource, next);
        return true;
      });
    },
    async replaceAll(records) {
      const next = ensureCollectionIds(records, idField);
      await runtime.write(resource, next);
      return next;
    },
  };
}

async function createRecord(runtime: StandaloneRuntime, resource: JsonRuntimeResource, record: CollectionRecord): Promise<CollectionRecord> {
  const idField = String(resource.idField ?? 'id');
  return runtime.withWrite(resource, async () => {
    const records = Array.isArray(await runtime.read(resource)) ? await runtime.read(resource) as CollectionRecord[] : [];
    const nextRecord = { ...record };
    if (nextRecord[idField] === undefined || nextRecord[idField] === null || nextRecord[idField] === '') {
      nextRecord[idField] = nextCollectionId(records, idField);
    }
    if (records.some((existing) => idMatches(existing[idField], nextRecord[idField]))) {
      throw jsonDbError('JSON_CREATE_DUPLICATE_ID', `Cannot create "${resource.name}" record because id "${String(nextRecord[idField])}" already exists.`, {
        status: 409,
        details: { resource: resource.name, idField, id: nextRecord[idField] },
      });
    }
    const next = [...records, nextRecord];
    await runtime.write(resource, next);
    return nextRecord;
  });
}

async function patchRecord(runtime: StandaloneRuntime, resource: JsonRuntimeResource, id: unknown, patch: CollectionRecord): Promise<CollectionRecord | null> {
  const idField = String(resource.idField ?? 'id');
  return runtime.withWrite(resource, async () => {
    const records = Array.isArray(await runtime.read(resource)) ? await runtime.read(resource) as CollectionRecord[] : [];
    const index = records.findIndex((record) => idMatches(record[idField], id));
    if (index === -1) return null;
    const current = records[index] as CollectionRecord;
    const nextRecord = { ...current, ...patch, [idField]: current[idField] };
    const next = [...records];
    next[index] = nextRecord;
    await runtime.write(resource, next);
    return nextRecord;
  });
}

function createDocument(runtime: StandaloneRuntime, resource: JsonRuntimeResource): JsonDocument {
  return {
    kind: 'document',
    name: resource.name,
    all() {
      return runtime.read(resource);
    },
    async get(documentPath = '') {
      const value = await runtime.read(resource);
      return documentPath === '' || (Array.isArray(documentPath) && documentPath.length === 0)
        ? value
        : getPath(value, documentPath);
    },
    async put(value) {
      await runtime.write(resource, value);
      return value;
    },
    async set(documentPath, value) {
      return runtime.withWrite(resource, async () => {
        const current = await runtime.read(resource);
        const next = setPath(current, documentPath, value);
        await runtime.write(resource, next);
        return value;
      });
    },
    async update(patch) {
      return runtime.withWrite(resource, async () => {
        const current = await runtime.read(resource);
        const next = { ...(isPlainObject(current) ? current : {}), ...patch };
        await runtime.write(resource, next);
        return next;
      });
    },
  };
}

function resourceForSeed(name: string, filePath: string, seed: unknown): JsonRuntimeResource {
  return {
    name,
    kind: Array.isArray(seed) ? 'collection' : 'document',
    idField: 'id',
    dataPath: filePath,
  };
}

function normalizedSeed(seed: unknown, resource: JsonRuntimeResource): unknown {
  if (resource.kind === 'collection') {
    return ensureCollectionIds(Array.isArray(seed) ? seed as CollectionRecord[] : [], String(resource.idField ?? 'id'));
  }
  return isPlainObject(seed) ? seed : {};
}

function ensureCollectionIds(records: CollectionRecord[], idField: string): CollectionRecord[] {
  const used = new Set(records.map((record) => record[idField]).filter((id) => id !== undefined && id !== null && id !== '').map(String));
  let counter = 1;
  return records.map((record) => {
    if (record[idField] !== undefined && record[idField] !== null && record[idField] !== '') {
      return { ...record };
    }
    while (used.has(String(counter))) counter += 1;
    const id = String(counter);
    used.add(id);
    counter += 1;
    return { ...record, [idField]: id };
  });
}

function nextCollectionId(records: CollectionRecord[], idField: string): string {
  const used = new Set(records.map((record) => record[idField]).filter((id) => id !== undefined && id !== null).map(String));
  let counter = 1;
  while (used.has(String(counter))) counter += 1;
  return String(counter);
}

function requireResource(resources: JsonRuntimeResource[], name: string, kind: 'collection' | 'document'): JsonRuntimeResource {
  const resource = resources.find((candidate) => candidate.name === name);
  if (!resource) {
    throw jsonDbError('JSON_RESOURCE_NOT_FOUND', `JSON resource "${name}" does not exist.`, { status: 404, details: { resource: name } });
  }
  if (resource.kind !== kind) {
    throw jsonDbError('JSON_RESOURCE_KIND_MISMATCH', `JSON resource "${name}" is a ${resource.kind}, not a ${kind}.`, { status: 400, details: { resource: name, kind: resource.kind } });
  }
  return resource;
}

function resourceNameForFile(filePath: string): string {
  return path.basename(filePath).replace(/\.json$/u, '');
}

function indexesFor(resourceName: string, indexes: JsonOpenOptions['indexes']): JsonIndexDefinition[] {
  if (!indexes) return [];
  if (Array.isArray(indexes)) return indexes;
  return indexes[resourceName] ?? [];
}

function idMatches(left: unknown, right: unknown): boolean {
  return left !== undefined && left !== null && right !== undefined && right !== null && String(left) === String(right);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getPath(value: unknown, documentPath: JsonDocumentPath): unknown {
  const segments = normalizeDocumentPath(documentPath);
  let current = value;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[String(segment)];
  }
  return current;
}

function setPath(value: unknown, documentPath: JsonDocumentPath, nextValue: unknown): unknown {
  const segments = normalizeDocumentPath(documentPath);
  if (segments.length === 0) return nextValue;
  const root = isPlainObject(value) || Array.isArray(value) ? structuredClone(value) as Record<string, unknown> : {};
  let current: Record<string, unknown> = root;
  for (const [index, segment] of segments.entries()) {
    const key = String(segment);
    if (index === segments.length - 1) {
      current[key] = nextValue;
      break;
    }
    const existing = current[key];
    if (!isPlainObject(existing) && !Array.isArray(existing)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  return root;
}

function normalizeDocumentPath(documentPath: JsonDocumentPath): Array<string | number> {
  if (Array.isArray(documentPath)) return documentPath;
  if (documentPath === '') return [];
  if (documentPath.startsWith('/')) {
    return documentPath.split('/').slice(1).map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  }
  return documentPath.split('.');
}
