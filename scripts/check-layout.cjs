#!/usr/bin/env node
/**
 * check:layout — a tripwire for the layout rules in src/components/design.tsx.
 *
 * Not a real linter. It catches the two patterns that produced the iPhone SE
 * text leakage, both of which are cheap to spot textually:
 *
 *   1. Type below the 11pt floor. `text-[8px]` has no wrapping headroom, so at
 *      any font scale above 1.0 it wraps, and inside a fixed-height box that
 *      means clipped text.
 *   2. A hard `height:` on a box that holds text. Text grows; the box doesn't.
 *
 * Rule 2 has legitimate uses (progress tracks, avatars, toggle switches), so a
 * `layout-ok` comment on the same or previous line silences it.
 *
 * Screens not yet migrated to the design system are listed in LEGACY below.
 * They still report, but as warnings rather than errors, so this can run in
 * anger today and the list shrinks as screens get migrated.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/**
 * Files still on the pre-design-system layout. Delete entries as they migrate;
 * when this list is empty the warnings become errors everywhere.
 */
const LEGACY = new Set([
  'components/BookPicker.tsx',
  'components/ChallengeCard.tsx',
  'components/DoodleCanvas.tsx',
  'components/Dropdown.tsx',
  'components/MemoryGrid.tsx',
  'components/PracticeModals.tsx',
  'components/ReactionBar.tsx',
  'components/ui.tsx',
  'screens/ActivePlanScreen.tsx',
  'screens/AudioFeedScreen.tsx',
  'screens/AuthGateScreen.tsx',
  'screens/BooksScreen.tsx',
  'screens/ChapterLandingScreen.tsx',
  'screens/ChaptersScreen.tsx',
  'screens/CircleChatScreen.tsx',
  'screens/CommunityCreateScreen.tsx',
  'screens/CommunityFindScreen.tsx',
  'screens/CommunityGroupDetailScreen.tsx',
  'screens/CommunityHomeScreen.tsx',
  'screens/CommunityPreviewScreen.tsx',
  'screens/DMThreadScreen.tsx',
  'screens/DashboardScreen.tsx',
  'screens/DevLayoutLab.tsx',
  'screens/FindFriendsScreen.tsx',
  'screens/FullHistoryScreen.tsx',
  'screens/HomeScreen.tsx',
  'screens/MemberProfileScreen.tsx',
  'screens/MemoryCalendarScreen.tsx',
  'screens/MessagesScreen.tsx',
  'screens/OnboardingScreen.tsx',
  'screens/PlanDesignerScreen.tsx',
  'screens/ProfileScreen.tsx',
  'screens/RecordScreen.tsx',
  'screens/RecordingDetailScreen.tsx',
  'screens/ReferenceDrillScreen.tsx',
  'screens/SavedPlansScreen.tsx',
  'screens/SettingsScreen.tsx',
  'screens/GroupPlanDetailScreen.tsx',
]);

const MIN_FONT_PT = 11;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

const findings = [];

for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file).split(path.sep).join('/');
  const legacy = LEGACY.has(rel);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    const prev = lines[i - 1] || '';
    const silenced = /layout-ok/.test(rawLine) || /layout-ok/.test(prev);

    // Skip comments. Documentation that *describes* these patterns (including
    // this script's own header, and design.tsx's rationale comments) would
    // otherwise report as violations.
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    const line = rawLine.replace(/\/\/.*$/, '');

    // Rule 1: type below the floor.
    for (const m of line.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
      const pt = parseFloat(m[1]);
      if (pt < MIN_FONT_PT) {
        findings.push({
          rel,
          lineNo,
          legacy,
          rule: 'font-floor',
          msg: `text-[${m[1]}px] is below the ${MIN_FONT_PT}pt floor — use <AppText variant="micro">`,
        });
      }
    }

    // Rule 2: a hard numeric height in an inline style.
    for (const m of line.matchAll(/\bheight:\s*(\d+(?:\.\d+)?)\b/g)) {
      if (silenced) continue;
      findings.push({
        rel,
        lineNo,
        legacy,
        rule: 'fixed-height',
        msg: `height: ${m[1]} cannot grow with the font scale — use minHeight, or add a "layout-ok" comment if this box holds no text`,
      });
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
  console.log(`\n${errors.length} layout error(s) in migrated files:`);
  print(errors, 'ERROR');
}
if (warnings.length) {
  console.log(`\n${warnings.length} finding(s) in not-yet-migrated files (warnings):`);
  print(warnings, 'warn ');
}

console.log(
  `\ncheck:layout — ${errors.length} error(s), ${warnings.length} warning(s) across ${LEGACY.size} legacy file(s) still to migrate.`
);

process.exit(errors.length > 0 ? 1 : 0);
