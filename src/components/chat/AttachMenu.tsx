import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { BookOpen, Mic, Play, Shuffle, Target, Trophy } from 'lucide-react-native';

import type { AppState } from '../../state/useAppState';
import type { ChatScope } from '../../state/useSocial';
import { DEFAULT_TRANSLATION_ID, PICKER_TRANSLATIONS, getBookByName, translationLabel } from '../../data';
import { Dropdown } from '../Dropdown';
import { fetchChapterText } from '../../state/useScripture';
import {
  attachmentFallbackText,
  passageLabel,
  QuizAttachment,
  RecordingRequestAttachment,
  VerseAttachment,
} from '../../lib/chatAttachments';
import { recordingLabel, recordingMeta } from '../../lib/recordingLabel';
import { ChipRow, NumericKeyboardAccessory } from '../ui';
import { AppButton, AppText, useScaledSpace } from '../design';
import { Dialog, EmptyState, GroupedList, ListRow } from '../blocks';
import { PassageRangeForm } from '../ChallengeCard';

// Its own Modal, so its number fields need their own "Done" bar (see ui.tsx).
const TRANSLATION_OPTIONS = PICKER_TRANSLATIONS.map((t) => ({ id: t.id, label: translationLabel(t.id) }));
const ATTACH_ACCESSORY_ID = 'chatAttachNumericDoneBar';

type Step = 'menu' | 'verse' | 'recording' | 'request' | 'quiz';

type QuizVerse = { book: string; chapter: number; verseNumber: number; status: string; translationId?: string };

const HIDE_OPTIONS = [
  { id: 25, label: '25%' },
  { id: 50, label: '50%' },
  { id: 75, label: '75%' },
  { id: 100, label: 'All' },
];

/**
 * The chat composer's + button: share a verse, share one of my recordings,
 * ask for a recording, and in a DM quiz the other person or race them.
 * One sheet that steps through to each form, so there's never a sheet on
 * top of a sheet.
 */
export function AttachMenu({
  state,
  visible,
  scope,
  containerId,
  onClose,
  onChallenge,
}: {
  state: AppState;
  visible: boolean;
  scope: ChatScope;
  containerId: string;
  onClose: () => void;
  /** DM only: open the race sheet. */
  onChallenge?: () => void;
}) {
  const space = useScaledSpace();
  const [step, setStep] = useState<Step>('menu');
  const isDM = scope === 'dm';
  const other = isDM ? state.activeDMThread : null;
  const otherIsFriend = !!other && state.friends.some((f) => f.uid === other.otherUid);
  const myName = state.user?.displayName || 'Someone';

  // The translation a recording request asks for. Starts on the one I'm
  // reading in, so asking for "my" translation is one tap.
  const defaultTranslation = PICKER_TRANSLATIONS.some((t) => t.id === state.selectedTranslationId)
    ? state.selectedTranslationId
    : DEFAULT_TRANSLATION_ID;
  const [requestTranslation, setRequestTranslation] = useState(defaultTranslation);

  useEffect(() => {
    if (visible) {
      setStep('menu');
      setRequestTranslation(defaultTranslation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const post = async (text: string, attachment: Parameters<AppState['postChatMessage']>[3]) => {
    if (!state.guidelinesAcceptedAt) {
      onClose();
      state.requireCommunityGuidelines();
      return;
    }
    const ok = await state.postChatMessage(scope, containerId, text, attachment);
    if (ok) onClose();
  };

  const titles: Record<Step, string> = {
    menu: 'Share in this chat',
    verse: 'Share a verse',
    recording: 'Send a recording',
    request: 'Ask for a recording',
    quiz: `Quiz ${other?.otherName.split(' ')[0] || ''}`,
  };

  return (
    <Dialog visible={visible} onClose={onClose} placement="sheet" title={titles[step]}>
      {step === 'menu' ? (
        <GroupedList>
          <ListRow Icon={BookOpen} title="Share a verse" subtitle="A passage, shown in your translation" onPress={() => setStep('verse')} />
          <ListRow Icon={Play} title="Send one of my recordings" onPress={() => setStep('recording')} />
          <ListRow
            Icon={Mic}
            title="Ask for a recording"
            subtitle={isDM ? `${other?.otherName.split(' ')[0] || 'They'} can say "I will" and record it for you` : 'Anyone in the circle can take it on'}
            onPress={() => setStep('request')}
          />
          {isDM && otherIsFriend ? (
            <ListRow Icon={Target} title="Quiz them" subtitle="Pick one of their verses for them to recite" onPress={() => setStep('quiz')} />
          ) : null}
          {isDM && onChallenge ? (
            <ListRow
              Icon={Trophy}
              title="Race a passage"
              subtitle="Who memorizes it first"
              onPress={() => {
                onClose();
                onChallenge();
              }}
            />
          ) : null}
        </GroupedList>
      ) : null}

      {step === 'verse' ? (
        <>
          <PassageRangeForm
            submitLabel="Share"
            hint={`Leave the verses blank to share the whole chapter. Shown in ${state.selectedTranslationId}; each person sees it in that translation.`}
            accessoryID={ATTACH_ACCESSORY_ID}
            onCancel={() => setStep('menu')}
            onSubmit={async (range) => {
              const book = getBookByName(range.book);
              if (!book) return;
              const start = range.startVerse ?? 1;
              let end = range.endVerse ?? range.startVerse;
              if (end === undefined) {
                const text = await fetchChapterText(state.selectedTranslationId, book.id, range.startChapter).catch(() => null);
                end = text?.verseCount ?? start;
              }
              const attachment: VerseAttachment = {
                kind: 'verse',
                translationId: state.selectedTranslationId,
                book: book.name,
                bookId: book.id,
                chapter: range.startChapter,
                startVerse: start,
                endVerse: Math.max(start, end),
              };
              await post(attachmentFallbackText(attachment, myName), attachment);
            }}
          />
          <NumericKeyboardAccessory nativeID={ATTACH_ACCESSORY_ID} />
        </>
      ) : null}

      {step === 'recording' ? <RecordingPicker state={state} onPick={async (rec) => {
        const ok = await state.sendRecordingToChat(rec, scope, containerId);
        if (ok) onClose();
      }} /> : null}

      {step === 'request' ? (
        <>
          <View style={{ gap: space(4) }}>
            <AppText variant="caption" className="font-sans font-medium text-ink-2">
              Translation
            </AppText>
            <Dropdown value={requestTranslation} options={TRANSLATION_OPTIONS} title="Translation" onChange={setRequestTranslation} />
          </View>
          <PassageRangeForm
            submitLabel="Ask"
            hint="Leave the verses blank to ask for the whole chapter."
            accessoryID={ATTACH_ACCESSORY_ID}
            onCancel={() => setStep('menu')}
            onSubmit={async (range) => {
              const attachment: RecordingRequestAttachment = {
                kind: 'recordingRequest',
                book: range.book,
                chapter: range.startChapter,
                startVerse: range.startVerse,
                endVerse: range.endVerse ?? range.startVerse,
                translationId: requestTranslation,
              };
              await post(attachmentFallbackText(attachment, myName), attachment);
            }}
          />
          <NumericKeyboardAccessory nativeID={ATTACH_ACCESSORY_ID} />
        </>
      ) : null}

      {step === 'quiz' && other ? (
        <QuizPicker
          state={state}
          friendUid={other.otherUid}
          friendName={other.otherName}
          onPick={async (v, hidePercent) => {
            const book = getBookByName(v.book);
            if (!book) return;
            const attachment: QuizAttachment = {
              kind: 'quiz',
              toUid: other.otherUid,
              translationId: v.translationId || 'BSB',
              book: book.name,
              bookId: book.id,
              chapter: v.chapter,
              verse: v.verseNumber,
              hidePercent,
            };
            await post(attachmentFallbackText(attachment, myName), attachment);
          }}
        />
      ) : null}

      {step !== 'menu' && step !== 'verse' && step !== 'request' ? (
        <AppButton variant="quiet" label="Back" onPress={() => setStep('menu')} />
      ) : null}
    </Dialog>
  );
}

function RecordingPicker({ state, onPick }: { state: AppState; onPick: (rec: AppState['userRecordings'][number]) => void }) {
  const playable = state.userRecordings.filter((r) => r.audioUrl);
  if (playable.length === 0) {
    return <EmptyState Icon={Mic} title="No recordings yet" message="Record a passage on the Record tab, then you can send it here." />;
  }
  return (
    <GroupedList>
      {playable.slice(0, 30).map((rec) => (
        <ListRow key={rec.id} Icon={Play} title={recordingLabel(rec)} subtitle={recordingMeta(rec)} onPress={() => onPick(rec)} />
      ))}
    </GroupedList>
  );
}

function QuizPicker({
  state,
  friendUid,
  friendName,
  onPick,
}: {
  state: AppState;
  friendUid: string;
  friendName: string;
  onPick: (verse: QuizVerse, hidePercent: number) => void;
}) {
  const space = useScaledSpace();
  const [verses, setVerses] = useState<QuizVerse[] | null | undefined>(undefined);
  const [hidePercent, setHidePercent] = useState(50);
  const first = friendName.split(' ')[0];

  useEffect(() => {
    let live = true;
    state.loadFriendQuizVerses(friendUid).then((v) => live && setVerses(v));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendUid]);

  if (verses === undefined) {
    return (
      <AppText variant="label" className="font-sans text-ink-3 text-center" style={{ paddingVertical: space(16) }}>
        Loading {first}'s verses…
      </AppText>
    );
  }
  if (!verses || verses.length === 0) {
    return (
      <EmptyState
        Icon={Target}
        title={verses ? `${first} hasn't started any verses yet` : `${first} keeps their verses private`}
        message={
          verses
            ? 'Once they begin learning a verse, you can quiz them on it.'
            : `You can quiz friends on the verses they share. ${first} can turn that on in Settings, under who can see their verses.`
        }
      />
    );
  }

  const sorted = [...verses].sort((a, b) => a.book.localeCompare(b.book) || a.chapter - b.chapter || a.verseNumber - b.verseNumber);
  return (
    <View style={{ gap: space(12) }}>
      <View style={{ gap: space(6) }}>
        <AppText variant="caption" className="font-sans font-semibold text-ink-2">
          Words hidden
        </AppText>
        <ChipRow options={HIDE_OPTIONS} value={hidePercent} onChange={setHidePercent} />
      </View>
      <AppButton
        variant="secondary"
        Icon={Shuffle}
        label="Surprise me"
        onPress={() => onPick(sorted[Math.floor(Math.random() * sorted.length)], hidePercent)}
      />
      <GroupedList header={`${first}'s verses · ${sorted.length}`}>
        {sorted.slice(0, 100).map((v) => (
          <ListRow
            key={`${v.translationId}_${v.book}_${v.chapter}_${v.verseNumber}`}
            title={passageLabel({ book: v.book, chapter: v.chapter, startVerse: v.verseNumber })}
            value={v.translationId}
            onPress={() => onPick(v, hidePercent)}
          />
        ))}
      </GroupedList>
    </View>
  );
}
