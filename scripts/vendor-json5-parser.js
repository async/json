#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json5Root = path.dirname(require.resolve('json5/package.json'));
const check = process.argv.includes('--check');

const parseSource = readFileSync(path.join(json5Root, 'lib/parse.js'), 'utf8');
const utilSource = readFileSync(path.join(json5Root, 'lib/util.js'), 'utf8');
const unicodeSource = readFileSync(path.join(json5Root, 'lib/unicode.js'), 'utf8');
const licenseSource = readFileSync(path.join(json5Root, 'LICENSE.md'), 'utf8');
const packageJson = JSON.parse(readFileSync(path.join(json5Root, 'package.json'), 'utf8'));

const vendorDir = path.join(repoRoot, 'src/vendor');
const parserPath = path.join(vendorDir, 'json5-parser.ts');
const licensePath = path.join(vendorDir, 'json5-parser.LICENSE.md');

const parserOutput = [
  `// Vendored from json5@${packageJson.version}. Regenerate with pnpm run vendor:json5.`,
  '// Upstream license: MIT. See json5-parser.LICENSE.md and the notice below.',
  '/*',
  ...licenseSource.trimEnd().split('\n'),
  '*/',
  '// @ts-nocheck',
  '',
  transformUnicode(unicodeSource),
  '',
  transformUtil(utilSource),
  '',
  transformParse(parseSource),
  '',
  'export { parseJson5 };',
  '',
].join('\n');

const licenseOutput = [
  `Vendored parser source from json5@${packageJson.version}.`,
  'Original package: https://github.com/json5/json5',
  '',
  licenseSource.trimEnd(),
  '',
].join('\n');

if (check) {
  assertSame(parserPath, parserOutput);
  assertSame(licensePath, licenseOutput);
  process.exit(0);
}

mkdirSync(vendorDir, { recursive: true });
writeFileSync(parserPath, parserOutput);
writeFileSync(licensePath, licenseOutput);

function transformUnicode(source) {
  return source
    .replace('// This is a generated file. Do not edit.', '// Unicode tables from json5.')
    .replace(/^module\.exports\.(\w+) = /gm, 'const $1 = ');
}

function transformUtil(source) {
  return source
    .replace("const unicode = require('../lib/unicode')\n\n", '')
    .replace(/\bunicode\./g, '')
    .replace('module.exports = {', 'const util = {');
}

function transformParse(source) {
  return source
    .replace("const util = require('./util')\n\n", '')
    .replace('module.exports = function parse (text, reviver) {', 'function parseJson5 (text, reviver) {');
}

function assertSame(filePath, expected) {
  let actual;
  try {
    actual = readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`${path.relative(repoRoot, filePath)} is missing. Run pnpm run vendor:json5.`);
  }

  if (actual !== expected) {
    throw new Error(`${path.relative(repoRoot, filePath)} is out of date. Run pnpm run vendor:json5.`);
  }
}
