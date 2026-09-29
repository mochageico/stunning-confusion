import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { LogOut, Trash2 } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, NumericInput, StepperRow } from '../components/ui';
import { BookPicker } from '../components/BookPicker';
import { ALL_BIBLE_BOOKS, DEFAULT_TRANSLATION_ID, getBookByName } from '../data';
import { useChapterText } from '../state/useScripture';
import { GroupPlanMembership } from '../types';
import { AppButton, AppText, AppTextInput, ChoiceCard, useScaledSpace } from '../components/design';
import { Dialog, EmptyState, GroupedList, ListRow, ScreenHeader, SectionHeader } from '../components/blocks';

// Plain language, and ordered by how most people actually want it: joining a
// group thing usually means you want the group's verses to lead. The old
// labels ("Individual First"/"Plan First"/"Additive") described the
// scheduler's internals rather than the choice being made.
const PRIORITY_OPTIONS: { id: GroupPlanMembership['priority']; label: string; description: string }[] = [
  { id: 'group', label: 'Group verses first', description: 'This plan leads. Your own verses fill whatever room is left in your daily pace.' },
  { id: 'individual', label: 'My verses first', description: 'Your own verses lead. This plan fills whatever room is left in your daily pace.' },
  { id: 'additive', label: 'Both, side by side', description: 'This plan adds its full pace on top of your own, even past your daily limits.' },
];

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
    triggerToast,
  } = state;

  const [isEditing, setIsEditing] = useState(false);
  const [showAddVerses, setShowAddVerses] = useState(false);
  const [addBook, setAddBook] = useState('Romans');
  const [addChapter, setAddChapter] = useState('1');
  const [addStartVerse, setAddStartVerse] = useState('1');
  const [addEndVerse, setAddEndVerse] = useState('1');
  const [joinPriority, setJoinPriority] = useState<GroupPlanMembership['priority']>(DEFAULT_JOIN_PRIORITY);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (!viewingGroupPlan) return null;
  const plan = viewingGroupPlan;

  const isManager = !!user && plan.managerId === user.uid;
  const membership = joinedGroupPlanMemberships.find((m) => m.planId === plan.planId);

  // Real verse count for the "of N" hint next to To verse.
  const addChapterId = getBookByName(addBook)?.id || null;
  const addChapterNum = parseInt(addChapter, 10);
  const { data: addChapterData } = useChapterText(
    DEFAULT_TRANSLATION_ID,
    addChapterId,
    Number.isNaN(addChapterNum) ? null : addChapterNum
  );

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

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader
          title={plan.name}
          eyebrow="Group plan"
          subtitle={isEditing ? undefined : plan.description || undefined}
          onBack={handleBack}
          backLabel="Circle"
          actions={
            isManager ? (
              <AppButton size="sm" variant={isEditing ? 'primary' : 'secondary'} label={isEditing ? 'Done' : 'Edit'} onPress={() => setIsEditing(!isEditing)} />
            ) : undefined
          }
        />

        {isEditing ? (
          <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(12) }}>
            <View style={{ gap: space(4) }}>
              {fieldLabel('Plan name')}
              <AppTextInput
                defaultValue={plan.name}
                onEndEditing={(e) => {
                  const val = e.nativeEvent.text.trim();
                  if (val && val !== plan.name) updateGroupPlan(plan.circleId, plan.planId, { name: val });
                }}
                accessibilityLabel="Plan name"
                variant="body"
                className={inputBox}
                style={inputStyle}
              />
            </View>
            <View style={{ gap: space(4) }}>
              {fieldLabel('Description')}
              <AppTextInput
                defaultValue={plan.description}
                onEndEditing={(e) => {
                  const val = e.nativeEvent.text.trim();
                  if (val !== plan.description) updateGroupPlan(plan.circleId, plan.planId, { description: val });
                }}
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
        ) : null}

        <GroupedList>
          <ListRow title="Managed by" value={plan.managerName || 'Leader'} />
          {!isManager && <ListRow title="Pace" value={`${plan.versesPerWeek} verses a week`} />}
        </GroupedList>

        {isManager && (
          <View style={{ gap: space(6) }}>
            <SectionHeader title="Pace" />
            <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(8) }}>
              <StepperRow
                value={plan.versesPerWeek}
                min={1}
                max={20}
                onChange={(n) => updateGroupPlan(plan.circleId, plan.planId, { versesPerWeek: n })}
              />
              <AppText variant="body" className="font-sans font-semibold text-ink">
                {plan.versesPerWeek} verses a week
              </AppText>
              <AppText variant="caption" className="font-sans text-ink-3">
                New verses this plan adds each week. Each member's daily limit and priority decide how they blend with their own queue.
              </AppText>
            </View>
          </View>
        )}

        {/* VERSES */}
        <View style={{ gap: space(6) }}>
          <SectionHeader
            title={`Verses · ${plan.verseIds.length}`}
            actionLabel={isManager ? (showAddVerses ? 'Cancel' : 'Add verses') : undefined}
            onAction={() => setShowAddVerses(!showAddVerses)}
          />

          {showAddVerses && isManager && (
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
        </View>

        {/* JOIN / MEMBERSHIP -- the priority choice is made here, at join,
            rather than hardcoded and only changeable afterwards on a screen
            most members never come back to. */}
        <View style={{ gap: space(6) }}>
          <SectionHeader title={membership ? 'Which verses come first' : 'How should these verses fit in?'} />
          {membership ? (
            priorityCards(membership.priority, (id) => setGroupPlanPriority(plan.planId, id))
          ) : (
            <>
              {priorityCards(joinPriority, setJoinPriority)}
              <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
                You can change this any time. It decides which verses win when there isn't room for everything.
              </AppText>
            </>
          )}
        </View>

        {!membership && <AppButton size="lg" variant="primary" label="Join plan" onPress={() => joinGroupPlan(plan, joinPriority)} />}

        {(membership || isManager) && (
          <GroupedList>
            {membership && (
              <ListRow Icon={LogOut} title="Leave plan" destructive accessory="none" onPress={() => setConfirmingLeave(true)} />
            )}
            {isManager && (
              <ListRow Icon={Trash2} title="Delete plan" destructive accessory="none" onPress={() => setConfirmingDelete(true)} />
            )}
          </GroupedList>
        )}
      </ScrollView>

      <Dialog
        visible={confirmingLeave}
        onClose={() => setConfirmingLeave(false)}
        title="Leave this plan?"
        message="Its verses you haven't started leave your queue. You can join again later."
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
