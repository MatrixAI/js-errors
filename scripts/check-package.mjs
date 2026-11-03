import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'tmp/package-candidate');
const consumer = path.join(output, 'consumer');
const manifestText = await readFile(path.join(root, 'package.json'), 'utf8');
await rm(output, { recursive: true, force: true });
await mkdir(path.join(consumer, 'node_modules/@matrixai/errors'), {
  recursive: true,
});
execFileSync(
  process.execPath,
  [
    process.env.npm_execpath,
    'pack',
    '--offline',
    '--ignore-scripts',
    '--pack-destination',
    output,
  ],
  { cwd: root, stdio: 'inherit' },
);
const archives = (await readdir(output)).filter((name) =>
  name.endsWith('.tgz'),
);
assert.equal(archives.length, 1);
const archive = path.join(output, archives[0]);
const installed = path.join(consumer, 'node_modules/@matrixai/errors');
execFileSync('tar', ['-xzf', archive, '-C', installed, '--strip-components=1']);
assert.equal(
  await readFile(path.join(installed, 'package.json'), 'utf8'),
  manifestText,
);
assert.deepEqual((await readdir(installed)).sort(), [
  'LICENSE',
  'README.md',
  'dist',
  'package.json',
]);
assert(!(await readdir(path.join(installed, 'dist'))).includes('tsbuildinfo'));
// Reconstruct the declared runtime dependency from this lockfile's installation.
// This is a packed-package proof, not a fresh recursive npm-install claim.
await cp(
  path.join(root, 'node_modules/ts-custom-error'),
  path.join(consumer, 'node_modules/ts-custom-error'),
  { recursive: true },
);
await writeFile(
  path.join(consumer, 'package.json'),
  '{"private":true,"type":"module"}\n',
);
await writeFile(
  path.join(consumer, 'smoke.mjs'),
  `
import assert from 'node:assert/strict';
import { AbstractError, utils } from '@matrixai/errors';
import DirectError from '@matrixai/errors/AbstractError.js';
import { readFileSync } from 'node:fs';
assert.equal(DirectError, AbstractError);
assert.equal(JSON.parse(readFileSync(new URL(import.meta.resolve('@matrixai/errors/package.json')), 'utf8')).name, '@matrixai/errors');
assert.equal(JSON.parse(readFileSync(new URL(import.meta.resolve('@matrixai/errors/AbstractError.js.map')), 'utf8')).version, 3);
const cause = new TypeError('cause');
const error = new AbstractError('packed', { cause });
assert.equal(error.cause, cause);
assert.ok(utils.checkError(new AggregateError([error]), (e) => e === cause));
assert.equal(AbstractError.fromJSON(JSON.parse(JSON.stringify(error))).message, 'packed');
assert.ok(Number.isFinite(error.timestamp.getTime()));
`,
);
execFileSync(process.execPath, ['smoke.mjs'], {
  cwd: consumer,
  stdio: 'inherit',
});
await writeFile(
  path.join(consumer, 'types.ts'),
  `
import { AbstractError, utils } from '@matrixai/errors';
import type { POJO } from '@matrixai/errors';
import DirectError from '@matrixai/errors/AbstractError.js';
const data: POJO = { packed: true };
const error: AbstractError<TypeError> = new DirectError('typed', { data, cause: new TypeError() });
const timestamp: Date = error.timestamp;
utils.checkError(error, (value: unknown) => value === timestamp);
`,
);
await writeFile(
  path.join(consumer, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      types: [],
      lib: ['ES2022'],
      verbatimModuleSyntax: true,
      skipLibCheck: false,
    },
    include: ['types.ts'],
  }),
);
execFileSync(
  process.execPath,
  [
    path.join(root, 'node_modules/typescript/bin/tsc'),
    '-p',
    path.join(consumer, 'tsconfig.json'),
  ],
  { stdio: 'inherit' },
);
await cp(
  path.join(root, 'tests/fixtures/browser/runtime.mjs'),
  path.join(consumer, 'browser.js'),
);
const bundled = await build({
  entryPoints: [path.join(consumer, 'browser.js')],
  outfile: path.join(output, 'browser.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  tsconfigRaw: {},
  metafile: true,
});
assert(
  Object.keys(bundled.metafile.inputs).some((name) =>
    name.endsWith('node_modules/@matrixai/errors/dist/AbstractError.js'),
  ),
);
await writeFile(
  path.join(output, 'bundle-inputs.json'),
  JSON.stringify(bundled.metafile, null, 2),
);
await writeFile(
  path.join(output, 'report.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      status: 'passed',
      archive: path.basename(archive),
      manifest: 'byte-identical',
      node: process.version,
      checks: [
        'node-imports',
        'exports',
        'declarations-without-node-types',
        'browser-bundle-without-aliases',
      ],
    },
    null,
    2,
  ),
);
