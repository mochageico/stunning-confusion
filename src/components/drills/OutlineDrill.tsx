import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Check, ListTree, Mic, RotateCcw, X } from 'lucide-react-native';

import type { ChapterSections } from '../../types';
import {
  bumpExtra,
  cleanExtra,
  DEFAULT_OUTLINE_WORDS,
  gradeOutlineVerse,
  groupBySection,
  OUTLINE_MAX_WORDS,
  OutlineDirection,
  OutlineExtra,
  outlineRow,
  OutlineRow,
  OutlineRun,
  OutlineVerse,
  OutlineVerseResult,
  orderVerses,
  recordRunResult,
  runCurrent,
  runDone,
  shownIndices,
  startRun,
} from '../../lib/outline';
import { memoryAidOf, normalizeDraft, phraseLetters, sectionsFromStarts } from '../../lib/sections';
import { FORMATS, MIX_NAMES } from '../../lib/formatNames';
import type { WordOutcome } from '../../lib/recitation';
import { isRtl } from '../../lib/textScript';
import { AppButton, AppIconButton, AppText, Switch, useScaledSpace } from '../design';
import { SegmentedControl } from '../blocks';
import { DiscreteSlider } from '../ui';
import { useThemeColors } from '../theme';
import GradedRecitation, { canSpeakVerses, RecitationMode } from '../GradedRecitation';
import { BracketGutter, SectionHeaderRow, useGutterWidth } from '../ChapterSections';
import { DrillSetting, DrillSettings } from '../practice/shared';

// ============================================================================
// FIRST WORDS (OUTLINE) -- MIXED_REVIEW_PLAN.md, stage 2
// ----------------------------------------------------------------------------
// A row per verse: its number, its first few words, and a faint line standing
// for the rest. Say the verse from those words and it counts as a review, since
// everything after them comes out of memory. The row's mic says one verse;
// "Run it" walks every row in the order listed, first to last or last to
// first, one verse at a time.
//
// This component only grades. What a graded verse earns (a review, a log
// entry) is the host's call, through `onVerseGraded`; Recall's panel credits a
// verse that is on a review schedule and due.
//
// The words shown are one number for every verse (the slider, 0-4) plus taps:
// a tap on a verse opens one more word there and wraps. Taps are saved on the
// chapter's sections doc, so the outline looks the same tomorrow.
// ============================================================================

const WORD_STOPS = Array.from({ length: OUTLINE_MAX_WORDS + 1 }, (_, n) => ({ id: n, label: String(n) }));

const verseKeyOf = (v: OutlineVerse) => `${v.book}|${v.chapter}`;

export default React.memo(function OutlineDrill({
  verses,
  sections,
  onSaveExtra,
  onVerseGraded,
}: {
  verses: OutlineVerse[];
  /** The chapter's saved sections doc, if any. Only used when every verse is from one chapter. */
  sections?: ChapterSections | null;
  /** Saves the per-verse taps for the chapter. */
  onSaveExtra?: (book: string, chapter: number, extra: OutlineExtra) => void;
  /** Fires when a recited verse has been graded and its result confirmed. */
  onVerseGraded?: (result: OutlineVerseResult) => void;
}) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const gutter = useGutterWidth(false);

  // One chapter's worth of verses is the normal case (a chapter-page
  // selection, a Home group). Sections and saved taps only apply then.
  const first = verses[0];
  const oneChapter = !!first && verses.every((v) => verseKeyOf(v) === verseKeyOf(first));
  const chapterSections = oneChapter ? sections ?? null : null;

  const [words, setWords] = useState(DEFAULT_OUTLINE_WORDS);
  const [direction, setDirection] = useState<OutlineDirection>('forward');
  const [showLabels, setShowLabels] = useState(true);
  const [showPhrase, setShowPhrase] = useState(true);
  const [extra, setExtra] = useState<OutlineExtra>(() => cleanExtra(chapterSections?.outlineExtra));
  // How a verse is answered. Speech where this device can grade it, else typing.
  const speakable = first ? canSpeakVerses([first]) : false;
  const [mode, setMode] = useState<RecitationMode>(speakable ? 'speak' : 'type');

  // A new passage (a chained review swaps `verses` in place) starts from that
  // chapter's saved taps and a clean slate.
  const passageKey = first ? `${first.translationId || ''}|${verseKeyOf(first)}|${verses.length}` : '';
  useEffect(() => {
    setExtra(cleanExtra(chapterSections?.outlineExtra));
    setRun(null);
    setResults({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passageKey]);

  const listed = useMemo(() => orderVerses(verses, direction), [verses, direction]);
  const rows = useMemo(() => listed.map((v) => outlineRow(v, words, extra[v.verse])), [listed, words, extra]);
  const rowByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const tapped = Object.keys(extra).length;

  // ---- Sections -------------------------------------------------------------
  const lastVerse = verses.reduce((m, v) => Math.max(m, v.verse), 0);
  const draft = useMemo(
    () => (chapterSections && first ? normalizeDraft(chapterSections, 1, Math.max(lastVerse, 1)) : null),
    [chapterSections, first, lastVerse]
  );
  const hasSections = !!draft && draft.starts.length > 1;
  const sectionList = useMemo(() => (hasSections && draft ? sectionsFromStarts(draft, lastVerse) : []), [hasSections, draft, lastVerse]);
  const groups = useMemo(() => groupBySection(rows, hasSections && draft ? draft.starts : null), [rows, hasSections, draft]);
  // The chapter's memory phrase: a word per section on the dividers, or a
  // word per verse above each verse. Off shows neither, and so no switch.
  const memoryAid = memoryAidOf(draft);
  const verseWords = memoryAid === 'verses' ? draft?.verseWords ?? {} : {};
  const hasPhrase =
    memoryAid === 'sections' ? hasSections : memoryAid === 'verses' ? verses.some((v) => verseWords[v.verse]?.trim()) : false;

  // ---- Saving taps ----------------------------------------------------------
  const saveExtra = (next: OutlineExtra) => {
    const clean = cleanExtra(next);
    setExtra(clean);
    if (oneChapter && first) onSaveExtra?.(first.book, first.chapter, clean);
  };
  const tapVerse = (row: OutlineRow) => {
    const n = bumpExtra(words, extra[row.verse.verse] ?? 0);
    saveExtra({ ...extra, [row.verse.verse]: n });
  };

  // ---- A run ----------------------------------------------------------------
  const [run, setRun] = useState<OutlineRun | null>(null);
  // Graded verses since the last "Run it", for the marks beside the rows.
  const [results, setResults] = useState<Record<string, OutlineVerseResult>>({});
  const [finishedRun, setFinishedRun] = useState(false);

  const beginRun = (queue: OutlineRow[], whole: boolean) => {
    if (queue.length === 0) return;
    if (!speakable) setMode('type');
    setRun(startRun(queue));
    setFinishedRun(false);
    if (whole) setResults({});
  };

  const stopRun = () => setRun(null);

  const currentRow = run ? rowByKey.get(runCurrent(run) ?? '') ?? null : null;

  const finishVerse = (row: OutlineRow, perVerse: WordOutcome[][], m: RecitationMode) => {
    if (!run) return;
    const result = gradeOutlineVerse(row, perVerse[0] ?? [], m);
    const next = recordRunResult(run, result);
    setResults((prev) => ({ ...prev, [result.key]: result }));
    onVerseGraded?.(result);
    if (runDone(next)) {
      setRun(null);
      setFinishedRun(run.queue.length > 1);
    } else {
      setRun(next);
    }
  };

  // ---------------------------------------------------------------------------
  // Reciting one verse
  // ---------------------------------------------------------------------------
  if (run && currentRow) {
    const position = run.index + 1;
    return (
      <View className="flex-1">
        <GradedRecitation
          key={`${currentRow.key}:${mode}`}
          verses={[currentRow.verse]}
          startVerse={0}
          startWord={0}
          endVerse={0}
          mode={mode}
          shownWords={shownIndices(currentRow)}
          continueLabel={position < run.queue.length ? 'Next verse' : 'Finish'}
          onSwitchMode={setMode}
          onCancel={stopRun}
          onResult={(perVerse, m) => finishVerse(currentRow, perVerse, m)}
          header={
            <View className="flex-row items-center justify-between" style={{ gap: space(8) }}>
              <AppText variant="caption" className="font-sans font-medium text-ink-3 flex-1">
                {run.queue.length > 1 ? `Verse ${currentRow.verse.verse} · ${position} of ${run.queue.length}` : `Verse ${currentRow.verse.verse}`}
              </AppText>
              <AppButton size="sm" variant="quiet" label="Stop" onPress={stopRun} />
            </View>
          }
        />
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // The outline
  // ---------------------------------------------------------------------------
  const passedCount = Object.values(results).filter((r) => r.passed).length;
  const resultCount = Object.keys(results).length;

  const renderRow = (row: OutlineRow, groupIndex: number, last: boolean) => {
    const rtl = isRtl(row.script);
    const result = results[row.key];
    return (
      <View key={row.key} className={rtl ? 'flex-row-reverse' : 'flex-row'}>
        <BracketGutter index={groupIndex} width={hasSections ? gutter : 0} bottom={last} rtl={rtl} />
        <View
          className={`flex-1 items-start ${rtl ? 'flex-row-reverse' : 'flex-row'}`}
          style={{ gap: space(8), paddingVertical: space(8), paddingRight: space(4) }}
        >
          <View style={{ minWidth: space(24), paddingTop: space(2) }}>
            <AppText variant="caption" className="font-sans font-bold text-ink-3">
              {row.verse.verse}
            </AppText>
            {row.extra > 0 && (
              <AppText variant="micro" className="font-sans font-semibold text-accent">
                +{row.extra}
              </AppText>
            )}
          </View>
          <Pressable
            onPress={() => tapVerse(row)}
            accessibilityRole="button"
            accessibilityLabel={`Verse ${row.verse.verse}, ${row.shownCount} ${row.shownCount === 1 ? 'word' : 'words'} shown`}
            accessibilityHint="Shows one more word. After four it goes back."
            className="flex-1 active:opacity-60"
            style={{ gap: space(6), minWidth: 0 }}
          >
            {showPhrase && verseWords[row.verse.verse]?.trim() ? (
              <AppText variant="caption" className="font-sans font-semibold text-accent">
                {verseWords[row.verse.verse].trim()}
              </AppText>
            ) : null}
            {row.shown !== '' && (
              <AppText variant="body" script={row.script} className="font-serif text-ink">
                {row.shown}
              </AppText>
            )}
            {row.restShare > 0 && (
              // layout-ok: a faint line standing for the hidden words, not a box holding text.
              <View
                className="bg-fill"
                style={{ height: space(6), borderRadius: space(3), width: `${Math.round(30 + row.restShare * 70)}%`, alignSelf: rtl ? 'flex-end' : 'flex-start' }}
              />
            )}
          </Pressable>
          <View className="flex-row items-center" style={{ gap: space(4) }}>
            {result && (result.passed ? <Check size={Math.round(space(16))} color={palette.success} /> : <X size={Math.round(space(16))} color={palette.danger} />)}
            <AppIconButton
              Icon={Mic}
              variant="outline"
              diameter={32}
              onPress={() => beginRun([row], false)}
              accessibilityLabel={`Say verse ${row.verse.verse}`}
            />
          </View>
        </View>
      </View>
    );
  };

  return (
    <View className="flex-1 justify-between">
      <ScrollView className="flex-1" contentContainerStyle={{ gap: space(10), paddingBottom: space(8) }}>
        <View className="flex-row items-center" style={{ gap: space(6) }}>
          <ListTree size={Math.round(space(14))} color={palette.ink3} />
          <AppText variant="caption" className="text-ink-3 font-sans flex-1">
            Say each verse from its first words. Tap a verse to see one more word.
          </AppText>
        </View>

        <DrillSettings>
          <DrillSetting storageKey="outline.words" first label="Words shown" value={String(words)}>
            <View style={{ gap: 2 }}>
              <DiscreteSlider value={words} onChange={setWords} options={WORD_STOPS} accessibilityLabel="Words shown" />
            </View>
            <AppText variant="caption" className="text-ink-3 font-sans">
              The same for every verse. Tapping a verse adds a word to that verse alone.
            </AppText>
          </DrillSetting>
          <DrillSetting storageKey="outline.order" label="Order" value={direction === 'forward' ? MIX_NAMES.firstToLast : MIX_NAMES.lastToFirst}>
            <SegmentedControl
              value={direction}
              onChange={setDirection}
              accessibilityLabel="Order of the verses"
              options={[
                { id: 'forward' as const, label: MIX_NAMES.firstToLast },
                { id: 'reverse' as const, label: MIX_NAMES.lastToFirst },
              ]}
            />
            <AppText variant="caption" className="text-ink-3 font-sans">
              The list and Run it both follow it. Each verse is still said forward.
            </AppText>
          </DrillSetting>
          {speakable && (
            <DrillSetting storageKey="outline.answer" label="Answer by" value={mode === 'speak' ? 'Saying it' : 'Typing first letters'}>
              <SegmentedControl
                value={mode}
                onChange={setMode}
                accessibilityLabel="How to answer"
                options={[
                  { id: 'speak' as const, label: 'Say it' },
                  { id: 'type' as const, label: 'Type it' },
                ]}
              />
            </DrillSetting>
          )}
          {hasSections && <SwitchRow label="Section labels" value={showLabels} onChange={setShowLabels} />}
          {hasPhrase && <SwitchRow label="Memory phrase" value={showPhrase} onChange={setShowPhrase} />}
        </DrillSettings>

        {finishedRun && resultCount > 0 && (
          <View className="bg-surface-2 border border-line rounded-card" style={{ padding: space(12), gap: space(2) }}>
            <AppText variant="label" className="font-sans font-bold text-ink">
              {passedCount} of {resultCount} {resultCount === 1 ? 'verse' : 'verses'} right
            </AppText>
            <AppText variant="caption" className="font-sans text-ink-3">
              Marked below. Verses that were due count as reviewed.
            </AppText>
          </View>
        )}

        <View className="bg-surface border border-line rounded-card" style={{ paddingHorizontal: space(4), paddingVertical: space(4) }}>
          {groups.map((group, gi) => {
            const section = group.sectionIndex >= 0 ? sectionList[group.sectionIndex] : undefined;
            const opening = section ? verses.find((v) => v.verse === section.start) : undefined;
            const letter = section && opening ? phraseLetters([section], [opening], rows[0]?.script)[0] : '';
            return (
              <View key={`${group.sectionIndex}:${gi}`}>
                {section && (
                  <SectionHeaderRow
                    section={{
                      ...section,
                      label: showLabels ? section.label : undefined,
                      phraseWord: showPhrase ? section.phraseWord : undefined,
                    }}
                    letter={showPhrase ? letter : ''}
                    showWord={memoryAid === 'sections'}
                    script={rows[0]?.script ?? 'latin'}
                    rtl={isRtl(rows[0]?.script ?? 'latin')}
                    editing={false}
                    gutter={gutter}
                    first={gi === 0}
                  />
                )}
                {group.rows.map((row, ri) => renderRow(row, Math.max(group.sectionIndex, 0), ri === group.rows.length - 1))}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View className="shrink-0 flex-row flex-wrap" style={{ gap: space(8), paddingTop: space(8) }}>
        <View style={{ flexGrow: 1, flexBasis: space(110) }}>
          <AppButton
            variant="quiet"
            Icon={RotateCcw}
            label="Reset taps"
            onPress={() => saveExtra({})}
            disabled={tapped === 0}
          />
        </View>
        <View style={{ flexGrow: 1, flexBasis: space(110) }}>
          <AppButton variant="primary" Icon={Mic} label="Run it" onPress={() => beginRun(rows, true)} accessibilityLabel={`${FORMATS.firstWords.label}: run it, ${direction === 'forward' ? 'first to last' : 'last to first'}`} />
        </View>
      </View>
    </View>
  );
});

/** A settings row with a switch, in the same card as the folding rows. */
function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (next: boolean) => void }) {
  const space = useScaledSpace();
  return (
    <View
      className="flex-row items-center justify-between border-t border-hairline"
      style={{ paddingHorizontal: space(12), paddingVertical: space(10), gap: space(8) }}
    >
      <AppText variant="label" className="font-sans font-medium text-ink shrink">
        {label}
      </AppText>
      <Switch value={value} onChange={onChange} accessibilityLabel={label} />
    </View>
  );
}
