import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Check } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppButton, AppText, useFontScale, useScaledSpace } from '../components/design';
import { Dialog, EmptyState, GroupedList, ListRow, ScreenHeader } from '../components/blocks';
import { Dropdown } from '../components/Dropdown';
import { useThemeColors } from '../components/theme';
import { STAGE_FILL, StageBar, dayWord } from '../components/VerseStages';
import { textScriptFor, translationLabel } from '../data';
import { isRtl } from '../lib/textScript';
import { QueueItem, ReviewLog, VerseState } from '../types';
import {
  STAGE_LABEL,
  STAGE_ORDER,
  VerseStage,
  arrivalDates,
  referenceFor,
  roadEstimates,
  stageProgress,
} from '../lib/stageProgress';

// ============================================================================
// One verse's page (or a run of neighbours that sit at the same point on the
// road -- one row on My Verses). Where it is on the road, with real dates for
// the stops it has passed and estimates for the ones ahead; how far through
// its current stage it is; and its history from the review log.
//
// One page per verse: learning it in two translations is two independent
// queue items, and the dropdown switches between them.
// ============================================================================

const ROAD: VerseStage[] = ['learning', 'daily', 'weekly', 'monthly', 'complete'];
const NEXT: Partial<Record<VerseStage, VerseStage>> = { learning: 'daily', daily: 'weekly', weekly: 'monthly', monthly: 'complete' };
const DAY_MS = 24 * 60 * 60 * 1000;

const shortDate = (d: Date, now: Date) =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() === now.getFullYear() ? null : { year: 'numeric' }) });
/** Near estimates get a day; far ones only a month, since a few misses move them by weeks. */
const estimateDate = (d: Date, now: Date) =>
  d.getTime() - now.getTime() < 60 * DAY_MS ? shortDate(d, now) : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function VersePageScreen({ state }: { state: AppState }) {
  const {
    versePageRef,
    setVersePageRef,
    memoryQueue,
    handleBack,
    navigateTo,
    startPractice,
    promoteToLearning,
    removeQueueItems,
    triggerToast,
    dailyPhaseWeeks,
    weeklyPhaseMonths,
    monthlyPhaseYears,
    masteryTouches,
  } = state;
  const space = useScaledSpace();
  const scale = useFontScale();
  const palette = useThemeColors();
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const plan = { dailyPhaseWeeks, weeklyPhaseMonths, monthlyPhaseYears, masteryTouches };
  const now = new Date();
  const ref = versePageRef;

  // Every translation this verse (the first of the run) is on your list in.
  const translations = useMemo(() => {
    if (!ref) return [];
    const ids = memoryQueue
      .filter((q) => q.book === ref.book && q.chapter === ref.chapter && q.verseNumber === ref.verses[0])
      .map((q) => q.translationId || 'ESV');
    return Array.from(new Set(ids));
  }, [memoryQueue, ref]);

  const items: QueueItem[] = useMemo(() => {
    if (!ref) return [];
    return memoryQueue
      .filter(
        (q) =>
          q.book === ref.book &&
          q.chapter === ref.chapter &&
          ref.verses.includes(q.verseNumber) &&
          (q.translationId || 'ESV') === ref.translationId
      )
      .sort((a, b) => a.verseNumber - b.verseNumber);
  }, [memoryQueue, ref]);

  const reference = ref ? referenceFor(ref.book, ref.chapter, ref.verses) : '';

  if (!ref || items.length === 0) {
    return (
      <FadeInView style={{ flex: 1 }}>
        <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
          <ScreenHeader title={reference || 'Verse'} onBack={handleBack} backLabel="Back" />
          <EmptyState title="Not on your list" message="This verse isn't on My Verses any more." />
        </ScrollView>
      </FadeInView>
    );
  }

  const first = items[0];
  const progress = stageProgress(first, plan, now);
  const stage = progress.stage;
  const arrivals = arrivalDates(first);
  const estimates = roadEstimates(first, plan, now);
  const currentIdx = ROAD.indexOf(stage); // -1 while waiting
  const next = first.nextReviewDueDate ? new Date(first.nextReviewDueDate) : null;
  const ids = items.map((i) => i.verseId);
  const script = textScriptFor(ref.translationId, ref.book);
  const rtl = isRtl(script);

  const verseStates: VerseState[] = items.map((item) => ({
    book: item.book,
    chapter: item.chapter,
    verse: item.verseNumber,
    text: item.text,
    status: item.status === 'retained' ? 'memorized' : 'learning',
    translationId: item.translationId || 'ESV',
  }));

  // ---- the sentence under the bar ----
  let explainer: string;
  if (stage === 'waiting') explainer = "Not started yet. It starts when it reaches the front of Waiting, or you can start it now.";
  else if (stage === 'complete') explainer = 'Done with scheduled reviews. Practice it any time to keep it fresh.';
  else if (stage === 'learning')
    explainer =
      progress.remaining > 0
        ? `${plural(progress.remaining, 'more perfect recall')}, at least an hour apart, and it moves up to Daily.`
        : 'It moves up to Daily once today’s reviews are done.';
  else if (progress.refresher) {
    const r = progress.refresher;
    explainer = `A missed review put it on a refresher: ${r.via} reviews for ${plural(r.remaining, r.unit)} more. Then it goes back to ${STAGE_LABEL[stage]} right where it was.`;
  } else {
    const to = NEXT[stage];
    explainer =
      progress.movesUpOn && to
        ? `Moves up to ${STAGE_LABEL[to]} ${progress.movesUpOn.getTime() - now.getTime() < 7 * DAY_MS ? '' : 'around '}${dayWord(progress.movesUpOn, now)} if every review goes well.`
        : `${plural(progress.remaining, 'more review')} and it moves up.`;
  }

  // ---- history ----
  const logs: ReviewLog[] = first.reviewLogs || [];
  // The log only goes back to 2026-09-26; the running total covers older verses.
  const passes = Math.max(first.totalSuccessfulReviews || 0, logs.filter((l) => l.result === 'pass').length);
  const misses = logs.filter((l) => l.result === 'miss' || l.result === 'grace').length;
  const startedAt = [arrivals.learning, logs[0] ? new Date(logs[0].at) : null, first.dateStarted ? new Date(first.dateStarted) : null]
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const daysWith = startedAt ? Math.max(1, Math.round((now.getTime() - startedAt.getTime()) / DAY_MS)) : null;

  const story: { at: Date; text: string }[] = [];
  for (const s of STAGE_ORDER) {
    const d = arrivals[s];
    if (!d) continue;
    story.push({ at: d, text: s === 'learning' ? 'Started learning.' : `Moved up to ${STAGE_LABEL[s]}.` });
  }
  for (const l of logs) {
    const at = new Date(l.at);
    if (l.result === 'grace') story.push({ at, text: 'Missed a review. Grace covered it, so nothing was lost.' });
    else if (l.result === 'miss') story.push({ at, text: l.refresher ? 'Missed a refresher review.' : 'Missed a review.' });
    else if (l.result === 'skipped')
      story.push({ at, text: `${l.cycles && l.cycles > 1 ? `${l.cycles} review dates` : 'A review date'} passed without a review${l.forgiven ? ', and was forgiven' : ''}.` });
    else if (l.result === 'placed') story.push({ at, text: `Placed in ${STAGE_LABEL[l.stage === 'retained' ? 'complete' : l.stage]} by hand.` });
  }
  story.sort((a, b) => b.at.getTime() - a.at.getTime());

  // ---- the road across the top ----
  const vertical = scale > 1.15;
  const stopSize = Math.round(22 * Math.min(scale, 1.3));
  const stopDate = (s: VerseStage, i: number) => {
    if (i <= currentIdx) return arrivals[s] ? shortDate(arrivals[s]!, now) : '';
    return estimates[s] ? estimateDate(estimates[s]!, now) : '';
  };
  const stopMarker = (s: VerseStage, i: number) => {
    const passed = i < currentIdx;
    const current = i === currentIdx;
    return (
      <View
        className={`rounded-full items-center justify-center ${passed || current ? STAGE_FILL[s] : 'bg-surface border-2 border-line-strong'} ${current ? 'border-4 border-accent-soft' : ''}`}
        // layout-ok: a stop marker holds only an icon.
        style={{ width: current ? stopSize + 8 : stopSize, height: current ? stopSize + 8 : stopSize }}
      >
        {passed && <Check size={Math.round(12 * scale)} color={palette.onAccent} strokeWidth={3.4} />}
      </View>
    );
  };

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(18) }}>
        <ScreenHeader title={reference} onBack={handleBack} backLabel="Back" />

        {/* One page per verse; the translation is a dropdown like everywhere else. */}
        {translations.length > 1 ? (
          <Dropdown
            value={ref.translationId}
            options={translations.map((id) => ({ id, label: translationLabel(id) }))}
            title="Translation"
            onChange={(id) => setVersePageRef({ ...ref, translationId: id })}
          />
        ) : (
          <AppText variant="label" className="font-sans text-ink-2" style={{ marginTop: -space(10) }}>
            {translationLabel(ref.translationId)}
          </AppText>
        )}

        {/* The verse itself, set the way the chapter page sets it: body size
            serif with relaxed spacing, the verse number in its own column
            (not nested in the text, where it clipped the first line on iOS),
            and Hebrew right to left. */}
        <View className="bg-surface border border-line rounded-card" style={{ paddingVertical: space(14), paddingHorizontal: space(16), gap: space(10) }}>
          {items.map((item) => (
            <View key={item.verseId} className={rtl ? 'flex-row-reverse' : 'flex-row'} style={{ gap: space(10) }}>
              {items.length > 1 && (
                <AppText
                  variant="caption"
                  className="font-sans font-semibold text-ink-3"
                  style={{ minWidth: space(18), paddingTop: space(3), fontVariant: ['tabular-nums'] }}
                >
                  {item.verseNumber}
                </AppText>
              )}
              <AppText variant="body" script={script} className="font-serif leading-relaxed text-ink flex-1">
                {item.text}
              </AppText>
            </View>
          ))}
        </View>

        {/* Where it is on the road */}
        <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(16) }}>
          {vertical ? (
            <View style={{ gap: space(10) }}>
              {ROAD.map((s, i) => (
                <View key={s} className="flex-row items-center" style={{ gap: space(12) }}>
                  <View style={{ width: stopSize + 8, alignItems: 'center' }}>{stopMarker(s, i)}</View>
                  <AppText variant="label" className={`font-sans flex-1 ${i === currentIdx ? 'font-bold text-ink' : 'font-medium text-ink'}`}>
                    {STAGE_LABEL[s]}
                  </AppText>
                  <AppText variant="caption" className="font-sans text-ink-2">
                    {stopDate(s, i)}
                  </AppText>
                </View>
              ))}
            </View>
          ) : (
            <View style={{ position: 'relative' }}>
              {/* The line: colored up to where the verse is, grey after. */}
              <View
                className="bg-line"
                // layout-ok: the road's line.
                style={{ position: 'absolute', left: '10%', right: '10%', top: (stopSize + 8) / 2 - 1.5, height: 3 }}
              />
              {currentIdx > 0 && (
                <View
                  className={STAGE_FILL[stage]}
                  // layout-ok: the part of the road already travelled.
                  style={{ position: 'absolute', left: '10%', width: `${currentIdx * 20}%`, top: (stopSize + 8) / 2 - 1.5, height: 3 }}
                />
              )}
              <View className="flex-row">
                {ROAD.map((s, i) => (
                  <View key={s} className="items-center" style={{ width: '20%', gap: space(5) }}>
                    <View style={{ height: stopSize + 8, justifyContent: 'center' }}>{stopMarker(s, i)}</View>
                    <AppText variant="micro" className={`font-sans text-ink ${i === currentIdx ? 'font-bold' : 'font-semibold'}`} numberOfLines={1}>
                      {STAGE_LABEL[s]}
                    </AppText>
                    <AppText variant="micro" className="font-sans text-ink-2" numberOfLines={1}>
                      {stopDate(s, i) || ' '}
                    </AppText>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View className="bg-surface-2 rounded-btn" style={{ padding: space(14), gap: space(8) }}>
            <View className="flex-row flex-wrap items-baseline justify-between" style={{ gap: space(8) }}>
              <AppText variant="body" className="font-sans font-bold text-ink">
                {stage === 'waiting' ? 'Waiting to start' : stage === 'complete' ? 'Complete' : `${STAGE_LABEL[stage]}, ${progress.position.toLowerCase()}`}
              </AppText>
              {next && stage !== 'learning' && stage !== 'complete' && (
                <AppText variant="caption" className="font-sans text-ink-2">
                  Next review: {dayWord(next, now)}
                </AppText>
              )}
            </View>
            {stage !== 'waiting' && stage !== 'complete' && <StageBar stage={stage} fraction={progress.fraction} faded={!!progress.refresher} thick />}
            <AppText variant="label" className="font-sans text-ink">
              {explainer}
            </AppText>
          </View>

          {Object.keys(estimates).length > 0 && (
            <AppText variant="caption" className="font-sans text-ink-3">
              Dates ahead are estimates, if every review goes well.
            </AppText>
          )}

          <View className="flex-row" style={{ gap: space(8) }}>
            {stage === 'waiting' ? (
              <View className="flex-1">
                <AppButton
                  variant="primary"
                  label="Start learning"
                  onPress={() => {
                    promoteToLearning(ids);
                    triggerToast('Started.');
                  }}
                />
              </View>
            ) : (
              <>
                <View className="flex-1">
                  <AppButton variant="primary" label="Practice" onPress={() => startPractice('learn', verseStates)} />
                </View>
                <View className="flex-1">
                  <AppButton variant="secondary" label="Listen" onPress={() => startPractice('listen', verseStates)} />
                </View>
              </>
            )}
          </View>
        </View>

        {stage !== 'waiting' && (
          <View className="flex-row" style={{ gap: space(8) }}>
            {[
              { n: passes, label: passes === 1 ? 'good review' : 'good reviews' },
              { n: misses, label: misses === 1 ? 'missed' : 'missed' },
              ...(daysWith !== null ? [{ n: daysWith, label: daysWith === 1 ? 'day with it' : 'days with it' }] : []),
            ].map((t) => (
              <View key={t.label} className="flex-1 bg-surface border border-line rounded-card" style={{ padding: space(12), gap: space(2) }}>
                <AppText variant="title" className="font-sans font-bold text-ink">
                  {t.n}
                </AppText>
                <AppText variant="caption" className="font-sans text-ink-2">
                  {t.label}
                </AppText>
              </View>
            ))}
          </View>
        )}

        {story.length > 0 && (
          <GroupedList header="Its story">
            <View style={{ padding: space(14), gap: space(12) }}>
              {story.slice(0, 10).map((e, i) => (
                <View key={i} className="flex-row items-start" style={{ gap: space(12) }}>
                  <AppText variant="label" className="font-sans font-semibold text-ink-2" style={{ minWidth: space(56) }}>
                    {shortDate(e.at, now)}
                  </AppText>
                  <AppText variant="label" className="font-sans text-ink flex-1">
                    {e.text}
                  </AppText>
                </View>
              ))}
            </View>
          </GroupedList>
        )}

        <GroupedList>
          <ListRow
            title={`${ref.book} ${ref.chapter}`}
            value="Open chapter"
            onPress={() => navigateTo('chapterLanding', ref.book, ref.chapter, { keepBack: true })}
          />
        </GroupedList>

        <AppButton variant="destructive" label="Remove from My Verses" onPress={() => setConfirmingRemove(true)} />
      </ScrollView>

      <Dialog
        visible={confirmingRemove}
        onClose={() => setConfirmingRemove(false)}
        title={`Remove ${reference}?`}
        message={
          stage === 'waiting'
            ? 'It comes off your list. You can add it again any time.'
            : 'Its progress and history go with it. Adding it again later starts it from the beginning.'
        }
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setConfirmingRemove(false)} />
            <AppButton
              variant="destructive"
              label="Remove"
              onPress={() => {
                setConfirmingRemove(false);
                removeQueueItems(ids);
                triggerToast(`Removed ${reference}.`);
                handleBack();
              }}
            />
          </>
        }
      />
    </FadeInView>
  );
}
