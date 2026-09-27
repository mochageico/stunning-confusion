// Assertions for per-verse review history, run by `npm run check:reviewlog`.

import { QueueItem } from '../types';
import { appendReviewLog, REVIEW_LOG_LIMIT, reviewStageOf } from './reviewLog';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    verseId: 'BSB_ROM_8_28',
    translationId: 'BSB',
    book: 'Romans',
    chapter: 8,
    verseNumber: 28,
    text: '',
    orderIndex: 0,
    status: 'reviewing',
    retentionPhase: 'weekly',
    dateStarted: null,
    lastReviewDate: null,
    nextReviewDueDate: null,
    currentStreakCount: 3,
    totalSuccessfulReviews: 10,
    gracePeriodUsedToday: false,
    ...overrides,
  };
}

console.log('reviewStageOf');
check('queued counts as learning', reviewStageOf(item({ status: 'queued', retentionPhase: 'none' })) === 'learning');
check('learning', reviewStageOf(item({ status: 'learning', retentionPhase: 'none' })) === 'learning');
check('reviewing uses its phase', reviewStageOf(item()) === 'weekly');
check('retained', reviewStageOf(item({ status: 'retained', retentionPhase: 'none' })) === 'retained');

console.log('appendReviewLog');
const a = item();
appendReviewLog(a, a, 'pass', { drillType: 'type' });
const first = a.reviewLogs?.[0];
check('adds one entry', a.reviewLogs?.length === 1);
check('records result, stage and drill', first?.result === 'pass' && first?.stage === 'weekly' && first?.drillType === 'type');
check('timestamp is a real date', !!first && !Number.isNaN(Date.parse(first.at)));
check('no undefined fields (Firestore rejects them)', !!first && Object.values(first).every((v) => v !== undefined), first);
check('no refresher flag outside a refresher', !!first && !('refresher' in first));

// A miss sends Weekly into a Daily refresher; the log must say Weekly, the
// stage the miss actually happened in.
const before = item();
const after = { ...before, retentionPhase: 'daily' as const, refresherActive: true };
appendReviewLog(after, before, 'miss');
check('logs the stage before the miss moved it', after.reviewLogs?.[0]?.stage === 'weekly');

const r = item({ retentionPhase: 'daily', refresherActive: true });
appendReviewLog(r, r, 'pass');
check('marks reviews during a refresher', r.reviewLogs?.[0]?.refresher === true);

const s = item();
appendReviewLog(s, s, 'skipped', { cycles: 2, forgiven: true });
check('skipped keeps cycles and forgiven', s.reviewLogs?.[0]?.cycles === 2 && s.reviewLogs?.[0]?.forgiven === true);

const original = item({ reviewLogs: [] });
const copy = { ...original };
appendReviewLog(copy, copy, 'pass');
check("doesn't mutate the array another copy still holds", original.reviewLogs?.length === 0);

const full = item({
  reviewLogs: Array.from({ length: REVIEW_LOG_LIMIT }, (_, i) => ({ at: `2026-01-01T00:00:${i}`, result: 'pass' as const, stage: 'daily' as const })),
});
appendReviewLog(full, full, 'miss');
check('stays at the cap', full.reviewLogs?.length === REVIEW_LOG_LIMIT);
check('drops the oldest, keeps the newest', full.reviewLogs?.[0]?.at === '2026-01-01T00:00:1' && full.reviewLogs?.[REVIEW_LOG_LIMIT - 1]?.result === 'miss');

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall review-log checks passed');
