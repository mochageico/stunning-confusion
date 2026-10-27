// Assertions for turning one verse's result into a grade, run by `npm run check:grading`.

import {
  applySpotCheck,
  canSelfCheckMoveUp,
  gradeRecall,
  gradeSelfCheck,
  gradeSwap,
  pickSpotCheck,
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
  'every other: it can still drop the passage',
  passageOutcome(['clean', 'blank'], { canMoveUp: canSelfCheckMoveUp(true) }) === 'down'
);

console.log('spot check');
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};
check('no Got it, no spot check', pickSpotCheck(['stumbled', 'blanked'], seq(0)) === null);
check('a roll over the odds skips it', pickSpotCheck(['gotIt', 'gotIt'], seq(0.5)) === null);
check('a roll under the odds checks a Got it verse', pickSpotCheck(['stumbled', 'gotIt', 'gotIt'], seq(0.1, 0)) === 1);
check('…picked among the Got it verses only', pickSpotCheck(['gotIt', 'blanked', 'gotIt'], seq(0.1, 0.99)) === 2);
check('lead-in: the last 3 words of the verse before', spotCheckLeadIn('There is therefore now no condemnation for those who are in Christ Jesus.') === '…in Christ Jesus.');
check('lead-in: a short verse is shown whole', spotCheckLeadIn('Jesus wept.') === 'Jesus wept.');
check('lead-in: extra spaces are ignored', spotCheckLeadIn('  one   two  three  ') === 'one two three');
check('lead-in: no verse before', spotCheckLeadIn(null) === null && spotCheckLeadIn('  ') === null);
check(
  'missed spot check: the checked verse is a stumble',
  JSON.stringify(applySpotCheck(['clean', 'clean', 'clean'], 1, false)) === JSON.stringify(['clean', 'stumble', 'clean'])
);
check(
  'passed spot check changes nothing',
  JSON.stringify(applySpotCheck(['clean', 'clean'], 0, true)) === JSON.stringify(['clean', 'clean'])
);
check(
  'a missed spot check holds a short passage',
  passageOutcome(applySpotCheck(['clean', 'clean', 'clean'], 0, false)) === 'held'
);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll grading checks passed.');
