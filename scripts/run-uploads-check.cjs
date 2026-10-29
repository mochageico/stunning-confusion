// Runs src/lib/recordingUploads.check.ts standalone under plain Node.
//
// Same shape as run-outbox-check.cjs: recordingUploads.ts is pure (it
// imports nothing but types), but it's TypeScript, so esbuild bundles it to
// CJS in memory and Node executes the result. Its files live apart, in
// recordingUploadStore.ts, which this never loads.
//
// Usage: npm run check:uploads
const esbuild = require('esbuild');
const path = require('path');
const Module = require('module');

const result = esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '../src/lib/recordingUploads.check.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});

const code = result.outputFiles[0].text;
const m = new Module('uploads-check', null);
m.filename = path.resolve(__dirname, 'uploads-check-bundle.cjs');
m.paths = Module._nodeModulePaths(process.cwd());
m._compile(code, m.filename);
