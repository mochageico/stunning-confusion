import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Check, Compass, RefreshCw, X } from 'lucide-react-native';

import { AppState, isReviewDue } from '../state/useAppState';
import { QueueItem } from '../types';
import { FadeInView } from '../components/ui';
import { Dropdown } from '../components/Dropdown';
import { AppButton, AppIconButton, AppText, useScaledSpace } from '../components/design';
import { EmptyState, GroupedList, ListRow, ScreenHeader } from '../components/blocks';
import GradedRecitation, { ButtonPair, canSpeakVerses, RecitationMode, RoundFrame } from '../components/GradedRecitation';
import BuildUpDrill from '../components/drills/BuildUpDrill';
import ScrambleDrill from '../components/drills/ScrambleDrill';
import SpotSwapDrill from '../components/drills/SpotSwapDrill';
import JigsawDrill from '../components/drills/JigsawDrill';
import { threadSpan, threadStartVerseCounts, ThreadCue } from '../lib/drills';
import { WordOutcome } from '../lib/recitation';
import { joinWords, maskExceptFirstLetter, normalizeToken, scriptOfVerse, splitWords } from '../lib/textScript';
import { loadPracticePrefs, savePracticePrefs } from '../lib/practicePrefs';
import {
  buildPassages,
  coldCheckQueue,
  currentRung,
  GuidedActivity,
  GuidedDrillId,
  GuidedDrillVerse,
  GuidedOutcome,
  guidedCredit,
  GUIDED_PARTLY_HIDDEN,
  Ladder,
  newVersesFinishedToday,
  nextNewVerse,
  Passage,
  runsBanked,
  SessionEnv,
  SessionEvent,
  sessionReducer,
  SessionState,
  startSession,
  stitchWindow,
  toDrillVerse,
} from '../lib/guided';

// ============================================================================
// GUIDED LEARNING -- the screen
// ----------------------------------------------------------------------------
// Renders sessionReducer's state (src/lib/guided.ts) and reports what the user
// did. Every decision -- which drill, which rung, what a miss costs, whether a
// result banks a run -- lives in that module; nothing here decides them. The
// only logic in this file is plumbing: reading the live queue before each
// dispatch, turning a graded recitation into per-verse results, and calling
// creditGuided for the ones guidedCredit says count.
// ============================================================================

const DRILL_LABEL: Record<GuidedDrillId, string> = {
  buildUp: 'Build it up',
  scramble: 'Put the phrases in order',
  swap: 'Spot the swap',
  firstLetters: 'First letters',
};

const refOf = (v: { book: string; chapter: number; verse: number }) => `${v.book} ${v.chapter}:${v.verse}`;
const rangeOf = (vs: { book: string; chapter: number; verse: number }[]) =>
  vs.length === 0 ? '' : vs.length === 1 ? refOf(vs[0]) : `${vs[0].book} ${vs[0].chapter}:${vs[0].verse}–${vs[vs.length - 1].verse}`;

/** The same pass bar a review uses: 90% of words, and "perfect" means none missed. */
const verseResult = (o: WordOutcome[]) => {
  const right = o.filter((x) => x !== 'missed').length;
  const pct = o.length === 0 ? 1 : right / o.length;
  return { passed: pct >= 0.9, perfect: o.length > 0 && right === o.length };
};

interface StageResult {
  mode: RecitationMode;
  /** One per verse in the stretch, by index into the verses given to the stage. */
  perVerse: { index: number; passed: boolean; perfect: boolean }[];
}

// ----------------------------------------------------------------------------
// One graded recitation, with its own "ready" card and the two ways to answer
// ----------------------------------------------------------------------------

function CueCard({ eyebrow, words, caption, script }: { eyebrow: string; words?: string[]; caption: string; script: ReturnType<typeof scriptOfVerse> }) {
  const space = useScaledSpace();
  return (
    <View className="bg-surface border border-line rounded-card items-center" style={{ padding: space(16), gap: space(4) }}>
      <AppText variant="caption" className="font-sans font-medium text-ink-3">
        {eyebrow}
      </AppText>
      {words && words.length > 0 && (
        <AppText variant="title" script={script} className="font-serif text-ink text-center">
          “{words.join(' ')}”
        </AppText>
      )}
      <AppText variant="caption" className="font-sans text-ink-2 text-center">
        {caption}
      </AppText>
    </View>
  );
}

function GradedStage({
  verses,
  startVerse,
  startWord,
  endVerse,
  cueWords,
  eyebrow,
  caption,
  hiddenShare,
  creditLines,
  onDone,
}: {
  verses: GuidedDrillVerse[];
  startVerse: number;
  startWord: number;
  endVerse: number;
  cueWords?: string[];
  eyebrow: string;
  caption: string;
  /** Share of words hidden; the rest stay visible (partly hidden). Omit for fully hidden. */
  hiddenShare?: number;
  /** One line per verse in the stretch, shown under the graded text. */
  creditLines?: (results: StageResult) => { index: number; text: string }[];
  onDone: (result: StageResult) => void;
}) {
  const space = useScaledSpace();
  const script = scriptOfVerse(verses[endVerse]);
  const [stage, setStage] = useState<'ready' | RecitationMode>('ready');
  const [attempt, setAttempt] = useState(0);
  const [canSpeak] = useState(() => canSpeakVerses([verses[endVerse]]));
  const span = useMemo(() => threadSpan(verses, { startVerse, startWord, endVerse, cueWords: [] }), [verses, startVerse, startWord, endVerse]);

  // Which graded words stay visible, chosen once per stage so it doesn't shuffle on re-render.
  const shown = useMemo(() => {
    if (hiddenShare === undefined) return undefined;
    const idx: number[] = [];
    let n = 0;
    span.forEach((sv) =>
      sv.words.forEach((w) => {
        if (normalizeToken(w, script).length > 0) idx.push(n++);
      })
    );
    const order = [...idx].sort(() => Math.random() - 0.5);
    const hide = new Set(order.slice(0, Math.round(idx.length * hiddenShare)));
    return new Set(idx.filter((i) => !hide.has(i)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (perVerseOutcomes: WordOutcome[][], mode: RecitationMode) => {
    onDone({
      mode,
      perVerse: span.map((sv, k) => ({ index: sv.index, ...verseResult(perVerseOutcomes[k]) })),
    });
  };

  if (stage === 'ready') {
    return (
      <RoundFrame>
        <View className="flex-1 justify-center" style={{ minHeight: space(160) }}>
          <CueCard eyebrow={eyebrow} words={cueWords} caption={caption} script={script} />
        </View>
        <View style={{ gap: space(8) }}>
          {canSpeak && <AppButton size="lg" variant="primary" label="Recite" onPress={() => setStage('speak')} />}
          <AppButton
            variant={canSpeak ? 'secondary' : 'primary'}
            size={canSpeak ? 'md' : 'lg'}
            label="Type first letters"
            onPress={() => setStage('type')}
          />
        </View>
      </RoundFrame>
    );
  }

  return (
    <GradedRecitation
      key={`${stage}:${attempt}`}
      verses={verses}
      startVerse={startVerse}
      startWord={startWord}
      endVerse={endVerse}
      mode={stage}
      shownWords={shown}
      highlightWords={cueWords?.length ?? 0}
      header={<CueCard eyebrow={eyebrow} words={cueWords} caption={caption} script={script} />}
      onCancel={() => setStage('ready')}
      onResult={finish}
      gradedDetail={(perVerse) => {
        const results: StageResult = {
          mode: stage,
          perVerse: span.map((sv, k) => ({ index: sv.index, ...verseResult(perVerse[k]) })),
        };
        const lines = creditLines?.(results) ?? [];
        const anyMissed = results.perVerse.some((r) => !r.perfect);
        return (
          <View style={{ gap: space(10) }}>
            {lines.length > 0 && (
              <View className="border-t border-line" style={{ paddingTop: space(10), gap: space(6) }}>
                {lines.map((l) => (
                  <View key={l.index} className="flex-row items-start justify-between" style={{ gap: space(8) }}>
                    <AppText variant="label" className="font-sans font-semibold text-ink" style={{ minWidth: space(36) }}>
                      v{verses[l.index].verse}
                    </AppText>
                    <AppText variant="caption" className="font-sans flex-1 text-right text-ink-2">
                      {l.text}
                    </AppText>
                  </View>
                ))}
              </View>
            )}
            {stage === 'speak' && anyMissed && (
              <AppButton
                variant="secondary"
                label="Type it instead"
                onPress={() => {
                  setStage('type');
                  setAttempt((a) => a + 1);
                }}
              />
            )}
          </View>
        );
      }}
    />
  );
}

// ----------------------------------------------------------------------------
// One drill, with a Next button and a way to swap it
// ----------------------------------------------------------------------------

function DrillStage({
  drill,
  verse,
  passage,
  onNext,
  onReroll,
  canReroll,
}: {
  drill: GuidedDrillId;
  verse: GuidedDrillVerse;
  passage: GuidedDrillVerse[];
  onNext: () => void;
  onReroll: () => void;
  canReroll: boolean;
}) {
  const space = useScaledSpace();
  const [completed, setCompleted] = useState(false);
  const single = useMemo(() => [verse], [verse]);
  const done = () => setCompleted(true);

  const footer = (
    <ButtonPair
      left={canReroll ? <AppButton variant="quiet" Icon={RefreshCw} label="Different drill" onPress={onReroll} /> : <View />}
      right={<AppButton size="lg" variant={completed ? 'primary' : 'secondary'} label="Next" onPress={onNext} />}
    />
  );

  return (
    <View className="flex-1" style={{ gap: space(12) }}>
      <View className="flex-1">
        {drill === 'buildUp' && <BuildUpDrill verses={single} onComplete={done} />}
        {drill === 'scramble' && <ScrambleDrill verses={single} onComplete={done} />}
        {drill === 'swap' && <SpotSwapDrill verses={passage} onlyVerse={verse.verse} onComplete={done} />}
        {drill === 'firstLetters' && (
          <GradedRecitation
            verses={single}
            startVerse={0}
            startWord={0}
            endVerse={0}
            mode="type"
            continueLabel="Next"
            onCancel={onNext}
            onResult={onNext}
          />
        )}
      </View>
      {drill !== 'firstLetters' && footer}
    </View>
  );
}

// ----------------------------------------------------------------------------
// A verse's text, whole or reduced to its first letters
// ----------------------------------------------------------------------------

function VerseCard({ verse, firstLettersOnly }: { verse: GuidedDrillVerse; firstLettersOnly?: boolean }) {
  const space = useScaledSpace();
  const script = scriptOfVerse(verse);
  const text = firstLettersOnly ? joinWords(splitWords(verse.text, script).map((w) => maskExceptFirstLetter(w, script))) : verse.text;
  return (
    <View className="bg-surface border border-line rounded-card" style={{ padding: space(16), gap: space(6) }}>
      <AppText variant="caption" className="font-sans font-bold text-ink-3">
        {refOf(verse)}
      </AppText>
      <AppText variant="body" script={script} className="font-serif leading-relaxed text-ink">
        {text}
      </AppText>
    </View>
  );
}

// ----------------------------------------------------------------------------
// The sitting
// ----------------------------------------------------------------------------

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

function Sitting({
  state,
  passageKey,
  passages,
  onPickPassage,
}: {
  state: AppState;
  passageKey: string;
  passages: Passage[];
  onPickPassage: (key: string) => void;
}) {
  const space = useScaledSpace();
  const { navigateTo, masteryTouches, newVersesPace, learningDays, dayStartHour, reviewsPaused, memoryQueueRef } = state;

  // The passage's verse ids, fixed for this sitting. Items themselves are read
  // fresh from the live queue each time, so a run banked a moment ago shows.
  const [ids] = useState(() => (passages.find((p) => p.key === passageKey)?.items ?? []).map((i) => i.verseId));
  const idsRef = useRef(ids);
  const liveItems = (): QueueItem[] =>
    idsRef.current.map((id) => memoryQueueRef.current.find((q) => q.verseId === id)).filter((q): q is QueueItem => !!q);
  const itemOf = (id: string) => memoryQueueRef.current.find((q) => q.verseId === id);

  const makeEnv = (): SessionEnv => {
    const shift = dayStartHour * 3600000;
    const toLogical = (iso: string) => dayKey(new Date(new Date(iso).getTime() - shift));
    const learnDay = learningDays.includes(state.getTodayAbbreviation());
    return {
      items: liveItems(),
      now: Date.now(),
      masteryTouches,
      pace: learnDay ? newVersesPace : 0,
      newToday: newVersesFinishedToday(memoryQueueRef.current, dayKey(new Date(Date.now() - shift)), toLogical),
      rng: Math.random,
    };
  };

  const [s, setS] = useState<SessionState>(() => startSession(makeEnv()));
  const [notice, setNotice] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [rerolls, setRerolls] = useState(0);
  const creditedRef = useRef(new Set<string>());
  const bankedRef = useRef(0);

  const dispatch = (event: SessionEvent) => {
    setNotice(null);
    setS((prev) => sessionReducer(prev, event, makeEnv()));
  };

  // Set-aside is saved the moment the reducer sets it; a verse that later
  // finishes loses the flag.
  const persistedAside = useRef(new Set<string>());
  useEffect(() => {
    s.setAside.forEach((id) => {
      if (persistedAside.current.has(id)) return;
      persistedAside.current.add(id);
      state.setGuidedSetAside(id, true);
      const it = itemOf(id);
      setNotice(`${it ? refOf({ book: it.book, chapter: it.chapter, verse: it.verseNumber }) : 'That verse'} is set aside for now. It comes first next time.`);
    });
    s.finishedThisSitting.forEach((id) => {
      if (itemOf(id)?.guidedSetAside) state.setGuidedSetAside(id, false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.setAside, s.finishedThisSitting]);

  const ctxFor = () => ({
    now: Date.now(),
    reviewsPaused,
    isDue: (d: string | null) => isReviewDue(d),
    credited: creditedRef.current,
  });

  /** What guidedCredit says about one verse in a result, for the line under the graded text. */
  const creditLabel = (id: string, outcome: GuidedOutcome) => {
    const item = itemOf(id);
    return item ? guidedCredit(item, outcome, ctxFor()).label : '';
  };

  /**
   * Credits every verse in a result that guidedCredit says counts. The screen
   * has already moved on; the engine call runs after, so a slow write never
   * holds up the sitting. Marks verses credited up front so a quick second
   * result can't count one twice.
   */
  const bank = (entries: { id: string; outcome: GuidedOutcome }[], mode: RecitationMode) => {
    const touches: QueueItem[] = [];
    const reviews: QueueItem[] = [];
    entries.forEach(({ id, outcome }) => {
      const item = itemOf(id);
      if (!item) return;
      const { kind } = guidedCredit(item, outcome, ctxFor());
      if (!kind) return;
      creditedRef.current.add(id);
      (kind === 'touch' ? touches : reviews).push(item);
    });
    bankedRef.current += touches.length + reviews.length;
    (async () => {
      if (touches.length > 0) {
        const after = await state.creditGuided(touches, 'touch', mode);
        const msgs = after.map((it) => {
          const n = runsBanked(it);
          const label = `Verse ${it.verseNumber}`;
          if (n < masteryTouches) return `Run ${n} of ${masteryTouches} counted for ${label}.`;
          return it.status === 'reviewing'
            ? `That's ${n}. ${label} moves to daily reviews.`
            : `That's ${n}. ${label} finishes once today's reviews are done.`;
        });
        if (msgs.length > 0) {
          setNotice(msgs.join(' '));
          setNotes((prev) => [...prev, ...msgs]);
        }
      }
      if (reviews.length > 0) await state.creditGuided(reviews, 'review', mode);
    })();
  };

  // ---- small helpers over the step ---------------------------------------
  const verseOf = (id: string): GuidedDrillVerse | null => {
    const it = itemOf(id);
    return it ? toDrillVerse(it) : null;
  };
  const versesOf = (verseIds: string[]): GuidedDrillVerse[] =>
    verseIds.map(verseOf).filter((v): v is GuidedDrillVerse => !!v);
  const passageVerses = (): GuidedDrillVerse[] => liveItems().map(toDrillVerse);

  const onLeave = () => {
    if (s.step.kind === 'opening') navigateTo('home');
    else dispatch({ type: 'finish' });
  };

  const step = s.step;
  const frame = (eyebrow: string, title: string, body: React.ReactNode, showEnd = true) => (
    <FadeInView style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas p-5">
        <View className="flex-row items-center justify-between" style={{ marginBottom: space(12), gap: space(12) }}>
          <View className="flex-1">
            <AppText variant="caption" className="font-sans font-medium text-ink-3">
              {eyebrow}
            </AppText>
            <AppText variant="title" className="font-sans font-bold text-ink">
              {title}
            </AppText>
          </View>
          {showEnd && <AppIconButton Icon={X} variant="outline" onPress={onLeave} accessibilityLabel="End session" />}
        </View>
        {notice && (
          <View className="bg-accent-soft rounded-card" style={{ padding: space(10), marginBottom: space(12) }}>
            <AppText variant="label" className="font-sans text-ink">
              {notice}
            </AppText>
          </View>
        )}
        {body}
      </View>
    </FadeInView>
  );

  // ==========================================================================
  // OPENING
  // ==========================================================================
  if (step.kind === 'opening') {
    const items = liveItems();
    const env = makeEnv();
    const learning = items.filter((i) => i.status === 'learning').sort((a, b) => a.verseNumber - b.verseNumber);
    const { ready, waiting } = coldCheckQueue(items, env.now, masteryTouches);
    const waitMin = new Map(waiting.map((w) => [w.item.verseId, w.minutesLeft]));
    const readyIds = new Set(ready.map((i) => i.verseId));
    const window = stitchWindow(items);
    const next = nextNewVerse(items);
    const dueCount = reviewsPaused ? 0 : state.memoryQueue.filter((q) => q.status === 'reviewing' && isReviewDue(q.nextReviewDueDate)).length;
    const learnDay = env.pace > 0;

    const plan = [
      ready.length > 0 ? `${ready.length} ${ready.length === 1 ? 'check' : 'checks'}` : null,
      window.length >= 2 ? `stitch ${window[0].verseNumber}–${window[window.length - 1].verseNumber}` : null,
      next && learnDay ? `new: verse ${next.verseNumber}` : null,
    ].filter(Boolean);

    const tag = (i: QueueItem) => {
      if (readyIds.has(i.verseId)) return 'Check';
      const m = waitMin.get(i.verseId);
      if (m !== undefined) return `Ready in ${m} min`;
      return i.guidedSetAside ? 'Set aside' : 'New';
    };

    return (
      <FadeInView style={{ flex: 1 }}>
        <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
          <ScreenHeader
            title="Guided learning"
            subtitle="It picks the practice for each verse, one step at a time, then ties it to the verses before it."
            onBack={() => navigateTo('home')}
            backLabel="Today"
          />

          {dueCount > 0 && (
            <View className="bg-surface-2 border border-line rounded-card" style={{ padding: space(12) }}>
              <AppText variant="label" className="font-sans text-ink-2">
                You have {dueCount} {dueCount === 1 ? 'review' : 'reviews'} due. Graduating verses waits until they're done.
              </AppText>
            </View>
          )}

          <GroupedList
            header={rangeOf(items.map(toDrillVerse))}
            footer={plan.length > 0 ? `Today: ${plan.join(' → ')}` : learnDay ? 'Nothing waiting. Start with a new verse.' : 'Not a learning day. Checks and stitches only, and you can keep going for a new verse.'}
          >
            {passages.length > 1 && (
              <ListRow
                title="Passage"
                accessory={
                  <Dropdown
                    value={passageKey}
                    onChange={onPickPassage}
                    options={passages.map((p) => ({ id: p.key, label: `${p.book} ${p.chapter}:${p.items[0].verseNumber}–${p.items[p.items.length - 1].verseNumber}` }))}
                    title="Passage"
                    searchable={false}
                    compact
                  />
                }
              />
            )}
            {learning.map((i) => (
              <ListRow
                key={i.verseId}
                title={`Verse ${i.verseNumber}`}
                subtitle={`${Math.min(runsBanked(i), masteryTouches)} of ${masteryTouches} runs`}
                value={tag(i)}
                accessory="none"
              />
            ))}
          </GroupedList>

          <AppButton size="lg" variant="primary" Icon={Compass} label="Begin" onPress={() => dispatch({ type: 'begin' })} />
        </ScrollView>
      </FadeInView>
    );
  }

  // ==========================================================================
  // COLD CHECK
  // ==========================================================================
  if (step.kind === 'cold') {
    const verse = verseOf(step.verseId);
    if (!verse) {
      dispatchMissing();
      return null;
    }
    const eyebrow = `Check · ${s.coldQueue.length} left`;
    if (step.stage === 'refreshDrill' && step.drill) {
      return frame(
        eyebrow,
        `Refresh ${refOf(verse)}`,
        <DrillStage
          key={`${step.drill}:${rerolls}`}
          drill={step.drill}
          verse={verse}
          passage={passageVerses()}
          onNext={() => dispatch({ type: 'next' })}
          onReroll={() => {
            setRerolls((r) => r + 1);
            dispatch({ type: 'reroll' });
          }}
          canReroll
        />
      );
    }
    const refresh = step.stage === 'refreshRecite';
    return frame(
      eyebrow,
      refresh ? `Once more: ${refOf(verse)}` : refOf(verse),
      <GradedStage
        key={`cold:${step.verseId}:${step.stage}`}
        verses={[verse]}
        startVerse={0}
        startWord={0}
        endVerse={0}
        eyebrow={refresh ? 'Once more' : 'Check from memory'}
        caption={refresh ? 'Say it again. This one doesn’t count.' : 'Say the verse with nothing in front of you.'}
        creditLines={({ perVerse }) => [
          {
            index: 0,
            text: creditLabel(step.verseId, { activity: refresh ? 'refresh' : 'cold', passed: perVerse[0].passed, perfect: perVerse[0].perfect, mode: 'speak' }),
          },
        ]}
        onDone={({ mode, perVerse }) => {
          const r = perVerse[0];
          const activity: GuidedActivity = refresh ? 'refresh' : 'cold';
          bank([{ id: step.verseId, outcome: { activity, passed: r.passed, perfect: r.perfect, mode } }], mode);
          dispatch({ type: 'result', perfect: r.perfect });
        }}
      />
    );
  }

  // ==========================================================================
  // STITCH, SEAM, THREAD
  // ==========================================================================
  if (step.kind === 'stitch' || step.kind === 'seam' || step.kind === 'thread') {
    const verses = versesOf(step.verseIds);
    if (verses.length !== step.verseIds.length) {
      dispatchMissing();
      return null;
    }
    const kind = step.kind;
    const cue: ThreadCue = step.cue;

    if (kind === 'stitch' && step.stage === 'jigsaw') {
      return frame(
        'Stitch · warm-up',
        rangeOf(verses),
        <View className="flex-1" style={{ gap: space(12) }}>
          <View className="flex-1">
            <JigsawDrill verses={verses} />
          </View>
          <AppButton size="lg" variant="primary" label="Next" onPress={() => dispatch({ type: 'next' })} />
        </View>
      );
    }

    const eyebrow = kind === 'stitch' ? 'Stitch' : kind === 'seam' ? 'The join' : 'Pick up the thread';
    const activity: GuidedActivity = kind;
    const caption =
      kind === 'stitch'
        ? `Say ${rangeOf(verses)} from the start`
        : `from v${verses[cue.startVerse].verse} through the end of v${verses[cue.endVerse].verse}`;
    const outcomeFor = (index: number, passed: boolean, perfect: boolean, mode: RecitationMode): GuidedOutcome => ({
      activity,
      passed,
      perfect,
      mode,
      startsPastHalf: index === cue.startVerse && !threadStartVerseCounts(verses, cue),
    });

    return frame(
      eyebrow,
      rangeOf(verses.slice(cue.startVerse, cue.endVerse + 1)),
      <GradedStage
        key={`${kind}:${s.log.length}:${step.kind === 'stitch' ? step.fails : 0}`}
        verses={verses}
        startVerse={cue.startVerse}
        startWord={cue.startWord}
        endVerse={cue.endVerse}
        cueWords={cue.cueWords}
        eyebrow={kind === 'stitch' ? 'Start at the beginning' : `Start at · v${verses[cue.startVerse].verse}`}
        caption={caption}
        creditLines={({ mode, perVerse }) =>
          perVerse.map((r) => ({ index: r.index, text: creditLabel(step.verseIds[r.index], outcomeFor(r.index, r.passed, r.perfect, mode)) }))
        }
        onDone={({ mode, perVerse }) => {
          bank(
            perVerse.map((r) => ({ id: step.verseIds[r.index], outcome: outcomeFor(r.index, r.passed, r.perfect, mode) })),
            mode
          );
          const slip = perVerse.find((r) => !r.perfect);
          dispatch({ type: 'result', perfect: !slip, firstSlip: slip ? slip.index : undefined });
        }}
      />
    );
  }

  // ==========================================================================
  // LADDER
  // ==========================================================================
  if (step.kind === 'ladder') {
    const verse = verseOf(step.verseId);
    if (!verse) {
      dispatchMissing();
      return null;
    }
    const ladder: Ladder = step.ladder;
    const rung = currentRung(ladder);
    const eyebrow = `New verse · step ${ladder.pos + 1} of ${ladder.rungs.length}`;
    const title = refOf(verse);

    if (rung.kind === 'read') {
      return frame(
        eyebrow,
        title,
        <RoundFrame
          footer={
            <View style={{ gap: space(8) }}>
              <AppButton size="lg" variant="primary" label="Next" onPress={() => dispatch({ type: 'next' })} />
              <AppButton variant="quiet" label="I know this one" onPress={() => dispatch({ type: 'knowIt' })} />
            </View>
          }
        >
          <AppText variant="label" className="font-sans text-ink-2">
            Read it through, slowly, a couple of times.
          </AppText>
          <VerseCard verse={verse} />
        </RoundFrame>
      );
    }

    if (rung.kind === 'lookUp') {
      return frame(
        eyebrow,
        title,
        <RoundFrame footer={<AppButton size="lg" variant="primary" Icon={Check} label="Said it" onPress={() => dispatch({ type: 'next' })} />}>
          <AppText variant="label" className="font-sans text-ink-2">
            Look at the first letters and say the verse out loud.
          </AppText>
          <VerseCard verse={verse} firstLettersOnly />
        </RoundFrame>
      );
    }

    if (rung.kind === 'drill' && rung.drill) {
      return frame(
        eyebrow,
        `${DRILL_LABEL[rung.drill]} · ${title}`,
        <DrillStage
          key={`${ladder.pos}:${ladder.misses}:${rung.drill}:${rerolls}`}
          drill={rung.drill}
          verse={verse}
          passage={passageVerses()}
          onNext={() => dispatch({ type: 'next' })}
          onReroll={() => {
            setRerolls((r) => r + 1);
            dispatch({ type: 'reroll' });
          }}
          canReroll={ladder.eligible.length > 1}
        />
      );
    }

    // Partly or fully hidden
    const partly = rung.kind === 'partly';
    const activity: GuidedActivity = partly ? 'partly' : ladder.knowIt ? 'knowIt' : 'fully';
    return frame(
      eyebrow,
      title,
      <GradedStage
        key={`${ladder.pos}:${ladder.misses}:${ladder.activities}`}
        verses={[verse]}
        startVerse={0}
        startWord={0}
        endVerse={0}
        hiddenShare={partly ? GUIDED_PARTLY_HIDDEN : undefined}
        eyebrow={partly ? 'Some words showing' : 'From memory'}
        caption={partly ? 'Say the verse. The shown words won’t count toward a run.' : 'Say the verse with nothing in front of you.'}
        creditLines={({ perVerse }) => [
          { index: 0, text: creditLabel(step.verseId, { activity, passed: perVerse[0].passed, perfect: perVerse[0].perfect, mode: 'speak' }) },
        ]}
        onDone={({ mode, perVerse }) => {
          const r = perVerse[0];
          if (!partly) bank([{ id: step.verseId, outcome: { activity, passed: r.passed, perfect: r.perfect, mode } }], mode);
          // dispatch clears the notice, so it is set again just after.
          const message = !r.perfect ? (partly ? 'Not quite. Back to a drill.' : 'Not quite. Back two steps.') : null;
          dispatch({ type: 'result', perfect: r.perfect });
          if (message) setTimeout(() => setNotice(message), 0);
        }}
      />
    );
  }

  // ==========================================================================
  // DONE FOR TODAY
  // ==========================================================================
  if (step.kind === 'doneToday') {
    const items = liveItems();
    const exclude = new Set([...s.setAside, ...s.finishedThisSitting]);
    const next = nextNewVerse(items, exclude);
    const queued = items.filter((i) => i.status === 'queued').sort((a, b) => a.verseNumber - b.verseNumber)[0];
    return (
      <FadeInView style={{ flex: 1 }}>
        <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
          <View style={{ gap: space(4) }}>
            <AppText variant="display" className="font-sans font-bold text-ink">
              Done for today
            </AppText>
            <AppText variant="label" className="font-sans text-ink-2">
              {s.newDone > 0 ? `${s.newDone} new ${s.newDone === 1 ? 'verse' : 'verses'} learned this sitting.` : 'That’s today’s plan.'}
            </AppText>
          </View>
          {notice && (
            <View className="bg-accent-soft rounded-card" style={{ padding: space(10) }}>
              <AppText variant="label" className="font-sans text-ink">
                {notice}
              </AppText>
            </View>
          )}
          <View style={{ gap: space(8) }}>
            {next ? (
              <AppButton size="lg" variant="primary" label={`Keep going: verse ${next.verseNumber}`} onPress={() => dispatch({ type: 'keepGoing' })} />
            ) : queued ? (
              <AppButton
                size="lg"
                variant="primary"
                label={`Add verse ${queued.verseNumber} to Learning`}
                onPress={() => {
                  if (state.pullVerseIntoLearning(queued.verseId)) dispatch({ type: 'keepGoing' });
                }}
              />
            ) : null}
            <AppButton variant={next || queued ? 'secondary' : 'primary'} size={next || queued ? 'md' : 'lg'} label="Finish" onPress={() => dispatch({ type: 'finish' })} />
          </View>
        </ScrollView>
      </FadeInView>
    );
  }

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  const items = liveItems().filter((i) => i.status === 'learning' || s.finishedThisSitting.includes(i.verseId));
  const checks = s.log.filter((l) => l.step === 'cold' && l.perfect).length;
  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <View style={{ gap: space(4) }}>
          <AppText variant="display" className="font-sans font-bold text-ink">
            {s.log.length === 0 ? 'Nothing this time' : 'Good sitting'}
          </AppText>
          <AppText variant="label" className="font-sans text-ink-2">
            {[
              s.newDone > 0 ? `${s.newDone} new ${s.newDone === 1 ? 'verse' : 'verses'}` : null,
              checks > 0 ? `${checks} ${checks === 1 ? 'check' : 'checks'} passed` : null,
              bankedRef.current > 0 ? `${bankedRef.current} ${bankedRef.current === 1 ? 'run' : 'runs'} counted` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Come back when a verse is ready.'}
          </AppText>
        </View>

        {items.length > 0 && (
          <GroupedList header="Where each verse stands">
            {items.map((i) => (
              <ListRow
                key={i.verseId}
                title={`Verse ${i.verseNumber}`}
                value={
                  i.status === 'learning'
                    ? `${Math.min(runsBanked(i), masteryTouches)} of ${masteryTouches} runs`
                    : 'In reviews'
                }
                accessory="none"
              />
            ))}
          </GroupedList>
        )}

        {notes.length > 0 && (
          <GroupedList header="What counted">
            {notes.map((n, i) => (
              <ListRow key={i} title={n} accessory="none" />
            ))}
          </GroupedList>
        )}

        <AppButton size="lg" variant="primary" label="Done" onPress={() => navigateTo('home')} />
      </ScrollView>
    </FadeInView>
  );

  // A verse in the step vanished from the queue (deleted mid-sitting): end cleanly.
  function dispatchMissing() {
    setTimeout(() => dispatch({ type: 'finish' }), 0);
  }
}

// ----------------------------------------------------------------------------
// The route: picks the passage, then hands over to the sitting
// ----------------------------------------------------------------------------

export default function GuidedLearningScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const { memoryQueue, guidedPassageKey, setGuidedPassageKey, navigateTo } = state;

  // Passages that have a verse in Learning: those are what a sitting works on.
  const passages = useMemo(() => buildPassages(memoryQueue).filter((p) => p.items.some((i) => i.status === 'learning')), [memoryQueue]);

  // Pick up where you left off: the last passage opened on this device.
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  useEffect(() => {
    (async () => {
      const prefs: any = await loadPracticePrefs();
      if (typeof prefs.guidedLastPassage === 'string') setSavedKey(prefs.guidedLastPassage);
      setPrefsLoaded(true);
    })();
  }, []);

  const [chosen, setChosen] = useState<string | null>(null);
  // An explicit passage (from a button elsewhere) wins once, then is cleared.
  useEffect(() => {
    if (guidedPassageKey) {
      setChosen(guidedPassageKey);
      setGuidedPassageKey(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidedPassageKey]);

  const first = [chosen, savedKey].map((k) => passages.find((p) => p.key === k)).find(Boolean) ?? passages[0];

  // Once a sitting starts it stays on its passage, even if the last verse in
  // Learning graduates mid-sitting and the passage drops out of the list.
  const [locked, setLocked] = useState<string | null>(null);
  const lockedPassage = locked ? buildPassages(memoryQueue).find((p) => p.key === locked) : undefined;
  const resolved = chosen && passages.find((p) => p.key === chosen) ? passages.find((p) => p.key === chosen) : lockedPassage ?? first;
  useEffect(() => {
    if (prefsLoaded && first && !locked) setLocked(first.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsLoaded, first?.key]);

  // Remember it once a sitting is on it.
  const resolvedKey = resolved?.key;
  useEffect(() => {
    if (resolvedKey && prefsLoaded) savePracticePrefs({ guidedLastPassage: resolvedKey });
  }, [resolvedKey, prefsLoaded]);

  if (!prefsLoaded) return <View className="flex-1 bg-canvas" />;

  if (!resolved) {
    const queued = [...memoryQueue].filter((i) => i.status === 'queued').sort((a, b) => a.orderIndex - b.orderIndex)[0];
    return (
      <FadeInView style={{ flex: 1 }}>
        <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
          <ScreenHeader title="Guided learning" onBack={() => navigateTo('home')} backLabel="Today" />
          <EmptyState
            Icon={Compass}
            title="No verse to learn yet"
            message="Guided learning walks you through a verse that's in Learning. Start one and it will be here."
          />
          {queued && (
            <AppButton
              variant="primary"
              label={`Start ${queued.book} ${queued.chapter}:${queued.verseNumber}`}
              onPress={() => state.pullVerseIntoLearning(queued.verseId)}
            />
          )}
        </ScrollView>
      </FadeInView>
    );
  }

  return <Sitting key={resolved.key} state={state} passageKey={resolved.key} passages={passages} onPickPassage={(k) => {
    setChosen(k);
    setLocked(k);
  }} />;
}
