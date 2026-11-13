import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Check, Compass, RefreshCw, SlidersHorizontal, X } from 'lucide-react-native';

import { isReviewDue } from '../state/useAppState';
import { QueueItem } from '../types';
import { FadeInView, useKeyboardLift } from '../components/ui';
import { AppButton, AppIconButton, AppText, RadioMark, useScaledSpace } from '../components/design';
import { OptionsPopup, SessionDone } from '../components/session';
import { EmptyState, GroupedList, ListRow, ScreenHeader } from '../components/blocks';
import GradedRecitation, { ButtonPair, RecitationMode, RoundFrame } from '../components/GradedRecitation';
import PeekDrill from '../components/drills/PeekDrill';
import PickPhraseDrill from '../components/drills/PickPhraseDrill';
import ScrambleDrill from '../components/drills/ScrambleDrill';
import SpotGapDrill from '../components/drills/SpotGapDrill';
import { formatLabel } from '../lib/formatNames';
import JigsawDrill from '../components/drills/JigsawDrill';
import VersePlayButton from '../components/VersePlayButton';
import { chunkIntoPhrases, threadSlips, ThreadSlip, threadSpan, threadStartVerseCounts, ThreadCue } from '../lib/drills';
import { reviewPassAccuracy, WordOutcome } from '../lib/recitation';
import { blankExceptFirstLetter, normalizeToken, scriptOfVerse, splitWords } from '../lib/textScript';
import { loadPracticePrefs, savePracticePrefs } from '../lib/practicePrefs';
import { getLogicalDate, localDayKey } from '../lib/logicalDate';
import { gradedOnDay } from '../lib/retention';
import {
  buildPassages,
  coldCheckQueue,
  currentRung,
  GuidedActivity,
  GuidedDrillId,
  GuidedDrillVerse,
  GuidedOutcome,
  guidedCredit,
  GUIDED_MAX_ANCHORS,
  GUIDED_PARTLY_HIDDEN,
  GUIDED_RELEARN_BELOW,
  pickShownWords,
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
  toDrillVerse,
} from '../lib/guided';
import { useAppFields } from '../state/appStore';

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
  peek: 'Peek',
  scramble: 'Put the phrases in order',
  gap: formatLabel('findWrongWord'),
  listen: 'Listen and fill the gap',
  backwards: 'Work backwards',
};

const refOf = (v: { book: string; chapter: number; verse: number }) => `${v.book} ${v.chapter}:${v.verse}`;
const rangeOf = (vs: { book: string; chapter: number; verse: number }[]) =>
  vs.length === 0 ? '' : vs.length === 1 ? refOf(vs[0]) : `${vs[0].book} ${vs[0].chapter}:${vs[0].verse}–${vs[vs.length - 1].verse}`;

/** The same pass bar a review uses (90% of words unless changed in Settings), and "perfect" means none missed. */
const verseResult = (o: WordOutcome[]) => {
  const right = o.filter((x) => x !== 'missed').length;
  const pct = o.length === 0 ? 1 : right / o.length;
  return { passed: pct >= reviewPassAccuracy(), perfect: o.length > 0 && right === o.length, accuracy: pct };
};

interface StageResult {
  mode: RecitationMode;
  /** One per verse in the stretch, by index into the verses given to the stage. */
  perVerse: { index: number; passed: boolean; perfect: boolean; accuracy: number }[];
  /** Where it went wrong, joins included (threadSlips); indices as in perVerse. */
  slips: ThreadSlip[];
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
  anchors,
  phrasal,
  creditLines,
  easierLabel,
  onEasier,
  moreLabel,
  onMore,
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
  /** Words (indexes into the verse) hidden first, and highlighted after the result. */
  anchors?: ReadonlySet<number>;
  /** Hide whole phrases, not scattered words. */
  phrasal?: boolean;
  /** One line per verse in the stretch, shown under the graded text. */
  creditLines?: (results: StageResult) => { index: number; text: string }[];
  /** A step down offered before reciting (no miss counted). */
  easierLabel?: string;
  onEasier?: () => void;
  /** A second, stronger step back offered before reciting (a cold check: teach me again). */
  moreLabel?: string;
  onMore?: () => void;
  onDone: (result: StageResult) => void;
}) {
  const space = useScaledSpace();
  const script = scriptOfVerse(verses[endVerse]);
  // One screen: typing with a mic beside the input, like a normal review.
  const [stage, setStage] = useState<RecitationMode>('type');
  const [attempt, setAttempt] = useState(0);
  const span = useMemo(() => threadSpan(verses, { startVerse, startWord, endVerse, cueWords: [] }), [verses, startVerse, startWord, endVerse]);

  // Which graded words stay visible, chosen once per stage so it doesn't shuffle on re-render.
  // The anchors as graded-word positions (a punctuation-only token isn't graded).
  const { anchoredGraded, gradedTotal } = useMemo(() => {
    let n = 0;
    const anchored = new Set<number>();
    span.forEach((sv) =>
      sv.words.forEach((w, wi) => {
        if (normalizeToken(w, script).length === 0) return;
        if (span.length === 1 && anchors?.has(wi)) anchored.add(n);
        n++;
      })
    );
    return { anchoredGraded: anchored, gradedTotal: n };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    if (hiddenShare === undefined) return undefined;
    const phraseSizes = phrasal ? chunkIntoPhrases(verses[endVerse].text, script).map((p) => splitWords(p, script).length) : undefined;
    return pickShownWords(gradedTotal, hiddenShare, { anchors: anchoredGraded, phraseSizes }, Math.random);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (perVerseOutcomes: WordOutcome[][], mode: RecitationMode) => {
    onDone({
      mode,
      perVerse: span.map((sv, k) => ({ index: sv.index, ...verseResult(perVerseOutcomes[k]) })),
      slips: threadSlips(span, perVerseOutcomes.map((o) => (o || []).map((x) => x === 'missed'))),
    });
  };

  return (
    <GradedRecitation
      key={`${stage}:${attempt}`}
      verses={verses}
      startVerse={startVerse}
      startWord={startWord}
      endVerse={endVerse}
      mode={stage}
      shownWords={shown}
      showHeard
      highlightWords={cueWords?.length ?? 0}
      header={<CueCard eyebrow={eyebrow} words={cueWords} caption={caption} script={script} />}
      anchorWords={anchoredGraded.size > 0 ? anchoredGraded : undefined}
      footerExtra={
        (onEasier && easierLabel) || (onMore && moreLabel) ? (
          <View style={{ gap: space(4) }}>
            {onEasier && easierLabel && <AppButton variant="quiet" label={easierLabel} onPress={onEasier} />}
            {onMore && moreLabel && <AppButton variant="quiet" label={moreLabel} onPress={onMore} />}
          </View>
        ) : undefined
      }
      onCancel={() => {
        // Listening heard nothing or was cancelled: back to typing.
        setStage('type');
        setAttempt((a) => a + 1);
      }}
      onSwitchMode={(to) => {
        setStage(to);
        setAttempt((a) => a + 1);
      }}
      onResult={finish}
      gradedDetail={(perVerse) => {
        const results: StageResult = {
          mode: stage,
          perVerse: span.map((sv, k) => ({ index: sv.index, ...verseResult(perVerse[k]) })),
          slips: [],
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
  audio,
}: {
  drill: GuidedDrillId;
  verse: GuidedDrillVerse;
  passage: GuidedDrillVerse[];
  onNext: () => void;
  onReroll: () => void;
  canReroll: boolean;
  /** The verse's play button, shown above Listen and fill the gap. */
  audio?: React.ReactNode;
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
        {drill === 'peek' && <PeekDrill verse={verse} onComplete={done} />}
        {drill === 'scramble' && <ScrambleDrill verses={single} onComplete={done} />}
        {drill === 'gap' && (
          <SpotGapDrill verses={single} hideNumbers={false} shuffle={false} resultNote="A warm-up, so nothing is logged." onScored={done} />
        )}
        {drill === 'listen' && (
          <View className="flex-1" style={{ gap: space(10) }}>
            {audio}
            <PickPhraseDrill mode="listen" verse={verse} passage={passage} onComplete={done} />
          </View>
        )}
        {drill === 'backwards' && <PickPhraseDrill mode="backwards" verse={verse} passage={passage} onComplete={done} />}
      </View>
      {footer}
    </View>
  );
}

// ----------------------------------------------------------------------------
// A verse's text, whole or reduced to its first letters
// ----------------------------------------------------------------------------

/**
 * The verse as text, whole or reduced to its first letters. `anchors` (word
 * indexes) show bold while reading, and spelled out in full among the first
 * letters. With `onToggleWord` the words become tappable chips to pick them.
 * Anchors are for Latin-script verses only.
 */
function VerseCard({
  verse,
  firstLettersOnly,
  anchors,
  onToggleWord,
}: {
  verse: GuidedDrillVerse;
  firstLettersOnly?: boolean;
  anchors?: readonly number[];
  onToggleWord?: (wordIndex: number) => void;
}) {
  const space = useScaledSpace();
  const script = scriptOfVerse(verse);
  const anchorSet = new Set(script === 'latin' ? anchors ?? [] : []);
  const words = splitWords(verse.text, script);
  const picking = !!onToggleWord && script === 'latin';

  let body: React.ReactNode;
  if (picking) {
    body = (
      <View className="flex-row flex-wrap" style={{ columnGap: space(6), rowGap: space(6) }}>
        {words.map((w, i) => {
          const on = anchorSet.has(i);
          return (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={`${w}, ${on ? 'an anchor' : 'not an anchor'}`}
              accessibilityState={{ selected: on }}
              onPress={() => onToggleWord(i)}
              className={`rounded-lg ${on ? 'bg-accent' : 'bg-surface-2'}`}
              style={{ paddingHorizontal: space(8), paddingVertical: space(4) }}
            >
              <AppText variant="body" script={script} className={`font-serif ${on ? 'text-on-accent' : 'text-ink'}`}>
                {w}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    );
  } else if (firstLettersOnly) {
    // The letters stay dark; the lines after them are quieter, as in Recall.
    body = (
      <AppText variant="body" script={script} className="font-serif leading-relaxed text-ink">
        {words.map((w, i) => {
          const gap = i < words.length - 1 ? ' ' : '';
          if (anchorSet.has(i)) {
            return (
              <AppText variant="inherit" key={i} className="font-bold text-accent">
                {w + gap}
              </AppText>
            );
          }
          const blanked = blankExceptFirstLetter(w, script);
          const cut = blanked.search(/_/);
          return cut < 0 ? (
            <AppText variant="inherit" key={i}>
              {blanked + gap}
            </AppText>
          ) : (
            <AppText variant="inherit" key={i}>
              {blanked.slice(0, cut)}
              <AppText variant="inherit" className="text-ink-3">
                {blanked.slice(cut) + gap}
              </AppText>
            </AppText>
          );
        })}
      </AppText>
    );
  } else {
    body = (
      <AppText variant="body" script={script} className="font-serif leading-relaxed text-ink">
        {anchorSet.size === 0
          ? verse.text
          : words.map((w, i) => (
              <AppText variant="inherit" key={i} className={anchorSet.has(i) ? 'font-bold text-accent' : undefined}>
                {w + (i < words.length - 1 ? ' ' : '')}
              </AppText>
            ))}
      </AppText>
    );
  }

  return (
    <View className="bg-surface border border-line rounded-card" style={{ padding: space(16), gap: space(6) }}>
      <AppText variant="caption" className="font-sans font-bold text-ink-3">
        {refOf(verse)}
      </AppText>
      {body}
    </View>
  );
}

// ----------------------------------------------------------------------------
// Look up and say it -- or type it, with the first letters as hints. Ungraded.
// ----------------------------------------------------------------------------

function LookUpStage({ verse, anchors, onNext }: { verse: GuidedDrillVerse; anchors?: readonly number[]; onNext: () => void }) {
  const space = useScaledSpace();
  const [mode, setMode] = useState<'say' | 'type'>('say');
  const single = useMemo(() => [verse], [verse]);
  if (mode === 'type') {
    return (
      <GradedRecitation
        verses={single}
        startVerse={0}
        startWord={0}
        endVerse={0}
        mode="type"
        hintFirstLetters
        continueLabel="Next"
        header={
          <AppText variant="label" className="font-sans text-ink-2">
            Type the first letter of each word. The hints stay up.
          </AppText>
        }
        onCancel={() => setMode('say')}
        onSwitchMode={() => setMode('say')}
        onResult={onNext}
      />
    );
  }
  return (
    <RoundFrame
      footer={
        <View style={{ gap: space(8) }}>
          <AppButton size="lg" variant="primary" Icon={Check} label="Said it" onPress={onNext} />
          <AppButton variant="quiet" label="Type it instead" onPress={() => setMode('type')} />
        </View>
      }
    >
      <AppText variant="label" className="font-sans text-ink-2">
        Look at the first letters and say the verse out loud.
      </AppText>
      <VerseCard verse={verse} firstLettersOnly anchors={anchors} />
    </RoundFrame>
  );
}

// ----------------------------------------------------------------------------
// Progress marks: run dots for a verse, and the ladder drawn as rungs
// ----------------------------------------------------------------------------

function RunDots({ done, needed }: { done: number; needed: number }) {
  const space = useScaledSpace();
  const dot = Math.max(8, Math.round(space(8)));
  return (
    <View className="flex-row" style={{ gap: space(4) }} accessible accessibilityLabel={`${Math.min(done, needed)} of ${needed} runs`}>
      {Array.from({ length: needed }).map((_, i) => (
        <View
          key={i}
          className={`rounded-full ${i < done ? 'bg-accent' : 'bg-fill'}`}
          // layout-ok: a dot holds no text.
          style={{ width: dot, height: dot }}
        />
      ))}
    </View>
  );
}

const RUNG_LABEL: Record<string, string> = {
  read: 'Read',
  lookUp: 'Look up',
  drill: 'Pick and place',
  blanks: 'Fill the blanks',
  partly: 'Some words',
  fully: 'From memory',
};

/** One segment per rung: done, here, still to come. A drop back shows as segments emptying. */
function RungBar({ ladder }: { ladder: Ladder }) {
  const space = useScaledSpace();
  return (
    <View style={{ gap: space(6), marginBottom: space(12) }} accessible accessibilityLabel={`Step ${ladder.pos + 1} of ${ladder.rungs.length}`}>
      <View className="flex-row" style={{ gap: space(4) }}>
        {ladder.rungs.map((r, i) => (
          <View
            key={i}
            className={`flex-1 rounded-full ${i < ladder.pos ? 'bg-accent' : i === ladder.pos ? 'bg-accent-soft border border-accent' : 'bg-fill'}`}
            // layout-ok: a segment holds no text.
            style={{ height: Math.max(6, Math.round(space(6))) }}
          />
        ))}
      </View>
      <AppText variant="caption" className="font-sans font-medium text-ink-3">
        {RUNG_LABEL[ladder.rungs[ladder.pos].kind]}
      </AppText>
    </View>
  );
}

// ----------------------------------------------------------------------------
// The sitting
// ----------------------------------------------------------------------------

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

function Sitting({
  passageKey,
  passages,
  onPickPassage,
  jigsawWarmUp,
}: {
  passageKey: string;
  passages: Passage[];
  onPickPassage: (key: string) => void;
  /** The saved warm-up setting; the warm-up step can turn it off mid-sitting. */
  jigsawWarmUp: boolean;
}) {
  const state = useAppFields(
    'audioCache', 'creditGuided', 'dayStartHour', 'getTodayAbbreviation', 'learningDays',
    'masteryTouches', 'memoryQueue', 'memoryQueueRef', 'navigateTo', 'newVersesPace',
    'openMixedReview', 'pullVerseIntoLearning', 'reviewsPaused', 'selectedChapterAudios',
    'setGuidedAnchors', 'setGuidedSetAside', 'setPlayingRecordingId', 'studioPlaybackEnabled',
    'userRecordings',
  );
  const space = useScaledSpace();
  const lift = useKeyboardLift();
  const { navigateTo, masteryTouches, newVersesPace, learningDays, dayStartHour, reviewsPaused, memoryQueueRef } = state;

  // The passage's verse ids, fixed for this sitting. Items themselves are read
  // fresh from the live queue each time, so a run banked a moment ago shows.
  const [ids] = useState(() => (passages.find((p) => p.key === passageKey)?.items ?? []).map((i) => i.verseId));
  const idsRef = useRef(ids);
  const liveItems = (): QueueItem[] =>
    idsRef.current.map((id) => memoryQueueRef.current.find((q) => q.verseId === id)).filter((q): q is QueueItem => !!q);
  const itemOf = (id: string) => memoryQueueRef.current.find((q) => q.verseId === id);

  const jigsawRef = useRef(jigsawWarmUp);
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
      jigsawWarmUp: jigsawRef.current,
      rng: Math.random,
    };
  };

  // Straight into the first step (UI simplify plan, Job 4): the old opening
  // page's choices live in the gear now.
  const [s, setS] = useState<SessionState>(() => {
    const env = makeEnv();
    return sessionReducer(startSession(env), { type: 'begin' }, env);
  });
  const [gearOpen, setGearOpen] = useState(false);
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
    // A review is graded clean, stumble or blank on its words.
    const accuracy = new Map<string, number>();
    entries.forEach(({ id, outcome }) => {
      const item = itemOf(id);
      if (!item) return;
      const { kind } = guidedCredit(item, outcome, ctxFor());
      if (!kind) return;
      creditedRef.current.add(id);
      (kind === 'touch' ? touches : reviews).push(item);
      if (outcome.accuracy !== undefined) accuracy.set(id, outcome.accuracy);
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
      if (reviews.length > 0) await state.creditGuided(reviews, 'review', mode, accuracy);
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

  /** The new verse a jump would start, if any is left. */
  const newAvailable = () => nextNewVerse(liveItems(), new Set([...s.setAside, ...s.finishedThisSitting]));

  /**
   * Above a check or stitch: move past it (no credit, no penalty),
   * or go straight to the new verse.
   */
  const skipBar = (skipLabel: string) => {
    const next = newAvailable();
    return (
      <View style={{ marginBottom: space(12) }}>
        <ButtonPair
          left={<AppButton size="sm" variant="quiet" label={skipLabel} onPress={() => dispatch({ type: 'skip' })} />}
          right={
            next ? (
              <AppButton size="sm" variant="quiet" label={`Go to verse ${next.verseNumber}`} onPress={() => dispatch({ type: 'startNew' })} />
            ) : (
              <View />
            )
          }
        />
      </View>
    );
  };

  const onLeave = () => {
    if (s.step.kind === 'opening') navigateTo('home');
    else dispatch({ type: 'finish' });
  };

  // The gear: which passage, and starting any verse right now. These were the
  // old opening page.
  const gear = (() => {
    if (!gearOpen) return <OptionsPopup visible={false} onClose={() => setGearOpen(false)} title="Guided learning">{null}</OptionsPopup>;
    const items = liveItems();
    const env = makeEnv();
    const learning = items.filter((i) => i.status === 'learning').sort((a, b) => a.verseNumber - b.verseNumber);
    const { waiting } = coldCheckQueue(items, env.now, masteryTouches);
    const waitMin = new Map(waiting.map((w) => [w.item.verseId, w.minutesLeft]));
    const canJump = s.step.kind !== 'ladder' && s.step.kind !== 'summary';
    const close = () => setGearOpen(false);
    return (
      <OptionsPopup visible onClose={close} title="Guided learning">
        <View style={{ gap: space(12) }}>
          {passages.length > 1 ? (
            <GroupedList header="Passage">
              {passages.map((p) => (
                <ListRow
                  key={p.key}
                  title={`${p.book} ${p.chapter}:${p.items[0].verseNumber}–${p.items[p.items.length - 1].verseNumber}`}
                  accessory={<RadioMark selected={p.key === passageKey} />}
                  onPress={() => {
                    close();
                    if (p.key !== passageKey) onPickPassage(p.key);
                  }}
                />
              ))}
            </GroupedList>
          ) : null}
          {learning.length > 0 ? (
            <GroupedList header={canJump ? 'Start a verse now' : 'Verses'}>
              {learning.map((i) => {
                const startable = canJump && runsBanked(i) === 0;
                const m = waitMin.get(i.verseId);
                return (
                  <ListRow
                    key={i.verseId}
                    title={`Verse ${i.verseNumber}`}
                    subtitle={m !== undefined ? `Ready in ${m} min` : i.guidedSetAside ? 'Set aside' : undefined}
                    accessory={<RunDots done={runsBanked(i)} needed={masteryTouches} />}
                    onPress={
                      startable
                        ? () => {
                            close();
                            dispatch({ type: 'startNew', verseId: i.verseId });
                          }
                        : undefined
                    }
                  />
                );
              })}
            </GroupedList>
          ) : null}
        </View>
      </OptionsPopup>
    );
  })();

  const step = s.step;
  const frame = (eyebrow: string, title: string, body: React.ReactNode, top?: React.ReactNode, showEnd = true) => (
    <FadeInView style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas p-5" style={lift > 0 ? { paddingBottom: lift + space(8) } : undefined}>
        {/* Same row as the practice window: close, the step, gear. */}
        <View className="flex-row items-center" style={{ marginBottom: space(12), gap: space(12) }}>
          {showEnd ? <AppIconButton Icon={X} variant="outline" diameter={40} onPress={onLeave} accessibilityLabel="End session" /> : null}
          <View className="flex-1">
            <AppText variant="caption" className="font-sans font-medium text-ink-3">
              {eyebrow}
            </AppText>
            <AppText variant="title" className="font-sans font-bold text-ink">
              {title}
            </AppText>
          </View>
          <AppIconButton Icon={SlidersHorizontal} variant="outline" diameter={40} onPress={() => setGearOpen(true)} accessibilityLabel="Guided learning settings" />
        </View>
        {/* Closeable, and out of the way while the keyboard is up. */}
        {notice && lift === 0 && (
          <View className="bg-accent-soft rounded-card flex-row items-start" style={{ padding: space(10), marginBottom: space(12), gap: space(8) }}>
            <AppText variant="label" className="font-sans text-ink flex-1">
              {notice}
            </AppText>
            <AppIconButton Icon={X} variant="bare" diameter={28} onPress={() => setNotice(null)} accessibilityLabel="Dismiss" />
          </View>
        )}
        {top}
        {body}
      </View>
      {gear}
    </FadeInView>
  );

  // ==========================================================================
  // OPENING
  // ==========================================================================
  // Only for a moment: the sitting begins on its first step (see useState above).
  if (step.kind === 'opening') {
    setTimeout(() => dispatch({ type: 'begin' }), 0);
    return null;
  }

  // ==========================================================================
  // COLD CHECK
  // ==========================================================================
  const audioFor = (v: GuidedDrillVerse) => (
    <VersePlayButton
      key={`${v.book}${v.chapter}:${v.verse}`}
      book={v.book}
      chapter={v.chapter}
      verse={v.verse}
      translationId={v.translationId ?? ''}
      userRecordings={state.userRecordings}
      selectedChapterAudios={state.selectedChapterAudios}
      studioPlaybackEnabled={state.studioPlaybackEnabled}
      audioCacheMap={state.audioCache.map}
      onStart={() => state.setPlayingRecordingId(null)}
    />
  );

  if (step.kind === 'cold') {
    const verses = versesOf(step.verseIds);
    const refreshId = step.refreshIds[0];
    const verse = step.stage === 'recite' ? verses[0] : refreshId ? verseOf(refreshId) : null;
    if (verses.length !== step.verseIds.length || !verse) {
      dispatchMissing();
      return null;
    }
    const eyebrow = `Check · ${s.coldQueue.length} left`;
    if (step.stage === 'recite') {
      const many = verses.length > 1;
      return frame(
        eyebrow,
        rangeOf(verses),
        <GradedStage
          key={`cold:${step.verseIds.join()}`}
          verses={verses}
          startVerse={0}
          startWord={0}
          endVerse={verses.length - 1}
          easierLabel="Not ready? Refresh it first"
          onEasier={() => dispatch({ type: 'easier' })}
          moreLabel={many ? 'Teach me the first verse again' : 'Teach me again'}
          onMore={() => dispatch({ type: 'relearn' })}
          eyebrow="Check from memory"
          caption={many ? 'Say these verses with nothing in front of you.' : 'Say the verse with nothing in front of you.'}
          creditLines={({ mode, perVerse }) =>
            perVerse.map((r) => ({
              index: r.index,
              text: creditLabel(step.verseIds[r.index], { activity: 'cold', passed: r.passed, perfect: r.perfect, mode }),
            }))
          }
          onDone={({ mode, perVerse }) => {
            bank(
              perVerse.map((r) => ({
                id: step.verseIds[r.index],
                outcome: { activity: 'cold' as const, passed: r.passed, perfect: r.perfect, accuracy: r.accuracy, mode },
              })),
              mode
            );
            const missed = perVerse.filter((r) => !r.perfect).map((r) => r.index);
            const bad = perVerse.filter((r) => r.accuracy < GUIDED_RELEARN_BELOW).map((r) => r.index);
            dispatch({ type: 'result', perfect: missed.length === 0, slips: missed, bad });
            if (bad.length > 0) setTimeout(() => setNotice('That one slipped a lot. Let’s learn it again.'), 0);
          }}
        />,
        skipBar(many ? 'Skip these checks' : 'Skip this check')
      );
    }
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
          audio={step.drill === 'listen' ? audioFor(verse) : undefined}
        />,
        skipBar('Skip this check')
      );
    }
    // Refresh recitation: the one verse, again. It never counts.
    return frame(
      eyebrow,
      `Once more: ${refOf(verse)}`,
      <GradedStage
        key={`cold:${refreshId}:refresh`}
        verses={[verse]}
        startVerse={0}
        startWord={0}
        endVerse={0}
        eyebrow="Once more"
        caption="Say it again. This one doesn’t count."
        creditLines={({ perVerse }) => [
          { index: 0, text: creditLabel(refreshId, { activity: 'refresh', passed: perVerse[0].passed, perfect: perVerse[0].perfect, mode: 'speak' }) },
        ]}
        onDone={({ perVerse }) => dispatch({ type: 'result', perfect: perVerse[0].perfect })}
      />,
      skipBar('Skip this check')
    );
  }

  // ==========================================================================
  // STITCH, SEAM
  // ==========================================================================
  if (step.kind === 'stitch' || step.kind === 'seam') {
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
          <AppButton
            variant="quiet"
            label="Turn off warm-ups"
            onPress={() => {
              jigsawRef.current = false;
              savePracticePrefs({ guidedJigsaw: false });
              dispatch({ type: 'next' });
              setTimeout(() => setNotice('Warm-ups are off. Turn them back on in Settings, under Practice.'), 0);
            }}
          />
        </View>,
        skipBar('Skip the stitch')
      );
    }

    const eyebrow =
      step.kind === 'stitch' ? 'Stitch' : formatLabel('keepGoing');
    const activity: GuidedActivity = kind;
    const caption =
      kind === 'stitch'
        ? `Say ${rangeOf(verses)} from the start`
        : `from v${verses[cue.startVerse].verse} through the end of v${verses[cue.endVerse].verse}`;
    const outcomeFor = (index: number, passed: boolean, perfect: boolean, mode: RecitationMode, accuracy?: number): GuidedOutcome => ({
      activity,
      passed,
      perfect,
      ...(accuracy !== undefined ? { accuracy } : {}),
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
            perVerse.map((r) => ({ id: step.verseIds[r.index], outcome: outcomeFor(r.index, r.passed, r.perfect, mode, r.accuracy) })),
            mode
          );
          const slip = perVerse.find((r) => !r.perfect);
          dispatch({ type: 'result', perfect: !slip, firstSlip: slip ? slip.index : undefined });
        }}
      />,
      skipBar('Skip the stitch')
    );
  }

  // ==========================================================================
  // LAST LOOK
  // ==========================================================================
  if (step.kind === 'lastLook') {
    const verseIds = step.groups[step.index];
    const verses = versesOf(verseIds);
    if (verses.length !== verseIds.length || verses.length === 0) {
      dispatchMissing();
      return null;
    }
    return frame(
      step.groups.length > 1 ? `One last look · ${step.index + 1} of ${step.groups.length}` : 'One last look',
      rangeOf(verses),
      <GradedStage
        key={`lastLook:${step.index}`}
        verses={verses}
        startVerse={0}
        startWord={0}
        endVerse={verses.length - 1}
        eyebrow="Learned this sitting"
        caption={`Say ${verses.length > 1 ? 'them' : 'it'} once more before you stop. This one doesn’t count.`}
        creditLines={({ mode, perVerse }) =>
          perVerse.map((r) => ({ index: r.index, text: creditLabel(verseIds[r.index], { activity: 'lastLook', passed: r.passed, perfect: r.perfect, mode }) }))
        }
        onDone={({ perVerse }) => {
          dispatch({ type: 'result', perfect: perVerse.every((r) => r.perfect) });
        }}
      />,
      <View style={{ marginBottom: space(12) }}>
        <ButtonPair left={<AppButton size="sm" variant="quiet" label="Skip this" onPress={() => dispatch({ type: 'skip' })} />} right={<View />} />
      </View>
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
    const eyebrow = `${step.relearn ? 'Learning again' : 'New verse'} · step ${ladder.pos + 1} of ${ladder.rungs.length}`;
    const title = refOf(verse);
    // Anchors only help while the verse is being learned, and only in Latin-script text.
    const liveItem = itemOf(step.verseId);
    const anchors = liveItem?.status === 'learning' && scriptOfVerse(verse) === 'latin' ? liveItem.guidedAnchors : undefined;
    const toggleAnchor = (wordIndex: number) => {
      const cur = liveItem?.guidedAnchors ?? [];
      const next = cur.includes(wordIndex) ? cur.filter((x) => x !== wordIndex) : cur.length >= GUIDED_MAX_ANCHORS ? cur : [...cur, wordIndex];
      state.setGuidedAnchors(step.verseId, next);
    };
    const canPickAnchors = scriptOfVerse(verse) === 'latin';
    const ladderFrame = (e: string, t: string, body: React.ReactNode) => frame(e, t, body, <RungBar ladder={ladder} />);

    if (rung.kind === 'read') {
      return ladderFrame(
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
            {canPickAnchors
              ? `Read it through, slowly, a couple of times. Then tap up to ${GUIDED_MAX_ANCHORS} words that carry it: your anchors.`
              : 'Read it through, slowly, a couple of times.'}
          </AppText>
          <VerseCard verse={verse} anchors={anchors} onToggleWord={canPickAnchors ? toggleAnchor : undefined} />
          <VersePlayButton
            key={step.verseId}
            book={verse.book}
            chapter={verse.chapter}
            verse={verse.verse}
            translationId={verse.translationId ?? ''}
            userRecordings={state.userRecordings}
            selectedChapterAudios={state.selectedChapterAudios}
            studioPlaybackEnabled={state.studioPlaybackEnabled}
            audioCacheMap={state.audioCache.map}
            onStart={() => state.setPlayingRecordingId(null)}
          />
        </RoundFrame>
      );
    }

    if (rung.kind === 'lookUp') {
      return ladderFrame(
        eyebrow,
        title,
        <LookUpStage key={`${ladder.pos}:${ladder.misses}`} verse={verse} anchors={anchors} onNext={() => dispatch({ type: 'next' })} />
      );
    }

    if (rung.kind === 'drill' && rung.drill) {
      return ladderFrame(
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
          audio={
            rung.drill === 'listen' ? audioFor(verse) : undefined
          }
        />
      );
    }

    // Fill the blanks, partly hidden, or fully hidden. Anchors stay unhighlighted while reciting.
    const blanks = rung.kind === 'blanks';
    const partly = rung.kind === 'partly';
    const stepDown = blanks || partly;
    const activity: GuidedActivity = blanks ? 'blanks' : partly ? 'partly' : ladder.knowIt ? 'knowIt' : 'fully';
    return ladderFrame(
      eyebrow,
      title,
      <GradedStage
        key={`${ladder.pos}:${ladder.misses}:${ladder.activities}`}
        verses={[verse]}
        startVerse={0}
        startWord={0}
        endVerse={0}
        hiddenShare={blanks ? rung.share : partly ? GUIDED_PARTLY_HIDDEN : undefined}
        anchors={anchors ? new Set(anchors) : undefined}
        phrasal={blanks && (rung.share ?? 0) >= 0.5}
        easierLabel={stepDown ? 'Easier: one more drill first' : 'Easier: show some words'}
        onEasier={() => dispatch({ type: 'easier' })}
        eyebrow={blanks ? 'Fill in the blanks' : partly ? 'Some words showing' : 'From memory'}
        caption={
          blanks
            ? 'Type the first letter of the hidden words. The shown words won’t count toward a run.'
            : partly
              ? 'Say the verse. The shown words won’t count toward a run.'
              : `Say ${title} with nothing in front of you.`
        }
        creditLines={({ perVerse }) => [
          { index: 0, text: creditLabel(step.verseId, { activity, passed: perVerse[0].passed, perfect: perVerse[0].perfect, mode: 'speak' }) },
        ]}
        onDone={({ mode, perVerse }) => {
          const r = perVerse[0];
          if (!stepDown) bank([{ id: step.verseId, outcome: { activity, passed: r.passed, perfect: r.perfect, accuracy: r.accuracy, mode } }], mode);
          // dispatch clears the notice, so it is set again just after.
          const message = !r.perfect ? 'Not quite. Back to a pick-and-place step.' : null;
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
            {s.coldQueue.length > 0 && (
              <AppButton
                variant="secondary"
                label={`Check ${s.coldQueue.length === 1 ? 'verse' : 'verses'} ${s.coldQueue
                  .map((id) => itemOf(id)?.verseNumber)
                  .filter(Boolean)
                  .join(', ')}`}
                onPress={() => dispatch({ type: 'doChecks' })}
              />
            )}
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
  const todayKey = localDayKey(getLogicalDate(dayStartHour));
  const dueCount = reviewsPaused
    ? 0
    : state.memoryQueue.filter((q) => q.status === 'reviewing' && isReviewDue(q.nextReviewDueDate) && !gradedOnDay(q, todayKey)).length;
  // The shared finish page (UI simplify R3 / Job 14).
  return (
    <SessionDone
      safeTop={false}
      safeBottom={false}
      title={s.log.length === 0 ? 'Nothing this time' : 'Good sitting'}
      subtitle={s.log.length === 0 ? 'Come back when a verse is ready.' : undefined}
      stats={
        s.log.length === 0
          ? undefined
          : [
              { value: s.newDone, label: s.newDone === 1 ? 'new verse' : 'new verses' },
              { value: checks, label: checks === 1 ? 'check passed' : 'checks passed' },
              { value: bankedRef.current, label: bankedRef.current === 1 ? 'run counted' : 'runs counted' },
            ]
      }
      onDone={() => navigateTo('home')}
      secondary={dueCount > 0 ? { label: `Review now · ${dueCount} due`, onPress: () => state.openMixedReview() } : undefined}
    >
      {items.length > 0 && (
        <GroupedList header="Where each verse stands">
          {items.map((i) => (
            <ListRow
              key={i.verseId}
              title={`Verse ${i.verseNumber}`}
              subtitle={i.status === 'learning' ? undefined : 'In reviews'}
              accessory={<RunDots done={i.status === 'learning' ? runsBanked(i) : masteryTouches} needed={masteryTouches} />}
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

      {dueCount > 0 ? (
        <AppText variant="label" className="font-sans text-ink-2" style={{ paddingHorizontal: space(4) }}>
          Finished verses move to reviews once today's are done.
        </AppText>
      ) : null}
    </SessionDone>
  );

  // A verse in the step vanished from the queue (deleted mid-sitting): end cleanly.
  function dispatchMissing() {
    setTimeout(() => dispatch({ type: 'finish' }), 0);
  }
}

// ----------------------------------------------------------------------------
// The route: picks the passage, then hands over to the sitting
// ----------------------------------------------------------------------------

export default function GuidedLearningScreen() {
  const state = useAppFields(
    'guidedPassageKey', 'memoryQueue', 'navigateTo', 'pullVerseIntoLearning', 'setGuidedPassageKey',
  );
  const space = useScaledSpace();
  const { memoryQueue, guidedPassageKey, setGuidedPassageKey, navigateTo } = state;

  // Passages that have a verse in Learning: those are what a sitting works on.
  const passages = useMemo(() => buildPassages(memoryQueue).filter((p) => p.items.some((i) => i.status === 'learning')), [memoryQueue]);

  // Pick up where you left off: the last passage opened on this device.
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [jigsawWarmUp, setJigsawWarmUp] = useState(true);
  useEffect(() => {
    (async () => {
      const prefs: any = await loadPracticePrefs();
      if (typeof prefs.guidedLastPassage === 'string') setSavedKey(prefs.guidedLastPassage);
      if (prefs.guidedJigsaw === false) setJigsawWarmUp(false);
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

  return <Sitting key={resolved.key} passageKey={resolved.key} passages={passages} jigsawWarmUp={jigsawWarmUp} onPickPassage={(k) => {
    setChosen(k);
    setLocked(k);
  }} />;
}
