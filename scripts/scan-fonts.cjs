// Every <AppText>/<Text>/<AppTextInput>/<TextInput> in the app, classified by
// font family and weight. Written for the 2026-09-24 UI audit: on iPhone a
// weight class on Inter/Playfair renders Regular, no family means San
// Francisco, and font-mono means Courier New. Run: node scripts/scan-fonts.cjs
// Scan every <AppText ...> / <Text ...> / <AppTextInput ...> opening tag with a
// brace/quote-aware scanner and classify font family + weight usage.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
function walk(d, out = []) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(f)) out.push(p);
  }
  return out;
}
const files = [...walk(path.join(root, 'src')), path.join(root, 'App.tsx')].filter((f) => !/DevLayoutLab|[\\/]src[\\/]dev[\\/]/.test(f));
const BT = String.fromCharCode(96);
// extract opening tags of given names
function tags(src, names) {
  const res = [];
  const re = new RegExp('<(' + names.join('|') + ')\\b', 'g');
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length,
      depth = 0,
      q = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (q) {
        if (c === '\\') {
          i++;
          continue;
        }
        if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'" || c === BT) {
        q = c;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    const line = src.slice(0, m.index).split('\n').length;
    res.push({ name: m[1], text: src.slice(m.index, i + 1), line });
  }
  return res;
}
module.exports = { tags, walk, files };
if (require.main === module) {
  const stats = {};
  const total = { tags: 0, noFamily: 0, noFamilyWeighted: 0, sansWeighted: 0, serifWeighted: 0, mono: 0, serif: 0, sans: 0 };
  const weightRe = /\bfont-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/g;
  const weightsCount = {};
  const noFamilyExamples = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(root, f).replace(/\\/g, '/');
    const s = (stats[rel] = { tags: 0, noFamily: 0, sans: 0, serif: 0, mono: 0, weighted: 0 });
    for (const t of tags(src, ['AppText', 'Text', 'AppTextInput', 'TextInput'])) {
      s.tags++;
      total.tags++;
      const hasSans = /\bfont-sans\b/.test(t.text),
        hasSerif = /\bfont-serif\b/.test(t.text),
        hasMono = /\bfont-mono\b/.test(t.text);
      const ws = t.text.match(weightRe) || [];
      ws.forEach((w) => (weightsCount[w] = (weightsCount[w] || 0) + 1));
      if (hasSans) {
        s.sans++;
        total.sans++;
        if (ws.length) total.sansWeighted++;
      }
      if (hasSerif) {
        s.serif++;
        total.serif++;
        if (ws.length) total.serifWeighted++;
      }
      if (hasMono) {
        s.mono++;
        total.mono++;
      }
      if (!hasSans && !hasSerif && !hasMono) {
        s.noFamily++;
        total.noFamily++;
        if (ws.length) total.noFamilyWeighted++;
        if (noFamilyExamples.length < 8)
          noFamilyExamples.push(rel + ':' + t.line + '  ' + t.text.replace(/\s+/g, ' ').slice(0, 140));
      }
      if (ws.length) s.weighted++;
    }
  }
  console.log('TOTAL', total);
  console.log('weights', weightsCount);
  console.log('\nper file (tags / noFamily / sans / serif / mono):');
  Object.entries(stats)
    .filter(([, s]) => s.tags)
    .sort((a, b) => b[1].tags - a[1].tags)
    .forEach(([f, s]) =>
      console.log(
        String(s.tags).padStart(4),
        String(s.noFamily).padStart(4),
        String(s.sans).padStart(4),
        String(s.serif).padStart(4),
        String(s.mono).padStart(4),
        ' ',
        f
      )
    );
  console.log('\nexamples of no-family text:');
  noFamilyExamples.forEach((e) => console.log('  ' + e));
}
