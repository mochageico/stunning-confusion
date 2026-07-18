// Runs src/lib/recitation.alignment.check.ts standalone under plain Node.
//
// Why this exists instead of `npx tsx ...`: recitation.ts statically imports
// `Platform` from react-native (whose entry file uses Flow syntax no plain
// TS/JS bundler can parse) and lazily requires expo-speech-recognition
// inside a try/catch (which itself pulls in a chain of Expo native-module
// packages). Neither is ever actually exercised by this check -- it only
// tests the pure alignment logic -- so react-native is aliased to a tiny
// shim (rn-shim.cjs) and expo-speech-recognition is left external/
// unresolved, which is safe since that code path never runs here.
//
// Usage: npm run check:recitation
const esbuild = require('esbuild');
const path = require('path');
const Module = require('module');

const result = esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '../src/lib/recitation.alignment.check.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  alias: { 'react-native': path.resolve(__dirname, 'rn-shim.cjs') },
  external: ['expo-speech-recognition'],
});

const code = result.outputFiles[0].text;
const m = new Module('recitation-check', null);
m.filename = path.resolve(__dirname, 'recitation-check-bundle.cjs');
m.paths = Module._nodeModulePaths(process.cwd());
m._compile(code, m.filename);
