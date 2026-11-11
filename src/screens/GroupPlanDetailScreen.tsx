import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { LogOut, Trash2 } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, NumericInput, ProgressBar, StepperRow } from '../components/ui';
import { BookPicker } from '../components/BookPicker';
import { ALL_BIBLE_BOOKS, DEFAULT_TRANSLATION_ID, getBookByName } from '../data';
import { useChapterText } from '../state/useScripture';
import { GroupPlanMembership } from '../types';
import { AppButton, AppText, AppTextInput, ChoiceCard, useScaledSpace } from '../components/design';
import { CollapsibleSection, Dialog, EmptyState, GroupedList, ListRow, ScreenHeader, SectionHeader } from '../components/blocks';
import { groupPlanProgress, upcomingPlanDays } from '../lib/groupPlanProgress';
import { DAY_FULL_NAMES, getLogicalDate } from '../lib/logicalDate';

// Plain language, and ordered by how most people actually want it: joining a
// group thing usually means you want the group's verses to lead. The old
// labels ("Individual First"/"Plan First"/"Additive") described the
// scheduler's internals rather than the choice being made.
const PRIORITY_OPTIONS: { id: GroupPlanMembership['priority']; label: string; description: string }[] = [
  { id: 'group', label: 'Counts toward my daily pace', description: "This plan's verses come out of your daily new-verse pace. Your own verses fill whatever is left." },
  { id: 'additive', label: 'On top of my daily pace', description: "This plan's verses are added to your daily pace, even past your limits." },
];
// Older memberships may still hold the retired 'individual' choice, which
// behaved like 'group' once a plan's own weekly pace was met.
const asChoice = (p: GroupPlanMembership['priority']): GroupPlanMembership['priority'] => (p === 'individual' ? 'group' : p);

const WEEK_ORDER = ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'];
const DAY_LETTER: Record<string, string> = { M: 'M', T: 'T', W: 'W', Th: 'T', F: 'F', S: 'S', Su: 'S' };

// Seven day chips, Monday first. With onToggle they edit; without they just show.
function DayChips({ days, onToggle }: { days: string[]; onToggle?: (day: string) => void }) {
  const space = useScaledSpace();
  return (
    <View className="flex-row" style={{ gap: space(6) }}>
      {WEEK_ORDER.map((d) => {
        const on = days.includes(d);
        return (
          <Pressable
            key={d}
            disabled={!onToggle}
            onPress={() => onToggle?.(d)}
            accessibilityRole={onToggle ? 'checkbox' : 'text'}
            accessibilityState={{ checked: on }}
            accessibilityLabel={(DAY_FULL_NAMES[d] ?? d).replace(/s$/, '')}
            className={`flex-1 items-center justify-center rounded-btn border ${on ? 'bg-accent-soft border-accent' : 'bg-surface border-line'}`}
            style={{ minHeight: space(40) }}
          >
            <AppText variant="label" className={`font-sans font-semibold ${on ? 'text-accent' : 'text-ink-3'}`}>
              {DAY_LETTER[d]}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

// What a brand-new member gets. Previously the Join button hardcoded
// 'individual', which meant the plan only ever got leftover capacity -- so
// anyone with a full personal queue joined a group plan and saw nothing
// happen at all.
const DEFAULT_JOIN_PRIORITY: GroupPlanMembership['priority'] = 'group';

interface VerseIdGroup {
  key: string;
  book: string;
  chapter: number;
  verses: number[];
}

// Groups a GroupPlan's flat verseId list ("ROM_8_1") into consecutive
// book/chapter runs for display -- same array-adjacency grouping convention
// as groupQueueItems (ActivePlanScreen/HomeScreen), just working off plain
// verseId strings instead of full QueueItem objects, since a plan's queue
// is a manager-curated string list, not the viewer's own queue items.
function groupVerseIds(verseIds: string[]): VerseIdGroup[] {
  const groups: VerseIdGroup[] = [];
  verseIds.forEach((id) => {
    const [bookId, chapterStr, verseStr] = id.split('_');
    const book = ALL_BIBLE_BOOKS.find((b) => b.id === bookId)?.name || bookId;
    const chapter = parseInt(chapterStr, 10);
    const verse = parseInt(verseStr, 10);
    const last = groups[groups.length - 1];
    if (last && last.book === book && last.chapter === chapter && verse === last.verses[last.verses.length - 1] + 1) {
      last.verses.push(verse);
    } else {
      groups.push({ key: id, book, chapter, verses: [verse] });
    }
  });
  return groups;
}


export default function GroupPlanDetailScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const {
    user,
    viewingGroupPlan,
    handleBack,
    updateGroupPlan,
    deleteGroupPlan,
    addVersesToGroupPlan,
    joinedGroupPlanMemberships,
    joinGroupPlan,
    leaveGroupPlan,
    setGroupPlanPriority,
    memoryQueue,
    triggerToast,
  } = state;

  const [isEditing, setIsEditing] = useState(false);
  // Edit mode works on a copy and applies it on Save, so a half-typed name or
  // a stepper tap is never written to the plan for everyone.
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftDays, setDraftDays] = useState<string[]>(['M', 'W', 'F']);
  const [draftPerDay, setDraftPerDay] = useState(1);
  const [showAddVerses, setShowAddVerses] = useState(false);
  const [addBook, setAddBook] = useState('Romans');
  const [addChapter, setAddChapter] = useState('1');
  const [addStartVerse, setAddStartVerse] = useState('1');
  const [addEndVerse, setAddEndVerse] = useState('1');
  const [joinPriority, setJoinPriority] = useState<GroupPlanMembership['priority']>(DEFAULT_JOIN_PRIORITY);
  const [choosingPriority, setChoosingPriority] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Real verse count for the "of N" hint next to To verse.
  const addChapterId = getBookByName(addBook)?.id || null;
  const addChapterNum = parseInt(addChapter, 10);
  const { data: addChapterData } = useChapterText(
    DEFAULT_TRANSLATION_ID,
    addChapterId,
    Number.isNaN(addChapterNum) ? null : addChapterNum
  );

  if (!viewingGroupPlan) return null;
  const plan = viewingGroupPlan;

  const isManager = !!user && plan.managerId === user.uid;
  const membership = joinedGroupPlanMemberships.find((m) => m.planId === plan.planId);
  const progress = groupPlanProgress(memoryQueue, plan);
  const weeksLeft = Math.max(1, Math.ceil(plan.verseIds.length / Math.max(1, plan.versesPerWeek)));
  const priorityLabel = PRIORITY_OPTIONS.find((o) => o.id === asChoice(membership?.priority ?? joinPriority))?.label ?? '';
  const scheduled = !!plan.days && plan.days.length > 0;
  const upcoming = scheduled && membership ? upcomingPlanDays(memoryQueue, plan, getLogicalDate(state.dayStartHour), membership.joinedAt) : [];
  const draftWeekly = draftDays.length * draftPerDay;
  const draftWeeks = Math.max(1, Math.ceil(plan.verseIds.length / Math.max(1, draftWeekly)));
  const draftDayNames = WEEK_ORDER.filter((d) => draftDays.includes(d)).map((d) => (DAY_FULL_NAMES[d] ?? d).replace(/s$/, '').slice(0, 3)).join(', ');

  const startEditing = () => {
    setDraftName(plan.name);
    setDraftDesc(plan.description || '');
    // An older plan has no schedule yet; start it from its weekly pace on Mon, Wed, Fri.
    setDraftDays(plan.days && plan.days.length > 0 ? plan.days : ['M', 'W', 'F']);
    setDraftPerDay(plan.versesPerDay ?? Math.max(1, Math.ceil(plan.versesPerWeek / 3)));
    setShowAddVerses(false);
    setIsEditing(true);
  };

  const saveEdits = () => {
    const name = draftName.trim();
    if (!name) {
      triggerToast('A plan needs a name.');
      return;
    }
    if (draftDays.length === 0) {
      triggerToast('Pick at least one day to start the plan.');
      return;
    }
    const fields: { name?: string; description?: string; versesPerWeek?: number; days?: string[]; versesPerDay?: number } = {};
    if (name !== plan.name) fields.name = name;
    if (draftDesc.trim() !== (plan.description || '')) fields.description = draftDesc.trim();
    const orderedDays = WEEK_ORDER.filter((d) => draftDays.includes(d));
    const sameDays = plan.days && plan.days.length === orderedDays.length && orderedDays.every((d) => plan.days!.includes(d));
    if (!sameDays || draftPerDay !== plan.versesPerDay) {
      fields.days = orderedDays;
      fields.versesPerDay = draftPerDay;
      fields.versesPerWeek = orderedDays.length * draftPerDay;
    }
    if (Object.keys(fields).length > 0) {
      updateGroupPlan(plan.circleId, plan.planId, fields);
      triggerToast('Plan updated.');
    }
    setShowAddVerses(false);
    setIsEditing(false);
  };

  const handleAddVerses = async () => {
    const chapter = parseInt(addChapter, 10);
    const startVerse = parseInt(addStartVerse, 10);
    const endVerse = parseInt(addEndVerse, 10);
    if (!addBook || Number.isNaN(chapter) || Number.isNaN(startVerse) || Number.isNaN(endVerse)) {
      triggerToast('Fill in a book, a chapter and a range of verses.');
      return;
    }
    await addVersesToGroupPlan(plan.circleId, plan.planId, addBook, chapter, startVerse, endVerse);
    setShowAddVerses(false);
  };

  const fieldLabel = (text: string, extra?: string) => (
    <View className="flex-row items-center justify-between">
      <AppText variant="caption" className="font-sans font-medium text-ink-2">
        {text}
      </AppText>
      {extra ? (
        <AppText variant="caption" className="font-sans text-ink-3">
          {extra}
        </AppText>
      ) : null}
    </View>
  );
  const inputBox = 'bg-surface border border-line rounded-btn text-ink font-sans';
  const inputStyle = { paddingHorizontal: space(12), paddingVertical: space(10) };
  // Three number fields share a row and wrap when the text is big.
  const numberBasis = { flexGrow: 1, flexBasis: space(96), gap: space(4) };
  const numberInput = 'bg-surface border border-line rounded-btn text-ink font-sans text-center';
  const numberStyle = { paddingHorizontal: space(8), paddingVertical: space(10) };

  const priorityCards = (selectedId: GroupPlanMembership['priority'], onPick: (id: GroupPlanMembership['priority']) => void) => (
    <View style={{ gap: space(8) }}>
      {PRIORITY_OPTIONS.map((opt) => (
        <ChoiceCard
          key={opt.id}
          title={opt.label}
          description={opt.description}
          selected={opt.id === selectedId}
          onPress={() => onPick(opt.id)}
        />
      ))}
    </View>
  );

  const verseList = (
    <>
      {plan.verseIds.length === 0 ? (
        <View className="bg-surface border border-line rounded-card">
          <EmptyState
            title="No verses yet"
            message={isManager ? 'Add a small range to start, a few verses at a time rather than a whole book.' : "The leader hasn't added any yet."}
          />
        </View>
      ) : (
        <GroupedList>
          {groupVerseIds(plan.verseIds).map((g) => (
            <ListRow
              key={g.key}
              title={`${g.book} ${g.chapter}:${g.verses.length > 1 ? `${g.verses[0]}-${g.verses[g.verses.length - 1]}` : g.verses[0]}`}
              value={g.verses.length > 1 ? `${g.verses.length} verses` : undefined}
            />
          ))}
        </GroupedList>
      )}
    </>
  );

  // One square per verse of this week's pace: learned, started, or still to come.
  const weekSquares = Array.from({ length: Math.min(plan.versesPerWeek, 20) }, (_, i) =>
    i < progress.learnedThisWeek ? 'learned' : i < progress.pulledThisWeek ? 'started' : 'todo'
  );
  const squareSize = space(18);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader
          title={isEditing ? 'Edit plan' : plan.name}
          eyebrow="Group plan"
          subtitle={
            isEditing
              ? undefined
              : `${plan.versesPerWeek} verses a week · led by ${plan.managerName || 'the leader'}${plan.description ? `\n${plan.description}` : ''}`
          }
          onBack={handleBack}
          backLabel="Circle"
          actions={
            isManager && !isEditing ? <AppButton size="sm" variant="secondary" label="Edit" onPress={startEditing} /> : undefined
          }
        />

        {isEditing ? (
          <>
            <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(12) }}>
              <View style={{ gap: space(4) }}>
                {fieldLabel('Plan name')}
                <AppTextInput
                  value={draftName}
                  onChangeText={setDraftName}
                  accessibilityLabel="Plan name"
                  variant="body"
                  className={inputBox}
                  style={inputStyle}
                />
              </View>
              <View style={{ gap: space(4) }}>
                {fieldLabel('Description')}
                <AppTextInput
                  value={draftDesc}
                  onChangeText={setDraftDesc}
                  accessibilityLabel="Plan description"
                  multiline
                  numberOfLines={2}
                  textAlignVertical="top"
                  variant="body"
                  className={inputBox}
                  style={{ ...inputStyle, minHeight: space(72) }}
                />
              </View>
            </View>

            <View style={{ gap: space(6) }}>
              <SectionHeader title="Schedule" />
              <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(12) }}>
                <View style={{ gap: space(6) }}>
                  {fieldLabel('Days')}
                  <DayChips
                    days={draftDays}
                    onToggle={(d) => setDraftDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))}
                  />
                </View>
                <View style={{ gap: space(6) }}>
                  {fieldLabel('New verses each day', String(draftPerDay))}
                  <StepperRow value={draftPerDay} min={1} max={5} onChange={setDraftPerDay} />
                </View>
                <View className="border-t border-hairline" style={{ paddingTop: space(10), gap: space(2) }}>
                  {draftDays.length === 0 ? (
                    <>
                      <AppText variant="body" className="font-sans font-semibold text-ink">No days picked</AppText>
                      <AppText variant="caption" className="font-sans text-ink-3">Pick at least one day to start the plan.</AppText>
                    </>
                  ) : (
                    <>
                      <AppText variant="body" className="font-sans font-semibold text-ink">{draftWeekly} verses a week</AppText>
                      <AppText variant="caption" className="font-sans text-ink-3">
                        {draftDayNames}
                        {plan.verseIds.length > 0 ? ` · about ${draftWeeks} ${draftWeeks === 1 ? 'week' : 'weeks'} for ${plan.verseIds.length} verses` : ''}
                      </AppText>
                      {draftWeekly > 14 && (
                        <AppText variant="caption" className="font-sans text-ink-3">That's a lot for most people.</AppText>
                      )}
                    </>
                  )}
                </View>
                <AppText variant="caption" className="font-sans text-ink-3">
                  Members keep their own Sabbath: if it falls on a plan day, that day's verses wait for the next plan day.
                </AppText>
              </View>
            </View>

            <View style={{ gap: space(6) }}>
              <SectionHeader
                title={`Verses · ${plan.verseIds.length}`}
                actionLabel={showAddVerses ? 'Cancel' : 'Add verses'}
                onAction={() => setShowAddVerses(!showAddVerses)}
              />
              {showAddVerses && (
                <FadeInView>
                  <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(12) }}>
                    <View style={{ gap: space(4) }}>
                      {fieldLabel('Book')}
                      <BookPicker value={addBook} onChange={setAddBook} />
                    </View>
                    <View className="flex-row flex-wrap" style={{ gap: space(10) }}>
                      <View style={numberBasis}>
                        {fieldLabel('Chapter')}
                        <NumericInput
                          value={addChapter}
                          onChangeText={setAddChapter}
                          accessibilityLabel="Chapter"
                          className={numberInput}
                          style={numberStyle}
                        />
                      </View>
                      <View style={numberBasis}>
                        {fieldLabel('From verse')}
                        <NumericInput
                          value={addStartVerse}
                          onChangeText={setAddStartVerse}
                          accessibilityLabel="From verse"
                          className={numberInput}
                          style={numberStyle}
                        />
                      </View>
                      <View style={numberBasis}>
                        {fieldLabel('To verse', addChapterData ? `of ${addChapterData.verseCount}` : undefined)}
                        <NumericInput
                          value={addEndVerse}
                          onChangeText={setAddEndVerse}
                          accessibilityLabel="To verse"
                          className={numberInput}
                          style={numberStyle}
                        />
                      </View>
                    </View>
                    <AppButton variant="primary" label="Add verses" onPress={handleAddVerses} />
                  </View>
                </FadeInView>
              )}
              {verseList}
            </View>

            <View style={{ gap: space(10) }}>
              <AppButton size="lg" variant="primary" label="Save" onPress={saveEdits} />
              <AppButton variant="quiet" label="Cancel" onPress={() => setIsEditing(false)} />
            </View>

            <GroupedList>
              <ListRow Icon={Trash2} title="Delete plan" destructive accessory="none" onPress={() => setConfirmingDelete(true)} />
            </GroupedList>
          </>
        ) : membership ? (
          <>
            {/* Where you are: the answer a member opens this page for. */}
            <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(10) }}>
              <View className="flex-row items-baseline justify-between" style={{ gap: space(8) }}>
                <AppText variant="body" className="font-sans font-semibold text-ink">Your progress</AppText>
                <AppText variant="caption" className="font-sans text-ink-3">
                  {progress.learned} of {progress.total} verses learned
                </AppText>
              </View>
              <ProgressBar percent={(progress.learned / Math.max(1, progress.total)) * 100} />
            </View>

            {scheduled && (
              <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(10) }}>
                <AppText variant="body" className="font-sans font-semibold text-ink">Schedule</AppText>
                <DayChips days={plan.days!} />
                <AppText variant="caption" className="font-sans text-ink-3">
                  {plan.versesPerDay ?? 1} new {(plan.versesPerDay ?? 1) === 1 ? 'verse' : 'verses'} each plan day
                </AppText>
              </View>
            )}
            {scheduled && (
              <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(8) }}>
                <AppText variant="body" className="font-sans font-semibold text-ink">Next verses</AppText>
                {upcoming.length === 0 ? (
                  <AppText variant="caption" className="font-sans text-ink-3">Nothing is due right now.</AppText>
                ) : (
                  upcoming.map((u) => (
                    <View key={u.day} className="flex-row items-baseline" style={{ gap: space(10) }}>
                      <AppText variant="caption" className="font-sans font-semibold text-accent" style={{ width: space(72) }}>{u.day}</AppText>
                      <AppText variant="label" className="font-sans text-ink flex-1">{u.refs}</AppText>
                    </View>
                  ))
                )}
              </View>
            )}

            {!scheduled && (
            <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(10) }}>
              <View className="flex-row items-baseline justify-between" style={{ gap: space(8) }}>
                <AppText variant="body" className="font-sans font-semibold text-ink">This week</AppText>
                <AppText variant="caption" className="font-sans text-ink-3">
                  {progress.leftThisWeek === 0 ? 'All started' : `${progress.leftThisWeek} still to start`}
                </AppText>
              </View>
              <View className="flex-row flex-wrap" style={{ gap: space(4) }} accessible accessibilityLabel={`${progress.learnedThisWeek} learned, ${progress.pulledThisWeek} started, of ${plan.versesPerWeek} this week`}>
                {weekSquares.map((kind, i) => (
                  <View
                    key={i}
                    className={kind === 'learned' ? 'bg-accent' : kind === 'started' ? 'bg-accent-soft' : 'bg-fill'}
                    style={{ width: squareSize, height: squareSize, borderRadius: 4 }}
                  />
                ))}
              </View>
              <AppText variant="caption" className="font-sans text-ink-3">
                {progress.pulledThisWeek} of {plan.versesPerWeek} started · {progress.learnedThisWeek} learned
              </AppText>
            </View>
            )}

            <CollapsibleSection storageKey="plan.verses" title={`All verses · ${plan.verseIds.length}`} defaultCollapsed>
              {verseList}
            </CollapsibleSection>

            <GroupedList>
              <ListRow title="How it fits your pace" value={priorityLabel} onPress={() => setChoosingPriority(true)} />
              <ListRow Icon={LogOut} title="Leave plan" destructive accessory="none" onPress={() => setConfirmingLeave(true)} />
            </GroupedList>
          </>
        ) : (
          <>
            <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(6) }}>
              <AppText variant="body" className="font-sans font-semibold text-ink">What you'll do</AppText>
              <AppText variant="label" className="font-sans text-ink-2">
                {plan.verseIds.length === 0
                  ? "The leader hasn't added any verses yet."
                  : `Learn ${plan.verseIds.length} ${plan.verseIds.length === 1 ? 'verse' : 'verses'}, ${plan.versesPerWeek} new each week. About ${weeksLeft} ${weeksLeft === 1 ? 'week' : 'weeks'}.`}
              </AppText>
            </View>

            <AppButton size="lg" variant="primary" label="Join plan" onPress={() => joinGroupPlan(plan, joinPriority)} />

            <GroupedList footer="Whether this plan's verses use up your daily pace or come on top of it. You can change it any time.">
              <ListRow title="How it fits your pace" value={priorityLabel} onPress={() => setChoosingPriority(true)} />
            </GroupedList>

            <CollapsibleSection storageKey="plan.verses" title={`All verses · ${plan.verseIds.length}`} defaultCollapsed>
              {verseList}
            </CollapsibleSection>
          </>
        )}
      </ScrollView>

      <Dialog
        visible={choosingPriority}
        onClose={() => setChoosingPriority(false)}
        placement="sheet"
        title="How should this fit your pace?"
      >
        {priorityCards(asChoice(membership?.priority ?? joinPriority), (id) => {
          if (membership) setGroupPlanPriority(plan.planId, id);
          else setJoinPriority(id);
          setChoosingPriority(false);
        })}
      </Dialog>

      <Dialog
        visible={confirmingLeave}
        onClose={() => setConfirmingLeave(false)}
        title="Leave this plan?"
        message="Its verses you haven't started leave My Verses. You can join again later."
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setConfirmingLeave(false)} />
            <AppButton
              variant="destructive"
              label="Leave plan"
              onPress={() => {
                setConfirmingLeave(false);
                leaveGroupPlan(plan.planId);
              }}
            />
          </>
        }
      />

      <Dialog
        visible={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title="Delete this plan?"
        message={`"${plan.name}" is removed for everyone in the circle. This can't be undone.`}
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setConfirmingDelete(false)} />
            <AppButton
              variant="destructive"
              label="Delete plan"
              onPress={async () => {
                setConfirmingDelete(false);
                await deleteGroupPlan(plan.circleId, plan.planId);
                handleBack();
              }}
            />
          </>
        }
      />
    </FadeInView>
  );
}
