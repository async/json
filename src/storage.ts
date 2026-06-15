import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile as nodeReadFile, rm as nodeRm, stat as nodeStat, writeFile as nodeWriteFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { jsonDbError } from './error.js';
import { jsonFileSystem, nodeFileSystem, type JsonFileSystem } from './fs.js';

export type JsonRuntimeScope = {
  fork?: string | null;
  branch?: string;
  rootStateDir?: string;
};

export type JsonRuntimeConfig = {
  cwd: string;
  stateDir: string;
  __asyncDbScope?: JsonRuntimeScope;
  fs?: JsonFileSystem;
  stores?: Record<string, unknown>;
  [key: string]: unknown;
};

export type JsonRuntimeResource = {
  name: string;
  kind?: string;
  idField?: string;
  identity?: {
    fields: string[];
  };
  writePolicy?: string;
  log?: Record<string, unknown>;
  fields?: Record<string, unknown>;
  indexes?: unknown[];
  dataHash?: string | null;
  dataPath?: string | null;
  dataFormat?: unknown;
  [key: string]: unknown;
};

export type JsonFileStorage = {
  kind: 'file';
  root: string;
};

export type JsonS3Storage = {
  kind: 's3';
  bucket: string;
  prefix?: string;
  client?: unknown;
  encryption?: unknown;
};

export type JsonStoreEncryptionOptions = {
  key: string | Uint8Array | (() => string | Uint8Array | Promise<string | Uint8Array>);
  algorithm?: 'aes-256-gcm';
};

export type JsonStoreOptions = {
  storage?: JsonFileStorage | JsonS3Storage;
  durability?: 'current' | 'versioned' | string;
  maxVersions?: number;
  encryption?: JsonStoreEncryptionOptions | null;
};

export type JsonStoreCapabilities = {
  writable: true;
  persistence: 'local-file';
  atomicity: 'resource';
  liveEvents: true;
  staticExport: false;
  production: 'small-local';
};

export type JsonStateConfig = {
  stateDir: string;
  __asyncDbScope?: JsonRuntimeScope;
};

export type JsonStateResource = {
  name: string;
};

export type JsonStateVersion = {
  file: string;
  path: string;
  at: number;
};

export type JsonStateRecoveryReport = {
  removedTempFiles: string[];
  removedLocks: string[];
};

export type JsonStateWriteOptions = {
  crossProcessLock?: boolean;
  lockTimeoutMs?: number;
  lockStaleMs?: number;
  fs?: JsonFileSystem;
};

type ResourceWriteOperation<T> = () => T | Promise<T>;

export const jsonStoreCapabilities: JsonStoreCapabilities = {
  writable: true,
  persistence: 'local-file',
  atomicity: 'resource',
  liveEvents: true,
  staticExport: false,
  production: 'small-local',
};

export const jsonRuntimeCapabilities = jsonStoreCapabilities;

export function fileStorage(root: string): JsonFileStorage {
  return { kind: 'file', root };
}

export function s3Storage(options: Omit<JsonS3Storage, 'kind'>): JsonS3Storage {
  return { kind: 's3', ...options };
}

export function jsonStore(options: JsonStoreOptions = {}) {
  return ({ config, storeName }: { config: JsonRuntimeConfig; resources?: JsonRuntimeResource[]; storeName: string }) => {
    const storage = options.storage ?? fileStorage(config.__asyncDbScope?.rootStateDir ?? config.stateDir);
    if (storage.kind !== 'file') {
      return unsupportedObjectStorageAdapter(storeName, storage, options);
    }

    const fileBackend = storage;
    const rootDirectory = options.storage ? 'resources' : 'state';
    const codec = jsonEncryptionCodec(options.encryption, storeName);
    const versioned = options.durability === 'versioned';
    const maxVersions = options.maxVersions ?? DEFAULT_MAX_JSON_STATE_VERSIONS;

    function statePath(resource: JsonRuntimeResource): string {
      return jsonStoreStatePath(config, fileBackend, resource.name, rootDirectory);
    }

    return {
      name: storeName,
      capabilities: {
        ...jsonStoreCapabilities,
        durability: options.durability ?? 'current',
        encryption: codec ? codec.algorithm : null,
        layout: 'resource-files',
      },
      statePath,
      async hydrate() {
        await recoverJsonStateDir(jsonResourceDir({
          root: storageRoot(config, fileBackend),
          rootDirectory,
          scope: config.__asyncDbScope,
        }), jsonFileSystem(config.fs));
      },
      readResource(resource: JsonRuntimeResource, fallback: unknown) {
        return codec
          ? readEncryptedJsonState(statePath(resource), fallback, codec, jsonFileSystem(config.fs))
          : readJsonState(statePath(resource), fallback, jsonFileSystem(config.fs));
      },
      writeResource(resource: JsonRuntimeResource, value: unknown) {
        if (codec) {
          return writeEncryptedJsonState(statePath(resource), value, codec, {
            fs: jsonFileSystem(config.fs),
            versioned,
            maxVersions,
          });
        }
        return versioned
          ? atomicWriteJsonVersioned(statePath(resource), value, { fs: jsonFileSystem(config.fs), maxVersions })
          : writeJsonState(statePath(resource), value, jsonFileSystem(config.fs));
      },
      withResourceWrite<T>(resource: JsonRuntimeResource, operation: ResourceWriteOperation<T>) {
        return withJsonStateWrite(statePath(resource), operation, jsonStateWriteOptions(config));
      },
    };
  };
}

function storageRoot(config: JsonRuntimeConfig, storage: JsonFileStorage): string {
  return path.isAbsolute(storage.root) ? storage.root : path.resolve(config.cwd, storage.root);
}

function jsonStateWriteOptions(config: JsonRuntimeConfig): JsonStateWriteOptions {
  return {
    fs: jsonFileSystem(config.fs),
    crossProcessLock: !config.fs,
  };
}

function jsonStoreStatePath(
  config: JsonRuntimeConfig,
  storage: JsonFileStorage,
  resourceName: string,
  rootDirectory: 'state' | 'resources',
): string {
  return jsonResourcePath({
    root: storageRoot(config, storage),
    rootDirectory,
    scope: config.__asyncDbScope,
    resourceName,
  });
}

export function jsonStatePathForResource(config: JsonStateConfig, resourceName: string | JsonStateResource): string {
  const name = typeof resourceName === 'string' ? resourceName : resourceName.name;
  return jsonResourcePath({
    root: config.__asyncDbScope?.rootStateDir ?? config.stateDir,
    rootDirectory: 'state',
    scope: config.__asyncDbScope,
    resourceName: name,
  });
}

export const statePathForResource = jsonStatePathForResource;

function jsonResourcePath(options: {
  root: string;
  rootDirectory: 'state' | 'resources';
  scope?: JsonRuntimeScope;
  resourceName: string;
}): string {
  return path.join(jsonResourceDir(options), `${options.resourceName}.json`);
}

function jsonResourceDir(options: {
  root: string;
  rootDirectory: 'state' | 'resources';
  scope?: JsonRuntimeScope;
}): string {
  const { root, rootDirectory, scope } = options;
  if (scope?.fork) {
    return path.join(root, 'forks', scope.fork, 'branches', scope.branch ?? 'main', 'resources');
  }
  return path.join(root, rootDirectory);
}

function unsupportedObjectStorageAdapter(storeName: string, storage: JsonS3Storage, options: JsonStoreOptions) {
  const error = () => jsonDbError(
    'JSON_STORAGE_BACKEND_UNAVAILABLE',
    `JSON store "${storeName}" cannot use "${storage.kind}" storage in this runtime yet.`,
    {
      status: 500,
      hint: 'Use fileStorage() for the built-in runtime today, or provide a custom object-storage adapter that implements read/write semantics.',
      details: { store: storeName, storage: storage.kind },
    },
  );
  return {
    name: storeName,
    capabilities: {
      ...jsonStoreCapabilities,
      persistence: 'object-storage',
      durability: options.durability ?? 'versioned',
      encryption: storage.encryption ?? options.encryption ?? null,
      layout: 'resource-files',
    },
    readResource() {
      throw error();
    },
    writeResource() {
      throw error();
    },
    withResourceWrite<T>(_resource: JsonRuntimeResource, _operation: ResourceWriteOperation<T>) {
      throw error();
    },
  };
}

export async function readJsonState<T>(filePath: string, fallback: T, fs: JsonFileSystem = nodeFileSystem): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8') as string);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    if (error instanceof SyntaxError) {
      throw jsonDbError(
        'JSON_STATE_INVALID',
        `JSON state file is not valid JSON: ${filePath}`,
        {
          status: 500,
          hint: 'Restore this file from a known-good snapshot, delete it to rehydrate from seed data when safe, or fix the JSON syntax before restarting.',
          details: { filePath, parserMessage: error.message },
        },
      );
    }
    throw error;
  }
}

export async function writeJsonState(filePath: string, value: unknown, fs: JsonFileSystem = nodeFileSystem): Promise<boolean> {
  return atomicWriteJson(filePath, value, fs);
}

export async function atomicWriteJson(filePath: string, value: unknown, fs: JsonFileSystem = nodeFileSystem): Promise<boolean> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (await currentJsonText(filePath, fs) === text) return false;
  await writeJsonTextAtomic(filePath, text, fs);
  return true;
}

export async function currentJsonText(filePath: string, fs: JsonFileSystem = nodeFileSystem): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8') as string;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return null;
  }
}

export async function writeJsonTextAtomic(filePath: string, text: string, fs: JsonFileSystem = nodeFileSystem): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );

  try {
    await fs.writeFile(tempPath, text, 'utf8');
    await fs.fsync?.(tempPath);
    await fs.rename(tempPath, filePath);
    try {
      await fs.fsync?.(path.dirname(filePath));
    } catch {}
  } catch (error) {
    try {
      await fs.rm(tempPath, { force: true });
    } catch {}
    throw error;
  }
}

export const DEFAULT_MAX_JSON_STATE_VERSIONS = 10;

export function jsonStateVersionsDir(filePath: string): string {
  return path.join(path.dirname(filePath), '.versions', path.basename(filePath).replace(/\.json$/, ''));
}

export async function atomicWriteJsonVersioned(
  filePath: string,
  value: unknown,
  options: { fs?: JsonFileSystem; maxVersions?: number } = {},
): Promise<boolean> {
  const fs = jsonFileSystem(options.fs);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const currentTextValue = await currentJsonText(filePath, fs);
  if (currentTextValue === text) return false;
  if (currentTextValue !== null) {
    await snapshotJsonStateVersion(filePath, currentTextValue, fs);
  }
  await writeJsonTextAtomic(filePath, text, fs);
  await pruneJsonStateVersions(filePath, options.maxVersions ?? DEFAULT_MAX_JSON_STATE_VERSIONS, fs);
  return true;
}

async function snapshotJsonStateVersion(filePath: string, text: string, fs: JsonFileSystem): Promise<string> {
  const versionsDir = jsonStateVersionsDir(filePath);
  await fs.mkdir(versionsDir, { recursive: true });
  const versionPath = path.join(versionsDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  await fs.writeFile(versionPath, text, 'utf8');
  return versionPath;
}

export async function listJsonStateVersions(filePath: string, fs: JsonFileSystem = nodeFileSystem): Promise<JsonStateVersion[]> {
  const versionsDir = jsonStateVersionsDir(filePath);
  let entries: string[];
  try {
    entries = await fs.readdir(versionsDir) as string[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  return entries
    .filter((entry) => /^\d+-[a-z0-9]+\.json$/.test(entry))
    .map((entry) => ({ file: entry, path: path.join(versionsDir, entry), at: Number(entry.split('-')[0]) }))
    .sort((left, right) => right.at - left.at || right.file.localeCompare(left.file));
}

async function pruneJsonStateVersions(filePath: string, maxVersions: number, fs: JsonFileSystem): Promise<void> {
  if (!Number.isFinite(maxVersions) || maxVersions < 0) return;
  const versions = await listJsonStateVersions(filePath, fs);
  for (const version of versions.slice(maxVersions)) {
    try {
      await fs.rm(version.path, { force: true });
    } catch {}
  }
}

export async function restoreJsonStateVersion(
  filePath: string,
  version: 'latest' | string = 'latest',
  options: { fs?: JsonFileSystem; maxVersions?: number } = {},
): Promise<JsonStateVersion> {
  const fs = jsonFileSystem(options.fs);
  const versions = await listJsonStateVersions(filePath, fs);
  const selected = version === 'latest'
    ? versions[0]
    : versions.find((candidate) => candidate.file === version || String(candidate.at) === version);

  if (!selected) {
    throw jsonDbError(
      'JSON_STATE_VERSION_NOT_FOUND',
      version === 'latest' ? `No version snapshots exist for ${filePath}.` : `Version "${version}" does not exist for ${filePath}.`,
      {
        status: 404,
        hint: 'List versions with listJsonStateVersions(), and enable durability: "versioned" so future writes keep history.',
        details: { filePath, version, availableVersions: versions.map((candidate) => candidate.file) },
      },
    );
  }

  const text = await fs.readFile(selected.path, 'utf8') as string;
  const existing = await currentJsonText(filePath, fs);
  if (existing !== null && existing !== text) {
    await snapshotJsonStateVersion(filePath, existing, fs);
    await pruneJsonStateVersions(filePath, options.maxVersions ?? DEFAULT_MAX_JSON_STATE_VERSIONS, fs);
  }
  await writeJsonTextAtomic(filePath, text, fs);
  return selected;
}

const writeQueues = new Map<string, Promise<unknown>>();

export function withJsonStateWrite<T>(
  filePath: string,
  operation: ResourceWriteOperation<T>,
  options: JsonStateWriteOptions = {},
): Promise<T> {
  const task = lockedJsonStateOperation(filePath, operation, options);
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const current = previous.then(task, task);
  const stored = current.catch(() => {});
  writeQueues.set(filePath, stored);
  stored.finally(() => {
    if (writeQueues.get(filePath) === stored) writeQueues.delete(filePath);
  });
  return current;
}

function lockedJsonStateOperation<T>(filePath: string, operation: ResourceWriteOperation<T>, options: JsonStateWriteOptions): () => Promise<T> {
  const useLock = options.crossProcessLock ?? ((options.fs ?? nodeFileSystem) === nodeFileSystem);
  if (!useLock) return async () => await operation();
  return async () => {
    const release = await acquireJsonStateLock(filePath, options);
    try {
      return await operation();
    } finally {
      await release();
    }
  };
}

type JsonStateLockInfo = {
  pid?: number;
  host?: string;
  createdAt?: number;
};

async function acquireJsonStateLock(filePath: string, options: JsonStateWriteOptions): Promise<() => Promise<void>> {
  const lockPath = `${filePath}.lock`;
  const timeoutMs = Math.max(0, options.lockTimeoutMs ?? 5000);
  const staleMs = Math.max(0, options.lockStaleMs ?? 10_000);
  const startedAt = Date.now();
  mkdirSync(path.dirname(lockPath), { recursive: true });

  for (;;) {
    try {
      await nodeWriteFile(lockPath, JSON.stringify({ pid: process.pid, host: hostname(), createdAt: Date.now() }), { flag: 'wx' });
      return async () => {
        await nodeRm(lockPath, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    const holder = await readJsonStateLock(lockPath);
    if (await reclaimStaleJsonStateLock(lockPath, holder, staleMs)) continue;
    if (Date.now() - startedAt >= timeoutMs) {
      throw jsonDbError(
        'JSON_STATE_LOCKED',
        `Timed out waiting for the JSON state lock: ${lockPath}`,
        {
          status: 503,
          hint: 'Another process is writing this resource. Retry, stop the other writer, or delete the lock file if its owner process is gone.',
          details: { filePath, lockPath, holder: holder ?? null, timeoutMs },
        },
      );
    }
    await sleepMs(5 + Math.random() * 10);
  }
}

async function readJsonStateLock(lockPath: string): Promise<JsonStateLockInfo | null> {
  try {
    return JSON.parse(await nodeReadFile(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

async function reclaimStaleJsonStateLock(lockPath: string, holder: JsonStateLockInfo | null, staleMs: number): Promise<boolean> {
  const holderPid = Number(holder?.pid);
  const sameHost = !holder?.host || holder.host === hostname();
  if (Number.isInteger(holderPid) && holderPid > 0 && sameHost) {
    if (holderPid !== process.pid && processIsAlive(holderPid)) return false;
    await nodeRm(lockPath, { force: true });
    return true;
  }
  const referenceTime = Number.isFinite(Number(holder?.createdAt)) && Number(holder?.createdAt) > 0
    ? Number(holder?.createdAt)
    : await lockFileMtime(lockPath);
  if (referenceTime === null) return true;
  if (Date.now() - referenceTime >= staleMs) {
    await nodeRm(lockPath, { force: true });
    return true;
  }
  return false;
}

async function lockFileMtime(lockPath: string): Promise<number | null> {
  try {
    return (await nodeStat(lockPath)).mtimeMs;
  } catch {
    return null;
  }
}

type JsonEncryptionCodec = {
  algorithm: 'aes-256-gcm';
  resolveKey(): Promise<Buffer>;
};

type EncryptedJsonEnvelope = {
  __asyncDbEncrypted: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
};

export function jsonEncryptionCodec(encryption: JsonStoreOptions['encryption'], storeName: string): JsonEncryptionCodec | null {
  if (!encryption) return null;
  if (!encryption.key) {
    throw jsonDbError(
      'JSON_ENCRYPTION_KEY_REQUIRED',
      `JSON store "${storeName}" enables encryption without a key.`,
      {
        status: 500,
        hint: 'Pass encryption: { key } with a 32-byte Buffer, a passphrase string, or a function returning either.',
        details: { store: storeName },
      },
    );
  }
  const algorithm = encryption.algorithm ?? 'aes-256-gcm';
  if (algorithm !== 'aes-256-gcm') {
    throw jsonDbError(
      'JSON_ENCRYPTION_ALGORITHM_UNSUPPORTED',
      `JSON store "${storeName}" requested unsupported encryption algorithm "${algorithm}".`,
      { status: 500, hint: 'Use the default aes-256-gcm algorithm.', details: { store: storeName, algorithm } },
    );
  }
  let cachedKey: Buffer | null = null;
  return {
    algorithm,
    async resolveKey() {
      if (cachedKey) return cachedKey;
      const raw = typeof encryption.key === 'function' ? await encryption.key() : encryption.key;
      cachedKey = normalizeEncryptionKey(raw, storeName);
      return cachedKey;
    },
  };
}

function normalizeEncryptionKey(raw: string | Uint8Array, storeName: string): Buffer {
  if (raw instanceof Uint8Array) {
    if (raw.byteLength !== 32) {
      throw jsonDbError(
        'JSON_ENCRYPTION_KEY_INVALID',
        `JSON store "${storeName}" received a ${raw.byteLength}-byte binary key; AES-256-GCM needs exactly 32 bytes.`,
        { status: 500, hint: 'Pass a 32-byte Buffer, or pass a passphrase string to derive a key via SHA-256.', details: { store: storeName, keyBytes: raw.byteLength } },
      );
    }
    return Buffer.from(raw);
  }
  return createHash('sha256').update(String(raw), 'utf8').digest();
}

function isEncryptedJsonEnvelope(value: unknown): value is EncryptedJsonEnvelope {
  return Boolean(value)
    && typeof value === 'object'
    && (value as EncryptedJsonEnvelope).__asyncDbEncrypted === 'aes-256-gcm'
    && typeof (value as EncryptedJsonEnvelope).iv === 'string'
    && typeof (value as EncryptedJsonEnvelope).tag === 'string'
    && typeof (value as EncryptedJsonEnvelope).data === 'string';
}

async function encryptJsonValue(value: unknown, codec: JsonEncryptionCodec): Promise<EncryptedJsonEnvelope> {
  const key = await codec.resolveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value) ?? 'null', 'utf8');
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { __asyncDbEncrypted: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

async function decryptJsonEnvelope(envelope: EncryptedJsonEnvelope, codec: JsonEncryptionCodec, filePath: string): Promise<unknown> {
  const key = await codec.resolveKey();
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw jsonDbError(
      'JSON_ENCRYPTION_FAILED',
      `Cannot decrypt JSON state file: ${filePath}`,
      {
        status: 500,
        hint: 'The encryption key does not match this file or the file was tampered with. Use the key that wrote the file, or restore from a backup/version snapshot.',
        details: { filePath },
      },
    );
  }
}

const MISSING_STATE: unique symbol = Symbol('async-json-missing-state');

export async function readEncryptedJsonState<T>(
  filePath: string,
  fallback: T,
  codec: JsonEncryptionCodec,
  fs: JsonFileSystem = nodeFileSystem,
): Promise<T> {
  const raw = await readJsonState<unknown>(filePath, MISSING_STATE, fs);
  if (raw === MISSING_STATE) return fallback;
  if (isEncryptedJsonEnvelope(raw)) return await decryptJsonEnvelope(raw, codec, filePath) as T;
  return raw as T;
}

export async function writeEncryptedJsonState(
  filePath: string,
  value: unknown,
  codec: JsonEncryptionCodec,
  options: { fs?: JsonFileSystem; versioned?: boolean; maxVersions?: number } = {},
): Promise<boolean> {
  const fs = jsonFileSystem(options.fs);
  const current = await readJsonState<unknown>(filePath, MISSING_STATE, fs);
  if (current !== MISSING_STATE) {
    const currentValue = isEncryptedJsonEnvelope(current)
      ? await decryptJsonEnvelope(current, codec, filePath).catch(() => MISSING_STATE)
      : current;
    if (currentValue !== MISSING_STATE && JSON.stringify(currentValue) === JSON.stringify(value)) return false;
  }
  const envelope = await encryptJsonValue(value, codec);
  return options.versioned
    ? atomicWriteJsonVersioned(filePath, envelope, { fs, maxVersions: options.maxVersions })
    : atomicWriteJson(filePath, envelope, fs);
}

export async function recoverJsonStateDir(directory: string, fs: JsonFileSystem = nodeFileSystem): Promise<JsonStateRecoveryReport> {
  const report: JsonStateRecoveryReport = { removedTempFiles: [], removedLocks: [] };
  let entries: string[];
  try {
    entries = await fs.readdir(directory) as string[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return report;
    throw error;
  }
  for (const entry of entries) {
    const filePath = path.join(directory, entry);
    if (/^\..+\.tmp$/.test(entry)) {
      const stats = await fs.stat?.(filePath).catch(() => null);
      if (!stats || Date.now() - stats.mtimeMs >= 60_000) {
        await fs.rm(filePath, { force: true });
        report.removedTempFiles.push(filePath);
      }
    }
    if (entry.endsWith('.json.lock') && await reclaimStaleJsonStateLock(filePath, await readJsonStateLock(filePath), 0)) {
      report.removedLocks.push(filePath);
    }
  }
  return report;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
