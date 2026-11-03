import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, 'tmp/integration-browser');
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'artifacts'), { recursive: true });
const bundle = await readFile(
  path.join(root, 'tmp/package-candidate/browser.js'),
);
const server = createServer((request, response) => {
  if (request.url === '/browser.js' || request.url === '/worker.js') {
    response.setHeader('content-type', 'text/javascript');
    response.end(bundle);
  } else {
    response.setHeader('content-type', 'text/html');
    response.end(
      '<!doctype html><title>Errors</title><script type="module" src="/browser.js"></script>',
    );
  }
});
let browser;
const results = [];
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  const address = server.address();
  assert(address != null && typeof address !== 'string');
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.waitForFunction(() => globalThis.errorsResult != null);
  results.push({
    runtime: 'document',
    ...(await page.evaluate(() => globalThis.errorsResult)),
  });
  const workerResult = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const worker = new Worker('/worker.js', { type: 'module' });
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(new Error('Worker timed out'));
        }, 20000);
        worker.onmessage = (event) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve(event.data);
        };
        worker.onerror = (event) => {
          clearTimeout(timeout);
          worker.terminate();
          reject(new Error(event.message));
        };
      }),
  );
  results.push({ runtime: 'dedicated-worker', ...workerResult });
  for (const result of results) {
    assert.equal(result.name, 'BrowserError');
    assert.equal(result.description, 'portable');
    assert.equal(result.monotonic, true);
    assert.equal(result.decoded, true);
    assert.equal(result.graph, true);
    assert(Math.abs(Date.now() - result.timestamp) < 60000);
  }
  await writeFile(
    path.join(output, 'artifacts/bundle-inputs.json'),
    await readFile(path.join(root, 'tmp/package-candidate/bundle-inputs.json')),
  );
  await writeFile(
    path.join(output, 'artifacts/cases.json'),
    JSON.stringify(results, null, 2),
  );
  await writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        name: 'integration-browser',
        kind: 'integration',
        status: 'passed',
        system:
          process.env.CHECK_SYSTEM ?? `${process.arch}-${process.platform}`,
        summary:
          'Packed errors passed in Chromium document and dedicated worker without builtin aliases',
        artifacts: {
          cases: 'artifacts/cases.json',
          bundleInputs: 'artifacts/bundle-inputs.json',
        },
        browser: browser.version(),
        playwright: process.env.CHECK_PLAYWRIGHT_VERSION ?? '1.59.1',
        scope:
          'Local Chromium document and dedicated worker, packed package, no builtin aliases',
        results,
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    'Packed errors passed in Chromium document and dedicated worker\n',
  );
} finally {
  await browser?.close();
  if (server.listening) {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
