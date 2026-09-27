// Runs src/lib/dragSelect.check.ts standalone under plain Node.
//
// Same shape as run-queue-check.cjs: dragSelect.ts is pure TypeScript with no
// react-native imports, so esbuild bundles it to CJS in memory and Node runs it.
//
// Usage: npm run check:dragselect
const esbuild = require('esbuild');
const path = require('path');
const Module = require('module');

const result = esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '../src/lib/dragSelect.check.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});

const code = result.outputFiles[0].text;
const m = new Module('dragselect-check', null);
m.filename = path.resolve(__dirname, 'dragselect-check-bundle.cjs');
m.paths = Module._nodeModulePaths(process.cwd());
m._compile(code, m.filename);
