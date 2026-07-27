import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { X } from 'lucide-react-native';

import { Challenge } from '../types';
import { DEFAULT_TRANSLATION_ID, getBookByName } from '../data';
import { useChapterText } from '../state/useScripture';
import { BookPicker } from './BookPicker';
import { ProgressBar } from './ui';

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
// same inputs/layout StudyPlanDetailScreen's "Add Verses" form already uses
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
              <TextInput
                value={chapter}
                onChangeText={setChapter}
                keyboardType="numeric"
                className="w-full bg-white border border-neutral-300 rounded-lg px-2 py-2.5 text-xs text-center"
              />
            </View>
          </View>

          <View className="flex-row gap-2 items-end">
            <View className="flex-1">
              <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest mb-0.5">Start Verse (optional)</Text>
              <TextInput
                value={startVerse}
                onChangeText={setStartVerse}
                keyboardType="numeric"
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
              <TextInput
                value={endVerse}
                onChangeText={setEndVerse}
                keyboardType="numeric"
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
    </Modal>
  );
}

// 1:1 challenge card -- pending (accept/decline for the recipient, waiting
// note for the sender), active (dual progress bars), or completed/declined.
export function ChallengeCard({
  challenge,
  myUid,
  onAccept,
  onDecline,
  onCancel,
}: {
  challenge: Challenge;
  myUid: string | undefined;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
}) {
  const isRecipient = challenge.toUid === myUid;
  const myProgress = isRecipient ? challenge.toProgress : challenge.fromProgress;
  const theirProgress = isRecipient ? challenge.fromProgress : challenge.toProgress;
  const theirName = isRecipient ? challenge.fromName : challenge.toName;

  if (challenge.status === 'declined' || challenge.status === 'cancelled') return null;

  return (
    <View className="mx-1 mb-2 border border-amber-200 bg-amber-50 rounded-xl p-3" style={{ gap: 8 }}>
      <View className="flex-row items-center gap-1.5">
        <Text className="text-xs">🏆</Text>
        <Text className="text-[10px] font-sans font-extrabold text-amber-800 uppercase tracking-wide">
          {referenceLabel(challenge)}
        </Text>
      </View>

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
          <Pressable onPress={onCancel} className="self-start bg-white border border-neutral-300 px-3 py-1.5 rounded-lg">
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
              🎉 Challenge complete -- you both finished!
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
