// Usage: node scripts/inspect-symbol.cjs <file-path> <symbol-name>
// Prints the line range and full declaration block of a top-level symbol
// (interface, type, function, const, let, var, class, enum).
const fs = require('fs');

const [file, symbol] = process.argv.slice(2);
if (!file || !symbol) {
  console.error('Usage: node scripts/inspect-symbol.cjs <file-path> <symbol-name>');
  process.exit(1);
}

const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
if (!/^[\w$]+$/.test(symbol)) {
  console.error("Symbol must be a plain identifier");
  process.exit(1);
}
const esc = symbol.replace(/\$/g, '\\$');
const declRe = new RegExp(
  `^\\s*(export\\s+)?(default\\s+)?(declare\\s+)?(async\\s+)?(abstract\\s+)?(interface|type|function\\*?|const|let|var|class|enum)\\s+${esc}(?![\\w$])`
);

const CONTINUES = /[=,|&(<>:?+\-*/]$/;
const STARTS_CONT = /^\s*[|&?:.]/;

const scan = (start) => {
  let depth = 0;
  let opened = false;
  let quote = null;
  let block = false;
  const keyword = lines[start].match(declRe)[6].replace('*', '');
  const braceEnds = keyword !== 'type' && keyword !== 'const' && keyword !== 'let' && keyword !== 'var';
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      const n = line[j + 1];
      if (block) {
        if (c === '*' && n === '/') { block = false; j++; }
        continue;
      }
      if (quote) {
        if (c === "\\") j++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '/' && n === '*') { block = true; j++; continue; }
      if (c === '/' && n === '/') break;
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '(' || c === '{' || c === '[') { depth++; if (c === '{') opened = true; }
      else if (c === ')' || c === '}' || c === ']') {
        depth--;
        if (depth === 0 && c === '}' && opened && braceEnds) return i;
      } else if (c === ';' && depth === 0) return i;
    }
    if (depth === 0 && !quote && !block) {
      const trimmed = line.replace(/\/\/.*$/, '').trimEnd();
      let k = i + 1;
      while (k < lines.length && !lines[k].trim()) k++;
      const nextCont = k < lines.length && STARTS_CONT.test(lines[k]);
      if (i > start || trimmed.length) {
        if (!CONTINUES.test(trimmed) && !nextCont && !(braceEnds && !opened)) return i;
      }
    }
  }
  return lines.length - 1;
};

let found = 0;
for (let i = 0; i < lines.length; i++) {
  if (!declRe.test(lines[i])) continue;
  // Include leading JSDoc / line comments directly above the declaration.
  let from = i;
  while (from > 0 && /^\s*(\/\/|\/\*|\*)/.test(lines[from - 1])) from--;
  const to = scan(i);
  found++;
  console.log(`${file}:${from + 1}-${to + 1}`);
  for (let n = from; n <= to; n++) console.log(`${String(n + 1).padStart(5)}  ${lines[n]}`);
  i = to;
}

if (!found) {
  console.error(`No top-level declaration of "${symbol}" found in ${file}`);
  process.exit(1);
}
