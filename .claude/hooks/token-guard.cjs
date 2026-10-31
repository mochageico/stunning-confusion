const fs = require('fs');
const path = require('path');

const BLOCKED_SUBSTRINGS = ['studio-samples.html', 'bakeoff', '.shots', 'legacy-web', '.claude/worktrees'];
const SIZE_LIMIT_KB = 40;
const MAX_LIMIT = 200;

const isBlockedPath = (p) => {
  if (typeof p !== 'string' || !p) return false;
  const norm = p.replace(/\\/g, '/').toLowerCase();
  return BLOCKED_SUBSTRINGS.some((s) => norm.includes(s));
};

let raw = '';
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let data;
  try {
    data = JSON.parse(raw.replace(/^﻿/, ''));
  } catch (e) {
    process.exit(0);
  }
  const tool = data.tool_name;
  const input = data.tool_input || {};

  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') {
    const candidates = [input.file_path, input.path, input.pattern, input.glob];
    const hit = candidates.find(isBlockedPath);
    if (hit) {
      console.error(`[TOKEN GUARD]: Access to "${hit}" is blocked (studio-samples.html, bakeoff, .shots, legacy-web, .claude/worktrees).`);
      process.exit(2);
    }
  }

  if (tool === 'Read' && input.file_path) {
    const fp = path.resolve(input.file_path);
    let sizeKB = 0;
    try {
      sizeKB = fs.statSync(fp).size / 1024;
    } catch (e) {
      process.exit(0);
    }
    if (
      sizeKB > SIZE_LIMIT_KB &&
      (input.allow_large === true ||
        typeof input.offset !== 'number' ||
        typeof input.limit !== 'number' ||
        input.limit > MAX_LIMIT)
    ) {
      console.error(
        `[TOKEN GUARD]: File is too large (${Math.round(sizeKB)}KB). Do NOT use allow_large. Use Grep -n first, then Read with offset and limit <= 200.`
      );
      process.exit(2);
    }
  }

  if (tool === 'Bash' && typeof input.command === 'string') {
    if (/studio-samples\.html|\.claude[\/\\]worktrees|bakeoff/i.test(input.command)) {
      console.error('[TOKEN GUARD]: Do not access studio-samples.html, worktrees, or bakeoff via Bash.');
      process.exit(2);
    }
  }

  process.exit(0);
});
