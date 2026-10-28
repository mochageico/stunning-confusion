import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Check, Eye, Keyboard, Layers, Mic, X } from 'lucide-react-native';

import { AppState, isReviewDue } from '../state/useAppState';
import { ChapterSections, QueueItem, ReviewGrade } from '../types';
import { FadeInView } from '../components/ui';
import { AppButton, AppIconButton, AppText, useFontScale, useScaledSpace } from '../components/design';
import { TakeawayAsk } from '../components/TakeawayAsk';
import { Badge, EmptyState, GroupedList, ListRow, ScreenHeader } from '../components/blocks';
import { bracketColor, useThemeColors } from '../components/theme';
import GradedRecitation, { ButtonPair, canSpeakVerses, RecitationMode, RoundFrame, SpanText } from '../components/GradedRecitation';
import ThreadRound, { ThreadRoundResult } from '../components/ThreadRound';
import { FixTransitions, PassageOutcomes, transitionTargets } from '../components/practice/ReviewRecap';
import { SelfCheckFlow, SelfCheckResult } from '../components/practice/SelfCheck';
import type { GradeSettings } from '../lib/grading';
import ScrambleDrill from '../components/drills/ScrambleDrill';
import SpotSwapDrill, { SwapVerseScore } from '../components/drills/SpotSwapDrill';
import SectionOrderDrill from '../components/drills/SectionOrderDrill';
import WhichSectionDrill from '../components/drills/WhichSectionDrill';
import TeachItDrill from '../components/drills/TeachItDrill';
import { DrillVerse, pickThreadCue, ThreadCue, threadCueKey, threadSpan } from '../lib/drills';
import { drillSections, DrillSection } from '../lib/sectionDrills';
import { summarizeOutcomes, WordOutcome } from '../lib/recitation';
import { normalizeToken, scriptOfVerse } from '../lib/textScript';
import { loadPracticePrefs } from '../lib/practicePrefs';
import { getLogicalDate, localDayKey } from '../lib/logicalDate';
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
//   - Find the wrong word: the round's misses (unfound, wrongly flagged, real
//     word not known) over its verse count grade every verse in it, never
//     perfect (it's spotting, not saying). Only the first check counts, so
//     the reshuffle is gone after it.
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
  onDone: (perVerse: Record<string, MixVerseResult>) => void;
}) {
  const space = useScaledSpace();
  const script = scriptOfVerse(verses[verses.length - 1]);
  const [stage, setStage] = useState<'ready' | RecitationMode | 'reveal' | 'pickSlip' | 'spot'>('ready');
  const [attempt, setAttempt] = useState(0);
  const [canSpeak] = useState(() => canSpeakVerses([verses[verses.length - 1]]));
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

  const opening = (v: DueVerse) => v.text.split(/\s+/).slice(0, FIRST_WORDS_SHOWN).join(' ');
  const ready = (
    <View className="bg-surface border border-line rounded-card" style={{ padding: space(16), gap: space(6) }}>
      <AppText variant="caption" className="font-sans font-medium text-ink-3 text-center">
        {firstWords ? `Say each verse from its first ${FIRST_WORDS_SHOWN} words` : 'Say it with nothing in front of you'}
      </AppText>
      {firstWords ? (
        verses.map((v) => (
          <AppText key={v.id} variant="body" script={script} className="font-serif text-ink">
            <AppText variant="caption" className="font-sans font-bold text-ink-3">
              {v.verse}{' '}
            </AppText>
            {opening(v)} …
          </AppText>
        ))
      ) : (
        <AppText variant="title" className="font-sans font-semibold text-ink text-center">
          {verses[0].book} {verses[0].chapter}:{rangeText(verses[0].verse, verses[last].verse)}
        </AppText>
      )}
    </View>
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
        continueLabel="Next"
        onCancel={() => setStage('ready')}
        onSwitchMode={(to) => {
          setStage(to);
          setAttempt((a) => a + 1);
        }}
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

  return (
    <RoundFrame>
      <View className="flex-1 justify-center" style={{ minHeight: space(140) }}>
        {ready}
      </View>
      <View style={{ gap: space(8) }}>
        {canSpeak && <AppButton size="lg" variant="primary" Icon={Mic} label="Recite" onPress={() => setStage('speak')} />}
        <AppButton
          variant={canSpeak ? 'secondary' : 'primary'}
          size={canSpeak ? 'md' : 'lg'}
          Icon={Keyboard}
          label="Type first letters"
          onPress={() => setStage('type')}
        />
        {allowSelfCheck && <AppButton variant="quiet" Icon={Eye} label="Show text and check myself" onPress={() => setStage('reveal')} />}
      </View>
    </RoundFrame>
  );
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
// Find the wrong word: the first check is what counts
// ----------------------------------------------------------------------------

function FindWrongWordRound({
  verses,
  counts,
  onDone,
}: {
  verses: DueVerse[];
  counts: boolean;
  onDone: (perVerse: Record<string, MixVerseResult>) => void;
}) {
  const space = useScaledSpace();
  const [scored, setScored] = useState<SwapVerseScore[] | null>(null);
  // The round's misses over its verses grade every verse in it (gradeSwap's rate).
  const result = () => {
    const out: Record<string, MixVerseResult> = {};
    if (!scored) return out;
    const swap = { misses: scored.reduce((n, sc) => n + sc.misses, 0), verses: verses.length };
    verses.forEach((v) => {
      if (scored.some((x) => x.verse === v.verse)) out[v.id] = { mode: 'type', swap, perfect: false };
    });
    return out;
  };
  return (
    <View className="flex-1" style={{ gap: space(12) }}>
      <View className="flex-1">
        <SpotSwapDrill
          verses={verses}
          showSwapCount={false}
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
  onNext: (perVerse?: Record<string, MixVerseResult>) => void;
}) {
  const space = useScaledSpace();
  const [checking, setChecking] = useState<'pick' | 'spot' | null>(null);
  if (checking) {
    return (
      <SelfCheckFlow
        verses={verses}
        allGotIt={checking === 'spot'}
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
// The start sheet
// ----------------------------------------------------------------------------

function StartSheet({
  state,
  due,
  enabled,
  counts,
  onStart,
}: {
  state: AppState;
  due: QueueItem[];
  enabled: FormatId[];
  counts: MixCounts;
  onStart: (chosen: QueueItem[]) => void;
}) {
  const space = useScaledSpace();
  const { navigateTo, memoryQueue, sectionsForChapter, getEstimatedReviewTime, cognitiveLoadSensitivity } = state;
  const { chapters } = useMemo(() => buildUnits({ due, pool: memoryQueue, sectionsFor: sectionsForChapter }), [due, memoryQueue, sectionsForChapter]);
  const [off, setOff] = useState<Set<string>>(new Set());
  const keyOf = (i: QueueItem) => `${i.translationId || ''}|${i.book}|${i.chapter}`;
  const chosen = due.filter((i) => !off.has(keyOf(i)));
  const chosenChapters = chapters.filter((c) => !off.has(c.key));
  const minutes = chosen.length === 0 ? 0 : Math.max(1, getEstimatedReviewTime(chosen, cognitiveLoadSensitivity));
  const countOf = (key: string) => due.filter((i) => keyOf(i) === key).length;
  const practiceOn = enabled.filter((f) => !counts[f]).length;
  const countingOn = enabled.filter((f) => counts[f]).length;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader
          title={MIX_NAMES.mixedReview}
          subtitle="Today's reviews, section by section, each in a different way."
          onBack={() => navigateTo('home')}
          backLabel="Today"
        />

        <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(4) }}>
          <AppText variant="title" className="font-sans font-bold text-ink">
            {plural(chosen.length, 'verse')} · {plural(chosenChapters.length, 'chapter')}
          </AppText>
          <AppText variant="label" className="font-sans text-ink-2">
            {chosen.length === 0 ? 'Pick at least one chapter.' : `About ${minutes} min`}
          </AppText>
        </View>

        <View style={{ gap: space(6) }}>
          <GroupedList header="Chapters, in Today's order">
            {chapters.map((c) => {
              const on = !off.has(c.key);
              const n = countOf(c.key);
              return (
                <Pressable
                  key={c.key}
                  onPress={() =>
                    setOff((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.key)) next.delete(c.key);
                      else next.add(c.key);
                      return next;
                    })
                  }
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${chapterName(c)}, ${plural(n, 'verse')}`}
                  className="flex-row items-center active:bg-surface-2"
                  style={{ paddingVertical: space(12), paddingHorizontal: space(14), gap: space(12) }}
                >
                  <CheckBox on={on} />
                  <View className="flex-1" style={{ gap: space(2) }}>
                    <AppText variant="body" className="font-sans font-semibold text-ink">
                      {chapterName(c)}
                    </AppText>
                    <AppText variant="caption" className="font-sans text-ink-3">
                      {plural(n, 'verse')}
                      {c.sectionCount > 0 ? ` · ${plural(c.sectionCount, 'section')}` : ' · no sections yet'}
                    </AppText>
                  </View>
                </Pressable>
              );
            })}
          </GroupedList>
          {chapters
            .filter((c) => c.sectionCount === 0)
            .map((c) => (
              <View key={c.key} style={{ paddingHorizontal: space(4) }}>
                <TextLink label={`Add sections to ${chapterName(c)}`} onPress={() => navigateTo('chapterLanding', c.book, c.chapter)} />
              </View>
            ))}
          <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
            A chapter without sections is taken a few verses at a time.
          </AppText>
        </View>

        <View style={{ gap: space(6), paddingHorizontal: space(4) }}>
          <AppText variant="label" className="font-sans text-ink-2">
            {`Formats: ${plural(countingOn, 'that counts', 'that count')}, ${plural(practiceOn, 'for practice', 'for practice')}.`}
          </AppText>
          <TextLink
            label="Choose formats"
            onPress={() => {
              openSettingsAt('formats');
              navigateTo('settings');
            }}
          />
        </View>

        <View style={{ gap: space(8) }}>
          <AppButton size="lg" variant="primary" Icon={Layers} label="Start" disabled={chosen.length === 0} onPress={() => onStart(chosen)} />
          <AppText variant="caption" className="font-sans text-ink-3 text-center">
            Stop anytime. What you finish counts.
          </AppText>
        </View>
      </ScrollView>
    </FadeInView>
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
}: {
  state: AppState;
  initial: MixState;
  startedAt: number;
  counts: MixCounts;
}) {
  const space = useScaledSpace();
  const palette = useThemeColors();
  const { memoryQueueRef, sectionsForChapter, handleReviewCompleted, startPractice, navigateTo, reviewNotes, clearSlipped } = state;

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
    const missedSet = new Set(sum.missed);
    // What each passage's review did this session, from the engine.
    const notes = reviewNotes.filter((n) => n.at >= startedAt);
    const fixTargets = transitionTargets(notes, memoryQueueRef.current);
    return (
      <FadeInView style={{ flex: 1 }}>
        <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
          <View style={{ gap: space(4) }}>
            <AppText variant="display" className="font-sans font-bold text-ink">
              {reviewed === 0 ? 'Nothing counted this time' : stopped ? 'Stopped for today' : 'Reviews done'}
            </AppText>
            <AppText variant="label" className="font-sans text-ink-2">
              {[plural(reviewed, 'verse'), plural(unitsDone, 'section'), `${minutes} min`].join(' · ')}
            </AppText>
          </View>

          <View className="flex-row" style={{ gap: space(10) }}>
            <View className="flex-1 bg-surface border border-line rounded-card" style={{ padding: space(12), gap: space(2) }}>
              <AppText variant="title" className="font-sans font-bold text-ink">
                {sum.clean.length}
              </AppText>
              <AppText variant="caption" className="font-sans text-ink-2">
                Clean
              </AppText>
            </View>
            <View className="flex-1 bg-surface border border-line rounded-card" style={{ padding: space(12), gap: space(2) }}>
              <AppText variant="title" className="font-sans font-bold text-ink">
                {sum.missed.length}
              </AppText>
              <AppText variant="caption" className="font-sans text-ink-2">
                Slipped
              </AppText>
            </View>
          </View>

          <PassageOutcomes notes={notes} />

          {/* A section may have just reached weekly reviews with this session's credits. */}
          <TakeawayAsk state={state} />

          {sum.notCovered.length > 0 && (
            <AppText variant="label" className="font-sans text-ink-2">
              {`${plural(sum.notCovered.length, 'verse')} not reached ${sum.notCovered.length === 1 ? 'is' : 'are'} still due today.`}
            </AppText>
          )}

          {sum.slippedUnits.length > 0 && (
            <GroupedList header="Where you slipped">
              {sum.slippedUnits.map((u) => {
                const unit = plan.units[u];
                const c = chapterOf(unit.chapterKey);
                const slippedHere = versesOf(unit.verseIds).filter((v) => missedSet.has(v.id));
                return (
                  <ListRow
                    key={u}
                    title={`${chapterName(c)}:${rangeText(unit.start, unit.end)}`}
                    subtitle={`${unit.label ? `${unit.label} · ` : ''}slipped on ${slippedHere.map((v) => `v${v.verse}`).join(', ')}`}
                    accessory={
                      <AppButton
                        size="sm"
                        variant="secondary"
                        label="Practice"
                        onPress={() => {
                          const items = unit.verseIds.map((id) => itemById.get(id)).filter((i): i is QueueItem => !!i);
                          startPractice('learn', mapQueueItemsToVerseStates(items));
                        }}
                      />
                    }
                  />
                );
              })}
            </GroupedList>
          )}

          <FixTransitions queue={memoryQueueRef.current} targets={fixTargets} onClear={(id) => void clearSlipped([id])} />

          {sum.formatsUsed.length > 0 && (
            <View style={{ gap: space(8) }}>
              <AppText variant="label" className="font-sans font-semibold text-ink-2">
                Formats used today
              </AppText>
              <View className="flex-row flex-wrap" style={{ gap: space(8) }}>
                {sum.formatsUsed.map((f) => (
                  <View key={f} className="flex-row items-center bg-surface border border-line rounded-btn" style={{ gap: space(6), paddingHorizontal: space(10), paddingVertical: space(6) }}>
                    <AppText variant="label" className="font-sans text-ink">
                      {formatLabel(f)}
                    </AppText>
                    <Badge label={formatTag(f, counts[f])} tone={counts[f] ? 'accent' : 'neutral'} />
                  </View>
                ))}
              </View>
            </View>
          )}

          <AppButton size="lg" variant="primary" label="Done" onPress={() => navigateTo('home')} />
        </ScrollView>
      </FadeInView>
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
      (q) => q.book === v.book && q.chapter === v.chapter && q.verseNumber === v.verse - 1 && (q.translationId || '') === (v.translationId || '')
    );
    return before?.text ?? null;
  };

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
  } else if (format === 'findWrongWord') {
    body = <FindWrongWordRound key={round.index} verses={verses} counts={round.counts} onDone={result} />;
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
        onDone={result}
      />
    );
  }

  return (
    <FadeInView style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas p-5" style={{ gap: space(12) }}>
        <View style={{ gap: space(8) }}>
          <View className="flex-row items-center" style={{ gap: space(12) }}>
            <View className="flex-1">
              <ProgressBar done={s.pos} total={plan.rounds.length} />
            </View>
            <AppButton size="sm" variant="quiet" label="Skip" onPress={() => send({ type: 'skip' })} />
            <AppIconButton Icon={X} variant="outline" onPress={() => send({ type: 'stop' })} accessibilityLabel="Stop for today" />
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
  useEffect(() => {
    loadPracticePrefs().then((saved: any) => {
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

  const [session, setSession] = useState<{ state: MixState; startedAt: number } | null>(null);

  if (session) {
    return <Session state={state} initial={session.state} startedAt={session.startedAt} counts={counts} />;
  }
  if (!enabled) return <View className="flex-1 bg-canvas" />;

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

  return (
    <StartSheet
      state={state}
      due={due}
      enabled={enabled}
      counts={counts}
      onStart={(chosen) => {
        const plan = buildMixPlan({ due: chosen, pool: memoryQueue, sectionsFor: sectionsForChapter, enabled, counts }, Math.random);
        setSession({ state: mixReducer(startMix(plan, { cleanPct, swapCanBeClean }), { type: 'start' }), startedAt: Date.now() });
      }}
    />
  );
}
