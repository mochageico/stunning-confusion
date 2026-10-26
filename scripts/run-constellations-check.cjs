// Runs src/lib/constellations.check.ts standalone under plain Node.
//
// Same shape as run-takeaways-check.cjs: stageProgress.ts pulls in data.ts, and
// react-native is aliased to the shim in case anything reaches it.
//
// Usage: npm run check:constellations
const esbuild = require('esbuild');
const path = require('path');
const Module = require('module');

const result = esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '../src/lib/constellations.check.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  alias: { 'react-native': path.resolve(__dirname, 'rn-shim.cjs') },
  external: ['expo-speech-recognition'],
});

const code = result.outputFiles[0].text;
const m = new Module('constellations-check', null);
m.filename = path.resolve(__dirname, 'constellations-check-bundle.cjs');
m.paths = Module._nodeModulePaths(process.cwd());
m._compile(code, m.filename);
