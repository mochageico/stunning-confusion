// Runs src/lib/ladderMigration.check.ts standalone under plain Node.
//
// Same shape as run-queue-check.cjs: ladderMigration.ts is pure TypeScript with no
// react-native imports, so esbuild bundles it to CJS in memory and Node runs it.
//
// Usage: npm run check:migration
const esbuild = require('esbuild');
const path = require('path');
const Module = require('module');

const result = esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '../src/lib/ladderMigration.check.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});

const code = result.outputFiles[0].text;
const m = new Module('migration-check', null);
m.filename = path.resolve(__dirname, 'migration-check-bundle.cjs');
m.paths = Module._nodeModulePaths(process.cwd());
m._compile(code, m.filename);
