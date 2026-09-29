import { useState } from 'react';
import { View } from 'react-native';
import { Trash2 } from 'lucide-react-native';

import { Challenge } from '../types';
import { DEFAULT_TRANSLATION_ID, getBookByName } from '../data';
import { useChapterText } from '../state/useScripture';
import { BookPicker } from './BookPicker';
import { NumericInput, NumericKeyboardAccessory, ProgressBar } from './ui';
import { AppButton, AppIconButton, AppText, useScaledSpace } from './design';
import { Badge, Dialog } from './blocks';

import { useThemeColors } from './theme';
// This sheet is a Modal -- its own iOS view controller -- so it must register
// its own numeric "Done" accessory rather than using App.tsx's. See the
// PAIRING RULE comment on NumericInput in ui.tsx.
const CHALLENGE_ACCESSORY_ID = 'challengeSheetNumericDoneBar';

export type ChallengeRange = {
  book: string;
  startChapter: number;
  endChapter: number;
  startVerse?: number;
  endVerse?: number;
};

const referenceLabel = (c: Pick<ChallengeRange, 'book' | 'startChapter' | 'endChapter' | 'startVerse' | 'endVerse'>) => {
  if (c.startChapter === c.endChapter && (c.startVerse != null || c.endVerse != null)) {
    return `${c.book} ${c.startChapter}:${c.startVerse ?? 1}-${c.endVerse ?? ''}`;
  }
  return c.startChapter === c.endChapter ? `${c.book} ${c.startChapter}` : `${c.book} ${c.startChapter}-${c.endChapter}`;
};

// Single-chapter range picker (Book + Chapter + optional Start/End Verse),
// same inputs/layout GroupPlanDetailScreen's "Add Verses" form already uses
// -- deliberately not a multi-chapter book-range picker, matching that
// screen's own scope decision to trade a few repeated taps for a simpler
// build.
//
// The fields live here, apart from any container, because they're presented
// two different ways: DMThreadScreen opens them in a bottom sheet (a 1:1
// challenge is a thing you fire off mid-conversation), while
// CommunityGroupDetailScreen expands them inline under the Challenges header
// -- the same shape as the New Group Plan form directly above it on that
// screen. A panel that slides over the whole page to collect four fields is
// heavier than the page it covers.
function ChallengeRangeForm({
  inline,
  submitLabel,
  accessoryID,
  onSubmit,
  onCancel,
}: {
  /** Cancel + confirm on one row, for the panel that expands in place on the circle page. */
  inline?: boolean;
  submitLabel: string;
  accessoryID?: string;
  onSubmit: (range: ChallengeRange) => void;
  onCancel: () => void;
}) {
  const [book, setBook] = useState('Philippians');
  const [chapter, setChapter] = useState('2');
  const [startVerse, setStartVerse] = useState('');
  const [endVerse, setEndVerse] = useState('');

  const chapterId = getBookByName(book)?.id || null;
  const chapterNum = parseInt(chapter, 10);
  const { data: chapterData } = useChapterText(DEFAULT_TRANSLATION_ID, chapterId, Number.isNaN(chapterNum) ? null : chapterNum);

  const handleSubmit = () => {
    const chapterN = parseInt(chapter, 10);
    if (!book || Number.isNaN(chapterN)) return;
    const startV = parseInt(startVerse, 10);
    const endV = parseInt(endVerse, 10);
    onSubmit({
      book,
      startChapter: chapterN,
      endChapter: chapterN,
      startVerse: Number.isNaN(startV) ? undefined : startV,
      endVerse: Number.isNaN(endV) ? undefined : endV,
    });
    setStartVerse('');
    setEndVerse('');
  };

  const space = useScaledSpace();
  // Book takes a row of its own; the three number fields share the next one
  // and wrap when the text is big, so none is squeezed.
  const numberBasis = { flexGrow: 1, flexBasis: space(96), gap: space(4) };
  const label = (text: string, extra?: string) => (
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
  const numberInput = 'bg-surface border border-line rounded-btn text-ink font-sans text-center';
  const numberStyle = { paddingHorizontal: space(8), paddingVertical: space(10) };

  return (
    <View style={{ gap: space(12) }}>
      <View style={{ gap: space(4) }}>
        {label('Book')}
        <BookPicker value={book} onChange={setBook} />
      </View>

      <View className="flex-row flex-wrap" style={{ gap: space(10) }}>
        <View style={numberBasis}>
          {label('Chapter')}
          <NumericInput
            value={chapter}
            onChangeText={setChapter}
            accessoryID={accessoryID}
            accessibilityLabel="Chapter"
            className={numberInput}
            style={numberStyle}
          />
        </View>
        <View style={numberBasis}>
          {label('From verse')}
          <NumericInput
            value={startVerse}
            onChangeText={setStartVerse}
            accessoryID={accessoryID}
            accessibilityLabel="From verse (optional)"
            placeholder="1"
            className={numberInput}
            style={numberStyle}
          />
        </View>
        <View style={numberBasis}>
          {label('To verse', chapterData ? `of ${chapterData.verseCount}` : undefined)}
          <NumericInput
            value={endVerse}
            onChangeText={setEndVerse}
            accessoryID={accessoryID}
            accessibilityLabel="To verse (optional)"
            placeholder={chapterData ? String(chapterData.verseCount) : 'end'}
            className={numberInput}
            style={numberStyle}
          />
        </View>
      </View>
      <AppText variant="caption" className="font-sans text-ink-3">
        Leave the verses blank to race through the whole chapter.
      </AppText>

      {inline ? (
        <View className="flex-row flex-wrap justify-end" style={{ gap: space(8) }}>
          <AppButton variant="quiet" label="Cancel" onPress={onCancel} />
          <AppButton variant="primary" label={submitLabel} onPress={handleSubmit} />
        </View>
      ) : (
        <AppButton size="lg" variant="primary" label={submitLabel} onPress={handleSubmit} />
      )}
    </View>
  );
}

/** Bottom-sheet presentation. Used from a chat thread and a friend's
 *  profile, where there's no room on screen to expand a form in place. */
export function ChallengeCreateSheet({
  visible,
  title,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSubmit: (range: ChallengeRange) => void;
}) {
  return (
    <Dialog visible={visible} onClose={onClose} placement="sheet" title={title}>
      <ChallengeRangeForm submitLabel="Send challenge" accessoryID={CHALLENGE_ACCESSORY_ID} onSubmit={onSubmit} onCancel={onClose} />
      <NumericKeyboardAccessory nativeID={CHALLENGE_ACCESSORY_ID} />
    </Dialog>
  );
}

/** Inline presentation: the expanding panel used on the circle page,
 *  deliberately the same shape as the New Group Plan form above it. Not a
 *  Modal, so it uses App.tsx's shared numeric accessory bar rather than
 *  registering one of its own. */
export function ChallengeCreateInline({
  onSubmit,
  onCancel,
}: {
  onSubmit: (range: ChallengeRange) => void;
  onCancel: () => void;
}) {
  const space = useScaledSpace();
  return (
    <View className="bg-surface border border-line rounded-card" style={{ padding: space(14) }}>
      <ChallengeRangeForm inline submitLabel="Start challenge" onSubmit={onSubmit} onCancel={onCancel} />
    </View>
  );
}

// 1:1 challenge card -- pending (accept/decline for the recipient, waiting
// note for the sender), active (dual progress bars), or completed/declined.
//
// Every status can be deleted, because either participant can remove the
// challenge outright (see deleteChallenge in useAppState.ts). That includes
// declined/cancelled ones: those used to render as `null`, which meant a whole
// class of challenge was permanently un-deletable -- invisible in the thread
// but still a live Firestore doc. They show as a compact row instead.
export function ChallengeCard({
  challenge,
  myUid,
  onAccept,
  onDecline,
  onDelete,
}: {
  challenge: Challenge;
  myUid: string | undefined;
  onAccept: () => void;
  onDecline: () => void;
  onDelete: () => void;
}) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isRecipient = challenge.toUid === myUid;
  const myProgress = isRecipient ? challenge.toProgress : challenge.fromProgress;
  const theirProgress = isRecipient ? challenge.fromProgress : challenge.toProgress;
  const theirName = isRecipient ? challenge.fromName : challenge.toName;
  const total = Math.max(1, challenge.totalVerses);

  // Deleting is destructive for the OTHER person too, so it always asks first.
  const deleteDialog = (
    <Dialog
      visible={confirmingDelete}
      onClose={() => setConfirmingDelete(false)}
      title="Delete this challenge?"
      message="It's removed for both of you. Verses you've started stay in your queue."
      actions={
        <>
          <AppButton variant="quiet" label="Keep it" onPress={() => setConfirmingDelete(false)} />
          <AppButton
            variant="destructive"
            label="Delete"
            onPress={() => {
              setConfirmingDelete(false);
              onDelete();
            }}
          />
        </>
      }
    />
  );

  const box = 'bg-surface border border-line rounded-card';
  const boxStyle = { padding: space(14), gap: space(10), marginBottom: space(8) };

  if (challenge.status === 'declined' || challenge.status === 'cancelled') {
    return (
      <View className={`${box} flex-row items-center`} style={{ ...boxStyle, gap: space(8) }}>
        <AppText variant="label" className="font-sans text-ink-3 flex-1">
          {referenceLabel(challenge)} · {challenge.status === 'declined' ? 'declined' : 'cancelled'}
        </AppText>
        <AppButton size="sm" variant="quiet" label="Remove" onPress={() => setConfirmingDelete(true)} />
        {deleteDialog}
      </View>
    );
  }

  const badge =
    challenge.status === 'pending' ? (
      <Badge label="Pending" tone="warning" />
    ) : challenge.status === 'completed' ? (
      <Badge label="Complete" tone="success" />
    ) : (
      <Badge label="Racing" tone="accent" />
    );

  const progressRow = (name: string, value: number) => (
    <View style={{ gap: space(4) }}>
      <View className="flex-row justify-between" style={{ gap: space(8) }}>
        <AppText variant="caption" className="font-sans text-ink-2 flex-1">{name}</AppText>
        <AppText variant="caption" className="font-sans text-ink-3">
          {value} of {challenge.totalVerses}
        </AppText>
      </View>
      <ProgressBar percent={(value / total) * 100} />
    </View>
  );

  return (
    <View className={box} style={boxStyle}>
      <View className="flex-row items-center justify-between" style={{ gap: space(8) }}>
        <View className="flex-1 flex-row items-center flex-wrap" style={{ gap: space(8) }}>
          <AppText variant="body" className="font-sans font-semibold text-ink">
            {referenceLabel(challenge)}
          </AppText>
          {badge}
        </View>
        <AppIconButton
          Icon={Trash2}
          variant="bare"
          diameter={30}
          iconColor={palette.ink3}
          accessibilityLabel="Delete challenge"
          onPress={() => setConfirmingDelete(true)}
        />
      </View>

      {challenge.status === 'pending' && isRecipient && (
        <View style={{ gap: space(10) }}>
          <AppText variant="label" className="font-sans text-ink-2">
            {challenge.fromName} challenged you to a memorization race.
          </AppText>
          <View className="flex-row flex-wrap" style={{ gap: space(8) }}>
            <AppButton variant="primary" label="Accept" onPress={onAccept} />
            <AppButton variant="quiet" label="Decline" onPress={onDecline} />
          </View>
        </View>
      )}

      {challenge.status === 'pending' && !isRecipient && (
        <View style={{ gap: space(10) }}>
          <AppText variant="label" className="font-sans text-ink-2">Waiting for {challenge.toName} to accept.</AppText>
          {/* No confirm step here -- nothing has been accepted yet, so
              cancelling an unanswered invitation costs the other side nothing. */}
          <AppButton size="sm" variant="quiet" label="Cancel challenge" onPress={onDelete} style={{ alignSelf: 'flex-start' }} />
        </View>
      )}

      {(challenge.status === 'active' || challenge.status === 'completed') && (
        <View style={{ gap: space(8) }}>
          {progressRow('You', myProgress)}
          {progressRow(theirName, theirProgress)}
          {challenge.status === 'completed' && (
            <AppText variant="caption" className="font-sans font-semibold text-success">You both finished.</AppText>
          )}
        </View>
      )}
      {deleteDialog}
    </View>
  );
}
