import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Trash2, X } from 'lucide-react-native';

import { Challenge } from '../types';
import { DEFAULT_TRANSLATION_ID, getBookByName } from '../data';
import { useChapterText } from '../state/useScripture';
import { BookPicker } from './BookPicker';
import { NumericInput, NumericKeyboardAccessory, ProgressBar } from './ui';

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
// build. Shared by DMThreadScreen (1:1 challenge) and
// CommunityGroupDetailScreen (group challenge) so both stay in sync.
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

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 bg-black/40 justify-end">
        <View className="bg-white rounded-t-2xl p-5" style={{ gap: 12 }}>
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-serif font-bold text-neutral-900">{title}</Text>
            <Pressable onPress={onClose} className="w-7 h-7 rounded-full border border-neutral-200 items-center justify-center">
              <X size={12} color="#262626" />
            </Pressable>
          </View>

          <View className="flex-row gap-2">
            <View className="flex-1">
              <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest mb-0.5">Book</Text>
              <BookPicker value={book} onChange={setBook} />
            </View>
            <View style={{ width: 70 }}>
              <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest mb-0.5">Chapter</Text>
              <NumericInput
                value={chapter}
                onChangeText={setChapter}
                accessoryID={CHALLENGE_ACCESSORY_ID}
                className="w-full bg-white border border-neutral-300 rounded-lg px-2 py-2.5 text-xs text-center"
              />
            </View>
          </View>

          <View className="flex-row gap-2 items-end">
            <View className="flex-1">
              <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest mb-0.5">Start Verse (optional)</Text>
              <NumericInput
                value={startVerse}
                onChangeText={setStartVerse}
                accessoryID={CHALLENGE_ACCESSORY_ID}
                placeholder="1"
                placeholderTextColor="#a3a3a3"
                className="w-full bg-white border border-neutral-300 rounded-lg px-2 py-1.5 text-xs text-center"
              />
            </View>
            <View className="flex-1">
              <View className="flex-row items-center justify-between mb-0.5">
                <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest">End Verse</Text>
                {chapterData && <Text className="text-[8px] font-mono text-neutral-400">max {chapterData.verseCount}</Text>}
              </View>
              <NumericInput
                value={endVerse}
                onChangeText={setEndVerse}
                accessoryID={CHALLENGE_ACCESSORY_ID}
                placeholder={chapterData ? String(chapterData.verseCount) : 'end'}
                placeholderTextColor="#a3a3a3"
                className="w-full bg-white border border-neutral-300 rounded-lg px-2 py-1.5 text-xs text-center"
              />
            </View>
          </View>

          <Pressable onPress={handleSubmit} className="bg-[#1A1A1A] py-3 rounded-xl items-center">
            <Text className="text-white text-[10px] font-bold uppercase tracking-wider">🏆 Send Challenge</Text>
          </Pressable>
        </View>
      </View>
      <NumericKeyboardAccessory nativeID={CHALLENGE_ACCESSORY_ID} />
    </Modal>
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isRecipient = challenge.toUid === myUid;
  const myProgress = isRecipient ? challenge.toProgress : challenge.fromProgress;
  const theirProgress = isRecipient ? challenge.fromProgress : challenge.toProgress;
  const theirName = isRecipient ? challenge.fromName : challenge.toName;

  // Deleting is destructive for the OTHER person too, so it always asks first
  // -- matching the inline confirm-card idiom used on Home/MemberProfile
  // rather than a native Alert.
  const deleteControl = (
    <Pressable
      onPress={() => setConfirmingDelete(true)}
      hitSlop={8}
      className="w-6 h-6 rounded-full items-center justify-center"
    >
      <Trash2 size={12} color="#a3a3a3" />
    </Pressable>
  );

  const confirmRow = (
    <View className="border border-neutral-200 bg-white rounded-lg p-2.5" style={{ gap: 8 }}>
      <Text className="text-[10px] font-sans text-neutral-600 leading-snug">
        Delete this challenge for both of you? Verses you've started stay in your queue.
      </Text>
      <View className="flex-row gap-2">
        <Pressable
          onPress={() => setConfirmingDelete(false)}
          className="flex-1 bg-white border border-neutral-300 py-2 rounded-lg items-center"
        >
          <Text className="text-neutral-600 text-[9px] font-bold uppercase tracking-wide">Keep</Text>
        </Pressable>
        <Pressable onPress={onDelete} className="flex-1 bg-red-600 py-2 rounded-lg items-center">
          <Text className="text-white text-[9px] font-bold uppercase tracking-wide">Delete</Text>
        </Pressable>
      </View>
    </View>
  );

  if (challenge.status === 'declined' || challenge.status === 'cancelled') {
    return (
      <View className="mx-1 mb-2 border border-neutral-200 bg-neutral-50 rounded-xl p-3" style={{ gap: 8 }}>
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-2">
            <Text className="text-[10px] font-sans font-bold text-neutral-500">
              {referenceLabel(challenge)} — {challenge.status === 'declined' ? 'declined' : 'cancelled'}
            </Text>
          </View>
          {deleteControl}
        </View>
        {confirmingDelete && confirmRow}
      </View>
    );
  }

  return (
    <View className="mx-1 mb-2 border border-amber-200 bg-amber-50 rounded-xl p-3" style={{ gap: 8 }}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1.5 flex-1 pr-2">
          <Text className="text-xs">🏆</Text>
          <Text className="text-[10px] font-sans font-extrabold text-amber-800 uppercase tracking-wide">
            {referenceLabel(challenge)}
          </Text>
        </View>
        {deleteControl}
      </View>

      {confirmingDelete && confirmRow}

      {challenge.status === 'pending' && isRecipient && (
        <View style={{ gap: 8 }}>
          <Text className="text-[10px] text-amber-700 font-sans">{challenge.fromName} challenged you to a memorization race!</Text>
          <View className="flex-row gap-2">
            <Pressable onPress={onAccept} className="flex-1 bg-[#1A1A1A] py-2 rounded-lg items-center">
              <Text className="text-white text-[9px] font-bold uppercase tracking-wide">Accept</Text>
            </Pressable>
            <Pressable onPress={onDecline} className="flex-1 bg-white border border-neutral-300 py-2 rounded-lg items-center">
              <Text className="text-neutral-600 text-[9px] font-bold uppercase tracking-wide">Decline</Text>
            </Pressable>
          </View>
        </View>
      )}

      {challenge.status === 'pending' && !isRecipient && (
        <View style={{ gap: 8 }}>
          <Text className="text-[10px] text-amber-700 font-sans">Waiting for {challenge.toName} to accept…</Text>
          {/* No confirm step here -- nothing has been accepted yet, so
              cancelling an unanswered invitation costs the other side nothing. */}
          <Pressable onPress={onDelete} className="self-start bg-white border border-neutral-300 px-3 py-1.5 rounded-lg">
            <Text className="text-neutral-600 text-[9px] font-bold uppercase tracking-wide">Cancel Challenge</Text>
          </Pressable>
        </View>
      )}

      {(challenge.status === 'active' || challenge.status === 'completed') && (
        <View style={{ gap: 6 }}>
          <View style={{ gap: 3 }}>
            <View className="flex-row justify-between">
              <Text className="text-[9px] font-sans font-bold text-neutral-700">You</Text>
              <Text className="text-[9px] font-mono text-neutral-500">
                {myProgress}/{challenge.totalVerses}
              </Text>
            </View>
            <ProgressBar percent={(myProgress / Math.max(1, challenge.totalVerses)) * 100} />
          </View>
          <View style={{ gap: 3 }}>
            <View className="flex-row justify-between">
              <Text className="text-[9px] font-sans font-bold text-neutral-700">{theirName}</Text>
              <Text className="text-[9px] font-mono text-neutral-500">
                {theirProgress}/{challenge.totalVerses}
              </Text>
            </View>
            <ProgressBar percent={(theirProgress / Math.max(1, challenge.totalVerses)) * 100} />
          </View>
          {challenge.status === 'completed' && (
            <Text className="text-[9px] font-sans font-bold text-emerald-700 uppercase tracking-wide">
              🎉 Challenge complete — you both finished!
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
