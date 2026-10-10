import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
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
// Credit, as the user chose it (2026-10-10):
//   - Every verse recited through can count, each scored on its own words at
//     the same 90% a review needs. The start verse counts only when the cue
//     falls in its first half.
//   - A verse only counts when a review would count anyway: due today (and
//     reviews not paused), or a verse still being learned with a perfect,
//     machine-graded run an hour after its last touch. A thread through a
//     monthly verse that isn't due is practice, or doing threads every day
//     would push it through the monthly stage in days.
//   - Misses never count against a verse. Below 90% is simply no credit.
//   - Show text + Got it counts as a review, recorded as self-reported, and
//     never as a perfect recall.
//   - Each verse counts at most once per visit to this screen.
// Credit is logged when a round ends, quietly; the round's own results and
// the recap say what counted.
// ============================================================================

const SESSION_LENGTHS = [
  { id: 5, label: '5' },
  { id: 10, label: '10' },
  { id: 20, label: '20' },
];

/** Cues in a "Drill this spot" set. */
const SPOT_DRILL_LENGTH = 3;

type Phase = 'setup' | 'playing' | 'recap';
type PoolVerse = ThreadVerse & { item: QueueItem };
type CreditKind = 'review' | 'touch';

interface RoundLog {
  cue: ThreadCue;
  result: ThreadRoundResult;
  counted: { index: number; kind: CreditKind; self: boolean }[];
}

const passageKey = (v: { translationId?: string; book: string; chapter: number }) => `${v.translationId || ''}|${v.book}|${v.chapter}`;
const verseKey = (v: { translationId?: string; book: string; chapter: number; verse: number }) => `${passageKey(v)}|${v.verse}`;

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

  // Chapters that have at least one run of two verses in a row.
  const passages = useMemo(() => {
    const byKey = new Map<string, PoolVerse[]>();
    pool.forEach((v) => byKey.set(passageKey(v), [...(byKey.get(passageKey(v)) || []), v]));
    const chapterTranslations = new Map<string, number>();
    byKey.forEach((vs) => {
      const ch = `${vs[0].book}|${vs[0].chapter}`;
      chapterTranslations.set(ch, (chapterTranslations.get(ch) || 0) + 1);
    });
    const out: { id: string; label: string; verses: PoolVerse[] }[] = [];
    byKey.forEach((vs, id) => {
      const sorted = [...vs].sort((a, b) => a.verse - b.verse);
      if (!sorted.some((v) => threadRunEndingAt(sorted, v).length >= MIN_THREAD_VERSES)) return;
      const first = sorted[0];
      const twoTranslations = (chapterTranslations.get(`${first.book}|${first.chapter}`) || 0) > 1;
      out.push({
        id,
        label: `${first.book} ${first.chapter}${twoTranslations ? ` · ${translationLabel(first.translationId || 'ESV')}` : ''}`,
        verses: sorted,
      });
    });
    return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [pool]);

  const [passageId, setPassageId] = useState('');
  const [throughVerse, setThroughVerse] = useState(0);
  const [fromVerse, setFromVerse] = useState(0);
  const [sessionLength, setSessionLength] = useState(5);
  const [hideVerseNumber, setHideVerseNumber] = useState(false);

  const passage = passages.find((p) => p.id === passageId) ?? null;
  const throughOptions = useMemo(
    () => (passage ? passage.verses.filter((v) => threadRunEndingAt(passage.verses, v).length >= MIN_THREAD_VERSES) : []),
    [passage]
  );
  const run = useMemo(() => {
    const end = passage?.verses.find((v) => v.verse === throughVerse);
    return passage && end ? threadRunEndingAt(passage.verses, end) : [];
  }, [passage, throughVerse]);
  const fromOptions = run.slice(0, -1);

  // Picks a sensible "through" verse (and "from") whenever the passage changes
  // and the current one doesn't belong to it.
  const choosePassage = (id: string, through?: number) => {
    const p = passages.find((x) => x.id === id);
    if (!p) return;
    const ends = p.verses.filter((v) => threadRunEndingAt(p.verses, v).length >= MIN_THREAD_VERSES);
    const end = ends.find((v) => v.verse === through) ?? ends[ends.length - 1];
    setPassageId(id);
    setThroughVerse(end.verse);
    setFromVerse(threadRunEndingAt(p.verses, end)[0].verse);
  };

  // Opened from a passing Recall: start on that verse. Otherwise the first
  // chapter in the list. The preset is cleared once read, so coming back
  // later from Home doesn't reopen on a stale verse.
  useEffect(() => {
    if (passageId && passages.some((p) => p.id === passageId)) return;
    const preset = threadDrillPreset;
    if (preset) setThreadDrillPreset(null);
    const presetPassage = preset && passages.find((p) => p.id === passageKey({ ...preset, translationId: preset.translationId || 'ESV' }));
    const presetOk = presetPassage && presetPassage.verses.some((v) => v.verse === preset!.verse && threadRunEndingAt(presetPassage.verses, v).length >= MIN_THREAD_VERSES);
    if (presetOk) choosePassage(presetPassage!.id, preset!.verse);
    else if (passages.length > 0) choosePassage(passages[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passages]);

  // ---- Session --------------------------------------------------------------
  const [phase, setPhase] = useState<Phase>('setup');
  // The verses this session draws from, in order, and the slice cues use.
  const [range, setRange] = useState<PoolVerse[]>([]);
  const [scope, setScope] = useState<{ from: number; end: number; total: number; spot: boolean }>({ from: 0, end: 0, total: 0, spot: false });
  const [cue, setCue] = useState<ThreadCue | null>(null);
  const [rounds, setRounds] = useState<RoundLog[]>([]);
  const usedRef = useRef(new Set<string>());
  // Verses already credited during this visit. Survives Go again and spot drills.
  const creditedRef = useRef(new Map<string, CreditKind>());

  const nextCue = (verses: PoolVerse[], from: number, end: number) => {
    const c = pickThreadCue(verses, end, { fromVerse: from, used: usedRef.current });
    if (c) usedRef.current.add(threadCueKey(c));
    setCue(c);
  };

  const startSession = (opts?: { from: number; end: number; total: number; spot: boolean }) => {
    const verses = opts ? range : run.filter((v) => v.verse >= fromVerse);
    const w = opts ?? { from: 0, end: verses.length - 1, total: sessionLength, spot: false };
    if (!opts) setRange(verses);
    setScope(w);
    setRounds([]);
    usedRef.current = new Set();
    nextCue(verses, w.from, w.end);
    setPhase('playing');
  };

  // ---- Credit -----------------------------------------------------------------
  // What a verse in this round would earn, and why. Pure: the round screen
  // shows it before anything is logged.
  const decide = (
    c: ThreadCue,
    index: number,
    passed: boolean,
    perfect: boolean,
    mode: ThreadAnswerMode
  ): { kind: CreditKind | null; label: string } => {
    const v = range[index];
    if (!v) return { kind: null, label: '' };
    if (index === c.startVerse && !threadStartVerseCounts(range, c)) return { kind: null, label: 'Started past halfway, so not counted' };
    if (!passed) return { kind: null, label: 'Under 90%, so no credit and no penalty' };
    const already = creditedRef.current.get(verseKey(v));
    if (already) return { kind: null, label: 'Already counted this session' };
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
    return { kind: null, label: 'Retained, so practice only' };
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
    if (!cue) return;
    const c = cue;
    const counted: RoundLog['counted'] = [];
    const touches: PoolVerse[] = [];
    const reviews: PoolVerse[] = [];
    result.perVerse.forEach((pv) => {
      const { kind } = decide(c, pv.index, pv.ok, pv.perfect, result.mode);
      if (!kind) return;
      const v = range[pv.index];
      creditedRef.current.set(verseKey(v), kind);
      counted.push({ index: pv.index, kind, self: result.mode === 'self' });
      (kind === 'touch' ? touches : reviews).push(v);
    });

    const log: RoundLog = { cue: c, result, counted };
    const done = rounds.length + 1 >= scope.total;
    setRounds((prev) => [...prev, log]);
    if (done) setPhase('recap');
    else nextCue(range, scope.from, scope.end);

    // Logged after the screen moves on, so a slow write never holds up the next cue.
    const drill = result.mode === 'self' ? 'reveal' : result.mode;
    if (touches.length > 0) {
      await handleUpdateVerseStatus(touches.map(toVerseState), 'memorized', drill, { perfect: true, quiet: true, via: 'thread' });
    }
    if (reviews.length > 0) {
      await handleUpdateVerseStatus(reviews.map(toVerseState), 'memorized', drill, { perfect: false, quiet: true, via: 'thread' });
    }
  };

  const differentCue = () => nextCue(range, scope.from, scope.end);

  const handleBack = () => navigateTo('home');
  const rangeLabel = (verses: { book: string; chapter: number; verse: number }[]) =>
    verses.length === 0
      ? ''
      : `${verses[0].book} ${verses[0].chapter}:${verses[0].verse}${verses.length > 1 ? `–${verses[verses.length - 1].verse}` : ''}`;

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
    if (passages.length === 0) {
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
    const selected = run.filter((v) => v.verse >= fromVerse);
    return (
      <FadeInView style={{ flex: 1 }}>
        <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
          {header}

          <GroupedList
            header="Passage"
            footer={`Recite through the end of verse ${throughVerse}. ${
              throughVerse - fromVerse === 1
                ? `Cues come from verse ${fromVerse}.`
                : throughVerse - fromVerse === 2
                  ? `Cues come from verses ${fromVerse}–${throughVerse - 1}.`
                  : `Cues come from verses ${fromVerse}–${throughVerse - 1}, mostly the two right before it.`
            }`}
          >
            <ListRow
              title="Chapter"
              accessory={
                <Dropdown
                  value={passageId}
                  onChange={(id) => choosePassage(id)}
                  options={passages.map((p) => ({ id: p.id, label: p.label }))}
                  title="Chapter"
                  searchable={passages.length > 8}
                  compact
                />
              }
            />
            <ListRow
              title="Through verse"
              accessory={
                <Dropdown
                  value={throughVerse}
                  onChange={(n) => passage && choosePassage(passage.id, n)}
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
          </GroupedList>

          <GroupedList header="Session">
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
            label={`Start ${rangeLabel(selected)}`}
            onPress={() => startSession()}
            disabled={selected.length < MIN_THREAD_VERSES}
          />
        </ScrollView>
      </FadeInView>
    );
  }

  // ==========================================================================
  // RECAP
  // ==========================================================================
  if (phase === 'recap') {
    const label = (index: number) => `v${range[index]?.verse}`;

    const counted = rounds.flatMap((r) => r.counted);
    const reviewed = counted.filter((c) => c.kind === 'review' && !c.self).map((c) => label(c.index));
    const selfReviewed = counted.filter((c) => c.kind === 'review' && c.self).map((c) => label(c.index));
    const learned = counted.filter((c) => c.kind === 'touch').map((c) => label(c.index));

    // Slips per verse, each counted against the runs that passed through that
    // spot. One row per verse: getting into it and stumbling within it both
    // drill the same way, so they share a button.
    const spots = new Map<number, { verse: number; join?: { slipped: number; through: number }; inside?: { slipped: number; through: number } }>();
    rounds.forEach((r) =>
      r.result.slips.forEach((s) => {
        const through = rounds.filter((x) =>
          s.kind === 'join' ? x.cue.startVerse < s.verse && s.verse <= x.cue.endVerse : x.cue.startVerse <= s.verse && s.verse <= x.cue.endVerse
        ).length;
        const spot = spots.get(s.verse) ?? { verse: s.verse };
        spot[s.kind] = { slipped: (spot[s.kind]?.slipped || 0) + 1, through };
        spots.set(s.verse, spot);
      })
    );
    const rate = (x?: { slipped: number; through: number }) => (x ? x.slipped / x.through : 0);
    const spotList = [...spots.values()].sort(
      (a, b) => Math.max(rate(b.join), rate(b.inside)) - Math.max(rate(a.join), rate(a.inside)) || a.verse - b.verse
    );
    const runs = (x: { slipped: number; through: number }) => `${x.slipped} of ${x.through} ${x.through === 1 ? 'run' : 'runs'}`;

    const drillSpot = (verse: number) =>
      startSession({ from: Math.max(0, verse - 2), end: verse, total: SPOT_DRILL_LENGTH, spot: true });

    return (
      <FadeInView style={{ flex: 1 }}>
        <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
          <View style={{ gap: space(4) }}>
            <AppText variant="display" className="font-sans font-bold text-ink">
              {rounds.length} {rounds.length === 1 ? 'thread' : 'threads'}
            </AppText>
            <AppText variant="label" className="font-sans text-ink-2">
              {rangeLabel(range.slice(scope.from, scope.end + 1))}
            </AppText>
          </View>

          <GroupedList header="Where you slipped">
            {spotList.length === 0 ? (
              <ListRow title="Nowhere" subtitle="Every run was clean." accessory="none" />
            ) : (
              spotList.map((s) => (
                <ListRow
                  key={s.verse}
                  title={label(s.verse)}
                  subtitle={[s.join && `Getting into it: ${runs(s.join)}`, s.inside && `Within it: ${runs(s.inside)}`].filter(Boolean).join('\n')}
                  accessory={<AppButton size="sm" variant="secondary" label="Drill this spot" onPress={() => drillSpot(s.verse)} />}
                />
              ))
            )}
          </GroupedList>

          <GroupedList header="What counted" footer="Verses that weren't due, or were already counted this session, were practice.">
            {reviewed.length + selfReviewed.length + learned.length === 0 ? (
              <ListRow title="Nothing this time" subtitle="None of these verses had a review due." accessory="none" />
            ) : (
              <>
                {reviewed.length > 0 && <ListRow title="Reviewed" value={reviewed.join(', ')} accessory="none" />}
                {selfReviewed.length > 0 && <ListRow title="Reviewed, checked by you" value={selfReviewed.join(', ')} accessory="none" />}
                {learned.length > 0 && <ListRow title="Toward learning" value={learned.join(', ')} accessory="none" />}
              </>
            )}
          </GroupedList>

          <View style={{ gap: space(8) }}>
            <AppButton
              size="lg"
              variant="primary"
              Icon={RefreshCw}
              label="Go again"
              onPress={() => startSession({ from: 0, end: range.length - 1, total: sessionLength, spot: false })}
            />
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
  return (
    <FadeInView style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas p-5">
        <View className="flex-row items-center justify-between" style={{ marginBottom: space(16), gap: space(12) }}>
          <View className="flex-1">
            <AppText variant="caption" className="font-sans font-medium text-ink-3">
              {scope.spot ? 'Drilling one spot · ' : ''}
              {Math.min(rounds.length + 1, scope.total)} of {scope.total}
            </AppText>
            <AppText variant="title" className="font-sans font-bold text-ink">
              {rangeLabel(range.slice(scope.from, scope.end + 1))}
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
            key={`${rounds.length}:${threadCueKey(cue)}`}
            verses={range}
            cue={cue}
            hideVerseNumber={hideVerseNumber}
            creditPreview={(index, passed, perfect, mode) => decide(cue, index, passed, perfect, mode).label}
            onFinish={finishRound}
            onDifferentCue={differentCue}
          />
        ) : (
          <EmptyState Icon={Route} title="No cue to give" message="These verses don't have two words in a row that appear only once." />
        )}
      </View>
    </FadeInView>
  );
}
