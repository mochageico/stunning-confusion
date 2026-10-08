#!/usr/bin/env node
/**
 * check:layout — a tripwire for the rules in src/components/design.tsx and
 * blocks.tsx, so the look the UI polish jobs (S1-S9) settled on stays put.
 *
 * Not a real linter: every rule is a cheap textual check. Each one names the
 * comment that silences it, for the rare place the rule is genuinely wrong.
 * The silencing comment goes on the same line or in the comment block
 * directly above, and should say why.
 *
 *   font-floor     type below 11pt (`text-[8px]`): it has no room to grow.
 *   fixed-height   `height: 28` on a box: text grows, the box doesn't.
 *                  Silence: layout-ok (progress tracks, dots, icon circles).
 *   hex-color      a hex color in code (`#1A1A1A`, `bg-[#fff]`): colors come
 *                  from the theme tokens, so the accent picker and dark mode
 *                  reach them. theme.tsx, which defines them, is exempt.
 *                  Silence: theme-ok.
 *   raw-palette    Tailwind's own greys (`text-neutral-400`, `bg-gray-100`):
 *                  same reason. Use ink / ink-2 / ink-3 / line / fill.
 *                  Silence: theme-ok.
 *   font-mono      the old Courier look. Numbers are plain sans now.
 *   uppercase      all-caps labels. Headings are sentence case (SectionHeader).
 *   shadow-toggle  a shadow-* class that appears or disappears with state:
 *                  this froze iOS (Fabric). Shadows are always on or never.
 *   raw-button     a Pressable filled like a button (bg-accent, bg-danger...):
 *                  use AppButton, so every button has the same sizes, radius
 *                  and states. Silence: button-ok (chat bubbles, a switch).
 *   button-variant an AppButton with no `variant`: the old look, styled by
 *                  hand. Give it primary / secondary / quiet / destructive.
 *                  Silence: button-ok (toggle pills that style themselves).
 *
 * Files listed in LEGACY still report, but as warnings rather than errors.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/** Dev-only tools. They report as warnings, never errors. */
const LEGACY = new Set(['screens/DevLayoutLab.tsx', 'dev/BlocksGallery.tsx', 'dev/DemoHarness.tsx']);

/** Files that define the rules' building blocks, per rule. */
const EXEMPT = {
  'hex-color': new Set(['components/theme.tsx']),
  'font-mono': new Set(['components/design.tsx']),
  'raw-button': new Set(['components/design.tsx', 'components/blocks.tsx']),
  'button-variant': new Set(['components/design.tsx', 'components/blocks.tsx']),
};

const MIN_FONT_PT = 11;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

const isCommentLine = (line) => {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*');
};

/** True when `tag` is on this line or in the comment block right above it. */
function silencedBy(lines, i, tag) {
  if (lines[i].includes(tag)) return true;
  for (let j = i - 1; j >= 0 && isCommentLine(lines[j]); j -= 1) {
    if (lines[j].includes(tag)) return true;
  }
  return false;
}

/** The text of a JSX opening tag that starts at (line i, col), across lines. */
function openingTag(lines, i, col) {
  let text = '';
  let depth = 0;
  let quote = null;
  for (let li = i; li < Math.min(lines.length, i + 40); li += 1) {
    const line = li === i ? lines[li].slice(col) : lines[li];
    for (let k = 0; k < line.length; k += 1) {
      const ch = line[k];
      text += ch;
      if (quote) {
        if (ch === quote && line[k - 1] !== '\\') quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0 && line[k - 1] !== '=') return text;
    }
    text += '\n';
  }
  return text;
}

/**
 * A Pressable that is always filled with a strong color. A fill that only
 * appears in one state (inside ${...}) is a toggle or a chip; a self-closing
 * Pressable is a dot; checkbox / radio / switch / tab / slider roles are
 * controls with their own look. None of those are buttons.
 */
function looksLikeButton(tag) {
  if (/\/>\s*$/.test(tag)) return false;
  if (/accessibilityRole=["'{]+(checkbox|radio|switch|tab|adjustable)/.test(tag)) return false;
  const fixed = tag.replace(/\$\{[^}]*\}/g, '');
  return /\bbg-(accent|danger|success|warning|ink)(?![-\w])/.test(fixed);
}

const findings = [];
const add = (rel, lineNo, legacy, rule, msg) => findings.push({ rel, lineNo, legacy, rule, msg });

for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file).split(path.sep).join('/');
  const legacy = LEGACY.has(rel);
  const exempt = (rule) => EXEMPT[rule] && EXEMPT[rule].has(rel);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;

    // Skip comments. Documentation that *describes* these patterns (including
    // this script's own header, and design.tsx's rationale comments) would
    // otherwise report as violations.
    if (isCommentLine(rawLine)) return;
    // Drop a trailing // comment, but not the // in "https://".
    const line = rawLine.replace(/(^|[^:])\/\/.*$/, '$1');

    for (const m of line.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
      if (parseFloat(m[1]) < MIN_FONT_PT) {
        add(rel, lineNo, legacy, 'font-floor', `text-[${m[1]}px] is below the ${MIN_FONT_PT}pt floor — use <AppText variant="micro">`);
      }
    }

    if (!silencedBy(lines, i, 'layout-ok')) {
      for (const m of line.matchAll(/\bheight:\s*(\d+(?:\.\d+)?)\b/g)) {
        add(rel, lineNo, legacy, 'fixed-height', `height: ${m[1]} cannot grow with the font scale — use minHeight, or add a "layout-ok" comment if this box holds no text`);
      }
    }

    if (!exempt('hex-color') && !silencedBy(lines, i, 'theme-ok')) {
      const hex = line.match(/\[#[0-9a-fA-F]{3,8}\]|['"`]#[0-9a-fA-F]{3,8}['"`]/);
      if (hex) add(rel, lineNo, legacy, 'hex-color', `${hex[0]} is a hard-coded color — use a theme token (className) or useThemeColors() (props)`);
    }

    if (!silencedBy(lines, i, 'theme-ok')) {
      const grey = line.match(/\b(?:text|bg|border|fill|stroke)-(?:neutral|gray|slate|zinc|stone)-\d{2,3}\b/);
      if (grey) add(rel, lineNo, legacy, 'raw-palette', `${grey[0]} bypasses the theme — use ink / ink-2 / ink-3 / line / fill / surface`);
    }

    if (!exempt('font-mono') && /\bfont-mono\b/.test(line)) {
      add(rel, lineNo, legacy, 'font-mono', 'font-mono is the retired Courier look — numbers are plain font-sans');
    }

    if (/\buppercase\b/.test(line)) {
      add(rel, lineNo, legacy, 'uppercase', 'all-caps text — labels and headings are sentence case (SectionHeader for group labels)');
    }

    if (/(\?|&&|:)\s*['"`][^'"`]*\bshadow(-\w+)?\b/.test(line) || /\$\{[^}]*\?[^}]*\bshadow(-\w+)?\b[^}]*\}/.test(line)) {
      add(rel, lineNo, legacy, 'shadow-toggle', 'a shadow that changes with state froze iOS — make it always on or always off');
    }

    for (const tag of ['<Pressable', '<AppButton']) {
      let col = line.indexOf(tag);
      while (col >= 0) {
        const next = line[col + tag.length];
        if (next === undefined || /[\s>/]/.test(next)) {
          const text = openingTag(lines, i, col);
          if (
            tag === '<Pressable' &&
            !exempt('raw-button') &&
            looksLikeButton(text) &&
            !silencedBy(lines, i, 'button-ok')
          ) {
            add(rel, lineNo, legacy, 'raw-button', 'a Pressable filled like a button — use AppButton (or add a "button-ok" comment saying why not)');
          }
          if (tag === '<AppButton' && !exempt('button-variant') && !/\bvariant=/.test(text) && !silencedBy(lines, i, 'button-ok')) {
            add(rel, lineNo, legacy, 'button-variant', 'an AppButton with no variant — give it primary / secondary / quiet / destructive');
          }
        }
        col = line.indexOf(tag, col + 1);
      }
    }
  });
}

const errors = findings.filter((f) => !f.legacy);
const warnings = findings.filter((f) => f.legacy);

const print = (list, tag) => {
  const byFile = new Map();
  for (const f of list) {
    if (!byFile.has(f.rel)) byFile.set(f.rel, []);
    byFile.get(f.rel).push(f);
  }
  for (const [rel, items] of [...byFile.entries()].sort()) {
    console.log(`\n  ${rel}`);
    for (const f of items) console.log(`    ${tag} ${f.lineNo}: [${f.rule}] ${f.msg}`);
  }
};

if (errors.length) {
  console.log(`\n${errors.length} layout error(s):`);
  print(errors, 'ERROR');
}
if (warnings.length && process.argv.includes('--dev')) {
  console.log(`\n${warnings.length} finding(s) in dev-only files (warnings):`);
  print(warnings, 'warn ');
}

console.log(
  `\ncheck:layout — ${errors.length} error(s), ${warnings.length} warning(s) in dev-only files${
    warnings.length && !process.argv.includes('--dev') ? ' (--dev to list them)' : ''
  }.`
);

process.exit(errors.length > 0 ? 1 : 0);
