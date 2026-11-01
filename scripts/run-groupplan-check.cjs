// Runs src/lib/groupPlanSchedule.check.ts standalone under plain Node.
//
// Same shape as run-queue-check.cjs: groupplan.ts is pure TypeScript with no
// react-native imports, so esbuild bundles it to CJS in memory and Node runs it.
//
// Usage: npm run check:groupplan
const esbuild = require('esbuild');
const path = require('path');
const Module = require('module');

const result = esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '../src/lib/groupPlanSchedule.check.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});

const code = result.outputFiles[0].text;
const m = new Module('groupplan-check', null);
m.filename = path.resolve(__dirname, 'groupplan-check-bundle.cjs');
m.paths = Module._nodeModulePaths(process.cwd());
m._compile(code, m.filename);
