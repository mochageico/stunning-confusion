// Assertions for turning one verse's result into a grade, run by `npm run check:grading`.

import {
  canSelfCheckMoveUp,
  gradeRecall,
  isSelfCheckInput,
  resolveGrade,
  wordAccuracy,
  gradeSelfCheck,
  gradeSwap,
  pickSpotCheck,
  spotCheckCanMoveUp,
  spotCheckLeadIn,
  swapMisses,
} from './grading';
import { passageOutcome } from './ladder';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

console.log('recite / type / Keep going / First words');
check('100% is clean', gradeRecall({ accuracy: 1 }) === 'clean');
check('exactly 90% is clean at the default', gradeRecall({ accuracy: 0.9 }) === 'clean');
check('9 of 10 words is clean', gradeRecall({ accuracy: 9 / 10 }) === 'clean');
check('89% is a stumble', gradeRecall({ accuracy: 0.89 }) === 'stumble');
check('exactly 50% is a stumble', gradeRecall({ accuracy: 0.5 }) === 'stumble');
check('under 50% is a blank', gradeRecall({ accuracy: 0.49 }) === 'blank');
check('revealed is a blank, whatever the accuracy', gradeRecall({ accuracy: 1, revealed: true }) === 'blank');
check('a hint is a stumble', gradeRecall({ accuracy: 1, hinted: true }) === 'stumble');
check('a hint under 50% is still a blank', gradeRecall({ accuracy: 0.3, hinted: true }) === 'blank');
check('at 85%, 85% is clean', gradeRecall({ accuracy: 0.85 }, 85) === 'clean');
check('at 95%, 90% is a stumble', gradeRecall({ accuracy: 0.9 }, 95) === 'stumble');
check('at 100%, one slip is a stumble', gradeRecall({ accuracy: 0.99 }, 100) === 'stumble');
check('at 100%, perfect is clean', gradeRecall({ accuracy: 1 }, 100) === 'clean');

console.log('Find the wrong word');
check(
  'misses = unfound + wrong flags + unknown replacements',
  swapMisses({ unfound: 1, wrongFlags: 2, unknownReplacements: 3 }) === 6
);
check('no misses is clean', gradeSwap(0, 4) === 'clean');
check('0.49 per verse is clean', gradeSwap(49, 100) === 'clean');
check('0.5 per verse is a stumble', gradeSwap(1, 2) === 'stumble');
check('1.0 per verse is a stumble', gradeSwap(3, 3) === 'stumble');
check('1.01 per verse is a blank', gradeSwap(101, 100) === 'blank');
check('one miss on one verse is a stumble', gradeSwap(1, 1) === 'stumble');
check('two misses on one verse is a blank', gradeSwap(2, 1) === 'blank');
check('setting off: no misses is a stumble at best', gradeSwap(0, 4, false) === 'stumble');
check('setting off: a blank is still a blank', gradeSwap(5, 2, false) === 'blank');
check('zero verses does not divide by zero', gradeSwap(0, 0) === 'clean');

console.log('self-check');
check('Got it = clean', gradeSelfCheck('gotIt') === 'clean');
check('Stumbled = stumble', gradeSelfCheck('stumbled') === 'stumble');
check('Blanked = blank', gradeSelfCheck('blanked') === 'blank');
check('a self-check after recall can move up', canSelfCheckMoveUp(undefined));
check("a self-check after a self-check can't", !canSelfCheckMoveUp(true));
check(
  'every other: all Got it after a self-check holds',
  passageOutcome(['clean', 'clean'], { canMoveUp: canSelfCheckMoveUp(true) }) === 'held'
);
check(
  'every other: a blank holds too',
  passageOutcome(['clean', 'blank'], { canMoveUp: canSelfCheckMoveUp(true) }) === 'held'
);

console.log('spot check');
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};
check('no Got it, no spot check', pickSpotCheck(['stumbled', 'blanked'], seq(0)) === null);
check('a Got it always gets a spot check', pickSpotCheck(['gotIt', 'gotIt'], seq(0.99)) === 1);
check('…picked among the Got it verses only', pickSpotCheck(['stumbled', 'gotIt', 'blanked', 'gotIt'], seq(0)) === 1);
check('…the last Got it at the top of the roll', pickSpotCheck(['gotIt', 'blanked', 'gotIt'], seq(0.99)) === 2);
check('lead-in: the last 3 words of the verse before', spotCheckLeadIn('There is therefore now no condemnation for those who are in Christ Jesus.') === '…in Christ Jesus.');
check('lead-in: a short verse is shown whole', spotCheckLeadIn('Jesus wept.') === 'Jesus wept.');
check('lead-in: extra spaces are ignored', spotCheckLeadIn('  one   two  three  ') === 'one two three');
check('lead-in: no verse before', spotCheckLeadIn(null) === null && spotCheckLeadIn('  ') === null);
check(
  'missed spot check holds a short passage',
  passageOutcome(['clean', 'clean', 'clean'], { canMoveUp: spotCheckCanMoveUp(false) }) === 'held'
);
check(
  'missed spot check holds a 12+ passage too',
  passageOutcome(Array(15).fill('clean'), { canMoveUp: spotCheckCanMoveUp(false) }) === 'held'
);
check(
  'missed spot check: a blank holds too',
  passageOutcome(['clean', 'blank'], { canMoveUp: spotCheckCanMoveUp(false) }) === 'held'
);
check('passed spot check can move up', passageOutcome(['clean', 'clean'], { canMoveUp: spotCheckCanMoveUp(true) }) === 'up');

// ---- resolveGrade: what a screen reports, graded with the user's settings ----
const S = { cleanPct: 90, swapCanBeClean: true };
check('resolve: recall at 92% is clean at 90', resolveGrade({ kind: 'recall', accuracy: 0.92 }, S) === 'clean');
check('resolve: recall at 92% is a stumble at 95', resolveGrade({ kind: 'recall', accuracy: 0.92 }, { ...S, cleanPct: 95 }) === 'stumble');
check('resolve: swap rate over the drill', resolveGrade({ kind: 'swap', misses: 1, verses: 4 }, S) === 'clean');
check('resolve: swap with clean off is a stumble', resolveGrade({ kind: 'swap', misses: 0, verses: 4 }, { ...S, swapCanBeClean: false }) === 'stumble');
check('resolve: self-check answers', resolveGrade({ kind: 'self', answer: 'stumbled' }, S) === 'stumble');
check('resolve: a decided grade passes through', resolveGrade({ kind: 'grade', grade: 'blank' }, S) === 'blank');
check('self-check input: self and a self-checked grade', isSelfCheckInput({ kind: 'self', answer: 'gotIt' }) && isSelfCheckInput({ kind: 'grade', grade: 'clean', selfCheck: true }));
check('self-check input: recall is not', !isSelfCheckInput({ kind: 'recall', accuracy: 1 }) && !isSelfCheckInput({ kind: 'grade', grade: 'clean' }));
check('word accuracy: close counts, empty is 0', wordAccuracy(['perfect', 'close', 'missed', 'perfect']) === 0.75 && wordAccuracy([]) === 0);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll grading checks passed.');
