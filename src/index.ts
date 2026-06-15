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
  file,
  patchFile,
} from './file.js';

export type {
  FilePatch,
  FilePatchOptions,
  FilePatchUpdater,
} from './file.js';

export {
  parseJson,
  registerJson,
  stableJson,
  stableStringify,
} from './stable-json.js';

export type {
  JsonParseOptions,
  JsonParseReviver,
  JsonParseReviverContext,
  JsonRegisterOptions,
  JsonRestore,
  JsonStableStringifyContext,
  JsonStableStringifyOptions,
  JsonStableStringifyReplacer,
  JsonStableStringifySort,
} from './stable-json.js';

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

export type JsonIdentityDefinition = {
  fields: string[];
};

export type JsonBytesEncoding = 'base64' | 'base64url' | 'hex';

export type JsonFieldDefinition = {
  type?: string;
  required?: boolean;
  nullable?: boolean;
  encoding?: JsonBytesEncoding;
  fields?: Record<string, JsonFieldDefinition>;
  items?: JsonFieldDefinition;
  [key: string]: unknown;
};

export type JsonResourceOptions = {
  idField?: string;
  identity?: JsonIdentityDefinition;
  writePolicy?: 'append-only' | string;
  log?: {
    cursorField?: string;
    order?: 'asc' | 'desc';
    payloadField?: string;
    [key: string]: unknown;
  };
  fields?: Record<string, JsonFieldDefinition>;
  indexes?: JsonIndexDefinition[];
};

export type JsonKey = string | number | boolean | Record<string, unknown>;

export type JsonOpenOptions = {
  cwd?: string;
  fs?: JsonFileSystem;
  writes?: JsonWritesMode;
  stateDir?: string;
  idField?: string;
  identity?: JsonIdentityDefinition;
  writePolicy?: 'append-only' | string;
  fields?: Record<string, JsonFieldDefinition>;
  resource?: JsonResourceOptions;
  resources?: Record<string, JsonResourceOptions>;
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
  get(key: JsonKey): Promise<CollectionRecord | null>;
  exists(key: JsonKey): Promise<boolean>;
  find(query?: CollectionQuery): Promise<CollectionRecord[]>;
  count(query?: CollectionQuery): Promise<number>;
  aggregate(query: CollectionAggregate): Promise<CollectionRecord[]>;
  create(record: CollectionRecord): Promise<CollectionRecord>;
  append(record: CollectionRecord): Promise<CollectionRecord>;
  update(key: JsonKey, patch: CollectionRecord): Promise<CollectionRecord | null>;
  patch(key: JsonKey, patch: CollectionRecord): Promise<CollectionRecord | null>;
  delete(key: JsonKey): Promise<boolean>;
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
  const resource = resourceForSeed(name, filePath, seed, options);
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
    resources.push(resourceForSeed(resourceNameForFile(filePath), filePath, seed, options));
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
      await store.createIndexes?.(resource, seed, indexesForResource(resource, options));
    } else {
      await store.createIndexes?.(resource, existing, indexesForResource(resource, options));
    }
  }
  return {
    async read(resource) {
      return await store.readResource(resource, resource.kind === 'collection' ? [] : {});
    },
    async write(resource, value) {
      await store.writeResource(resource, value);
      await store.createIndexes?.(resource, value, indexesForResource(resource, options));
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
      const id = identityKeyString(resource, record);
      rows[key] ??= [];
      rows[key].push(id);
    }
    await writeJsonState(path.join(indexRoot, `${resource.name}.${fields.join('_')}.json`), rows, fs);
  }
}

function createCollection(runtime: StandaloneRuntime, resource: JsonRuntimeResource): JsonCollection {
  return {
    kind: 'collection',
    name: resource.name,
    async all() {
      const value = await runtime.read(resource);
      return Array.isArray(value) ? value as CollectionRecord[] : [];
    },
    async get(id) {
      const identity = identityForResource(resource);
      const key = normalizeKey(resource, identity, id);
      return (await this.all()).find((record) => recordMatchesKey(record, identity, key)) ?? null;
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
      assertCanMutate(resource, 'create');
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
      assertCanMutate(resource, 'delete');
      return runtime.withWrite(resource, async () => {
        const records = Array.isArray(await runtime.read(resource)) ? await runtime.read(resource) as CollectionRecord[] : [];
        const identity = identityForResource(resource);
        const key = normalizeKey(resource, identity, id);
        const next = records.filter((record) => !recordMatchesKey(record, identity, key));
        if (next.length === records.length) return false;
        await runtime.write(resource, next);
        return true;
      });
    },
    async replaceAll(records) {
      assertCanMutate(resource, 'replaceAll');
      const next = ensureCollectionIdentities(records, resource);
      validateCollectionRecords(resource, next);
      await runtime.write(resource, next);
      return next;
    },
  };
}

async function createRecord(runtime: StandaloneRuntime, resource: JsonRuntimeResource, record: CollectionRecord): Promise<CollectionRecord> {
  return runtime.withWrite(resource, async () => {
    const records = Array.isArray(await runtime.read(resource)) ? await runtime.read(resource) as CollectionRecord[] : [];
    const nextRecord = ensureRecordIdentity({ ...record }, resource, records);
    validateRecordFields(resource, nextRecord);
    const identity = identityForResource(resource);
    const key = keyFromRecord(resource, identity, nextRecord);
    if (records.some((existing) => recordMatchesKey(existing, identity, key))) {
      throw jsonDbError('JSON_CREATE_DUPLICATE_KEY', `Cannot create "${resource.name}" record because its identity already exists.`, {
        status: 409,
        hint: identity.fields.length === 1
          ? 'Use a unique id, or call patch/update if you intended to modify the existing record.'
          : `Use a unique compound key for fields: ${identity.fields.join(', ')}.`,
        details: { resource: resource.name, identity, key },
      });
    }
    const next = [...records, nextRecord];
    await runtime.write(resource, next);
    return nextRecord;
  });
}

async function patchRecord(runtime: StandaloneRuntime, resource: JsonRuntimeResource, id: unknown, patch: CollectionRecord): Promise<CollectionRecord | null> {
  assertCanMutate(resource, 'patch');
  return runtime.withWrite(resource, async () => {
    const records = Array.isArray(await runtime.read(resource)) ? await runtime.read(resource) as CollectionRecord[] : [];
    const identity = identityForResource(resource);
    const key = normalizeKey(resource, identity, id);
    const index = records.findIndex((record) => recordMatchesKey(record, identity, key));
    if (index === -1) return null;
    const current = records[index] as CollectionRecord;
    const nextRecord = {
      ...current,
      ...patch,
      ...Object.fromEntries(identity.fields.map((field) => [field, current[field]])),
    };
    validateRecordFields(resource, nextRecord);
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

function resourceForSeed(name: string, filePath: string, seed: unknown, options: RequiredRuntimeOptions): JsonRuntimeResource {
  const resourceOptions = resourceOptionsFor(name, options);
  return {
    name,
    kind: Array.isArray(seed) ? 'collection' : 'document',
    idField: resourceOptions.idField ?? 'id',
    identity: normalizeIdentity(resourceOptions),
    writePolicy: resourceOptions.writePolicy,
    log: resourceOptions.log,
    fields: resourceOptions.fields,
    indexes: resourceOptions.indexes,
    dataPath: filePath,
  };
}

function normalizedSeed(seed: unknown, resource: JsonRuntimeResource): unknown {
  if (resource.kind === 'collection') {
    const records = ensureCollectionIdentities(Array.isArray(seed) ? seed as CollectionRecord[] : [], resource);
    validateCollectionRecords(resource, records);
    return records;
  }
  return isPlainObject(seed) ? seed : {};
}

function ensureCollectionIdentities(records: CollectionRecord[], resource: JsonRuntimeResource): CollectionRecord[] {
  const identity = identityForResource(resource);
  const singleIdField = identity.fields.length === 1 ? identity.fields[0] : null;
  if (!singleIdField) {
    for (const record of records) {
      assertRecordKeyPresent(resource, identity, record);
    }
    const next = records.map((record) => ({ ...record }));
    assertNoDuplicateKeys(resource, identity, next);
    return next;
  }

  const used = new Set(records.map((record) => record[singleIdField]).filter((id) => id !== undefined && id !== null && id !== '').map(String));
  let counter = 1;
  const next = records.map((record) => {
    if (record[singleIdField] !== undefined && record[singleIdField] !== null && record[singleIdField] !== '') {
      return { ...record };
    }
    while (used.has(String(counter))) counter += 1;
    const id = String(counter);
    used.add(id);
    counter += 1;
    return { ...record, [singleIdField]: id };
  });
  assertNoDuplicateKeys(resource, identity, next);
  return next;
}

function ensureRecordIdentity(record: CollectionRecord, resource: JsonRuntimeResource, records: CollectionRecord[]): CollectionRecord {
  const identity = identityForResource(resource);
  const idField = singleIdentityField(identity);
  if (idField) {
    if (record[idField] === undefined || record[idField] === null || record[idField] === '') {
      record[idField] = nextCollectionId(records, idField);
    }
    return record;
  }

  assertRecordKeyPresent(resource, identity, record);
  return record;
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

function indexesForResource(resource: JsonRuntimeResource, options: RequiredRuntimeOptions): JsonIndexDefinition[] {
  return [
    ...indexesFor(resource.name, options.indexes),
    ...(((resource as { indexes?: JsonIndexDefinition[] }).indexes) ?? []),
  ];
}

function resourceOptionsFor(resourceName: string, options: RequiredRuntimeOptions): JsonResourceOptions {
  return {
    ...(options.idField ? { idField: options.idField } : {}),
    ...(options.identity ? { identity: options.identity } : {}),
    ...(options.writePolicy ? { writePolicy: options.writePolicy } : {}),
    ...(options.fields ? { fields: options.fields } : {}),
    ...(options.resource ?? {}),
    ...(options.resources?.[resourceName] ?? {}),
  };
}

function normalizeIdentity(resource: JsonResourceOptions): JsonIdentityDefinition | undefined {
  if (Array.isArray(resource.identity?.fields) && resource.identity.fields.length > 0) {
    return {
      fields: resource.identity.fields.map(String).filter(Boolean),
    };
  }

  if (resource.idField) {
    return { fields: [String(resource.idField)] };
  }

  return undefined;
}

function identityForResource(resource: JsonRuntimeResource): JsonIdentityDefinition {
  const fields = Array.isArray((resource as { identity?: JsonIdentityDefinition }).identity?.fields)
    ? (resource as { identity: JsonIdentityDefinition }).identity.fields.map(String).filter(Boolean)
    : [String(resource.idField ?? 'id')];
  return {
    fields: fields.length > 0 ? fields : [String(resource.idField ?? 'id')],
  };
}

function normalizeKey(resource: JsonRuntimeResource, identity: JsonIdentityDefinition, key: unknown): Record<string, unknown> {
  const idField = singleIdentityField(identity);
  if (idField && !isPlainObject(key)) {
    return { [idField]: key };
  }

  if (!isPlainObject(key)) {
    throw jsonDbError(
      'JSON_COMPOUND_KEY_REQUIRED',
      `JSON resource "${resource.name}" requires an object key for compound identity.`,
      {
        status: 400,
        hint: `Pass a key object with fields: ${identity.fields.join(', ')}.`,
        details: { resource: resource.name, identity },
      },
    );
  }

  const normalized = Object.fromEntries(identity.fields.map((field) => [field, key[field]]));
  assertRecordKeyPresent(resource, identity, normalized);
  return normalized;
}

function keyFromRecord(resource: JsonRuntimeResource, identity: JsonIdentityDefinition, record: CollectionRecord): Record<string, unknown> {
  assertRecordKeyPresent(resource, identity, record);
  return Object.fromEntries(identity.fields.map((field) => [field, record[field]]));
}

function recordMatchesKey(record: CollectionRecord, identity: JsonIdentityDefinition, key: Record<string, unknown>): boolean {
  return identity.fields.every((field) => idMatches(record[field], key[field]));
}

function identityKeyString(resource: JsonRuntimeResource, record: CollectionRecord): string {
  const identity = identityForResource(resource);
  const key = keyFromRecord(resource, identity, record);
  const idField = singleIdentityField(identity);
  return idField
    ? String(key[idField])
    : JSON.stringify(key);
}

function singleIdentityField(identity: JsonIdentityDefinition): string | null {
  return identity.fields.length === 1 ? identity.fields[0] ?? null : null;
}

function assertRecordKeyPresent(resource: JsonRuntimeResource, identity: JsonIdentityDefinition, record: Record<string, unknown>): void {
  const missing = identity.fields.filter((field) => record[field] === undefined || record[field] === null || record[field] === '');
  if (missing.length === 0) {
    return;
  }

  throw jsonDbError(
    'JSON_IDENTITY_FIELD_MISSING',
    `JSON resource "${resource.name}" is missing identity field${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`,
    {
      status: 400,
      hint: `Provide all identity fields: ${identity.fields.join(', ')}.`,
      details: { resource: resource.name, identity, missingFields: missing },
    },
  );
}

function assertNoDuplicateKeys(resource: JsonRuntimeResource, identity: JsonIdentityDefinition, records: CollectionRecord[]): void {
  const seen = new Set<string>();
  for (const record of records) {
    const key = keyFromRecord(resource, identity, record);
    const serialized = JSON.stringify(key);
    if (seen.has(serialized)) {
      throw jsonDbError(
        'JSON_DUPLICATE_IDENTITY',
        `JSON resource "${resource.name}" contains duplicate identity values.`,
        {
          status: 409,
          hint: `Ensure every record has a unique identity for fields: ${identity.fields.join(', ')}.`,
          details: { resource: resource.name, identity, key },
        },
      );
    }
    seen.add(serialized);
  }
}

function assertCanMutate(resource: JsonRuntimeResource, operation: string): void {
  if ((resource as { writePolicy?: unknown }).writePolicy !== 'append-only') {
    return;
  }

  throw jsonDbError(
    'JSON_APPEND_ONLY_RESOURCE',
    `Cannot ${operation} "${resource.name}" because it is append-only.`,
    {
      status: 405,
      hint: `Use collection("${resource.name}").append(record) for append-only resources.`,
      details: { resource: resource.name, operation, writePolicy: 'append-only' },
    },
  );
}

function validateCollectionRecords(resource: JsonRuntimeResource, records: CollectionRecord[]): void {
  for (const record of records) {
    validateRecordFields(resource, record);
  }
}

function validateRecordFields(resource: JsonRuntimeResource, record: CollectionRecord): void {
  const fields = (resource as { fields?: Record<string, JsonFieldDefinition> }).fields ?? {};
  for (const [fieldName, field] of Object.entries(fields)) {
    if (field.required && (record[fieldName] === undefined || (record[fieldName] === null && !field.nullable))) {
      throw jsonDbError(
        'JSON_FIELD_REQUIRED',
        `JSON resource "${resource.name}" record is missing required field "${fieldName}".`,
        { status: 400, details: { resource: resource.name, field: fieldName } },
      );
    }
    if (record[fieldName] !== undefined) {
      validateFieldValue(resource, fieldName, record[fieldName], field);
    }
  }
}

function validateFieldValue(resource: JsonRuntimeResource, fieldPath: string, value: unknown, field: JsonFieldDefinition): void {
  if (value === null && field.nullable) {
    return;
  }
  if (field.type === 'bytes') {
    validateBytesField(resource, fieldPath, value, field.encoding ?? 'base64');
    return;
  }
  if (field.type === 'object' && isPlainObject(value)) {
    for (const [childName, childField] of Object.entries(field.fields ?? {})) {
      const childValue = value[childName];
      if (childValue !== undefined) {
        validateFieldValue(resource, `${fieldPath}.${childName}`, childValue, childField);
      }
    }
  }
  if (field.type === 'array' && Array.isArray(value) && field.items) {
    value.forEach((item, index) => validateFieldValue(resource, `${fieldPath}[${index}]`, item, field.items as JsonFieldDefinition));
  }
}

function validateBytesField(resource: JsonRuntimeResource, fieldPath: string, value: unknown, encoding: JsonBytesEncoding): void {
  if (typeof value !== 'string') {
    throw jsonBytesError(resource, fieldPath, encoding, value);
  }
  const valid = encoding === 'hex'
    ? /^(?:[0-9a-fA-F]{2})*$/u.test(value)
    : encoding === 'base64url'
      ? /^(?:[A-Za-z0-9_-]+={0,2})?$/u.test(value) && value.length % 4 !== 1
      : /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value);
  if (!valid) {
    throw jsonBytesError(resource, fieldPath, encoding, value);
  }
}

function jsonBytesError(resource: JsonRuntimeResource, fieldPath: string, encoding: JsonBytesEncoding, value: unknown): Error {
  return jsonDbError(
    'JSON_BYTES_INVALID',
    `JSON resource "${resource.name}" field "${fieldPath}" must be a ${encoding}-encoded string.`,
    {
      status: 400,
      hint: 'Store binary payloads as JSON-safe encoded strings; @async/json validates the envelope but does not decode domain payloads.',
      details: { resource: resource.name, field: fieldPath, encoding, receivedType: value === null ? 'null' : typeof value },
    },
  );
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
