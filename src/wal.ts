import { createHash } from 'node:crypto';
import path from 'node:path';
import { jsonFileSystem, nodeFileSystem, type JsonFileSystem } from './fs.js';

export type WalFsyncPolicy = 'always' | 'everysec' | 'no';

export type WalDelta =
  | { op: 'put-record'; idField: string; record: Record<string, unknown> }
  | { op: 'delete-record'; idField: string; id: unknown }
  | { op: 'replace-all'; value: unknown };

export type WalEntry = WalDelta & {
  seq: number;
  at: string;
  source?: 'runtime' | 'external' | 'refresh' | string;
};

type WalBaseLine = {
  op: 'base';
  hash: string | null;
  seq: number;
};

export type WalReadResult = {
  baseHash: string | null;
  baseSeq: number;
  entries: WalEntry[];
};

export function walPathFor(walDir: string, resourceName: string): string {
  return path.join(walDir, `${resourceName}.jsonl`);
}

export function walContentHash(text: string | null): string | null {
  if (text === null) return null;
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 24);
}

export async function appendWalEntry(
  walPath: string,
  entry: WalEntry,
  options: { fsync?: WalFsyncPolicy; fs?: JsonFileSystem } = {},
): Promise<void> {
  const fs = jsonFileSystem(options.fs);
  await fs.mkdir(path.dirname(walPath), { recursive: true });
  if (!fs.appendFile) {
    throw new Error('WAL durability requires a file system with appendFile support.');
  }
  await fs.appendFile(walPath, `${JSON.stringify(entry)}\n`, 'utf8');
  await applyWalFsyncPolicy(walPath, options.fsync ?? 'everysec', fs);
}

export async function readWal(walPath: string, fs: JsonFileSystem = nodeFileSystem): Promise<WalReadResult> {
  let text: string;
  try {
    text = await fs.readFile(walPath, 'utf8') as string;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { baseHash: null, baseSeq: 0, entries: [] };
    }
    throw error;
  }

  const result: WalReadResult = { baseHash: null, baseSeq: 0, entries: [] };
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    let parsed: WalEntry | WalBaseLine;
    try {
      parsed = JSON.parse(line);
    } catch {
      break;
    }
    if (parsed.op === 'base') {
      result.baseHash = parsed.hash;
      result.baseSeq = Number(parsed.seq) || 0;
      result.entries = [];
      continue;
    }
    result.entries.push(parsed as WalEntry);
  }
  return result;
}

export async function rotateWal(
  walPath: string,
  baseHash: string | null,
  baseSeq: number,
  fs: JsonFileSystem = nodeFileSystem,
): Promise<void> {
  await fs.mkdir(path.dirname(walPath), { recursive: true });
  const tempPath = `${walPath}.${process.pid}.${Date.now()}.rotate`;
  await fs.writeFile(tempPath, `${JSON.stringify({ op: 'base', hash: baseHash, seq: baseSeq })}\n`, 'utf8');
  await fs.fsync?.(tempPath);
  await fs.rename(tempPath, walPath);
}

export function replayWal(checkpoint: unknown, entries: WalEntry[]): unknown {
  let value = checkpoint;
  for (const entry of entries) {
    if (entry.op === 'replace-all') {
      value = entry.value;
      continue;
    }
    const records = Array.isArray(value) ? [...value] as Array<Record<string, unknown>> : [];
    if (entry.op === 'put-record') {
      const index = records.findIndex((record) => idMatches(record?.[entry.idField], entry.record?.[entry.idField]));
      if (index === -1) records.push(entry.record);
      else records[index] = entry.record;
      value = records;
      continue;
    }
    if (entry.op === 'delete-record') {
      value = records.filter((record) => !idMatches(record?.[entry.idField], entry.id));
    }
  }
  return value;
}

function idMatches(left: unknown, right: unknown): boolean {
  return left !== undefined && left !== null && right !== undefined && right !== null && String(left) === String(right);
}

const pendingEverysecFsyncs = new Set<string>();
let everysecTimer: NodeJS.Timeout | null = null;

async function applyWalFsyncPolicy(walPath: string, policy: WalFsyncPolicy, fs: JsonFileSystem): Promise<void> {
  if (policy === 'no' || !fs.fsync) return;
  if (policy === 'always') {
    await fs.fsync(walPath);
    return;
  }

  pendingEverysecFsyncs.add(walPath);
  if (everysecTimer) return;
  everysecTimer = setInterval(() => {
    const paths = [...pendingEverysecFsyncs];
    pendingEverysecFsyncs.clear();
    if (paths.length === 0 && everysecTimer) {
      clearInterval(everysecTimer);
      everysecTimer = null;
      return;
    }
    for (const pending of paths) {
      void nodeFileSystem.fsync?.(pending).catch(() => {});
    }
  }, 1000);
  everysecTimer.unref?.();
}

export async function flushWalFsyncs(): Promise<void> {
  const paths = [...pendingEverysecFsyncs];
  pendingEverysecFsyncs.clear();
  if (everysecTimer) {
    clearInterval(everysecTimer);
    everysecTimer = null;
  }
  await Promise.all(paths.map((pending) => nodeFileSystem.fsync?.(pending).catch(() => {})));
}
