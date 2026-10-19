// Guards the shape of AppState (the `state` prop 64 files read by name) while
// useAppState.ts is split into smaller hooks -- see .claude/file-split-plan.md.
//
// Asks the TypeScript compiler for every property of AppState and its type,
// and compares that against scripts/appstate-keys.snapshot.txt. A missing,
// renamed or retyped field fails the check, so a refactor that is meant to be
// pure code motion can't quietly change what screens see.
//
// Usage: npm run check:appstate
//        npm run check:appstate -- --update   (rewrite the snapshot on purpose)
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'src/state/useAppState.ts');
const SNAPSHOT = path.join(__dirname, 'appstate-keys.snapshot.txt');

const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, 'tsconfig.json');
const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, ROOT);
const program = ts.createProgram([SOURCE], parsed.options);
const checker = program.getTypeChecker();

const sourceFile = program.getSourceFile(SOURCE);
const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
const appStateSymbol = checker.getExportsOfModule(moduleSymbol).find((s) => s.name === 'AppState');
if (!appStateSymbol) {
  console.error('AppState is no longer exported from src/state/useAppState.ts');
  process.exit(1);
}

const appStateType = checker.getDeclaredTypeOfSymbol(appStateSymbol);
const flags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias;
// Strip import("...") qualifiers so moving a type to another module isn't
// reported as a change -- only the name and shape matter here.
const clean = (s) => s.replace(/import\("[^"]*"\)\./g, '').replace(/\s+/g, ' ');
const lines = appStateType
  .getProperties()
  .map((prop) => `${prop.name}: ${clean(checker.typeToString(checker.getTypeOfSymbolAtLocation(prop, sourceFile), undefined, flags))}`)
  .sort();
const current = lines.join('\n') + '\n';

if (process.argv.includes('--update') || !fs.existsSync(SNAPSHOT)) {
  fs.writeFileSync(SNAPSHOT, current);
  console.log(`Wrote ${lines.length} AppState fields to ${path.relative(ROOT, SNAPSHOT)}`);
  process.exit(0);
}

const expected = fs.readFileSync(SNAPSHOT, 'utf8').split('\n').filter(Boolean);
const expectedSet = new Set(expected);
const currentSet = new Set(lines);
const missing = expected.filter((l) => !currentSet.has(l));
const added = lines.filter((l) => !expectedSet.has(l));

if (missing.length === 0 && added.length === 0) {
  console.log(`  ok   AppState unchanged (${lines.length} fields)`);
  process.exit(0);
}
for (const l of missing) console.log(`  - ${l}`);
for (const l of added) console.log(`  + ${l}`);
console.log(`\nAppState changed: ${missing.length} line(s) gone, ${added.length} new.`);
console.log('If that was on purpose, run: npm run check:appstate -- --update');
process.exit(1);
