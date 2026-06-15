import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { file, patchFile } from '../dist/index.js';

async function tempProject() {
  return await mkdtemp(path.join(tmpdir(), 'async-json-file-test-'));
}

test('file.patch updates package.json without reordering existing keys', async () => {
  const cwd = await tempProject();
  const packageJson = path.join(cwd, 'package.json');
  await writeFile(packageJson, `{
  "name": "demo",
  "version": "1.0.0",
  "scripts": {
    "build": "tsc",
    "test": "node --test"
  },
  "dependencies": {
    "left-pad": "1.3.0"
  }
}
`);

  assert.equal(await file.patch(packageJson, {
    scripts: {
      lint: 'eslint .',
    },
    devDependencies: {
      typescript: '^6.0.0',
    },
  }), true);

  assert.equal(await readFile(packageJson, 'utf8'), `{
  "name": "demo",
  "version": "1.0.0",
  "scripts": {
    "build": "tsc",
    "test": "node --test",
    "lint": "eslint ."
  },
  "dependencies": {
    "left-pad": "1.3.0"
  },
  "devDependencies": {
    "typescript": "^6.0.0"
  }
}
`);
});

test('patchFile returns false when a patch does not change file text', async () => {
  const cwd = await tempProject();
  const packageJson = path.join(cwd, 'package.json');
  await writeFile(packageJson, '{\n  "name": "demo"\n}\n');

  assert.equal(await patchFile(packageJson, { name: 'demo' }), false);
  assert.equal(await readFile(packageJson, 'utf8'), '{\n  "name": "demo"\n}\n');
});

test('file.patch accepts callback updates and preserves existing object order', async () => {
  const cwd = await tempProject();
  const packageJson = path.join(cwd, 'package.json');
  await writeFile(packageJson, `{
  "name": "demo",
  "scripts": {
    "build": "tsc"
  },
  "license": "MIT"
}
`);

  await file.patch(packageJson, (pkg) => {
    pkg.scripts.test = 'node --test';
    pkg.description = 'demo package';
  });

  assert.equal(await readFile(packageJson, 'utf8'), `{
  "name": "demo",
  "scripts": {
    "build": "tsc",
    "test": "node --test"
  },
  "license": "MIT",
  "description": "demo package"
}
`);
});

test('file.patch can parse JSON5-compatible input when requested', async () => {
  const cwd = await tempProject();
  const packageJson = path.join(cwd, 'package.json');
  await writeFile(packageJson, `{
  // package metadata
  name: 'demo',
}
`);

  await file.patch(packageJson, { version: '1.0.0' }, { parse: 'json5' });

  assert.equal(await readFile(packageJson, 'utf8'), `{
  "name": "demo",
  "version": "1.0.0"
}
`);
});
