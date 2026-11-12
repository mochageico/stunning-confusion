// Babel plugin: import each lucide icon from its own file.
//
//   import { Check, Play as PlayIcon } from 'lucide-react-native';
// becomes
//   import Check from 'lucide-react-native/dist/esm/icons/check.mjs';
//   import PlayIcon from 'lucide-react-native/dist/esm/icons/play.mjs';
//
// Without this, the package's index file pulls in all ~1,745 icons (the app
// uses about 108), and all of them run at start-up the first time any icon
// draws. Metro's inlineRequires cannot help: the index re-exports eagerly.
// (Optimization plan Phase 5, 2026-11-12.)
//
// The name -> file map is read from the package's own index file, so icon
// aliases (AlarmCheck = alarm-clock-check) and upgrades stay correct. Names
// that are not icons (LucideProvider, types like LucideIcon) are left on the
// original import. Deep paths work because metro.config.js turns off package
// "exports" resolution. If an upgrade moves the files, this plugin throws at
// build time rather than shipping a broken bundle.
const fs = require('fs');
const path = require('path');

const PKG = 'lucide-react-native';
const PKG_DIR = path.join(__dirname, 'node_modules', PKG);
const INDEX = path.join(PKG_DIR, 'dist', 'esm', 'lucide-react-native.mjs');

let iconFiles = null;
function loadIconFiles() {
  if (iconFiles) return iconFiles;
  const src = fs.readFileSync(INDEX, 'utf8');
  iconFiles = new Map();
  const line = /export \{([^}]+)\} from '\.\/icons\/([^']+)';/g;
  let m;
  while ((m = line.exec(src))) {
    const file = `${PKG}/dist/esm/icons/${m[2]}`;
    for (const n of m[1].matchAll(/default as (\w+)/g)) iconFiles.set(n[1], file);
  }
  if (iconFiles.size < 1000) throw new Error(`babel-lucide-per-icon: only ${iconFiles.size} icons found in ${INDEX}`);
  return iconFiles;
}

module.exports = function lucidePerIcon({ types: t }) {
  return {
    name: 'lucide-per-icon',
    visitor: {
      ImportDeclaration(p) {
        const node = p.node;
        if (node.source.value !== PKG || node.importKind === 'type') return;
        const files = loadIconFiles();
        const keep = [];
        const perIcon = [];
        for (const s of node.specifiers) {
          const name = t.isImportSpecifier(s) && s.importKind !== 'type'
            ? (t.isIdentifier(s.imported) ? s.imported.name : s.imported.value)
            : null;
          const file = name && files.get(name);
          if (file) perIcon.push(t.importDeclaration([t.importDefaultSpecifier(t.identifier(s.local.name))], t.stringLiteral(file)));
          else keep.push(s);
        }
        if (!perIcon.length) return;
        if (keep.length) {
          node.specifiers = keep;
          p.insertAfter(perIcon);
        } else {
          p.replaceWithMultiple(perIcon);
        }
      },
    },
  };
};
