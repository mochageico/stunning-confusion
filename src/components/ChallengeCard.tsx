import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Trash2, X } from 'lucide-react-native';

import { Challenge } from '../types';
import { DEFAULT_TRANSLATION_ID, getBookByName } from '../data';
import { useChapterText } from '../state/useScripture';
import { BookPicker } from './BookPicker';
import { NumericInput, NumericKeyboardAccessory, ProgressBar } from './ui';
import { AppButton, AppIconButton, AppText } from './design';

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
  const palette = useThemeColors();
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

  const labelTone = 'text-ink-3';
  const inputTone = 'bg-surface border border-line-strong text-ink';

  return (
    <View style={{ gap: 10 }}>
      <View className="flex-row gap-2">
        <View className="flex-1">
          <AppText variant="micro" className={`font-bold ${labelTone} uppercase tracking-widest mb-0.5`}>Book</AppText>
          <BookPicker value={book} onChange={setBook} />
        </View>
        <View style={{ width: 76 }}>
          <AppText variant="micro" className={`font-bold ${labelTone} uppercase tracking-widest mb-0.5`}>Chapter</AppText>
          <NumericInput
            value={chapter}
            onChangeText={setChapter}
            accessoryID={accessoryID}
            className={`w-full rounded-lg px-2 py-2.5 text-xs text-center ${inputTone}`}
          />
        </View>
      </View>

      <View className="flex-row gap-2 items-end">
        <View className="flex-1">
          <AppText variant="micro" className={`font-bold ${labelTone} uppercase tracking-widest mb-0.5`}>Start Verse (optional)</AppText>
          <NumericInput
            value={startVerse}
            onChangeText={setStartVerse}
            accessoryID={accessoryID}
            placeholder="1"
            placeholderTextColor={palette.ink3}
            className={`w-full rounded-lg px-2 py-2 text-xs text-center ${inputTone}`}
          />
        </View>
        <View className="flex-1">
          <View className="flex-row items-center justify-between mb-0.5">
            <AppText variant="micro" className={`font-bold ${labelTone} uppercase tracking-widest`}>End Verse</AppText>
            {chapterData && <AppText variant="micro" className={`font-mono ${labelTone}`}>max {chapterData.verseCount}</AppText>}
          </View>
          <NumericInput
            value={endVerse}
            onChangeText={setEndVerse}
            accessoryID={accessoryID}
            placeholder={chapterData ? String(chapterData.verseCount) : 'end'}
            placeholderTextColor={palette.ink3}
            className={`w-full rounded-lg px-2 py-2 text-xs text-center ${inputTone}`}
          />
        </View>
      </View>

      {inline ? (
        // Cancel + confirm on one right-aligned row, matching the New Group
        // Plan form this sits beside.
        <View className="flex-row justify-end gap-2 pt-2 border-t border-hairline">
          <Pressable onPress={onCancel} className="bg-surface border border-line-strong px-3 py-2 rounded-lg">
            <AppText variant="micro" className="text-ink-2 font-bold uppercase">Cancel</AppText>
          </Pressable>
          <Pressable onPress={handleSubmit} className="bg-accent px-4 py-2 rounded-lg">
            <AppText variant="micro" className="text-on-accent font-bold uppercase tracking-wider">{submitLabel}</AppText>
          </Pressable>
        </View>
      ) : (
        <AppButton size="lg" onPress={handleSubmit} className="bg-accent rounded-xl items-center">
          <AppText variant="section" className="text-on-accent font-bold uppercase tracking-wider">{submitLabel}</AppText>
        </AppButton>
      )}
    </View>
  );
}

/** Bottom-sheet presentation. Used from a chat thread, where there's no room
 *  on screen to expand a form in place. */
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
  const palette = useThemeColors();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 bg-black/40 justify-end">
        <View className="bg-surface rounded-t-2xl p-5" style={{ gap: 12 }}>
          <View className="flex-row items-center justify-between">
            <AppText variant="body" className="font-serif font-bold text-ink">{title}</AppText>
            <AppIconButton Icon={X} diameter={28} iconSize={12} iconColor={palette.ink} onPress={onClose} className="rounded-full border border-line" />
          </View>

          <ChallengeRangeForm
            submitLabel="🏆 Send Challenge"
            accessoryID={CHALLENGE_ACCESSORY_ID}
            onSubmit={onSubmit}
            onCancel={onClose}
          />
        </View>
      </View>
      <NumericKeyboardAccessory nativeID={CHALLENGE_ACCESSORY_ID} />
    </Modal>
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
  return (
    <View className="bg-surface-2 border border-line rounded-xl p-4" style={{ gap: 12 }}>
      <View className="flex-row justify-between items-center border-b border-hairline pb-1.5">
        <AppText variant="micro" className="font-black uppercase tracking-wider text-ink-3">New Challenge</AppText>
        <AppText variant="micro" className="bg-accent-soft text-accent px-2 py-0.5 rounded uppercase font-black">Race</AppText>
      </View>
      <ChallengeRangeForm inline submitLabel="🏆 Start Challenge" onSubmit={onSubmit} onCancel={onCancel} />
    </View>
  );
}

// 1:1 challenge card -- pending (accept/decline for the recipient, waiting
// note for the sender), active (dual progress bars), or completed/declined.
//
// Every status carries a delete control, because either participant can now
// remove the challenge outright (see deleteChallenge in useAppState.ts). That
// includes declined/cancelled ones: those used to render as `null`, which
// meant a whole class of challenge was permanently un-deletable -- invisible
// in the thread but still a live Firestore doc. They now show as a compact
// dismissible row instead.
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isRecipient = challenge.toUid === myUid;
  const myProgress = isRecipient ? challenge.toProgress : challenge.fromProgress;
  const theirProgress = isRecipient ? challenge.fromProgress : challenge.toProgress;
  const theirName = isRecipient ? challenge.fromName : challenge.toName;

  // Deleting is destructive for the OTHER person too, so it always asks first
  // -- matching the inline confirm-card idiom used on Home/MemberProfile
  // rather than a native Alert.
  const deleteControl = (
    <AppIconButton Icon={Trash2} diameter={24} iconSize={12} iconColor={palette.ink3} onPress={() => setConfirmingDelete(true)} hitSlop={8} className="rounded-full" />
  );

  const confirmRow = (
    <View className="border border-line bg-surface rounded-lg p-2.5" style={{ gap: 8 }}>
      <AppText variant="caption" className="font-sans text-ink-2 leading-snug">
        Delete this challenge for both of you? Verses you've started stay in your queue.
      </AppText>
      <View className="flex-row gap-2">
        <AppButton size="md" onPress={() => setConfirmingDelete(false)} className="flex-1 bg-surface border border-line-strong rounded-lg items-center">
          <AppText variant="micro" className="text-ink-2 font-bold uppercase tracking-wide">Keep</AppText>
        </AppButton>
        <AppButton size="md" onPress={onDelete} className="flex-1 bg-danger rounded-lg items-center">
          <AppText variant="micro" className="text-on-accent font-bold uppercase tracking-wide">Delete</AppText>
        </AppButton>
      </View>
    </View>
  );

  if (challenge.status === 'declined' || challenge.status === 'cancelled') {
    return (
      <View className="mx-1 mb-2 border border-line bg-surface-2 rounded-xl p-3" style={{ gap: 8 }}>
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-2">
            <AppText variant="caption" className="font-sans font-bold text-ink-3">
              {referenceLabel(challenge)} — {challenge.status === 'declined' ? 'declined' : 'cancelled'}
            </AppText>
          </View>
          {deleteControl}
        </View>
        {confirmingDelete && confirmRow}
      </View>
    );
  }

  return (
    <View className="mx-1 mb-2 border border-warning/30 bg-warning-soft rounded-xl p-3" style={{ gap: 8 }}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1.5 flex-1 pr-2">
          <AppText variant="label">🏆</AppText>
          <AppText variant="section" className="font-sans font-extrabold text-warning uppercase tracking-wide">
            {referenceLabel(challenge)}
          </AppText>
        </View>
        {deleteControl}
      </View>

      {confirmingDelete && confirmRow}

      {challenge.status === 'pending' && isRecipient && (
        <View style={{ gap: 8 }}>
          <AppText variant="caption" className="text-warning font-sans">{challenge.fromName} challenged you to a memorization race!</AppText>
          <View className="flex-row gap-2">
            <AppButton size="md" onPress={onAccept} className="flex-1 bg-accent rounded-lg items-center">
              <AppText variant="micro" className="text-on-accent font-bold uppercase tracking-wide">Accept</AppText>
            </AppButton>
            <AppButton size="md" onPress={onDecline} className="flex-1 bg-surface border border-line-strong rounded-lg items-center">
              <AppText variant="micro" className="text-ink-2 font-bold uppercase tracking-wide">Decline</AppText>
            </AppButton>
          </View>
        </View>
      )}

      {challenge.status === 'pending' && !isRecipient && (
        <View style={{ gap: 8 }}>
          <AppText variant="caption" className="text-warning font-sans">Waiting for {challenge.toName} to accept…</AppText>
          {/* No confirm step here -- nothing has been accepted yet, so
              cancelling an unanswered invitation costs the other side nothing. */}
          <Pressable onPress={onDelete} className="self-start bg-surface border border-line-strong px-3 py-1.5 rounded-lg">
            <AppText variant="micro" className="text-ink-2 font-bold uppercase tracking-wide">Cancel Challenge</AppText>
          </Pressable>
        </View>
      )}

      {(challenge.status === 'active' || challenge.status === 'completed') && (
        <View style={{ gap: 6 }}>
          <View style={{ gap: 3 }}>
            <View className="flex-row justify-between">
              <AppText variant="micro" className="font-sans font-bold text-ink-2">You</AppText>
              <AppText variant="micro" className="font-mono text-ink-3">
                {myProgress}/{challenge.totalVerses}
              </AppText>
            </View>
            <ProgressBar percent={(myProgress / Math.max(1, challenge.totalVerses)) * 100} />
          </View>
          <View style={{ gap: 3 }}>
            <View className="flex-row justify-between">
              <AppText variant="micro" className="font-sans font-bold text-ink-2">{theirName}</AppText>
              <AppText variant="micro" className="font-mono text-ink-3">
                {theirProgress}/{challenge.totalVerses}
              </AppText>
            </View>
            <ProgressBar percent={(theirProgress / Math.max(1, challenge.totalVerses)) * 100} />
          </View>
          {challenge.status === 'completed' && (
            <AppText variant="micro" className="font-sans font-bold text-success uppercase tracking-wide">
              🎉 Challenge complete — you both finished!
            </AppText>
          )}
        </View>
      )}
    </View>
  );
}
