import { parseJson5 } from './vendor/json5-parser.js';

export type JsonStableStringifyReplacer = (
  key: string,
  value: unknown,
  context: JsonStableStringifyContext,
) => unknown;

export type JsonStableStringifySort = (
  left: string,
  right: string,
  context: { path: string[]; value: Record<string, unknown> },
) => number;

export type JsonStableStringifyOptions = {
  pretty?: boolean;
  space?: number | string;
  sort?: boolean | JsonStableStringifySort;
  replacer?: JsonStableStringifyReplacer;
};

export type JsonStableStringifyContext = {
  path: string[];
  circular: boolean;
  refPath: string[] | null;
  value: unknown;
};

export type JsonParseReviver = (
  key: string,
  value: unknown,
  context: JsonParseReviverContext,
) => unknown;

export type JsonParseOptions = {
  reviver?: JsonParseReviver;
};

export type JsonParseReviverContext = {
  path: string[];
  root: unknown;
  isRef: boolean;
  ref: string | null;
  resolvePointer(ref: string): unknown;
  resolveRef(ref: string): unknown;
};

export type JsonRegisterOptions = {
  target?: { JSON?: JSON };
};

export type JsonRestore = () => void;

type NativeJsonReplacer = ((this: unknown, key: string, value: unknown) => unknown) | Array<string | number> | null;

type NormalizedStringifyOptions = {
  propertyList?: string[];
  replacer?: JsonStableStringifyReplacer;
  sort: boolean | JsonStableStringifySort;
  space: string;
};

type StringifyOptionsInput =
  | boolean
  | JsonStableStringifyReplacer
  | JsonStableStringifyOptions
  | NativeJsonReplacer
  | null
  | undefined;

export function stableStringify(
  value: unknown,
  options?: boolean | JsonStableStringifyReplacer | JsonStableStringifyOptions,
): string {
  const normalized = normalizeStringifyOptions(options);
  if (isFastStringifyOptions(normalized)) {
    return stringifyFast(value, new Set()) as string;
  }

  return stringifyRich({ '': value }, '', [], new Map(), normalized, '') as string;
}

export function parseJson<TValue = unknown>(text: string, options?: JsonParseReviver | JsonParseOptions): TValue {
  const root = parseJson5(String(text).replace(/^\uFEFF/u, ''), undefined);
  const reviver = typeof options === 'function' ? options : options?.reviver;
  if (typeof reviver !== 'function') {
    return root as TValue;
  }

  const holder = { '': root };
  const state = { root: root as unknown };
  return walkParsedValue(holder, '', [], reviver, state) as TValue;
}

export function registerJson(options: JsonRegisterOptions = {}): JsonRestore {
  const target = (options.target ?? globalThis) as { JSON?: JSON };
  const descriptor = Object.getOwnPropertyDescriptor(target, 'JSON');
  const previousJson = target.JSON ?? JSON;
  const shim = Object.create(Object.getPrototypeOf(previousJson)) as JSON;

  for (const [key, propertyDescriptor] of Object.entries(Object.getOwnPropertyDescriptors(previousJson))) {
    Object.defineProperty(shim, key, propertyDescriptor);
  }

  Object.defineProperty(shim, 'parse', {
    value(text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) {
      return parseJson(text, typeof reviver === 'function' ? reviver as JsonParseReviver : undefined);
    },
    writable: true,
    configurable: true,
  });

  Object.defineProperty(shim, 'stringify', {
    value(value: unknown, replacer?: NativeJsonReplacer, space?: string | number) {
      return stringifyWithNativeArgs(value, replacer, space);
    },
    writable: true,
    configurable: true,
  });

  Object.defineProperty(target, 'JSON', {
    value: shim,
    writable: true,
    configurable: true,
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(target, 'JSON', descriptor);
    } else {
      delete target.JSON;
    }
  };
}

export const stableJson = {
  parse: parseJson,
  stringify: stableStringify,
  register: registerJson,
};

function stringifyWithNativeArgs(value: unknown, replacer?: NativeJsonReplacer, space?: string | number): string {
  if (replacer === undefined && space === undefined) {
    return stableStringify(value);
  }

  return stringifyRich({ '': value }, '', [], new Map(), normalizeStringifyOptions(replacer, space), '') as string;
}

function normalizeStringifyOptions(input?: StringifyOptionsInput, nativeSpace?: string | number): NormalizedStringifyOptions {
  if (input === true) {
    return {
      sort: true,
      space: normalizeSpace(2),
    };
  }

  if (typeof input === 'function') {
    return {
      replacer: input as JsonStableStringifyReplacer,
      sort: true,
      space: normalizeSpace(nativeSpace),
    };
  }

  if (Array.isArray(input)) {
    return {
      propertyList: propertyList(input),
      sort: true,
      space: normalizeSpace(nativeSpace),
    };
  }

  if (input && typeof input === 'object') {
    return {
      replacer: typeof input.replacer === 'function' ? input.replacer : undefined,
      sort: input.sort ?? true,
      space: normalizeSpace(input.space ?? (input.pretty ? 2 : nativeSpace)),
    };
  }

  return {
    sort: true,
    space: normalizeSpace(nativeSpace),
  };
}

function isFastStringifyOptions(options: NormalizedStringifyOptions): boolean {
  return options.sort === true
    && options.space === ''
    && !options.replacer
    && !options.propertyList;
}

function normalizeSpace(space: unknown): string {
  if (typeof space === 'number') {
    return ' '.repeat(Math.min(10, Math.max(0, Math.trunc(space))));
  }

  if (typeof space === 'string') {
    return space.slice(0, 10);
  }

  return '';
}

function propertyList(input: Array<string | number>): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const value of input) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      continue;
    }
    const key = String(value);
    if (!seen.has(key)) {
      seen.add(key);
      list.push(key);
    }
  }
  return list;
}

function stringifyFast(value: unknown, seen: Set<object>): string | undefined {
  const prepared = prepareJsonValue(value, '');
  if (!isJsonSerializableValue(prepared)) {
    return undefined;
  }

  return stringifyPreparedFast(prepared, seen);
}

function stringifyPreparedFast(value: unknown, seen: Set<object>): string {
  if (value === null) {
    return 'null';
  }

  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return stringifyPrimitive(value);
  }
  if (type === 'bigint') {
    throw new TypeError('Do not know how to serialize a BigInt');
  }
  if (type !== 'object') {
    return 'null';
  }

  const object = value as object;
  if (seen.has(object)) {
    throw new TypeError('Converting circular structure to stable JSON');
  }

  seen.add(object);
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const item = prepareJsonValue(value[index], String(index));
      items.push(isJsonSerializableValue(item)
        ? stringifyPreparedFast(item, seen)
        : 'null');
    }
    seen.delete(object);
    return `[${items.join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const fields: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const item = prepareJsonValue(record[key], key);
    if (!isJsonSerializableValue(item)) {
      continue;
    }
    fields.push(`${JSON.stringify(key)}:${stringifyPreparedFast(item, seen)}`);
  }
  seen.delete(object);
  return `{${fields.join(',')}}`;
}

function stringifyRich(
  holder: Record<string, unknown> | unknown[],
  key: string,
  path: string[],
  seen: Map<object, string[]>,
  options: NormalizedStringifyOptions,
  indent: string,
): string | undefined {
  const original = prepareJsonValue(holder[key as keyof typeof holder], key);
  const refPath = isObjectLike(original) ? seen.get(original as object) ?? null : null;
  let value = original;

  if (options.replacer) {
    value = options.replacer.call(holder, key, value, {
      path,
      circular: refPath !== null,
      refPath,
      value,
    });
  }

  if (!isJsonSerializableValue(value)) {
    return undefined;
  }

  if (isObjectLike(value) && seen.has(value as object)) {
    throw new TypeError('Converting circular structure to stable JSON');
  }

  return stringifyPreparedRich(value, path, seen, options, indent);
}

function stringifyPreparedRich(
  value: unknown,
  path: string[],
  seen: Map<object, string[]>,
  options: NormalizedStringifyOptions,
  indent: string,
): string {
  if (value === null) {
    return 'null';
  }

  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return stringifyPrimitive(value);
  }
  if (type === 'bigint') {
    throw new TypeError('Do not know how to serialize a BigInt');
  }
  if (type !== 'object') {
    return 'null';
  }

  const object = value as object;
  seen.set(object, path);
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const rendered = stringifyRich(value, String(index), [...path, String(index)], seen, options, `${indent}${options.space}`);
      items.push(rendered ?? 'null');
    }
    seen.delete(object);
    return renderArray(items, indent, options.space);
  }

  const entries: string[] = [];
  const record = value as Record<string, unknown>;
  const keys = keysForObject(record, path, options);
  for (const field of keys) {
    const rendered = stringifyRich(record, field, [...path, field], seen, options, `${indent}${options.space}`);
    if (rendered !== undefined) {
      entries.push(`${JSON.stringify(field)}:${options.space ? ' ' : ''}${rendered}`);
    }
  }
  seen.delete(object);
  return renderObject(entries, indent, options.space);
}

function keysForObject(record: Record<string, unknown>, path: string[], options: NormalizedStringifyOptions): string[] {
  if (options.propertyList) {
    return options.propertyList.filter((key) => Object.prototype.hasOwnProperty.call(record, key));
  }

  const keys = Object.keys(record);
  if (options.sort === false) {
    return keys;
  }
  if (typeof options.sort === 'function') {
    return keys.sort((left, right) => (options.sort as JsonStableStringifySort)(left, right, { path, value: record }));
  }
  return keys.sort();
}

function renderArray(items: string[], indent: string, space: string): string {
  if (!space || items.length === 0) {
    return `[${items.join(',')}]`;
  }

  const nextIndent = `${indent}${space}`;
  return `[\n${nextIndent}${items.join(`,\n${nextIndent}`)}\n${indent}]`;
}

function renderObject(entries: string[], indent: string, space: string): string {
  if (!space || entries.length === 0) {
    return `{${entries.join(',')}}`;
  }

  const nextIndent = `${indent}${space}`;
  return `{\n${nextIndent}${entries.join(`,\n${nextIndent}`)}\n${indent}}`;
}

function stringifyPrimitive(value: unknown): string {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return 'null';
  }

  return JSON.stringify(value) as string;
}

function prepareJsonValue(value: unknown, key: string): unknown {
  if (value && typeof value === 'object') {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') {
      return toJSON.call(value, key);
    }
  }
  return value;
}

function isJsonSerializableValue(value: unknown): boolean {
  return value !== undefined && typeof value !== 'function' && typeof value !== 'symbol';
}

function isObjectLike(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

function walkParsedValue(
  holder: Record<string, unknown> | unknown[],
  key: string,
  path: string[],
  reviver: JsonParseReviver,
  state: { root: unknown },
): unknown {
  let value = holder[key as keyof typeof holder];
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const replacement = walkParsedValue(value, String(index), [...path, String(index)], reviver, state);
        if (replacement === undefined) {
          delete value[index];
        } else {
          value[index] = replacement;
        }
      }
    } else {
      for (const childKey of Object.keys(value)) {
        const replacement = walkParsedValue(value as Record<string, unknown>, childKey, [...path, childKey], reviver, state);
        if (replacement === undefined) {
          delete (value as Record<string, unknown>)[childKey];
        } else {
          (value as Record<string, unknown>)[childKey] = replacement;
        }
      }
    }
  }

  const ref = isRefObject(value) ? value.$ref : null;
  const replacement = reviver.call(holder, key, value, {
    path,
    get root() {
      return state.root;
    },
    isRef: ref !== null,
    ref,
    resolvePointer: (pointer) => resolveJsonPointer(state.root, pointer),
    resolveRef: (pointer) => resolveJsonPointer(state.root, pointer),
  });
  if (key === '') {
    state.root = replacement;
  }
  return replacement;
}

function isRefObject(value: unknown): value is { $ref: string } {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as { $ref?: unknown }).$ref === 'string';
}

function resolveJsonPointer(root: unknown, ref: string): unknown {
  if (ref === '#') {
    return root;
  }
  if (!ref.startsWith('#/')) {
    throw new TypeError(`Unsupported JSON ref "${ref}". Use "#" or "#/path".`);
  }

  let value = root;
  for (const segment of ref.slice(2).split('/').map(decodePointerSegment)) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function decodePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}
