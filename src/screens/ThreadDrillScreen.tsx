import { useEffect, useMemo, useRef, useState } from 'react';
import { verseStage } from '../lib/stageProgress';
import { ScrollView, View } from 'react-native';
import { RefreshCw, Route, X } from 'lucide-react-native';

import { AppState, isReviewDue } from '../state/useAppState';
import { QueueItem, VerseState } from '../types';
import { translationLabel } from '../data';
import { FadeInView } from '../components/ui';
import { Dropdown } from '../components/Dropdown';
import { AppButton, AppIconButton, AppText, Switch, useScaledSpace } from '../components/design';
import { EmptyState, GroupedList, ListRow, ScreenHeader } from '../components/blocks';
import ThreadRound, { ThreadAnswerMode, ThreadRoundResult, ThreadVerse } from '../components/ThreadRound';
import { GradeInput, wordAccuracy } from '../lib/grading';
import {
  buildThreadPassages,
  MIN_THREAD_VERSES,
  pickThreadCue,
  ThreadCue,
  threadCueKey,
  threadRunEndingAt,
  threadStartVerseCounts,
} from '../lib/drills';

// ============================================================================
// PICK UP THE THREAD
// ----------------------------------------------------------------------------
// Two words and a verse number from earlier in the passage; recite from there
// through the end of the last verse. Builds the joins between verses.
//
// Which verses (2026-10-11, modelled on Reference practice): a From filter
// (all started / learning / daily / weekly / monthly) and Due today only. With
// no chapter chosen, a session covers every chapter the filters match, moving
// between them. A chapter can still be picked, with a verse range.
//
// Verses at a time: every session is cut into short overlapping stretches
// (1-3, 3-5, 5-7 at 3 at a time) and cues stay inside one stretch, so a cue
// never asks for most of a chapter from the middle. The session walks the
// stretches in order. "All" keeps a range whole.
//
// Credit, as the user chose it (2026-10-10):
//   - Every verse recited through can count, each scored on its own words at
//     the same 90% a review needs. The start verse counts only when the cue
//     falls in its first half.
//   - A verse only counts when a review would count anyway: due today (and
//     reviews not paused), or a verse still being learned with a perfect,
//     machine-graded run an hour after its last touch. The engine refuses
//     early reviews as well (handleReviewCompleted); checking here too lets
//     the round say so before anything is logged.
//   - Misses never count against a verse. Below 90% is simply no credit.
//   - Show text + Got it counts as a review, recorded as self-reported, and
//     never as a perfect recall.
//   - Each verse counts at most once per visit to this screen.
// Credit is logged when a round ends, quietly; the round's own results and
// the recap say what counted.
// ============================================================================

/** 0 = one cue per stretch. */
const SESSION_LENGTHS = [
  { id: 0, label: 'Once through' },
  { id: 5, label: '5' },
  { id: 10, label: '10' },
  { id: 20, label: '20' },
];

/** 0 = the whole range as one stretch. */
const STRETCH_SIZES = [
  { id: 2, label: '2' },
  { id: 3, label: '3' },
  { id: 4, label: '4' },
  { id: 5, label: '5' },
  { id: 0, label: 'All' },
];

// Same sets, same words as Reference practice.
const REVIEW_SETS = [
  { id: 'all' as const, label: 'All started' },
  { id: 'learning' as const, label: 'Learning' },
  { id: 'settling' as const, label: 'Settling' },
  { id: 'steady' as const, label: 'Steady' },
  { id: 'kept' as const, label: 'Kept' },
  { id: 'secure' as const, label: 'Secure' },
];
type ReviewSet = (typeof REVIEW_SETS)[number]['id'];

/** The Chapter picker's "no single chapter" choice. */
const ALL_CHAPTERS = '';

/** Cues in a "Drill this spot" set. */
const SPOT_DRILL_LENGTH = 3;

type Phase = 'setup' | 'playing' | 'recap';
type PoolVerse = ThreadVerse & { item: QueueItem };
type CreditKind = 'review' | 'touch';

interface RoundLog {
  /** Index into the session's stretches. */
  p: number;
  cue: ThreadCue;
  result: ThreadRoundResult;
  counted: { verse: PoolVerse; kind: CreditKind; self: boolean }[];
}

interface Session {
  stretches: PoolVerse[][];
  total: number;
  spot: boolean;
}

const passageKey = (v: { translationId?: string; book: string; chapter: number }) => `${v.translationId || ''}|${v.book}|${v.chapter}`;
const verseKey = (v: { translationId?: string; book: string; chapter: number; verse: number }) => `${passageKey(v)}|${v.verse}`;

const rangeLabel = (verses: { book: string; chapter: number; verse: number }[]) =>
  verses.length === 0
    ? ''
    : `${verses[0].book} ${verses[0].chapter}:${verses[0].verse}${verses.length > 1 ? `–${verses[verses.length - 1].verse}` : ''}`;

/** "Romans 8:1, 2 · Psalms 23:3" -- verses grouped by chapter, in the order given. */
const listRefs = (verses: { book: string; chapter: number; verse: number }[]) => {
  const groups: { head: string; nums: number[] }[] = [];
  verses.forEach((v) => {
    const head = `${v.book} ${v.chapter}`;
    const g = groups.find((x) => x.head === head);
    if (g) {
      if (!g.nums.includes(v.verse)) g.nums.push(v.verse);
    } else groups.push({ head, nums: [v.verse] });
  });
  return groups.map((g) => `${g.head}:${g.nums.join(', ')}`).join(' · ');
};

export default function ThreadDrillScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const { memoryQueue, navigateTo, threadDrillPreset, setThreadDrillPreset, handleUpdateVerseStatus, validateTouch, reviewsPaused } = state;

  // Every started verse. 'queued' ones were never taught, so a cue can't point at them.
  const pool = useMemo<PoolVerse[]>(
    () =>
      memoryQueue
        .filter((i) => i.status !== 'queued')
        .map((i) => ({ book: i.book, chapter: i.chapter, verse: i.verseNumber, text: i.text, translationId: i.translationId || 'ESV', item: i })),
    [memoryQueue]
  );

  // ---- Filters ----------------------------------------------------------------
  const [reviewSet, setReviewSet] = useState<ReviewSet>('all');
  const [dueTodayOnly, setDueTodayOnly] = useState(false);
  const [stretchSize, setStretchSize] = useState(3);
  const [sessionLength, setSessionLength] = useState(0);
  const [hideVerseNumber, setHideVerseNumber] = useState(false);

  // Which verses the filters pick -- the same rules Reference practice uses.
  // While reviews are paused nothing is due, as on Home.
  const isTarget = (v: PoolVerse) => {
    const i = v.item;
    if (reviewSet === 'learning' && i.status !== 'learning') return false;
    if (reviewSet !== 'all' && reviewSet !== 'learning' && verseStage(i) !== reviewSet) return false;
    if (dueTodayOnly && !(i.status === 'reviewing' && !reviewsPaused && isReviewDue(i.nextReviewDueDate))) return false;
    return true;
  };

  // Every chapter (per translation) that has two verses in a row, sorted.
  const chapters = useMemo(() => {
    const byKey = new Map<string, PoolVerse[]>();
    pool.forEach((v) => byKey.set(passageKey(v), [...(byKey.get(passageKey(v)) || []), v]));
    const translationsPerChapter = new Map<string, number>();
    byKey.forEach((vs) => {
      const ch = `${vs[0].book}|${vs[0].chapter}`;
      translationsPerChapter.set(ch, (translationsPerChapter.get(ch) || 0) + 1);
    });
    const out: { id: string; label: string; verses: PoolVerse[] }[] = [];
    byKey.forEach((vs, id) => {
      const sorted = [...vs].sort((a, b) => a.verse - b.verse);
      if (!sorted.some((v) => threadRunEndingAt(sorted, v).length >= MIN_THREAD_VERSES)) return;
      const first = sorted[0];
      const twoTranslations = (translationsPerChapter.get(`${first.book}|${first.chapter}`) || 0) > 1;
      out.push({
        id,
        label: `${first.book} ${first.chapter}${twoTranslations ? ` · ${translationLabel(first.translationId || 'ESV')}` : ''}`,
        verses: sorted,
      });
    });
    return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [pool]);

  // What the filters match, as threadable passages (whole, before cutting into
  // stretches) -- decides which chapters the picker offers.
  const matchingPassages = useMemo(
    () => buildThreadPassages(pool, isTarget),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pool, reviewSet, dueTodayOnly, reviewsPaused]
  );
  const matchingChapterIds = useMemo(() => new Set(matchingPassages.map((p) => passageKey(p[0]))), [matchingPassages]);
  const chapterOptions = chapters.filter((c) => matchingChapterIds.has(c.id));

  // ---- One chapter, with a verse range ----------------------------------------
  const [chapterId, setChapterId] = useState(ALL_CHAPTERS);
  const [throughVerse, setThroughVerse] = useState(0);
  const [fromVerse, setFromVerse] = useState(0);

  const chapter = chapters.find((c) => c.id === chapterId) ?? null;
  const throughOptions = useMemo(
    () => (chapter ? chapter.verses.filter((v) => threadRunEndingAt(chapter.verses, v).length >= MIN_THREAD_VERSES) : []),
    [chapter]
  );
  const run = useMemo(() => {
    const end = chapter?.verses.find((v) => v.verse === throughVerse);
    return chapter && end ? threadRunEndingAt(chapter.verses, end) : [];
  }, [chapter, throughVerse]);
  const fromOptions = run.slice(0, -1);

  // Choosing a chapter starts on the first stretch of it the filters match
  // (or the verse asked for), so "Due today" lands on the due verses.
  const chooseChapter = (id: string, through?: number) => {
    if (id === ALL_CHAPTERS) {
      setChapterId(ALL_CHAPTERS);
      return;
    }
    const c = chapters.find((x) => x.id === id);
    if (!c) return;
    const ends = c.verses.filter((v) => threadRunEndingAt(c.verses, v).length >= MIN_THREAD_VERSES);
    const matched = matchingPassages.find((p) => passageKey(p[0]) === id);
    const end =
      ends.find((v) => v.verse === through) ??
      (matched ? ends.find((v) => v.verse === matched[matched.length - 1].verse) : undefined) ??
      ends[ends.length - 1];
    const runToEnd = threadRunEndingAt(c.verses, end);
    const start = through === undefined && matched ? matched[0].verse : runToEnd[0].verse;
    setChapterId(id);
    setThroughVerse(end.verse);
    setFromVerse(Math.max(runToEnd[0].verse, Math.min(start, end.verse - 1)));
  };

  // A filter change that leaves the chosen chapter with nothing matching goes
  // back to all chapters rather than running something the filters exclude.
  useEffect(() => {
    if (chapterId !== ALL_CHAPTERS && !matchingChapterIds.has(chapterId)) setChapterId(ALL_CHAPTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchingChapterIds]);

  // Opened from a passing Recall: start on that chapter and verse, with the
  // filters wide open. The preset is cleared once read, so coming back later
  // from Home doesn't reopen on a stale verse.
  useEffect(() => {
    const preset = threadDrillPreset;
    if (!preset) return;
    setThreadDrillPreset(null);
    const id = passageKey({ ...preset, translationId: preset.translationId || 'ESV' });
    const c = chapters.find((x) => x.id === id);
    if (c && c.verses.some((v) => v.verse === preset.verse && threadRunEndingAt(c.verses, v).length >= MIN_THREAD_VERSES)) {
      setReviewSet('all');
      setDueTodayOnly(false);
      // Usually one short stretch here, where "once through" is a single cue.
      setSessionLength(5);
      chooseChapter(id, preset.verse);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters]);

  // The stretches a session would run, from the current settings.
  const plannedStretches = useMemo(() => {
    const size = stretchSize === 0 ? Infinity : stretchSize;
    if (chapter) {
      const range = run.filter((v) => v.verse >= fromVerse);
      return range.length >= MIN_THREAD_VERSES ? buildThreadPassages(range, () => true, size) : [];
    }
    return buildThreadPassages(pool, isTarget, size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter, run, fromVerse, stretchSize, pool, reviewSet, dueTodayOnly, reviewsPaused]);

  // ---- Session ----------------------------------------------------------------
  const [phase, setPhase] = useState<Phase>('setup');
  const [session, setSession] = useState<Session>({ stretches: [], total: 0, spot: false });
  // The full session, kept while a "Drill this spot" set runs, for Go again.
  const baseSessionRef = useRef<Session | null>(null);
  const [current, setCurrent] = useState<{ p: number; cue: ThreadCue | null }>({ p: 0, cue: null });
  const [rounds, setRounds] = useState<RoundLog[]>([]);
  // Cue spots already given, per stretch, so they don't repeat until all are used.
  const usedRef = useRef(new Map<number, Set<string>>());
  // Verses already credited during this visit. Survives Go again and spot drills.
  const creditedRef = useRef(new Map<string, CreditKind>());

  const cueFor = (stretches: PoolVerse[][], p: number): ThreadCue | null => {
    const verses = stretches[p];
    if (!verses) return null;
    const used = usedRef.current.get(p) ?? new Set<string>();
    usedRef.current.set(p, used);
    const c = pickThreadCue(verses, verses.length - 1, { used });
    if (c) used.add(threadCueKey(c));
    return c;
  };

  const startSession = (s: Session) => {
    if (s.stretches.length === 0) return;
    setSession(s);
    setRounds([]);
    usedRef.current = new Map();
    setCurrent({ p: 0, cue: cueFor(s.stretches, 0) });
    setPhase('playing');
  };

  const startFromSettings = () => {
    const s = {
      stretches: plannedStretches,
      total: sessionLength === 0 ? plannedStretches.length : sessionLength,
      spot: false,
    };
    baseSessionRef.current = s;
    startSession(s);
  };

  // ---- Credit -----------------------------------------------------------------
  // What a verse in this round would earn, and why. Pure: the round screen
  // shows it before anything is logged.
  const decide = (
    verses: PoolVerse[],
    c: ThreadCue,
    index: number,
    passed: boolean,
    perfect: boolean,
    mode: ThreadAnswerMode
  ): { kind: CreditKind | null; label: string } => {
    const v = verses[index];
    if (!v) return { kind: null, label: '' };
    if (index === c.startVerse && !threadStartVerseCounts(verses, c)) return { kind: null, label: 'Started past halfway, so not counted' };
    if (!passed) return { kind: null, label: 'Under 90%, so no credit and no penalty' };
    if (creditedRef.current.get(verseKey(v))) return { kind: null, label: 'Already counted this session' };
    const item = v.item;
    if (item.status === 'learning') {
      if (mode === 'self') return { kind: null, label: 'Learning a verse needs it graded, not self-checked' };
      if (!perfect) return { kind: null, label: 'Learning a verse needs every word right' };
      if (!validateTouch(item, mode)) return { kind: null, label: 'Counted toward learning within the last hour' };
      return { kind: 'touch', label: 'Counts toward learning' };
    }
    if (item.status === 'reviewing') {
      if (reviewsPaused) return { kind: null, label: 'Reviews are paused, so practice only' };
      if (!isReviewDue(item.nextReviewDueDate)) return { kind: null, label: 'Not due yet, so practice only' };
      return { kind: 'review', label: mode === 'self' ? 'Counts as a review, checked by you' : 'Counts as a review' };
    }
    return { kind: null, label: 'Complete, so practice only' };
  };

  const toVerseState = (v: PoolVerse): VerseState => ({
    book: v.book,
    chapter: v.chapter,
    verse: v.verse,
    text: v.text,
    status: 'memorized',
    translationId: v.translationId,
  });

  const finishRound = async (result: ThreadRoundResult) => {
    const { p, cue: c } = current;
    if (!c) return;
    const verses = session.stretches[p];
    const counted: RoundLog['counted'] = [];
    const touches: PoolVerse[] = [];
    const reviews: PoolVerse[] = [];
    result.perVerse.forEach((pv) => {
      const { kind } = decide(verses, c, pv.index, pv.ok, pv.perfect, result.mode);
      if (!kind) return;
      const v = verses[pv.index];
      creditedRef.current.set(verseKey(v), kind);
      counted.push({ verse: v, kind, self: result.mode === 'self' });
      (kind === 'touch' ? touches : reviews).push(v);
    });

    setRounds((prev) => [...prev, { p, cue: c, result, counted }]);
    const played = rounds.length + 1;
    if (played >= session.total) {
      setPhase('recap');
    } else {
      // Stretches in reading order, then around again.
      const next = played % session.stretches.length;
      setCurrent({ p: next, cue: cueFor(session.stretches, next) });
    }

    // Logged after the screen moves on, so a slow write never holds up the next cue.
    // A review carries each verse's grade: its words graded against the
    // clean setting, or the user's own Got it; a missed spot check means it
    // can't move the passage up.
    const drill = result.mode === 'self' ? 'reveal' : result.mode;
    const gradeFor = (vs: VerseState): GradeInput | undefined => {
      const k = verses.findIndex((v) => v.verse === vs.verse && v.chapter === vs.chapter);
      const pv = result.perVerse.find((x) => x.index === k);
      if (!pv) return undefined;
      return pv.outcomes ? { kind: 'recall', accuracy: wordAccuracy(pv.outcomes) } : { kind: 'self', answer: pv.answer ?? (pv.ok ? 'gotIt' : 'stumbled') };
    };
    if (touches.length > 0) {
      await handleUpdateVerseStatus(touches.map(toVerseState), 'memorized', drill, { perfect: true, quiet: true, via: 'thread' });
    }
    if (reviews.length > 0) {
      await handleUpdateVerseStatus(reviews.map(toVerseState), 'memorized', drill, {
        perfect: false,
        quiet: true,
        via: 'thread',
        gradeFor,
        ...(result.spotPassed === false ? { canMoveUp: false } : {}),
      });
    }
  };

  const differentCue = () => setCurrent((cur) => ({ p: cur.p, cue: cueFor(session.stretches, cur.p) }));

  const handleBack = () => navigateTo('home');

  // ==========================================================================
  // SETUP
  // ==========================================================================
  if (phase === 'setup') {
    const header = (
      <ScreenHeader
        title="Pick up the thread"
        subtitle="Start from two words in an earlier verse and recite through to the end of your verse. Verses that are due count as reviewed."
        onBack={handleBack}
        backLabel="Today"
      />
    );
    if (chapters.length === 0) {
      return (
        <FadeInView style={{ flex: 1 }}>
          <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
            {header}
            <EmptyState
              Icon={Route}
              title="Start two verses in a row"
              message="A thread starts in one verse you've learned and runs into the next. Once you've started two neighbouring verses in the same chapter, they'll show up here."
            />
          </ScrollView>
        </FadeInView>
      );
    }

    const n = plannedStretches.length;
    const chapterCount = new Set(plannedStretches.map((s) => passageKey(s[0]))).size;
    const stretchList = plannedStretches.length <= 4 ? plannedStretches.map((s) => rangeLabel(s).replace(/^.* \d+:/, '')).join(', ') : '';
    const versesFooter = !chapter
      ? n === 0
        ? 'Nothing matches. Try another review set, or turn off Due today only.'
        : `${n} ${n === 1 ? 'stretch' : 'stretches'} across ${chapterCount} ${chapterCount === 1 ? 'chapter' : 'chapters'}.`
      : `Recite through the end of verse ${throughVerse}${
          n > 1 ? `, as ${n} overlapping stretches${stretchList ? `: ${stretchList}` : ''}` : ''
        }.`;

    return (
      <FadeInView style={{ flex: 1 }}>
        <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
          {header}

          <GroupedList header="Which verses" footer={versesFooter}>
            <ListRow
              title="From"
              accessory={
                <Dropdown
                  value={reviewSet}
                  onChange={(s) => setReviewSet(s as ReviewSet)}
                  options={REVIEW_SETS}
                  title="Practice verses from"
                  searchable={false}
                  compact
                />
              }
            />
            <ListRow
              title="Due today only"
              subtitle="Only verses whose review is due today."
              accessory={<Switch value={dueTodayOnly} onChange={setDueTodayOnly} accessibilityLabel="Due today only" />}
            />
            <ListRow
              title="Chapter"
              accessory={
                <Dropdown
                  value={chapterId}
                  onChange={(id) => chooseChapter(id)}
                  options={[{ id: ALL_CHAPTERS, label: 'All matching' }, ...chapterOptions.map((c) => ({ id: c.id, label: c.label }))]}
                  title="Chapter"
                  searchable={chapterOptions.length > 8}
                  compact
                />
              }
            />
            {chapter && (
              <>
                <ListRow
                  title="Through verse"
                  accessory={
                    <Dropdown
                      value={throughVerse}
                      onChange={(v) => chooseChapter(chapter.id, v)}
                      options={throughOptions.map((v) => ({ id: v.verse, label: String(v.verse) }))}
                      title="Recite through verse"
                      searchable={false}
                      compact
                    />
                  }
                />
                <ListRow
                  title="Starting from verse"
                  accessory={
                    <Dropdown
                      value={fromVerse}
                      onChange={setFromVerse}
                      options={fromOptions.map((v) => ({ id: v.verse, label: String(v.verse) }))}
                      title="Cues start from verse"
                      searchable={false}
                      compact
                    />
                  }
                />
              </>
            )}
          </GroupedList>

          <GroupedList header="Session">
            <ListRow
              title="Verses at a time"
              subtitle="Each thread stays inside a short stretch, so it never asks for a whole chapter."
              accessory={<Dropdown value={stretchSize} onChange={setStretchSize} options={STRETCH_SIZES} title="Verses at a time" searchable={false} compact />}
            />
            <ListRow
              title="How many"
              accessory={<Dropdown value={sessionLength} onChange={setSessionLength} options={SESSION_LENGTHS} title="How many cues" searchable={false} compact />}
            />
            <ListRow
              title="Hide verse numbers"
              subtitle="Place the words without being told which verse they're in."
              accessory={<Switch value={hideVerseNumber} onChange={setHideVerseNumber} accessibilityLabel="Hide verse numbers" />}
            />
          </GroupedList>

          <AppButton
            size="lg"
            variant="primary"
            Icon={Route}
            label={chapter ? `Start ${rangeLabel(run.filter((v) => v.verse >= fromVerse))}` : 'Start'}
            onPress={startFromSettings}
            disabled={n === 0}
          />
        </ScrollView>
      </FadeInView>
    );
  }

  // ==========================================================================
  // RECAP
  // ==========================================================================
  if (phase === 'recap') {
    const oneChapter = new Set(session.stretches.map((s) => passageKey(s[0]))).size === 1;
    const label = (v: PoolVerse) => (oneChapter ? `v${v.verse}` : `${v.book} ${v.chapter}:${v.verse}`);

    const counted = rounds.flatMap((r) => r.counted);
    const reviewed = counted.filter((c) => c.kind === 'review' && !c.self).map((c) => c.verse);
    const selfReviewed = counted.filter((c) => c.kind === 'review' && c.self).map((c) => c.verse);
    const learned = counted.filter((c) => c.kind === 'touch').map((c) => c.verse);
    const refs = (vs: PoolVerse[]) => (oneChapter ? vs.map((v) => `v${v.verse}`).join(', ') : listRefs(vs));

    // Slips per verse, each counted against the runs that passed through that
    // spot. One row per verse: getting into it and stumbling within it drill
    // the same way, so they share a button. Stretches overlap, so a verse is
    // keyed by reference, and drilled in the stretch where it sits latest
    // (most room for a cue before it).
    type Tally = { slipped: number; through: number };
    const spots = new Map<string, { verse: PoolVerse; p: number; index: number; join?: Tally; inside?: Tally }>();
    const covers = (r: RoundLog, key: string, join: boolean) => {
      const vs = session.stretches[r.p];
      for (let i = r.cue.startVerse; i <= r.cue.endVerse; i++) {
        if (verseKey(vs[i]) === key) return join ? i > r.cue.startVerse : true;
      }
      return false;
    };
    rounds.forEach((r) =>
      r.result.slips.forEach((s) => {
        const v = session.stretches[r.p][s.verse];
        const key = verseKey(v);
        const spot = spots.get(key) ?? { verse: v, p: r.p, index: s.verse };
        if (s.verse > spot.index) {
          spot.p = r.p;
          spot.index = s.verse;
        }
        const through = rounds.filter((x) => covers(x, key, s.kind === 'join')).length;
        spot[s.kind] = { slipped: (spot[s.kind]?.slipped || 0) + 1, through };
        spots.set(key, spot);
      })
    );
    const rate = (x?: Tally) => (x ? x.slipped / x.through : 0);
    const spotList = [...spots.values()].sort(
      (a, b) => Math.max(rate(b.join), rate(b.inside)) - Math.max(rate(a.join), rate(a.inside)) || a.index - b.index
    );
    const runs = (x: Tally) => `${x.slipped} of ${x.through} ${x.through === 1 ? 'run' : 'runs'}`;

    const drillSpot = (p: number, index: number) =>
      startSession({ stretches: [session.stretches[p].slice(Math.max(0, index - 2), index + 1)], total: SPOT_DRILL_LENGTH, spot: true });

    const base = baseSessionRef.current;
    const all = (base ?? session).stretches.flat();
    const subtitle = oneChapter ? rangeLabel([...new Map(all.map((v) => [verseKey(v), v])).values()].sort((a, b) => a.verse - b.verse)) : `${new Set(all.map(passageKey)).size} chapters`;

    return (
      <FadeInView style={{ flex: 1 }}>
        <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
          <View style={{ gap: space(4) }}>
            <AppText variant="display" className="font-sans font-bold text-ink">
              {rounds.length} {rounds.length === 1 ? 'thread' : 'threads'}
            </AppText>
            <AppText variant="label" className="font-sans text-ink-2">
              {session.spot ? `One spot · ${rangeLabel(session.stretches[0])}` : subtitle}
            </AppText>
          </View>

          <GroupedList header="Where you slipped">
            {spotList.length === 0 ? (
              <ListRow title="Nowhere" subtitle="Every run was clean." accessory="none" />
            ) : (
              spotList.map((s) => (
                <ListRow
                  key={verseKey(s.verse)}
                  title={label(s.verse)}
                  subtitle={[s.join && `Getting into it: ${runs(s.join)}`, s.inside && `Within it: ${runs(s.inside)}`].filter(Boolean).join('\n')}
                  accessory={<AppButton size="sm" variant="secondary" label="Drill this spot" onPress={() => drillSpot(s.p, s.index)} />}
                />
              ))
            )}
          </GroupedList>

          <GroupedList header="What counted" footer="Verses that weren't due, or were already counted this session, were practice.">
            {reviewed.length + selfReviewed.length + learned.length === 0 ? (
              <ListRow title="Nothing this time" subtitle="None of these verses had a review due." accessory="none" />
            ) : (
              <>
                {reviewed.length > 0 && <ListRow title="Reviewed" subtitle={refs(reviewed)} accessory="none" />}
                {selfReviewed.length > 0 && <ListRow title="Reviewed, checked by you" subtitle={refs(selfReviewed)} accessory="none" />}
                {learned.length > 0 && <ListRow title="Toward learning" subtitle={refs(learned)} accessory="none" />}
              </>
            )}
          </GroupedList>

          <View style={{ gap: space(8) }}>
            <AppButton size="lg" variant="primary" Icon={RefreshCw} label="Go again" onPress={() => startSession(base ?? session)} />
            <AppButton variant="secondary" label="Change settings" onPress={() => setPhase('setup')} />
            <AppButton variant="quiet" label="Done" onPress={handleBack} />
          </View>
        </ScrollView>
      </FadeInView>
    );
  }

  // ==========================================================================
  // PLAYING
  // ==========================================================================
  const stretch = session.stretches[current.p] ?? [];
  const cue = current.cue;
  return (
    <FadeInView style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas p-5">
        <View className="flex-row items-center justify-between" style={{ marginBottom: space(16), gap: space(12) }}>
          <View className="flex-1">
            <AppText variant="caption" className="font-sans font-medium text-ink-3">
              {session.spot ? 'Drilling one spot · ' : ''}
              {Math.min(rounds.length + 1, session.total)} of {session.total}
            </AppText>
            <AppText variant="title" className="font-sans font-bold text-ink">
              {rangeLabel(stretch)}
            </AppText>
          </View>
          <AppIconButton
            Icon={X}
            variant="outline"
            onPress={() => (rounds.length > 0 ? setPhase('recap') : setPhase('setup'))}
            accessibilityLabel="End session"
          />
        </View>

        {cue ? (
          <ThreadRound
            key={`${rounds.length}:${current.p}:${threadCueKey(cue)}`}
            verses={stretch}
            cue={cue}
            hideVerseNumber={hideVerseNumber}
            creditPreview={(index, passed, perfect, mode) => decide(stretch, cue, index, passed, perfect, mode).label}
            onFinish={finishRound}
            onDifferentCue={differentCue}
            // A spot check only where a review could count.
            spotCheck={!reviewsPaused && stretch.some((v) => v.item.status === 'reviewing' && isReviewDue(v.item.nextReviewDueDate))}
          />
        ) : (
          <EmptyState Icon={Route} title="No cue to give" message="These verses don't have two words in a row that appear only once." />
        )}
      </View>
    </FadeInView>
  );
}
