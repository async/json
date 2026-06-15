import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseJson,
  registerJson,
  stableJson,
  stableStringify,
} from '../dist/index.js';

test('stableStringify sorts object keys lexically by default', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":1}');
});

test('stableStringify preserves insertion order with sort false', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }, { sort: false }), '{"b":1,"a":2}');
});

test('stableStringify accepts a custom sort function', () => {
  assert.equal(
    stableStringify({ small: 1, longest: 2, mid: 3 }, {
      sort: (left, right) => right.length - left.length || left.localeCompare(right),
    }),
    '{"longest":2,"small":1,"mid":3}',
  );
});

test('stableStringify supports pretty true and explicit space', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }, true), '{\n  "a": 2,\n  "b": 1\n}');
  assert.equal(stableStringify({ b: 1, a: 2 }, { space: '--' }), '{\n--"a": 2,\n--"b": 1\n}');
});

test('stableStringify accepts second-argument and options replacers', () => {
  const seenPaths = [];
  const secondArg = stableStringify({ keep: 1, skip: 2 }, (key, value, context) => {
    seenPaths.push(`${key}:${context.path.join('.')}`);
    return key === 'skip' ? undefined : value;
  });
  assert.equal(secondArg, '{"keep":1}');
  assert.deepEqual(seenPaths, [':', 'keep:keep', 'skip:skip']);

  assert.equal(
    stableStringify({ a: 1 }, { replacer: (key, value) => key === 'a' ? 2 : value }),
    '{"a":2}',
  );
});

test('stableStringify throws on cycles by default and allows replacer ref output', () => {
  const node = { id: 'root' };
  node.self = node;
  assert.throws(() => stableStringify(node), /circular structure/i);
  assert.equal(
    stableStringify(node, (key, value, context) => context.circular
      ? { $ref: `#/${context.refPath?.join('/') ?? ''}` }
      : value),
    '{"id":"root","self":{"$ref":"#/"}}',
  );
});

test('parseJson accepts JSON5 and JSONC syntax', () => {
  assert.deepEqual(parseJson(`{
    // line comment
    unquoted: 'value',
    list: [1, 2,],
  }`), {
    unquoted: 'value',
    list: [1, 2],
  });
});

test('parseJson reviver receives post-order path context', () => {
  const calls = [];
  const value = parseJson('{"a":{"b":1},"list":[2]}', (key, current, context) => {
    calls.push({ key, path: context.path.join('/'), value: current });
    return current;
  });
  assert.deepEqual(value, { a: { b: 1 }, list: [2] });
  assert.deepEqual(calls.map((call) => `${call.key}:${call.path}`), [
    'b:a/b',
    'a:a',
    '0:list/0',
    'list:list',
    ':',
  ]);
});

test('parseJson exposes ref pointer helpers without automatic resolution', () => {
  const value = parseJson('{"users":{"u_1":{"name":"Ada"}},"owner":{"$ref":"#/users/u_1"}}', (key, current, context) => {
    if (context.isRef) {
      assert.equal(key, 'owner');
      assert.equal(context.ref, '#/users/u_1');
      assert.deepEqual(context.resolveRef(context.ref), { name: 'Ada' });
      return context.resolvePointer(context.ref);
    }
    return current;
  });
  assert.deepEqual(value, {
    users: { u_1: { name: 'Ada' } },
    owner: { name: 'Ada' },
  });
});

test('parseJson pointer resolution decodes escaped segments', () => {
  const value = parseJson('{"a/b":{"c~d":1},"ref":{"$ref":"#/a~1b/c~0d"}}', (_key, current, context) =>
    context.isRef ? context.resolvePointer(context.ref ?? '#') : current,
  );
  assert.equal(value.ref, 1);
});

test('stableJson sugar and registerJson expose the same helpers', () => {
  assert.equal(stableJson.stringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.deepEqual(stableJson.parse('{a: 1}'), { a: 1 });

  const target = { JSON };
  const restore = registerJson({ target });
  try {
    assert.equal(target.JSON.stringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
    assert.equal(target.JSON.stringify({ b: 1, a: 2 }, ['b'], 2), '{\n  "b": 1\n}');
    assert.deepEqual(target.JSON.parse('{a: 1}'), { a: 1 });
  } finally {
    restore();
  }
  assert.equal(target.JSON, JSON);
});
