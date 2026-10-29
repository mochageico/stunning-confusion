// Runs src/lib/queueOutbox.check.ts standalone under plain Node.
//
// Same shape as run-queue-check.cjs: queueOutbox.ts is pure (it imports
// nothing but types), but it's TypeScript, so esbuild bundles it to CJS in
// memory and Node executes the result. Its file storage lives apart, in
// queueOutboxStore.ts, which this never loads.
//
// Usage: npm run check:outbox
const esbuild = require('esbuild');
const path = require('path');
const Module = require('module');

const result = esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '../src/lib/queueOutbox.check.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});

const code = result.outputFiles[0].text;
const m = new Module('outbox-check', null);
m.filename = path.resolve(__dirname, 'outbox-check-bundle.cjs');
m.paths = Module._nodeModulePaths(process.cwd());
m._compile(code, m.filename);
