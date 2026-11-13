import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { FadeInView } from '../components/ui';
import { AppButton, AppText, useScaledSpace } from '../components/design';
import { GroupedList, ListRow, ScreenHeader } from '../components/blocks';
import { PickedTray, VerseSourcePicker, rangeLabel, usePickedVerses, verseKey } from '../components/versePicker/VersePicker';
import { LEARN_MODE_ICONS, type LearnMode } from '../components/practice/useRecall';
import { PRACTICE_MODES, modeFits, type PracticeModeInfo } from '../lib/practiceModes';
import { drillSections, hasEnoughSections } from '../lib/sectionDrills';
import { toVerseStates } from '../state/useToday';
import { useAppFields } from '../state/appStore';
import type { VerseState } from '../types';

// ============================================================================
// PRACTICE (FREE_PRACTICE_PLAN.md, stage 3)
// ----------------------------------------------------------------------------
// Opened from Today's Practice row. Any verses, any mode, not tied to today's
// reviews.
//   1. Pick verses: the playlist builder's picker (My verses / Browse the
//      Bible) and its tray. Starts empty every time (user's call).
//   2. Pick a mode: the practice pop-up's modes, grouped "Counts if due" and
//      "Practice", run on exactly the picked verses. No Due / Pick switch.
// Picks from several chapters run one chapter at a time (user's call,
// 2026-11-13): the pop-up is built around one passage. When one closes, this
// page offers the next. (References, stage 4, will mix them in one round.)
// A mode shows when it fits at least one chapter; chapters it doesn't fit
// are skipped and named under it.
// ============================================================================

interface ChapterGroup {
  key: string;
  label: string;
  verses: VerseState[];
  sectionDrillsReady: boolean;
}

/** One practice run through the picked chapters in one mode. */
interface Run {
  mode: PracticeModeInfo;
  groups: ChapterGroup[];
  /** The group open now, or last opened. */
  at: number;
}

const chapterKey = (v: VerseState) => `${v.translationId ?? ''}|${v.book}|${v.chapter}`;

/** "Romans 8:28–29, 31–32": runs of one chapter, the chapter named once. */
function chapterLabel(verses: VerseState[]): string {
  const runs: VerseState[][] = [];
  for (const v of verses) {
    const run = runs[runs.length - 1];
    if (run && v.verse === run[run.length - 1].verse + 1) run.push(v);
    else runs.push([v]);
  }
  return runs.map((r, i) => (i === 0 ? rangeLabel(r) : rangeLabel(r).replace(/^.* \d+:/, ''))).join(', ');
}

export default function PracticeScreen() {
  const { navigateTo, memoryQueue, startPractice, activeModal, sectionsForChapter } = useAppFields(
    'navigateTo', 'memoryQueue', 'startPractice', 'activeModal', 'sectionsForChapter',
  );
  const space = useScaledSpace();

  const { picked, pickedPassages, addVerses, removeVerses } = usePickedVerses();
  const [step, setStep] = useState<'pick' | 'modes'>('pick');
  const [run, setRun] = useState<Run | null>(null);

  // A picked verse you've saved is practiced as the saved one, so a due
  // verse can earn its review (Browse the Bible picks start untouched).
  const queueByKey = useMemo(() => {
    const m = new Map<string, VerseState>();
    toVerseStates(memoryQueue).forEach((v) => m.set(verseKey(v), v));
    return m;
  }, [memoryQueue]);

  // The picked verses by chapter, in Bible order (pickedPassages is in pick
  // order; this page practices in reading order).
  const groups: ChapterGroup[] = useMemo(() => {
    const byChapter = new Map<string, VerseState[]>();
    for (const p of pickedPassages) {
      for (const v of p.verses) {
        const saved = queueByKey.get(verseKey(v)) ?? v;
        const k = chapterKey(saved);
        if (!byChapter.has(k)) byChapter.set(k, []);
        byChapter.get(k)!.push(saved);
      }
    }
    return [...byChapter.entries()].map(([key, verses]) => {
      const sorted = [...verses].sort((a, b) => a.verse - b.verse);
      const doc = sectionsForChapter(sorted[0].book, sorted[0].chapter);
      return { key, label: chapterLabel(sorted), verses: sorted, sectionDrillsReady: hasEnoughSections(drillSections(sorted, doc)) };
    });
  }, [pickedPassages, queueByKey, sectionsForChapter]);

  const verseCount = picked.size;

  const modes = useMemo(
    () =>
      PRACTICE_MODES.map((mode) => {
        const fits = groups.filter((g) => modeFits(mode.id, g.verses, g.sectionDrillsReady));
        const skipped = groups.filter((g) => !fits.includes(g));
        return { mode, fits, skipped };
      }).filter((m) => m.fits.length > 0),
    [groups]
  );

  const open = (r: Run) => {
    setRun(r);
    startPractice('learn', r.groups[r.at].verses, { learnTab: r.mode.id as LearnMode });
  };

  // A run ends when its last chapter's pop-up closes.
  const [sawOpen, setSawOpen] = useState(false);
  useEffect(() => {
    if (activeModal) setSawOpen(true);
    else if (sawOpen) {
      setSawOpen(false);
      setRun((r) => (r && r.at >= r.groups.length - 1 ? null : r));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModal]);
  const waiting = run && !activeModal && run.at < run.groups.length - 1 ? run : null;

  if (step === 'pick') {
    return (
      <FadeInView style={{ flex: 1 }}>
        <View className="flex-1 bg-canvas p-5" style={{ gap: space(12) }}>
          <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
            <AppButton size="sm" variant="quiet" label="Cancel" onPress={() => navigateTo('home')} />
            <AppText variant="section" className="font-sans font-bold text-ink flex-1 text-center" accessibilityRole="header">
              Practice
            </AppText>
            <AppButton
              size="sm"
              variant="primary"
              label="Next"
              onPress={() => verseCount > 0 && setStep('modes')}
              accessibilityHint={verseCount === 0 ? 'Pick at least one verse first' : undefined}
              className={verseCount === 0 ? 'opacity-40' : ''}
            />
          </View>
          <VerseSourcePicker
            memoryQueue={memoryQueue}
            picked={picked}
            addVerses={addVerses}
            removeVerses={removeVerses}
            initialTab={memoryQueue.length > 0 ? 'mine' : 'browse'}
          />
          <PickedTray pickedPassages={pickedPassages} verseCount={verseCount} removeVerses={removeVerses} />
        </View>
      </FadeInView>
    );
  }

  const row = ({ mode, skipped }: (typeof modes)[number]) => (
    <ListRow
      key={mode.id}
      Icon={LEARN_MODE_ICONS[mode.id]}
      title={mode.label}
      subtitle={skipped.length > 0 ? `Skips ${skipped.map((g) => g.label).join(', ')}` : undefined}
      onPress={() => {
        const fits = modes.find((m) => m.mode.id === mode.id)!.fits;
        open({ mode, groups: fits, at: 0 });
      }}
    />
  );
  const counting = modes.filter((m) => m.mode.counts);
  const practiceOnly = modes.filter((m) => !m.mode.counts);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader
          title="Practice"
          onBack={() => {
            setRun(null);
            setStep('pick');
          }}
          backLabel="Verses"
          subtitle={`${verseCount} ${verseCount === 1 ? 'verse' : 'verses'} · ${groups.map((g) => g.label).join(' · ')}`}
        />

        {waiting ? (
          <View className="bg-accent-soft rounded-card" style={{ padding: space(14), gap: space(10) }}>
            <AppText variant="label" className="font-sans text-ink">
              {`${waiting.mode.label}: next is ${waiting.groups[waiting.at + 1].label} (${waiting.at + 2} of ${waiting.groups.length}).`}
            </AppText>
            <View className="flex-row" style={{ gap: space(8) }}>
              <View className="flex-1">
                <AppButton variant="primary" label="Next passage" onPress={() => open({ ...waiting, at: waiting.at + 1 })} />
              </View>
              <AppButton variant="quiet" label="Stop" onPress={() => setRun(null)} />
            </View>
          </View>
        ) : null}

        {counting.length > 0 ? <GroupedList header="Counts if due">{counting.map(row)}</GroupedList> : null}
        {practiceOnly.length > 0 ? <GroupedList header="Practice">{practiceOnly.map(row)}</GroupedList> : null}
        <AppText variant="caption" className="font-sans text-ink-3">
          Modes under "Counts if due" give credit only for verses due today. Nothing else changes your schedule.
        </AppText>
      </ScrollView>
    </FadeInView>
  );
}
