// Runs src/lib/reviewLog.check.ts standalone under plain Node.
//
// Same shape as run-queue-check.cjs: reviewLog.ts is pure TypeScript with no
// react-native imports, so esbuild bundles it to CJS in memory and Node runs it.
//
// Usage: npm run check:reviewlog
const esbuild = require('esbuild');
const path = require('path');
const Module = require('module');

const result = esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '../src/lib/reviewLog.check.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});

const code = result.outputFiles[0].text;
const m = new Module('reviewlog-check', null);
m.filename = path.resolve(__dirname, 'reviewlog-check-bundle.cjs');
m.paths = Module._nodeModulePaths(process.cwd());
m._compile(code, m.filename);
