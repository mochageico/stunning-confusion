// Regression assertions for Guided learning's pure logic, run by
// `npm run check:guided`. These cases are the plan's spec: a phase is not done
// until every one passes.

import { summarizeOutcomes } from './recitation';
import {
  buildPassages,
  coldCheckQueue,
  createLadder,
  eligibleDrills,
  GuidedItem,
  guidedCredit,
  GuidedCreditCtx,
  GuidedDrillId,
  isFinishedVerse,
  Ladder,
  ladderAfter,
  LadderEvent,
  nextNewVerse,
  pickDrill,
  SessionEnv,
  sessionReducer,
  SessionEvent,
  SessionState,
  startSession,
  stitchWindow,
  toDrillVerse,
} from './guided';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

const seeded = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

const NOW = Date.parse('2026-10-10T12:00:00Z');
const minsAgo = (m: number) => new Date(NOW - m * 60000).toISOString();

const TEXTS: Record<number, string> = {
  1: 'The LORD is my shepherd; I shall not want.',
  2: 'He makes me lie down in green pastures; He leads me beside quiet waters.',
  3: 'He restores my soul; He guides me in the paths of righteousness for the sake of His name.',
  4: 'Even though I walk through the valley of the shadow of death, I will fear no evil, for You are with me; Your rod and Your staff, they comfort me.',
  5: 'You prepare a table before me in the presence of my enemies; You anoint my head with oil; my cup overflows.',
  6: 'Surely goodness and mercy will follow me all the days of my life, and I will dwell in the house of the LORD forever.',
};
const LONG_30 =
  'For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life, and live with Him forever more.';

const item = (verse: number, opts: Partial<GuidedItem> & { runsAgo?: number[] } = {}): GuidedItem => {
  const { runsAgo, ...rest } = opts;
  return {
    verseId: `BSB_PSA_23_${verse}`,
    translationId: 'BSB',
    book: 'Psalms',
    chapter: 23,
    verseNumber: verse,
    text: TEXTS[verse] ?? LONG_30,
    orderIndex: verse,
    status: 'learning',
    retentionPhase: 'none',
    dateStarted: null,
    lastReviewDate: null,
    nextReviewDueDate: null,
    currentStreakCount: 0,
    totalSuccessfulReviews: 0,
    gracePeriodUsedToday: false,
    touchLogs: (runsAgo ?? []).map((m) => ({ timestamp: minsAgo(m), drillType: 'type' as const })),
    ...rest,
  } as GuidedItem;
};

const ids = (items: { verseNumber: number }[]) => items.map((i) => i.verseNumber);

const passageVerses = [1, 2, 3, 4, 5].map((n) => toDrillVerse(item(n)));
const long30 = { ...toDrillVerse(item(9)), text: LONG_30 };
const twelve = { book: 'Psalms', chapter: 23, verse: 2, text: 'He makes me lie down in green pastures; He leads me', translationId: 'BSB' };

// ---------------------------------------------------------------- ladder ----
console.log('Ladder');
{
  const rng = seeded(1);
  const twelveWords = createLadder(twelve, passageVerses, {}, rng);
  const thirty = createLadder(long30, passageVerses, {}, rng);
  check('A 12-word verse gets 6 rungs', twelveWords.rungs.length === 6, twelveWords.rungs.length);
  check('A 30-word verse gets 7 rungs', thirty.rungs.length === 7, thirty.rungs.length);

  let dupes = 0;
  let avoided = 0;
  let avoidable = 0;
  for (let s = 1; s <= 200; s++) {
    const l = createLadder(long30, passageVerses, { lastDrill: 'scramble' }, seeded(s));
    const drills = l.rungs.filter((r) => r.kind === 'drill').map((r) => r.drill);
    if (new Set(drills).size !== drills.length) dupes++;
    if (l.eligible.length - 0 > 1 && l.eligible.includes('scramble')) {
      avoidable++;
      if (drills[0] !== 'scramble') avoided++;
    }
  }
  check('Two drill rungs on one verse are never the same drill', dupes === 0, dupes);
  check('The first drill avoids the previous verse\'s last drill when it can', avoidable > 0 && avoided === avoidable, { avoided, avoidable });

  const five = { ...twelve, text: 'The LORD is my shepherd today' };
  check('A 5-word verse never gets Build up', !eligibleDrills(five, passageVerses).includes('buildUp'));
  const short = { ...twelve, text: 'Jesus wept.' };
  check('A verse that splits into under 3 phrases never gets Scramble', !eligibleDrills(short, passageVerses).includes('scramble'));
  check('First letters is always eligible', eligibleDrills(short, [short]).includes('firstLetters'));

  const run = (l: Ladder, events: LadderEvent[], r = seeded(7)) => events.reduce((acc, e) => ladderAfter(acc, e, r), l);
  const base = createLadder(long30, passageVerses, {}, seeded(3)); // 7 rungs
  const upToFully = run(base, ['done', 'done', 'done', 'done', 'done', 'pass']); // read, look, A, B, C, partly
  check('Climbing reaches the fully hidden rung', upToFully.rungs[upToFully.pos].kind === 'fully', upToFully.pos);

  const missFully = ladderAfter(upToFully, 'miss', seeded(11));
  check('Miss on Fully (7 rungs) lands on Drill C', missFully.pos === 4 && missFully.rungs[4].kind === 'drill', missFully.pos);
  check('...and Drill C is a newly picked drill', missFully.rungs[4].drill !== upToFully.rungs[4].drill, {
    before: upToFully.rungs[4].drill,
    after: missFully.rungs[4].drill,
  });
  check('...and the drills still never repeat', new Set(missFully.rungs.filter((r) => r.kind === 'drill').map((r) => r.drill)).size === 3);

  const atPartly = run(base, ['done', 'done', 'done', 'done', 'done']);
  const missPartly = ladderAfter(atPartly, 'miss', seeded(13));
  check('Miss on Partly lands on Drill B', missPartly.pos === 3, missPartly.pos);
  check(
    '...and both B and C are re-picked',
    missPartly.rungs[3].drill !== atPartly.rungs[3].drill && missPartly.rungs[4].drill !== atPartly.rungs[4].drill,
    { before: atPartly.rungs.map((r) => r.drill), after: missPartly.rungs.map((r) => r.drill) }
  );
  check('...and the kept drill A is unchanged', missPartly.rungs[2].drill === atPartly.rungs[2].drill);

  const six = createLadder(twelve, passageVerses, {}, seeded(5)); // read, look, A, B, partly, fully
  const sixAtPartly = run(six, ['done', 'done', 'done', 'done']);
  const dropped = ladderAfter(sixAtPartly, 'miss', seeded(2));
  check('Position never drops below the first drill rung', dropped.pos === 2, dropped.pos);

  let l = run(six, ['done', 'done', 'done', 'done']);
  const climbToPartly = (x: Ladder) => run(x, ['done', 'done']);
  l = ladderAfter(l, 'miss', seeded(1));
  l = ladderAfter(climbToPartly(l), 'miss', seeded(1));
  check('Two misses keep climbing', l.status === 'climbing' && l.misses === 2);
  l = ladderAfter(climbToPartly(l), 'miss', seeded(1));
  check('The third miss gives setAside', l.status === 'setAside' && l.misses === 3, l.status);

  // Partly passed, then Fully missed, then must pass Partly again before Fully counts.
  let f = run(six, ['done', 'done', 'done', 'done', 'pass']);
  f = ladderAfter(f, 'miss', seeded(1));
  check('A miss on Fully resets "partly passed"', f.passedPartly === false);
  f = run(f, ['done', 'done']);
  const stillOnPartly = f.rungs[f.pos].kind;
  f = ladderAfter(f, 'pass', seeded(1));
  check('Finishing needs Partly then Fully, back to back', stillOnPartly === 'partly' && f.status === 'climbing' && f.rungs[f.pos].kind === 'fully');
  f = ladderAfter(f, 'pass', seeded(1));
  check('Partly then Fully both passed finishes the verse', f.status === 'finished');

  // Activity floor across many random paths.
  let worst = Infinity;
  for (let s = 1; s <= 300; s++) {
    const r = seeded(s);
    let lad = createLadder(s % 2 ? long30 : twelve, passageVerses, {}, r);
    let guard = 0;
    while (lad.status === 'climbing' && guard++ < 60) {
      const kind = lad.rungs[lad.pos].kind;
      if (kind === 'partly' || kind === 'fully') lad = ladderAfter(lad, r() < 0.3 ? 'miss' : 'pass', r);
      else lad = ladderAfter(lad, 'done', r);
    }
    if (lad.status === 'finished') worst = Math.min(worst, lad.activities);
  }
  check('Every finished ladder logged 5 or more activities', worst >= 5, worst);

  const drillAt = run(base, ['done', 'done']);
  const rerolled = ladderAfter(drillAt, 'reroll', seeded(4));
  check('reroll changes the drill', rerolled.rungs[rerolled.pos].drill !== drillAt.rungs[drillAt.pos].drill);
  check('...and does not add an activity', rerolled.activities === drillAt.activities && rerolled.pos === drillAt.pos);
  check('reroll keeps drills distinct', new Set(rerolled.rungs.filter((r) => r.kind === 'drill').map((r) => r.drill)).size === 3);

  const k = ladderAfter(base, 'knowIt', seeded(1));
  check('knowIt jumps to the fully hidden rung', k.rungs[k.pos].kind === 'fully' && k.knowIt);
  check('knowIt then pass -> finished', ladderAfter(k, 'pass', seeded(1)).status === 'finished');
  const km = ladderAfter(k, 'miss', seeded(1));
  check('knowIt then miss -> rung 0, misses still 0', km.pos === 0 && km.misses === 0 && km.status === 'climbing', km);
  check('knowIt only works on the Read rung', ladderAfter(drillAt, 'knowIt', seeded(1)) === drillAt);

  const drills: GuidedDrillId[] = ['buildUp', 'scramble'];
  check('pickDrill only repeats the current drill when nothing else exists', pickDrill(['scramble'], [], undefined, 'scramble', seeded(1)) === 'scramble' && pickDrill(drills, [], undefined, 'scramble', seeded(1)) === 'buildUp');
}

// ---------------------------------------------------------------- credit ----
console.log('Credit');
{
  const ctx: GuidedCreditCtx = { now: NOW, reviewsPaused: false, isDue: (d) => !!d && Date.parse(d) <= NOW, credited: new Set() };
  const fresh = item(1);
  const perfect = { passed: true, perfect: true, mode: 'type' as const };
  check('Perfect fully hidden on a 0-run Learning verse -> touch', guidedCredit(fresh, { activity: 'fully', ...perfect }, ctx).kind === 'touch');
  check('Perfect partly hidden -> null', guidedCredit(fresh, { activity: 'partly', ...perfect }, ctx).kind === null);
  check('Perfect refresh recitation -> null', guidedCredit(fresh, { activity: 'refresh', ...perfect }, ctx).kind === null);
  const recent = guidedCredit(item(1, { runsAgo: [30] }), { activity: 'cold', ...perfect }, ctx);
  check('Perfect cold check 30 min after the last run -> null with the hour label', recent.kind === null && /within the last hour/.test(recent.label), recent);
  check('A cold check an hour+ later banks', guidedCredit(item(1, { runsAgo: [90] }), { activity: 'cold', ...perfect }, ctx).kind === 'touch');

  const near = summarizeOutcomes(['perfect', 'close', 'close', 'perfect']);
  check(
    'Near-misses only ("close", no "missed") count as perfect',
    guidedCredit(fresh, { activity: 'fully', passed: near.passesReview, perfect: near.isPerfect, mode: 'speak' }, ctx).kind === 'touch'
  );
  const slip = summarizeOutcomes(['perfect', 'missed', 'perfect', 'perfect']);
  check('One missed word -> null', guidedCredit(fresh, { activity: 'fully', passed: slip.passesReview, perfect: slip.isPerfect, mode: 'speak' }, ctx).kind === null);
  check('Self-marked "got it" never banks a Learning run', guidedCredit(fresh, { activity: 'fully', ...perfect, mode: 'self' }, ctx).kind === null);

  const again = guidedCredit(fresh, { activity: 'stitch', ...perfect }, { ...ctx, credited: new Set([fresh.verseId]) });
  check('The same verse credited twice in one sitting -> second is null', again.kind === null && /Already/.test(again.label));

  const dueReview = item(2, { status: 'reviewing', nextReviewDueDate: minsAgo(60) });
  const futureReview = item(2, { status: 'reviewing', nextReviewDueDate: new Date(NOW + 86400000).toISOString() });
  check('A reviewing verse due today in a stitch -> review', guidedCredit(dueReview, { activity: 'stitch', ...perfect }, ctx).kind === 'review');
  check('A reviewing verse not due -> null', guidedCredit(futureReview, { activity: 'stitch', ...perfect }, ctx).kind === null);
  check('Reviews paused -> null', guidedCredit(dueReview, { activity: 'stitch', ...perfect }, { ...ctx, reviewsPaused: true }).kind === null);
  check('Thread start verse past halfway -> null', guidedCredit(fresh, { activity: 'thread', ...perfect, startsPastHalf: true }, ctx).kind === null);
}

// --------------------------------------------------------------- sitting ----
console.log('Sitting');
{
  const items = [item(1, { runsAgo: [60 * 24] }), item(2, { runsAgo: [40] }), item(3, { runsAgo: [60 * 30] }), item(4), item(5)];
  const q = coldCheckQueue(items, NOW, 3);
  check('Cold checks come out oldest-run-first', ids(q.ready).join() === '3,1', ids(q.ready));
  const waiting = q.waiting.find((w) => w.item.verseNumber === 2);
  check('A verse 40 minutes old is waiting with 20 minutes left', !!waiting && waiting.minutesLeft === 20, q.waiting);
  check('A verse at the mastery count is not cold-checked', coldCheckQueue([item(1, { runsAgo: [300, 200, 100] })], NOW, 3).ready.length === 0);

  const fin = (...ns: number[]) => [1, 2, 3, 4, 5, 6].map((n) => item(n, ns.includes(n) ? { runsAgo: [300] } : {}));
  check('Finished 1, 2, 3, 5 -> no stitch (5 has no finished neighbour)', stitchWindow(fin(1, 2, 3, 5)).length === 0, ids(stitchWindow(fin(1, 2, 3, 5))));
  check('Finished 1-4 -> [2, 3, 4]', ids(stitchWindow(fin(1, 2, 3, 4))).join() === '2,3,4', ids(stitchWindow(fin(1, 2, 3, 4))));
  check('One finished verse -> no stitch', stitchWindow(fin(2)).length === 0);
  check('Finished status reviewing counts', isFinishedVerse(item(1, { status: 'reviewing' })));

  const longItems = [1, 2, 3].map((n) => item(n, { runsAgo: [300], text: LONG_30 + ' ' + LONG_30 }));
  check('A window over 120 words shrinks to 2 verses', ids(stitchWindow(longItems)).join() === '2,3', ids(stitchWindow(longItems)));

  const withAside = nextNewVerse([item(5), item(6, { guidedSetAside: true }), item(1, { runsAgo: [90] })]);
  check('A set-aside verse 6 comes before a new verse 5', withAside?.verseNumber === 6, withAside?.verseNumber);
  check('Without a flag the lowest verse number is next', nextNewVerse([item(5), item(4)])?.verseNumber === 4);

  const passages = buildPassages([item(1), item(2), item(4), item(5)]);
  check('A gap in verse numbers splits a passage', passages.length === 2 && ids(passages[0].items).join() === '1,2' && ids(passages[1].items).join() === '4,5');

  // ---- walk the reducer ----
  const mk = (its: GuidedItem[], extra: Partial<SessionEnv> = {}): SessionEnv => ({
    items: its, now: NOW, masteryTouches: 3, pace: 2, newToday: 0, rng: seeded(21), ...extra,
  });
  const send = (s: SessionState, e: SessionEvent, env: SessionEnv) => sessionReducer(s, e, env);

  {
    const env = mk([item(1, { runsAgo: [60 * 24] }), item(2), item(3)]);
    let s = send(startSession(env), { type: 'begin' }, env);
    check('Cold checks always run before any new verse', s.step.kind === 'cold' && s.step.verseId === 'BSB_PSA_23_1', s.step);
    s = send(s, { type: 'result', perfect: true }, env);
    check('After the only cold check: single finished verse -> straight to the new verse ladder', s.step.kind === 'ladder' && s.step.verseId === 'BSB_PSA_23_2', s.step);
  }
  {
    const env = mk([item(1, { runsAgo: [60 * 24] }), item(2, { runsAgo: [60 * 24] }), item(3)]);
    let s = send(startSession(env), { type: 'begin' }, env);
    s = send(s, { type: 'result', perfect: true }, env);
    s = send(s, { type: 'result', perfect: true }, env);
    check('Two finished verses -> opening stitch after the cold checks', s.step.kind === 'stitch' && s.step.verseIds.length === 2, s.step);
  }
  {
    const env = mk([item(1, { runsAgo: [60 * 24] }), item(2, { runsAgo: [60 * 24] }), item(3)], { pace: 1, newToday: 1 });
    let s = send(startSession(env), { type: 'begin' }, env);
    s = send(s, { type: 'result', perfect: true }, env);
    s = send(s, { type: 'result', perfect: true }, env);
    s = send(s, { type: 'result', perfect: true }, env); // stitch
    check('Pace 1 with one verse finished today stops at "Done for today" after checks and stitch', s.step.kind === 'doneToday', s.step);
    s = send(s, { type: 'keepGoing' }, env);
    check('Keep going starts the next new verse', s.step.kind === 'ladder' && s.step.verseId === 'BSB_PSA_23_3');
  }
  {
    const env = mk([item(1, { runsAgo: [60 * 24] }), item(2, { runsAgo: [60 * 24] }), item(3)], { pace: 0 });
    let s = send(startSession(env), { type: 'begin' }, env);
    s = send(s, { type: 'result', perfect: true }, env);
    s = send(s, { type: 'result', perfect: true }, env);
    s = send(s, { type: 'result', perfect: false, firstSlip: 1 }, env);
    check('A slipped stitch gives a seam cue next', s.step.kind === 'seam', s.step);
    s = send(s, { type: 'result', perfect: true }, env);
    check('...then stitches again', s.step.kind === 'stitch' && s.step.fails === 1, s.step);
    s = send(s, { type: 'result', perfect: false, firstSlip: 1 }, env);
    check('Two failed stitches in a row move on, with no set-aside', s.step.kind !== 'stitch' && s.step.kind !== 'seam' && s.setAside.length === 0, s.step);
  }
  {
    const env = mk([item(1), item(2)], { pace: 2 });
    let s = send(startSession(env), { type: 'begin' }, env);
    check('A single-verse passage opens on the ladder', s.step.kind === 'ladder');
    // Climb verse 1 to the end.
    const climb = (st: SessionState): SessionState => {
      let guard = 0;
      while (st.step.kind === 'ladder' && guard++ < 30) {
        const kind = st.step.ladder.rungs[st.step.ladder.pos].kind;
        st = send(st, kind === 'partly' || kind === 'fully' ? { type: 'result', perfect: true } : { type: 'next' }, env);
        if (st.finishedThisSitting.length > 0) break;
      }
      return st;
    };
    s = climb(s);
    check('A finished verse with no neighbour goes to the next verse without a stitch', s.step.kind === 'ladder' && s.step.verseId === 'BSB_PSA_23_2' && s.finishedThisSitting.length === 1, s.step);
  }
  {
    const env = mk([item(1)], { pace: 1 });
    let s = send(startSession(env), { type: 'begin' }, env);
    let guard = 0;
    while (s.step.kind === 'ladder' && guard++ < 30) {
      const kind = s.step.ladder.rungs[s.step.ladder.pos].kind;
      s = send(s, kind === 'partly' || kind === 'fully' ? { type: 'result', perfect: true } : { type: 'next' }, env);
    }
    check('A single-verse passage never produces a stitch or thread step', s.step.kind === 'doneToday' && !s.log.some((l) => l.step === 'stitch' || l.step === 'thread'), s.step);
  }
  {
    const env = mk([item(1)], { pace: 1 });
    let s = send(startSession(env), { type: 'begin' }, env);
    for (let i = 0; i < 40 && s.step.kind === 'ladder' && s.setAside.length === 0; i++) {
      const kind = s.step.ladder.rungs[s.step.ladder.pos].kind;
      s = send(s, kind === 'partly' || kind === 'fully' ? { type: 'result', perfect: false } : { type: 'next' }, env);
    }
    check('Three misses set the verse aside and the sitting moves on', s.setAside.join() === 'BSB_PSA_23_1' && s.step.kind === 'doneToday', { setAside: s.setAside, step: s.step.kind });
  }

  // ---- flexibility: skip and jump ----
  {
    // Verses 1-3 have a run from yesterday, 4 is new.
    const its = () => [item(1, { runsAgo: [60 * 24] }), item(2, { runsAgo: [60 * 24] }), item(3, { runsAgo: [60 * 24] }), item(4)];
    const env = mk(its());
    let s = send(startSession(env), { type: 'startNew' }, env);
    check('Start new from the opening skips checks and stitch for the new verse', s.step.kind === 'ladder' && s.step.verseId === 'BSB_PSA_23_4', s.step);
    check('...and keeps the skipped checks for later', s.coldQueue.length === 3, s.coldQueue);

    const zero = mk(its(), { pace: 0 });
    const z = send(startSession(zero), { type: 'startNew' }, zero);
    check('Start new works on a non-learning day (pace 0)', z.step.kind === 'ladder', z.step);

    const two = mk([item(1, { runsAgo: [60 * 24] }), item(2), item(3)]);
    const picked = send(startSession(two), { type: 'startNew', verseId: 'BSB_PSA_23_3' }, two);
    check('Start new can pick a verse other than the lowest', picked.step.kind === 'ladder' && picked.step.verseId === 'BSB_PSA_23_3', picked.step);
    const bad = send(startSession(two), { type: 'startNew', verseId: 'BSB_PSA_23_1' }, two);
    check('A verse that already has a run is not started as new', bad.step.kind === 'ladder' && bad.step.verseId === 'BSB_PSA_23_2', bad.step);

    let c = send(startSession(env), { type: 'begin' }, env);
    c = send(c, { type: 'skip' }, env);
    check('Skip on a cold check moves to the next check with nothing logged', c.step.kind === 'cold' && c.step.verseId === 'BSB_PSA_23_2' && c.log.length === 0, c.step);
    c = send(c, { type: 'startNew' }, env);
    check('Start new from a cold check goes to the new verse', c.step.kind === 'ladder' && c.step.verseId === 'BSB_PSA_23_4', c.step);

    let st = send(startSession(env), { type: 'begin' }, env);
    st = send(send(send(st, { type: 'skip' }, env), { type: 'skip' }, env), { type: 'skip' }, env);
    check('Skipping every check reaches the stitch', st.step.kind === 'stitch', st.step);
    st = send(st, { type: 'skip' }, env);
    check('Skip on the stitch moves on (here to the new verse)', st.step.kind === 'ladder', st.step);
    check('A skipped ladder step does nothing', send(st, { type: 'skip' }, env) === st);
    check('Start new does nothing on a ladder', send(st, { type: 'startNew' }, env) === st);
  }
  {
    // Done for today offers the checks a jump skipped.
    const env = mk([item(1, { runsAgo: [60 * 24] }), item(2)], { pace: 1 });
    let s = send(startSession(env), { type: 'startNew' }, env);
    let guard = 0;
    while (s.step.kind === 'ladder' && guard++ < 30) {
      const kind = s.step.ladder.rungs[s.step.ladder.pos].kind;
      s = send(s, kind === 'partly' || kind === 'fully' ? { type: 'result', perfect: true } : { type: 'next' }, env);
    }
    // The stitch of 1-2 runs after the new verse; skip it.
    if (s.step.kind === 'stitch') s = send(s, { type: 'skip' }, env);
    check('After a jump the sitting reaches Done for today with the check still waiting', s.step.kind === 'doneToday' && s.coldQueue.join() === 'BSB_PSA_23_1', { step: s.step.kind, q: s.coldQueue });
    s = send(s, { type: 'doChecks' }, env);
    check('Do checks runs the waiting cold check', s.step.kind === 'cold' && s.step.verseId === 'BSB_PSA_23_1', s.step);
  }

  // ---- easier and the jigsaw setting ----
  {
    const run = (l: Ladder, events: LadderEvent[], r = seeded(7)) => events.reduce((acc, e) => ladderAfter(acc, e, r), l);
    const base = createLadder(long30, passageVerses, {}, seeded(3)); // read, look, A, B, C, partly, fully
    const atFully = run(base, ['done', 'done', 'done', 'done', 'done', 'pass']);
    const down = ladderAfter(atFully, 'easier', seeded(9));
    check('Easier on fully hidden steps down to partly hidden', down.rungs[down.pos].kind === 'partly', down.pos);
    check('...with no miss and no activity counted', down.misses === 0 && down.activities === atFully.activities, { m: down.misses, a: down.activities });
    check('...and partly hidden has to be passed again', down.passedPartly === false);
    const down2 = ladderAfter(down, 'easier', seeded(9));
    check('Easier on partly hidden steps down to a drill', down2.rungs[down2.pos].kind === 'drill' && down2.misses === 0, down2.pos);
    const atDrill = run(base, ['done', 'done']);
    check('Easier does nothing on a drill', ladderAfter(atDrill, 'easier', seeded(9)) === atDrill);
    const known = ladderAfter(base, 'knowIt', seeded(9));
    const backed = ladderAfter(known, 'easier', seeded(9));
    check('Easier after "I know this one" lands on partly hidden, shortcut dropped', backed.rungs[backed.pos].kind === 'partly' && !backed.knowIt && backed.misses === 0, backed);

    const env = mk([item(1, { runsAgo: [60 * 24] }), item(2)]);
    let s = send(startSession(env), { type: 'begin' }, env);
    s = send(s, { type: 'easier' }, env);
    check('Easier on a cold check goes to the refresh drill with nothing logged', s.step.kind === 'cold' && s.step.stage === 'refreshDrill' && s.log.length === 0, s.step);

    // Every second 3-verse stitch gets a jigsaw warm-up unless the setting is off.
    const three = [item(1, { runsAgo: [60 * 24] }), item(2, { runsAgo: [60 * 24] }), item(3, { runsAgo: [60 * 24] })];
    const second = (on: boolean) => {
      const e = mk(three, { jigsawWarmUp: on });
      let st: SessionState = { ...startSession(e), coldQueue: [], stitchCount: 1 };
      st = send(st, { type: 'begin' }, e);
      return st.step;
    };
    const onStep = second(true);
    const offStep = second(false);
    check('Second 3-verse stitch opens with a jigsaw when the warm-up is on', onStep.kind === 'stitch' && onStep.stage === 'jigsaw', onStep);
    check('...and goes straight to reciting when it is off', offStep.kind === 'stitch' && offStep.stage === 'recite', offStep);
  }
}

console.log(failures === 0 ? '\nall guided checks passed' : `\n${failures} guided check(s) FAILED`);
if (failures > 0) process.exit(1);

