// Visible copy that breaks the app's wording rules: banned jargon (see the
// three-concept naming decision), ASCII "--" dashes and "->" arrows.
// Run: node scripts/scan-copy.cjs
// Find user-visible copy (JSX text nodes + string literals in UI-ish positions)
// containing banned jargon, ASCII arrows, or double-hyphen dashes.
const fs = require('fs');
const path = require('path');
const { files } = require('./scan-fonts.cjs');
const root = path.join(__dirname, '..');

const BANNED = /\b(queue|queued|rhythm|memory plan|phase|graduat\w*|priming|rigor|7-6-5)\b/i;
const ASCII = /(\s--\s|->|<-)/;

function stripComments(src) {
  // keep line structure; blank out // and /* */ comments (not inside strings - approximate)
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'`])\/\/.*$/gm, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}
const out = { banned: [], ascii: [] };
for (const f of files) {
  const rel = path.relative(root, f).replace(/\\/g, '/');
  if (/DevLayoutLab|^src\/dev\//.test(rel)) continue;
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  // JSX text nodes: >text<  (text without braces/angle brackets)
  const jsxText = /> *([^<>{}]*[A-Za-z][^<>{}]*) *</g;
  let m;
  const seen = new Set();
  const check = (text, idx, kind) => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t || t.length < 3) return;
    const key = rel + ':' + lineOf(idx) + t;
    if (seen.has(key)) return;
    seen.add(key);
    if (BANNED.test(t)) out.banned.push(`${rel}:${lineOf(idx)}  [${kind}] ${t.slice(0, 110)}`);
    if (ASCII.test(t)) out.ascii.push(`${rel}:${lineOf(idx)}  [${kind}] ${t.slice(0, 110)}`);
  };
  while ((m = jsxText.exec(src))) {
    // skip things that look like TS generics / code
    if (/[;=]|=>|\bconst\b|\breturn\b/.test(m[1])) continue;
    check(m[1], m.index, 'jsx');
  }
  // string literals with spaces (likely prose) -- '...' "..." `...`
  const strRe = /(['"`])((?:(?!\1)[^\\\n]|\\.){12,}?)\1/g;
  while ((m = strRe.exec(src))) {
    const s = m[2];
    if (!/\s/.test(s)) continue; // single tokens are class names/ids
    if (/^[\w\-\[\]#\/.:% ]+$/.test(s) && /\b(bg|text|border|rounded|flex|px|py|p|m|mt|mb|gap|items|justify|font|w|h)-/.test(s)) continue; // className
    if (/\b(bg|text|border|rounded)-/.test(s)) continue;
    check(s, m.index, 'str');
  }
}
console.log('== Banned jargon in visible copy (' + out.banned.length + ')');
out.banned.forEach((l) => console.log('  ' + l));
console.log('\n== ASCII arrows / double hyphens (' + out.ascii.length + ')');
out.ascii.forEach((l) => console.log('  ' + l));
