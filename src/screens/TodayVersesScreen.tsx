import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { BookOpen, Check, ClipboardCheck, Headphones, Layers, Sprout } from 'lucide-react-native';

import { FadeInView } from '../components/ui';
import { Dropdown } from '../components/Dropdown';
import { AppButton, AppText, useFontScale, useScaledSpace } from '../components/design';
import { Dialog, GroupedList, ListRow, ScreenHeader } from '../components/blocks';
import { useThemeColors } from '../components/theme';
import { lateNoteFor } from '../lib/todayCards';
import ManualLogFlow from '../components/practice/ManualLogFlow';
import { logManualAnswers } from '../components/practice/ManualLogSheet';
import type { SelfCheckAnswer } from '../lib/grading';
import { REVIEW_STAGES, groupTouches, toVerseStates, useToday, type TodayGroup } from '../state/useToday';
import { useAppFields } from '../state/appStore';

// ============================================================================
// Today's verses (UI simplify plan, Job 1): the whole of today as one list,
// opened from Today's "Today's verses" row. Review (done ones ticked), Learning,
// and Coming up (listen only). Rows carry no buttons: tapping one opens a
// small centered pop-up with what you can do with that passage.
// ============================================================================

const LOOKAHEAD_OPTIONS = [10, 20, 30, 40, 50].map((n) => ({ id: n, label: String(n) }));

type Kind = 'review' | 'learning' | 'comingUp' | 'done';

function StageDot({ className }: { className: string }) {
  const scale = useFontScale();
  const d = Math.round(9 * scale);
  // layout-ok: a dot, no text.
  return <View className={`rounded-full ${className}`} style={{ width: d, height: d }} />;
}

export default function TodayVersesScreen() {
  const state = useAppFields(
    'getTodayPullPreview', 'handleUpdateVerseStatus', 'lateNotes', 'masteryTouches', 'memoryQueue',
    'navigateTo', 'primingLookahead', 'setPrimingLookahead',
  );
  const { navigateTo, masteryTouches, primingLookahead, setPrimingLookahead, lateNotes, memoryQueue, handleUpdateVerseStatus } = state;
  const today = useToday();
  const space = useScaledSpace();
  const scale = useFontScale();
  const palette = useThemeColors();

  const [open, setOpen] = useState<{ group: TodayGroup; kind: Kind } | null>(null);
  const [logGroup, setLogGroup] = useState<TodayGroup | null>(null);

  const pullPreview = state.getTodayPullPreview();
  const startsToday = new Set(Object.values(pullPreview.fromPlans).flat());

  const reviewRows = [
    ...today.doneTodayGroups.map((g) => ({ group: g, kind: 'done' as const, stage: null })),
    ...REVIEW_STAGES.flatMap((stage) => today.reviewGroupsByStage[stage.key].map((g) => ({ group: g, kind: 'review' as const, stage }))),
  ];
  const passageCount = reviewRows.length + today.learningGroups.length + today.comingUpGroups.length;

  const logVerses = useMemo(() => (logGroup ? toVerseStates(logGroup.items) : []), [logGroup]);
  const submitLog = (answers: SelfCheckAnswer[], canMoveUp: boolean) => {
    const verses = logVerses;
    setLogGroup(null);
    if (verses.length) logManualAnswers(verses, answers, handleUpdateVerseStatus, canMoveUp);
  };

  const close = () => setOpen(null);
  const act = (fn: () => void) => () => {
    close();
    fn();
  };

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader
          title="Today's verses"
          onBack={() => navigateTo('home')}
          backLabel="Today"
          subtitle={`${passageCount} ${passageCount === 1 ? 'passage' : 'passages'} · about ${today.estMinutes} min`}
        />

        <AppButton variant="quiet" size="lg" Icon={Headphones} label="Listen to today's scripture" onPress={today.listenToToday} />

        {reviewRows.length > 0 ? (
          <GroupedList
            header={`Review · ${today.doneTodayItems.length} of ${today.doneTodayItems.length + today.dueReviewItems.length} verses done`}
          >
            {reviewRows.map(({ group, kind, stage }) =>
              kind === 'done' ? (
                <ListRow
                  key={`done-${group.label}`}
                  leading={<Check size={Math.round(20 * scale)} color={palette.success} strokeWidth={2.6} />}
                  title={group.label}
                  subtitle="Done today"
                  onPress={() => setOpen({ group, kind })}
                  accessory="none"
                />
              ) : (
                <ListRow
                  key={group.label}
                  leading={<StageDot className={stage!.dot} />}
                  title={group.label}
                  subtitle={lateNoteFor(group.items, lateNotes) ?? undefined}
                  value={stage!.label}
                  onPress={() => setOpen({ group, kind })}
                />
              )
            )}
          </GroupedList>
        ) : null}

        {today.learningGroups.length > 0 ? (
          <GroupedList header="Learning">
            {today.learningGroups.map((group) => {
              const t = groupTouches(group, masteryTouches);
              return (
                <ListRow
                  key={group.label}
                  leading={<StageDot className="bg-stage-learning" />}
                  title={group.label}
                  value={`${t.done} of ${t.needed}`}
                  onPress={() => setOpen({ group, kind: 'learning' })}
                />
              );
            })}
          </GroupedList>
        ) : null}

        {today.comingUpGroups.length > 0 ? (
          <View style={{ gap: space(6) }}>
            <GroupedList header="Coming up · listen only">
              {today.comingUpGroups.map((group) => (
                <ListRow
                  key={group.label}
                  leading={<Headphones size={Math.round(20 * scale)} color={palette.accent} strokeWidth={2} />}
                  title={group.label}
                  value={group.items.some((it) => startsToday.has(it.verseId)) ? 'Starts today' : undefined}
                  onPress={() => setOpen({ group, kind: 'comingUp' })}
                />
              ))}
            </GroupedList>
            <View className="flex-row items-center justify-end" style={{ gap: space(8), paddingHorizontal: space(4) }}>
              <AppText variant="caption" className="font-sans text-ink-3">
                Show up to
              </AppText>
              <Dropdown options={LOOKAHEAD_OPTIONS} value={primingLookahead} onChange={setPrimingLookahead} title="How many to show" compact />
            </View>
          </View>
        ) : null}

        {passageCount === 0 ? (
          <AppText variant="label" className="font-sans text-ink-3 text-center">
            Nothing on today yet.
          </AppText>
        ) : null}
      </ScrollView>

      {/* What you can do with one passage: centered, never a bottom sheet. */}
      <Dialog visible={!!open} onClose={close} title={open?.group.label}>
        {open ? (
          <View style={{ gap: space(8) }}>
            {open.kind === 'review' ? (
              <AppButton variant="primary" Icon={Layers} label="Review" onPress={act(() => today.practiceGroup('learn', open.group.items))} />
            ) : null}
            {open.kind === 'learning' ? (
              <AppButton variant="primary" Icon={Sprout} label="Learn" onPress={act(() => today.practiceGroup('learn', open.group.items))} />
            ) : null}
            <AppButton variant="secondary" Icon={Headphones} label="Listen" onPress={act(() => today.practiceGroup('listen', open.group.items))} />
            {open.kind === 'review' ? (
              <AppButton variant="quiet" Icon={ClipboardCheck} label="I reviewed it elsewhere" onPress={act(() => setLogGroup(open.group))} />
            ) : null}
            <AppButton
              variant="quiet"
              Icon={BookOpen}
              label="Open chapter"
              onPress={act(() => navigateTo('chapterLanding', open.group.book, open.group.chapter))}
            />
          </View>
        ) : null}
      </Dialog>

      <ManualLogFlow
        visible={!!logGroup}
        title={logGroup ? `Log ${logGroup.label}` : undefined}
        verses={logVerses}
        memoryQueue={memoryQueue}
        selfCheckedLast={!!logGroup?.items.some((i) => i.lastSelfChecked)}
        onClose={() => setLogGroup(null)}
        onLog={submitLog}
      />
    </FadeInView>
  );
}
