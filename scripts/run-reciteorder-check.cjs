// Runs src/lib/reciteOrder.check.ts standalone under plain Node.
//
// Same shape as run-sections-check.cjs: reciteOrder.check.ts imports
// recitation.ts, which statically imports `Platform` from react-native (Flow
// syntax no plain bundler parses) and lazily requires expo-speech-recognition.
// Neither runs here, so react-native is aliased to the shim and the speech
// package is left unresolved.
//
// Usage: npm run check:reciteorder
const esbuild = require('esbuild');
const path = require('path');
const Module = require('module');

const result = esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '../src/lib/reciteOrder.check.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  alias: { 'react-native': path.resolve(__dirname, 'rn-shim.cjs') },
  external: ['expo-speech-recognition'],
});

const code = result.outputFiles[0].text;
const m = new Module('reciteorder-check', null);
m.filename = path.resolve(__dirname, 'reciteorder-check-bundle.cjs');
m.paths = Module._nodeModulePaths(process.cwd());
m._compile(code, m.filename);
