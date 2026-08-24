// Runs src/lib/translations.check.ts standalone under plain Node.
//
// Same shape as run-queue-check.cjs. data.ts imports only types, so nothing
// here needs a react-native alias -- esbuild bundles the TypeScript to CJS in
// memory and Node executes the result.
//
// Usage: npm run check:translations
const esbuild = require('esbuild');
const path = require('path');
const Module = require('module');

const result = esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '../src/lib/translations.check.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});

const code = result.outputFiles[0].text;
const m = new Module('translations-check', null);
m.filename = path.resolve(__dirname, 'translations-check-bundle.cjs');
m.paths = Module._nodeModulePaths(process.cwd());
m._compile(code, m.filename);
