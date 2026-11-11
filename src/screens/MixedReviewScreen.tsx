import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Check, Eye, Layers, SlidersHorizontal, X } from 'lucide-react-native';

import { AppState, isReviewDue } from '../state/useAppState';
import { ChapterSections, QueueItem, ReviewGrade } from '../types';
import { FadeInView, useKeyboardLift } from '../components/ui';
import { AppButton, AppIconButton, AppText, useFontScale, useScaledSpace } from '../components/design';
import { TakeawayAsk } from '../components/TakeawayAsk';
import { OptionsPopup, SessionDone } from '../components/session';
import { Badge, EmptyState, GroupedList, ListRow, ScreenHeader } from '../components/blocks';
import { bracketColor, useThemeColors } from '../components/theme';
import GradedRecitation, { ButtonPair, RecitationMode, RoundFrame, SpanText } from '../components/GradedRecitation';
import ThreadRound, { ThreadRoundResult } from '../components/ThreadRound';
import { computeDayReviewLoad } from '../lib/retention';
import { SelfCheckFlow, SelfCheckResult } from '../components/practice/SelfCheck';
import type { GradeSettings } from '../lib/grading';
import ScrambleDrill from '../components/drills/ScrambleDrill';
import OpeningsDrill from '../components/drills/OpeningsDrill';
import type { OpeningResult } from '../lib/openings';
import SpotGapDrill from '../components/drills/SpotGapDrill';
import type { GapScore } from '../lib/spotGap';
import SectionOrderDrill from '../components/drills/SectionOrderDrill';
import WhichSectionDrill from '../components/drills/WhichSectionDrill';
import TeachItDrill from '../components/drills/TeachItDrill';
import { DrillVerse, pickThreadCue, ThreadCue, threadCueKey, threadSpan } from '../lib/drills';
import { drillSections, DrillSection } from '../lib/sectionDrills';
import { summarizeOutcomes, WordOutcome } from '../lib/recitation';
import { normalizeToken, scriptOfVerse } from '../lib/textScript';
import { loadPracticePrefs } from '../lib/practicePrefs';
import { getLogicalDate, localDayKey } from '../lib/logicalDate';
import { translationOf } from '../lib/passages';
import { openSettingsAt } from './SettingsScreen';
import { mapQueueItemsToVerseStates } from '../lib/appData';
import { FORMATS, FormatId, formatLabel, formatTag, MIX_NAMES } from '../lib/formatNames';
import {
  buildMixPlan,
  buildUnits,
  currentRound,
  MixChapter,
  MixCredit,
  MixEvent,
  MixPlan,
  mixReducer,
  MixRound,
  MixState,
  mixSummary,
  MixUnit,
  MixVerseResult,
  MIX_COUNTS_PREF,
  MIX_FORMATS_PREF,
  MixCounts,
  readMixCounts,
  readMixFormats,
  startMix,
  chapterKeyOf,
  notGradedOn,
  todayOrder,
  verseGrade,
} from '../lib/mix';

// ============================================================================
// MIXED REVIEW -- the screen (MIXED_REVIEW_PLAN.md, stage 5)
// ----------------------------------------------------------------------------
// Renders mixReducer's state (src/lib/mix.ts) and reports what the user did.
// The plan -- which chapters, which sections, which format each round gets,
// what a result credits -- is decided there; nothing here decides it. This
// file only plumbs: the start sheet, turning each drill's result into the
// per-verse results the reducer reads, and sending the credits it hands back
// to handleReviewCompleted the moment a round ends, so closing the app loses
// nothing already done.
//
// What a format reports (stage 4 left these to the screen):
//   - Recite and First words: one GradedRecitation over the unit, first to
//     last. First words keeps the first FIRST_WORDS_SHOWN words of each verse
//     showing and grades only the hidden ones. "Show text" is a self-check:
//     Got it / Stumbled / Blanked per verse, then a spot check (never
//     perfect). It's hidden when the last counted review of one of the
//     unit's passages was a self-check (the every-other rule).
//   - Keep going: ThreadRound cued inside the started verse just before the
//     unit, so every unit verse is said whole. The cue verse never counts.
//   - Spot the gap (the findWrongWord format): tapped wrong words, typed blank
//     letters and, with numbers hidden, typed verse numbers. Each verse's own
//     share right (the section's when it tested nothing there) grades it like
//     a typed recall. Only the first check counts, so there is no reshuffle.
//   - Practice rounds report nothing; the reducer would ignore it anyway. One
//     switched to Counts ends in the same self-check.
// Each verse's grade goes to the engine as it is; the engine decides when a
// passage has been covered and what that does to it.
// ============================================================================

const FIRST_WORDS_SHOWN = 3;

type DueVerse = DrillVerse & { id: string };

const toVerse = (item: QueueItem): DueVerse => ({
  id: item.verseId,
  book: item.book,
  chapter: item.chapter,
  verse: item.verseNumber,
  text: item.text,
  translationId: item.translationId,
});

const rangeText = (start: number, end: number) => (start === end ? `${start}` : `${start}–${end}`);
const chapterName = (c: Pick<MixChapter, 'book' | 'chapter'>) => `${c.book} ${c.chapter}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Pearls before pigs", or "Verses 6–11" for a section with no label or a stretch. */
const unitName = (u: MixUnit) => u.label || (u.start === u.end ? `Verse ${u.start}` : `Verses ${rangeText(u.start, u.end)}`);

/** Graded words of one verse's result, as the reducer wants them. */
const gradedResult = (outcomes: WordOutcome[], mode: RecitationMode): MixVerseResult => {
  const sum = summarizeOutcomes(outcomes);
  return { mode, accuracy: sum.accuracy, perfect: sum.isPerfect };
};

/** A self-check's answers, per verse id. A missed spot check holds the review. */
const selfResults = (verses: DueVerse[], r: SelfCheckResult): Record<string, MixVerseResult> => {
  const out: Record<string, MixVerseResult> = {};
  verses.forEach((v, i) => {
    out[v.id] = { mode: 'self', answer: r.answers[i], ...(r.spotPassed === false ? { spotMissed: true } : {}) };
  });
  return out;
};

const GRADE_WORD: Record<ReviewGrade, string> = { clean: 'Clean', stumble: 'Stumbled', blank: 'Blanked' };

/** Under each verse of a graded round: its grade, or Clean / Slipped when the round is practice. */
const gradePreview = (r: MixVerseResult, counts: boolean, settings: GradeSettings): string => {
  const g = verseGrade(r, settings);
  if (!counts) return g === 'clean' ? 'Clean' : 'Slipped';
  return GRADE_WORD[g];
};

// ----------------------------------------------------------------------------
// Small pieces
// ----------------------------------------------------------------------------

function CheckBox({ on }: { on: boolean }) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const box = Math.round(22 * scale);
  return (
    <View
      className={`rounded-md border-2 items-center justify-center shrink-0 ${on ? 'bg-accent border-accent' : 'border-line'}`}
      // layout-ok: a checkbox holds an icon, not text.
      style={{ width: box, height: box }}
    >
      {on ? <Check size={Math.round(14 * scale)} color={palette.onAccent} strokeWidth={3} /> : null}
    </View>
  );
}

function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" hitSlop={8} className="self-start active:opacity-60">
      <AppText variant="caption" className="font-sans font-medium text-accent underline">
        {label}
      </AppText>
    </Pressable>
  );
}

/** One segment per round: done, here, still to come. */
function ProgressBar({ done, total }: { done: number; total: number }) {
  const space = useScaledSpace();
  const share = total === 0 ? 0 : Math.min(1, done / total);
  return (
    <View
      className="bg-fill rounded-full overflow-hidden"
      // layout-ok: a progress track holds no text.
      style={{ height: Math.max(6, Math.round(space(6))) }}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: done }}
    >
      <View className="bg-accent rounded-full" style={{ width: `${share * 100}%`, height: '100%' }} />
    </View>
  );
}

// ----------------------------------------------------------------------------
// Recite and First words: a ready card, then one graded recitation (or a self-check)
// ----------------------------------------------------------------------------

function ReciteRound({
  verses,
  firstWords,
  counts,
  settings,
  allowSelfCheck,
  previousText,
  spotSkip,
  onDone,
}: {
  verses: DueVerse[];
  /** Keep the first FIRST_WORDS_SHOWN words of each verse showing. */
  firstWords: boolean;
  /** False when the user switched this format to Practice: same round, no credit. */
  counts: boolean;
  settings: GradeSettings;
  /** False when a self-check can't count here (the every-other rule): no Show text. */
  allowSelfCheck: boolean;
  /** The verse before verses[i], for the spot check's lead-in. */
  previousText: (i: number) => string | null;
  /** Verses a graded round already counted this sitting: no spot check on them. */
  spotSkip: ReadonlySet<string>;
  onDone: (perVerse: Record<string, MixVerseResult>) => void;
}) {
  const space = useScaledSpace();
  const script = scriptOfVerse(verses[verses.length - 1]);
  // One screen: typing starts at once, with a mic beside the input (as in Guided learning).
  const [stage, setStage] = useState<RecitationMode | 'reveal' | 'pickSlip' | 'spot'>('type');
  const [attempt, setAttempt] = useState(0);
  const last = verses.length - 1;
  const span = useMemo(() => threadSpan(verses, { startVerse: 0, startWord: 0, endVerse: last, cueWords: [] }), [verses, last]);

  // First words: the first few graded words of every verse, as flat graded indices across the span.
  const shown = useMemo(() => {
    if (!firstWords) return undefined;
    const out = new Set<number>();
    let n = 0;
    span.forEach((sv) => {
      let inVerse = 0;
      sv.words.forEach((w) => {
        if (normalizeToken(w, script).length === 0) return;
        if (inVerse < FIRST_WORDS_SHOWN) out.add(n);
        inVerse++;
        n++;
      });
    });
    return out;
  }, [firstWords, span, script]);

  const caption = (
    <AppText variant="caption" className="font-sans font-medium text-ink-3 text-center">
      {firstWords
        ? `Say each verse from its first ${FIRST_WORDS_SHOWN} words`
        : `${verses[0].book} ${verses[0].chapter}:${rangeText(verses[0].verse, verses[last].verse)}`}
    </AppText>
  );

  // First words grades only the words it hid: `shown` holds flat graded indices across the span.
  const resultsOf = (perVerse: WordOutcome[][], mode: RecitationMode): MixVerseResult[] => {
    let offset = 0;
    return span.map((_sv, k) => {
      const o = perVerse[k] ?? [];
      const hidden = shown ? o.filter((_x, j) => !shown.has(offset + j)) : o;
      offset += o.length;
      return gradedResult(hidden, mode);
    });
  };
  const finishGraded = (perVerse: WordOutcome[][], mode: RecitationMode) => {
    const out: Record<string, MixVerseResult> = {};
    const results = resultsOf(perVerse, mode);
    span.forEach((sv, k) => (out[verses[sv.index].id] = results[k]));
    onDone(out);
  };

  if (stage === 'speak' || stage === 'type') {
    return (
      <GradedRecitation
        key={`${stage}:${attempt}`}
        verses={verses}
        startVerse={0}
        startWord={0}
        endVerse={last}
        mode={stage}
        shownWords={shown}
        showHeard
        header={caption}
        continueLabel="Next"
        onCancel={() => {
          setStage('type');
          setAttempt((a) => a + 1);
        }}
        onSwitchMode={(to) => {
          setStage(to);
          setAttempt((a) => a + 1);
        }}
        footerExtra={
          allowSelfCheck ? <AppButton variant="quiet" Icon={Eye} label="Show text and check myself" onPress={() => setStage('reveal')} /> : undefined
        }
        onResult={finishGraded}
        gradedDetail={(perVerse) => {
          const results = resultsOf(perVerse, stage);
          return (
            <View className="border-t border-line" style={{ paddingTop: space(10), gap: space(6) }}>
              {span.map((sv, k) => {
                const clean = verseGrade(results[k], settings) === 'clean';
                return (
                  <View key={sv.index} className="flex-row items-start justify-between" style={{ gap: space(8) }}>
                    <AppText variant="label" className="font-sans font-semibold text-ink" style={{ minWidth: space(36) }}>
                      v{verses[sv.index].verse}
                    </AppText>
                    <AppText variant="caption" className={`font-sans flex-1 text-right ${clean ? 'text-ink-2' : 'text-ink-3'}`}>
                      {gradePreview(results[k], counts, settings)}
                    </AppText>
                  </View>
                );
              })}
            </View>
          );
        }}
      />
    );
  }

  if (stage === 'pickSlip' || stage === 'spot') {
    return (
      <SelfCheckFlow
        verses={verses}
        allGotIt={stage === 'spot'}
        // Practice can't move anything up, so there's nothing to spot check.
        spotCheck={counts}
        spotEligible={(i) => !spotSkip.has(verses[i].id)}
        previousText={previousText}
        note={counts ? undefined : 'Practice only: nothing is recorded.'}
        onBack={() => setStage('reveal')}
        onDone={(r) => onDone(selfResults(verses, r))}
      />
    );
  }

  if (stage === 'reveal') {
    return (
      <RoundFrame
        footer={
          <ButtonPair
            left={<AppButton size="lg" variant="secondary" label="Missed some" onPress={() => setStage('pickSlip')} />}
            right={<AppButton size="lg" variant="primary" label="Got it" onPress={() => setStage('spot')} />}
          />
        }
      >
        <AppText variant="label" className="font-sans text-ink-2">
          Say it first, then check yourself against the text.
        </AppText>
        <SpanText verses={verses} span={span} show={(_i, w) => ({ text: w, className: 'font-serif text-ink' })} />
      </RoundFrame>
    );
  }

  // Unreachable: every stage above returns. Keeps the function total.
  return null;
}

// ----------------------------------------------------------------------------
// Keep going: cued inside the verse before the unit
// ----------------------------------------------------------------------------

function KeepGoingRound({
  context,
  verses,
  counts,
  settings,
  allowSelfCheck,
  onDone,
  onFallback,
}: {
  context: DueVerse;
  verses: DueVerse[];
  counts: boolean;
  settings: GradeSettings;
  allowSelfCheck: boolean;
  onDone: (perVerse: Record<string, MixVerseResult>) => void;
  /** No cue could be found in the context verse: say it as Recite instead. */
  onFallback: () => void;
}) {
  const all = useMemo(() => [context, ...verses], [context, verses]);
  const used = useRef(new Set<string>());
  const pick = (): ThreadCue | null => {
    const c = pickThreadCue(all, all.length - 1, { fromVerse: 0, beforeVerse: 1, used: used.current });
    if (c) used.current.add(threadCueKey(c));
    return c;
  };
  const [cue, setCue] = useState<ThreadCue | null>(pick);
  const [n, setN] = useState(0);
  useEffect(() => {
    // The planner checked a context verse exists; a cue inside it should
    // always exist too, but a one-word verse could have none.
    if (!cue || cue.startVerse !== 0) onFallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!cue || cue.startVerse !== 0) return null;

  const finish = (r: ThreadRoundResult) => {
    const out: Record<string, MixVerseResult> = {};
    r.perVerse.forEach((pv) => {
      if (pv.index === 0) return; // The cue verse is only the way in.
      const id = all[pv.index].id;
      out[id] = pv.outcomes
        ? gradedResult(pv.outcomes, r.mode === 'self' ? 'type' : r.mode)
        : { mode: 'self', answer: pv.answer ?? (pv.ok ? 'gotIt' : 'stumbled'), ...(r.spotPassed === false ? { spotMissed: true } : {}) };
    });
    onDone(out);
  };

  return (
    <ThreadRound
      key={n}
      verses={all}
      cue={cue}
      hideVerseNumber={false}
      creditPreview={(index, _passed, _perfect, mode, outcomes) =>
        index === 0 ? 'Only the way in' : gradePreview(gradedResult(outcomes, mode === 'self' ? 'type' : mode), counts, settings)
      }
      onFinish={finish}
      allowSelfCheck={allowSelfCheck}
      spotCheck={counts}
      onDifferentCue={() => {
        const next = pick();
        if (next) {
          setCue(next);
          setN((x) => x + 1);
        }
      }}
    />
  );
}

// ----------------------------------------------------------------------------
// Openings: the first letters of every verse's start, then the rest self-checked
// ----------------------------------------------------------------------------

function OpeningsRound({
  verses,
  counts,
  onDone,
}: {
  verses: DueVerse[];
  counts: boolean;
  onDone: (perVerse: Record<string, MixVerseResult>) => void;
}) {
  const space = useScaledSpace();
  const [openings, setOpenings] = useState<OpeningResult[] | null>(null);
  const [stage, setStage] = useState<'reveal' | 'pickSlip' | 'spot'>('reveal');
  const last = verses.length - 1;
  const span = useMemo(() => threadSpan(verses, { startVerse: 0, startWord: 0, endVerse: last, cueWords: [] }), [verses, last]);

  if (!openings) return <OpeningsDrill verses={verses} onComplete={setOpenings} />;

  // The opening typed grades each verse; the rest, checked against the text, can only lower it.
  const finish = (r: SelfCheckResult) => {
    const out: Record<string, MixVerseResult> = {};
    verses.forEach((v, i) => {
      const cap = r.answers[i] === 'blanked' ? 0.3 : r.answers[i] === 'stumbled' ? 0.8 : 1;
      const accuracy = Math.min(openings[i]?.accuracy ?? 0, cap);
      out[v.id] = { mode: 'type', accuracy, perfect: accuracy === 1 };
    });
    onDone(out);
  };

  if (stage === 'pickSlip' || stage === 'spot') {
    return (
      <SelfCheckFlow
        verses={verses}
        allGotIt={stage === 'spot'}
        // The openings were typed, so the rest needs no second recital.
        spotCheck={false}
        note={counts ? undefined : 'Practice only: nothing is recorded.'}
        onBack={() => setStage('reveal')}
        onDone={finish}
      />
    );
  }

  return (
    <RoundFrame
      footer={
        <ButtonPair
          left={<AppButton size="lg" variant="secondary" label="Missed some" onPress={() => setStage('pickSlip')} />}
          right={<AppButton size="lg" variant="primary" label="Got it" onPress={() => setStage('spot')} />}
        />
      }
    >
      <AppText variant="label" className="font-sans text-ink-2" style={{ marginBottom: space(4) }}>
        Now say the rest of each verse, then check yourself against the text.
      </AppText>
      <SpanText verses={verses} span={span} show={(_i, w) => ({ text: w, className: 'font-serif text-ink' })} />
    </RoundFrame>
  );
}

// ----------------------------------------------------------------------------
// Spot the gap: the first check is what counts
// ----------------------------------------------------------------------------

/** The two Settings switches that make Spot the gap harder. */
interface GapPrefs {
  hideNumbers: boolean;
  shuffle: boolean;
}

const readGapPrefs = (saved: Record<string, unknown>): GapPrefs => ({
  hideNumbers: saved.spotGapShowNumbers === false,
  shuffle: saved.spotGapInOrder === false,
});

function SpotGapRound({
  verses,
  counts,
  gap,
  onDone,
}: {
  verses: DueVerse[];
  counts: boolean;
  gap: GapPrefs;
  onDone: (perVerse: Record<string, MixVerseResult>) => void;
}) {
  const space = useScaledSpace();
  const [scored, setScored] = useState<GapScore | null>(null);
  // Each verse's own accuracy (the section's, when it tested nothing there) grades it like a typed recall.
  const result = () => {
    const out: Record<string, MixVerseResult> = {};
    if (!scored) return out;
    scored.perVerse.forEach((row) => {
      const v = verses[row.verseIndex];
      if (v) out[v.id] = { mode: 'type', accuracy: row.accuracy, perfect: row.perfect };
    });
    return out;
  };
  return (
    <View className="flex-1" style={{ gap: space(12) }}>
      <View className="flex-1">
        <SpotGapDrill
          verses={verses}
          hideNumbers={gap.hideNumbers}
          shuffle={gap.shuffle}
          resultNote={counts ? 'these count for the review.' : 'this one is practice.'}
          onScored={setScored}
        />
      </View>
      {scored && <AppButton size="lg" variant="primary" label="Next" onPress={() => onDone(result())} />}
    </View>
  );
}

// ----------------------------------------------------------------------------
// A Practice round: the drill, then Next
// ----------------------------------------------------------------------------

function PracticeRound({
  format,
  verses,
  sections,
  script,
  counts,
  previousText,
  spotSkip,
  onNext,
}: {
  format: FormatId;
  verses: DueVerse[];
  sections: DrillSection[];
  script: ReturnType<typeof scriptOfVerse>;
  /** Switched to Counts in Settings: these drills don't grade, so the user checks themself. */
  counts: boolean;
  /** The verse before verses[i], for the spot check's lead-in. */
  previousText: (i: number) => string | null;
  /** Verses a graded round already counted this sitting: no spot check on them. */
  spotSkip: ReadonlySet<string>;
  onNext: (perVerse?: Record<string, MixVerseResult>) => void;
}) {
  const space = useScaledSpace();
  const [checking, setChecking] = useState<'pick' | 'spot' | null>(null);
  if (checking) {
    return (
      <SelfCheckFlow
        verses={verses}
        allGotIt={checking === 'spot'}
        // Scramble is a hands-on drill: its own "Got it" stands, rather than saying the verse a second time.
        spotCheck={format !== 'scramble'}
        spotEligible={(i) => !spotSkip.has(verses[i].id)}
        previousText={previousText}
        onBack={() => setChecking(null)}
        onDone={(r) => onNext(selfResults(verses, r))}
      />
    );
  }
  return (
    <View className="flex-1" style={{ gap: space(10) }}>
      <View className="flex-1">
        {format === 'scramble' && <ScrambleDrill verses={verses} counts={counts} />}
        {format === 'putInOrder' && <SectionOrderDrill sections={sections} script={script} counts={counts} />}
        {format === 'whichSection' && <WhichSectionDrill sections={sections} script={script} counts={counts} />}
        {format === 'teachIt' && <TeachItDrill verses={verses} sections={[]} script={script} counts={counts} />}
      </View>
      {counts ? (
        <ButtonPair
          left={<AppButton variant="secondary" label="Missed some" onPress={() => setChecking('pick')} />}
          right={<AppButton variant="secondary" label="Got it" onPress={() => setChecking('spot')} />}
        />
      ) : (
        // Secondary: most drills have a primary button of their own.
        <AppButton variant="secondary" label="Done practicing" onPress={() => onNext()} />
      )}
    </View>
  );
}

// ----------------------------------------------------------------------------
// The session
// ----------------------------------------------------------------------------

function Session({
  state,
  initial,
  startedAt,
  counts,
  gapPrefs,
  chapters,
  off,
  onChangeChapters,
}: {
  state: AppState;
  initial: MixState;
  startedAt: number;
  counts: MixCounts;
  gapPrefs: GapPrefs;
  /** Every chapter with a review due today, for the gear's chapter list. */
  chapters: { key: string; book: string; chapter: number; sectionCount: number }[];
  off: Set<string>;
  onChangeChapters: (next: Set<string>) => void;
}) {
  const space = useScaledSpace();
  const palette = useThemeColors();
  const lift = useKeyboardLift();
  // The gear: which chapters to include, and a way to the formats setting.
  const [gearOpen, setGearOpen] = useState(false);
  const [draftOff, setDraftOff] = useState<Set<string>>(off);
  const openGear = () => {
    setDraftOff(new Set(off));
    setGearOpen(true);
  };
  const closeGear = () => {
    setGearOpen(false);
    const changed = draftOff.size !== off.size || [...draftOff].some((k) => !off.has(k));
    if (changed) onChangeChapters(draftOff);
  };
  const { memoryQueueRef, sectionsForChapter, handleReviewCompleted, startPractice, navigateTo, pausedAt, pausedUntil, dayStartHour } = state;

  const sRef = useRef<MixState>(initial);
  const [s, setS] = useState<MixState>(initial);
  // Credits go out one at a time, each reading the live queue (the same way
  // handleUpdateVerseStatus does), so one write never works from a stale item.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const [endedAt, setEndedAt] = useState<number | null>(null);
  // Rounds that fell back to Recite on screen (Keep going with no usable cue).
  const [asRecite, setAsRecite] = useState<Set<number>>(new Set());

  const sendCredits = (credits: MixCredit[]) => {
    if (credits.length === 0) return;
    chain.current = chain.current
      .then(async () => {
        for (const c of credits) {
          const item = memoryQueueRef.current.find((q) => q.verseId === c.verseId);
          if (!item) continue;
          await handleReviewCompleted(item, c.grade === 'clean', c.mode === 'self' ? 'reveal' : c.mode, {
            quiet: true,
            via: 'mix',
            perfect: c.perfect,
            graded: { kind: 'grade', grade: c.grade, selfCheck: c.selfCheck },
            canMoveUp: c.canMoveUp,
          });
        }
      })
      .catch((err) => console.error('Mixed review: failed to save a review', err));
  };

  const send = (event: MixEvent) => {
    const next = mixReducer(sRef.current, event);
    sRef.current = next;
    setS(next);
    sendCredits(next.newCredits);
    if (next.status === 'finished' || next.status === 'stopped') setEndedAt((at) => at ?? Date.now());
  };

  const plan: MixPlan = s.plan;
  const itemById = useMemo(() => {
    const m = new Map<string, QueueItem>();
    memoryQueueRef.current.forEach((q) => m.set(q.verseId, q));
    return m;
    // The plan's verses, read once: their text doesn't change mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);
  const versesOf = (ids: string[]) => ids.map((id) => itemById.get(id)).filter((i): i is QueueItem => !!i).map(toVerse);
  const chapterOf = (key: string) => plan.chapters.find((c) => c.key === key)!;
  const docOf = (c: MixChapter): ChapterSections | null => sectionsForChapter(c.book, c.chapter) ?? null;

  // The round's verses, built once per round. Saving a credit refreshes the
  // app state; new arrays here would make a drill deal itself again mid-round.
  const round: MixRound | undefined = currentRound(s);
  const roundIndex = round?.index ?? -1;
  const verses = useMemo(() => (round ? versesOf(round.verseIds) : []), [plan, roundIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  const contextVerse = useMemo(() => {
    const id = round ? plan.units[round.unitIndex].contextVerseId : undefined;
    const item = id ? itemById.get(id) : undefined;
    return item ? toVerse(item) : null;
  }, [plan, roundIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  const sectionsHere = useMemo(() => {
    // By the drill, not by whether it counts: only the section drills need sections.
    if (!round || FORMATS[round.format].counts) return [];
    const c = chapterOf(round.chapterKey);
    return drillSections(versesOf(plan.units.filter((u) => u.chapterKey === c.key).flatMap((u) => u.verseIds)), docOf(c));
  }, [plan, roundIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ==========================================================================
  // RECAP
  // ==========================================================================
  if (s.status === 'finished' || s.status === 'stopped') {
    const sum = mixSummary(s);
    const reviewed = sum.grades.size;
    const unitsDone = new Set(s.credits.map((c) => c.unitIndex)).size;
    const minutes = Math.max(1, Math.round(((endedAt ?? Date.now()) - startedAt) / 60000));
    const stopped = s.status === 'stopped';
    const slippedItems = sum.missed.map((id) => itemById.get(id)).filter((i): i is QueueItem => !!i);
    // Tomorrow's reviews, priced the same way Today's forecast prices them.
    const tomorrow = new Date(getLogicalDate(dayStartHour));
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowLoad = computeDayReviewLoad(memoryQueueRef.current, tomorrow, false, pausedAt, pausedUntil);
    // The shared finish page (UI simplify R3 / Job 14).
    return (
      <SessionDone
        safeTop={false}
        safeBottom={false}
        title={
          reviewed === 0
            ? 'Nothing counted this time'
            : slippedItems.length > 0
              ? `${slippedItems.length === 1 ? 'One verse' : `${plural(slippedItems.length, 'verse')}`} to touch up`
              : stopped
                ? 'Stopped for today'
                : 'All clean'
        }
        subtitle={slippedItems.length > 0 ? 'Say each one once more while it’s fresh.' : undefined}
        stats={[
          { value: reviewed, label: 'reviewed' },
          { value: sum.clean.length, label: 'clean' },
          { value: `${minutes}m`, label: 'time' },
        ]}
        onDone={() => navigateTo('home')}
      >

          {slippedItems.length > 0 && (
            <View style={{ gap: space(12) }}>
              {slippedItems.map((item) => (
                <View key={item.verseId} className="bg-surface border border-line rounded-card" style={{ padding: space(16), gap: space(12) }}>
                  <View style={{ gap: space(4) }}>
                    <AppText variant="caption" className="font-sans font-semibold text-ink-3">
                      {`${item.book} ${item.chapter}:${item.verseNumber}`}
                    </AppText>
                    <AppText variant="body" className="font-sans text-ink" numberOfLines={4}>
                      {item.text}
                    </AppText>
                  </View>
                  <AppButton
                    size="md"
                    variant="secondary"
                    label="Say it once more"
                    onPress={() => startPractice('learn', mapQueueItemsToVerseStates([item]))}
                  />
                </View>
              ))}
            </View>
          )}

          {/* A section may have just reached weekly reviews with this session's credits. */}
          <TakeawayAsk state={state} />

          {sum.notCovered.length > 0 && (
            <AppText variant="label" className="font-sans text-ink-2">
              {`${plural(sum.notCovered.length, 'verse')} not reached ${sum.notCovered.length === 1 ? 'is' : 'are'} still due today.`}
            </AppText>
          )}

          {/* Offered once, here, rather than before starting. */}
          {plan.chapters
            .filter((c) => c.sectionCount === 0)
            .map((c) => (
              <TextLink key={c.key} label={`Add sections to ${chapterName(c)}`} onPress={() => navigateTo('chapterLanding', c.book, c.chapter)} />
            ))}

          {tomorrowLoad.count > 0 && (
            <View className="bg-fill rounded-card" style={{ padding: space(14), gap: space(2) }}>
              <AppText variant="caption" className="font-sans font-semibold text-ink-3">
                Tomorrow
              </AppText>
              <AppText variant="body" className="font-sans font-semibold text-ink">
                {`${plural(tomorrowLoad.count, 'verse')} · about ${Math.max(1, Math.ceil(tomorrowLoad.seconds / 60))} min`}
              </AppText>
            </View>
          )}
      </SessionDone>
    );
  }

  // ==========================================================================
  // A ROUND
  // ==========================================================================
  if (!round) return null;
  const unit = plan.units[round.unitIndex];
  const chapter = chapterOf(round.chapterKey);
  if (verses.length === 0) {
    // A verse removed from the list mid-session: move past the round.
    setTimeout(() => send({ type: 'skip' }), 0);
    return null;
  }
  const script = scriptOfVerse(verses[0]);
  const isOpener = round.role === 'opener';
  const place = chapter.unitIndexes.indexOf(unit.index) + 1;
  const where = isOpener
    ? `${chapterName(chapter)} · the whole chapter`
    : `${chapterName(chapter)} · ${unit.kind === 'section' ? 'section' : 'part'} ${place} of ${chapter.unitIndexes.length}`;
  const color = unit.kind === 'section' && !isOpener && unit.sectionIndex !== undefined ? bracketColor(palette, unit.sectionIndex) : palette.line;
  const format: FormatId = asRecite.has(round.index) ? 'recite' : round.format;
  const result = (perVerse?: Record<string, MixVerseResult>) => send({ type: 'result', perVerse });
  // Every other review: a self-check can't move a passage up twice in a row,
  // so where one of these verses' passages was last moved up by a
  // self-check, a counting round offers no Show text (the engine holds it
  // either way). Read live: an earlier round may have just set it.
  const allowSelfCheck = !round.counts || !round.verseIds.some((id) => memoryQueueRef.current.find((q) => q.verseId === id)?.lastSelfChecked);
  const previousText = (i: number): string | null => {
    const v = verses[i];
    const prev = verses[i - 1] ?? (i === 0 ? contextVerse : null);
    if (prev && prev.chapter === v.chapter && prev.verse === v.verse - 1) return prev.text;
    const before = memoryQueueRef.current.find(
      (q) => q.book === v.book && q.chapter === v.chapter && q.verseNumber === v.verse - 1 && translationOf(q) === translationOf(v)
    );
    return before?.text ?? null;
  };

  // Verses a graded round (said or typed, not self-checked) already counted
  // this sitting: a spot check on them would be a second review.
  const gradedBefore = new Set(s.credits.filter((c) => c.mode !== 'self').map((c) => c.verseId));

  let body: React.ReactNode;
  // Which drill shows goes by the format; whether it credits goes by
  // round.counts (the user's Counts / Practice choice in Settings).
  if (!FORMATS[format].counts) {
    body = (
      <PracticeRound
        key={round.index}
        format={format}
        verses={verses}
        sections={sectionsHere}
        script={script}
        counts={round.counts}
        previousText={previousText}
        spotSkip={gradedBefore}
        onNext={result}
      />
    );
  } else if (format === 'keepGoing' && contextVerse) {
    body = (
      <KeepGoingRound
        key={round.index}
        context={contextVerse}
        verses={verses}
        counts={round.counts}
        settings={s.settings}
        allowSelfCheck={allowSelfCheck}
        onDone={result}
        onFallback={() => setAsRecite((prev) => new Set(prev).add(round.index))}
      />
    );
  } else if (format === 'openings') {
    body = <OpeningsRound key={round.index} verses={verses} counts={round.counts} onDone={result} />;
  } else if (format === 'findWrongWord') {
    body = <SpotGapRound key={round.index} verses={verses} counts={round.counts} gap={gapPrefs} onDone={result} />;
  } else {
    body = (
      <ReciteRound
        key={`${round.index}:${format}`}
        verses={verses}
        firstWords={format === 'firstWords'}
        counts={round.counts}
        settings={s.settings}
        allowSelfCheck={allowSelfCheck}
        previousText={previousText}
        spotSkip={gradedBefore}
        onDone={result}
      />
    );
  }

  return (
    <FadeInView style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas p-5" style={{ gap: space(12), ...(lift > 0 ? { paddingBottom: lift + space(8) } : {}) }}>
        <View style={{ gap: space(8) }}>
          {/* Same row as the practice window: close, progress, gear. */}
          <View className="flex-row items-center" style={{ gap: space(12) }}>
            <AppIconButton Icon={X} variant="outline" diameter={40} onPress={() => send({ type: 'stop' })} accessibilityLabel="Stop for today" />
            <View className="flex-1">
              <ProgressBar done={s.pos} total={plan.rounds.length} />
            </View>
            <AppButton size="sm" variant="quiet" label="Skip" onPress={() => send({ type: 'skip' })} />
            <AppIconButton Icon={SlidersHorizontal} variant="outline" diameter={40} onPress={openGear} accessibilityLabel="Review settings" />
          </View>
          <AppText variant="caption" className="font-sans font-medium text-ink-3">
            {where}
          </AppText>
          <View className="flex-row items-stretch" style={{ gap: space(10) }}>
            {/* layout-ok: the section's bracket, a colored bar with no text. */}
            <View className="rounded-full" style={{ width: Math.max(4, Math.round(space(4))), backgroundColor: color }} />
            <View className="flex-1" style={{ gap: space(4) }}>
              <AppText variant="title" className="font-sans font-bold text-ink">
                {isOpener ? `${chapterName(chapter)}:${rangeText(verses[0].verse, verses[verses.length - 1].verse)}` : unitName(unit)}
              </AppText>
              <View className="flex-row flex-wrap items-center" style={{ gap: space(8) }}>
                <AppText variant="label" className="font-sans font-semibold text-ink-2">
                  {formatLabel(format)}
                </AppText>
                <Badge label={formatTag(format, round.counts)} tone={round.counts ? 'accent' : 'neutral'} />
              </View>
            </View>
          </View>
        </View>
        <View className="flex-1">{body}</View>
      </View>

      <OptionsPopup visible={gearOpen} onClose={closeGear} title="Review settings">
        <View style={{ gap: space(12) }}>
          <GroupedList header="Chapters to include">
            {chapters.map((c) => {
              const on = !draftOff.has(c.key);
              // Keep at least one chapter on.
              const lastOn = on && chapters.filter((x) => !draftOff.has(x.key)).length === 1;
              return (
                <ListRow
                  key={c.key}
                  leading={<CheckBox on={on} />}
                  title={chapterName(c)}
                  subtitle={c.sectionCount > 0 ? plural(c.sectionCount, 'section') : 'A few verses at a time'}
                  accessory="none"
                  onPress={
                    lastOn
                      ? undefined
                      : () =>
                          setDraftOff((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.key)) next.delete(c.key);
                            else next.add(c.key);
                            return next;
                          })
                  }
                />
              );
            })}
          </GroupedList>
          <GroupedList>
            <ListRow
              title="Review formats"
              subtitle="Which ones count, which are practice"
              onPress={() => {
                setGearOpen(false);
                openSettingsAt('formats');
                navigateTo('settings');
              }}
            />
          </GroupedList>
        </View>
      </OptionsPopup>
    </FadeInView>
  );
}

// ----------------------------------------------------------------------------
// The route
// ----------------------------------------------------------------------------

export default function MixedReviewScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const { memoryQueue, reviewsPaused, navigateTo, sectionsForChapter, cleanPct, swapCanBeClean, dayStartHour } = state;

  const [enabled, setEnabled] = useState<FormatId[] | null>(null);
  const [counts, setCounts] = useState<MixCounts>(() => readMixCounts(undefined));
  const [gapPrefs, setGapPrefs] = useState<GapPrefs>({ hideNumbers: false, shuffle: false });
  useEffect(() => {
    loadPracticePrefs().then((saved: any) => {
      setGapPrefs(readGapPrefs(saved));
      setCounts(readMixCounts(saved[MIX_COUNTS_PREF]));
      setEnabled(readMixFormats(saved[MIX_FORMATS_PREF]));
    });
  }, []);

  // Today's due reviews, in Today's order, less any verse already graded
  // today: a session stopped partway resumes at the first section not done.
  // The planner takes the filtered list.
  const due = useMemo(() => {
    if (reviewsPaused) return [];
    const today = localDayKey(getLogicalDate(dayStartHour));
    return todayOrder(notGradedOn(memoryQueue.filter((q) => q.status === 'reviewing' && isReviewDue(q.nextReviewDueDate)), today));
  }, [memoryQueue, reviewsPaused, dayStartHour]);

  const [session, setSession] = useState<{ state: MixState; startedAt: number; n: number } | null>(null);
  // Chapters left out (UI simplify plan, Job 4): picked in the session's gear,
  // not on a setup page. Review on Today goes straight into the first section.
  const [off, setOff] = useState<Set<string>>(new Set());
  const { chapters } = useMemo(() => buildUnits({ due, pool: memoryQueue, sectionsFor: sectionsForChapter }), [due, memoryQueue, sectionsForChapter]);

  const begin = (nextOff: Set<string>, startedAt = Date.now(), n = 0) => {
    if (!enabled) return;
    const chosen = due.filter((i) => !nextOff.has(chapterKeyOf(i)));
    if (chosen.length === 0) return;
    const plan = buildMixPlan({ due: chosen, pool: memoryQueue, sectionsFor: sectionsForChapter, enabled, counts }, Math.random);
    setSession({ state: mixReducer(startMix(plan, { cleanPct, swapCanBeClean }), { type: 'start' }), startedAt, n });
  };
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !enabled || due.length === 0) return;
    autoStarted.current = true;
    begin(off);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, due.length]);

  if (session) {
    return (
      <Session
        key={session.n}
        state={state}
        initial={session.state}
        startedAt={session.startedAt}
        counts={counts}
        gapPrefs={gapPrefs}
        chapters={chapters}
        off={off}
        onChangeChapters={(next) => {
          setOff(next);
          // Verses already reviewed today drop out of `due`, so the new plan
          // picks up where this one is.
          begin(next, session.startedAt, session.n + 1);
        }}
      />
    );
  }
  if (!enabled || due.length > 0) return <View className="flex-1 bg-canvas" />;

  if (due.length === 0) {
    return (
      <FadeInView style={{ flex: 1 }}>
        <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
          <ScreenHeader title={MIX_NAMES.mixedReview} onBack={() => navigateTo('home')} backLabel="Today" />
          <EmptyState
            Icon={Layers}
            title={reviewsPaused ? 'Reviews are paused' : 'No reviews due'}
            message={reviewsPaused ? 'Nothing is due while reviews are paused.' : "You're all caught up for today."}
          />
        </ScrollView>
      </FadeInView>
    );
  }
  return null;
}
