import { jsonDbError } from './error.js';
import { jsonFileSystem, type JsonFileSystem } from './fs.js';
import { parseJson, stableStringify } from './stable-json.js';
import { writeJsonTextAtomic } from './storage.js';

export type FilePatchUpdater<TValue = unknown> = (
  value: TValue,
) => TValue | void | Promise<TValue | void>;

export type FilePatch<TValue = unknown> =
  | Record<string, unknown>
  | FilePatchUpdater<TValue>;

export type FilePatchOptions = {
  fs?: JsonFileSystem;
  parse?: 'strict' | 'json5';
  space?: number | string | 'preserve';
  trailingNewline?: boolean | 'preserve';
};

export async function patchFile<TValue = unknown>(
  filePath: string,
  patch: FilePatch<TValue>,
  options: FilePatchOptions = {},
): Promise<boolean> {
  const fs = jsonFileSystem(options.fs);
  const originalText = await fs.readFile(filePath, 'utf8') as string;
  const originalValue = parseFileValue<TValue>(filePath, originalText, options);
  const nextValue = typeof patch === 'function'
    ? await patchWithUpdater(originalValue, patch)
    : patchObjectValue(filePath, originalValue, patch);
  const nextText = formatFileValue(nextValue, originalText, options);

  if (nextText === originalText) {
    return false;
  }

  await writeJsonTextAtomic(filePath, nextText, fs);
  return true;
}

export const file = {
  patch: patchFile,
};

async function patchWithUpdater<TValue>(value: TValue, updater: FilePatchUpdater<TValue>): Promise<TValue> {
  const result = await updater(value);
  return result === undefined ? value : result;
}

function patchObjectValue<TValue>(filePath: string, value: TValue, patch: Record<string, unknown>): TValue {
  if (!isPlainObject(value)) {
    throw jsonDbError(
      'JSON_FILE_PATCH_TARGET_INVALID',
      `Cannot patch JSON file "${filePath}" because its root value is not an object.`,
      {
        status: 400,
        hint: 'Pass a callback updater for non-object JSON roots, or patch an object JSON file such as package.json.',
        details: { filePath },
      },
    );
  }

  const next = structuredClone(value) as Record<string, unknown>;
  mergePatchObject(next, patch);
  return next as TValue;
}

function mergePatchObject(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete target[key];
      continue;
    }

    if (isPlainObject(target[key]) && isPlainObject(value)) {
      mergePatchObject(target[key] as Record<string, unknown>, value);
      continue;
    }

    target[key] = value;
  }
}

function parseFileValue<TValue>(filePath: string, text: string, options: FilePatchOptions): TValue {
  try {
    if (options.parse === 'json5') {
      return parseJson<TValue>(text);
    }
    return JSON.parse(text.replace(/^\uFEFF/u, '')) as TValue;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw jsonDbError(
        'JSON_FILE_INVALID',
        `JSON file is not valid JSON: ${filePath}`,
        {
          status: 400,
          hint: options.parse === 'json5'
            ? 'Fix the JSON5-compatible syntax before patching this file.'
            : 'Fix the JSON syntax before patching this file, or pass parse: "json5" for JSON5-compatible input.',
          details: { filePath, parserMessage: error.message },
        },
      );
    }
    throw error;
  }
}

function formatFileValue(value: unknown, originalText: string, options: FilePatchOptions): string {
  const space = options.space === undefined || options.space === 'preserve'
    ? inferIndentation(originalText)
    : options.space;
  const trailingNewline = options.trailingNewline === undefined || options.trailingNewline === 'preserve'
    ? originalText.endsWith('\n')
    : options.trailingNewline;
  const text = stableStringify(value, { sort: false, space });
  return trailingNewline ? `${text}\n` : text;
}

function inferIndentation(text: string): string {
  const match = /\n([ \t]+)(?="[^"]+":)/u.exec(text);
  if (match?.[1]) {
    return match[1];
  }
  return text.includes('\n') ? '  ' : '';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value);
}
