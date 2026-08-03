// Runs src/lib/queueReorder.check.ts standalone under plain Node.
//
// Same shape as run-recitation-check.cjs, and for the same reason: the logic
// under test is pure (reviewCalendar.ts + groupPlanScheduler.ts import
// nothing but types), but it's TypeScript, so esbuild bundles it to CJS in
// memory and Node executes the result. No react-native alias is needed here
// -- neither module touches it.
//
// Usage: npm run check:queue
const esbuild = require('esbuild');
const path = require('path');
const Module = require('module');

const result = esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '../src/lib/queueReorder.check.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});

const code = result.outputFiles[0].text;
const m = new Module('queue-check', null);
m.filename = path.resolve(__dirname, 'queue-check-bundle.cjs');
m.paths = Module._nodeModulePaths(process.cwd());
m._compile(code, m.filename);
