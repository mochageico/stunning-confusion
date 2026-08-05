// Runs src/lib/drills.buildUp.check.ts standalone under plain Node.
//
// Same shape as run-recitation-check.cjs, including its two workarounds: this
// pulls in drills.ts, which imports normalizeToken from recitation.ts, which
// in turn statically imports `Platform` from react-native (Flow syntax no
// plain bundler parses) and lazily requires expo-speech-recognition. Neither
// runs here -- the chunker is pure -- so react-native is aliased to the same
// shim and the speech package is left unresolved.
//
// Usage: npm run check:buildup
const esbuild = require('esbuild');
const path = require('path');
const Module = require('module');

const result = esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '../src/lib/drills.buildUp.check.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  alias: { 'react-native': path.resolve(__dirname, 'rn-shim.cjs') },
  external: ['expo-speech-recognition'],
});

const code = result.outputFiles[0].text;
const m = new Module('buildup-check', null);
m.filename = path.resolve(__dirname, 'buildup-check-bundle.cjs');
m.paths = Module._nodeModulePaths(process.cwd());
m._compile(code, m.filename);
