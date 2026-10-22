import { View } from 'react-native';
import { BookOpen, Check, Download, Mic, Play, Target } from 'lucide-react-native';

import type { ChatMessage } from '../../types';
import type { ChatResponse } from '../../lib/chatAttachments';
import { passageLabel } from '../../lib/chatAttachments';
import { formatDuration } from '../../lib/format';
import { useChapterText } from '../../state/useScripture';
import { AppButton, AppText, useScaledSpace } from '../design';
import { useThemeColors } from '../theme';

export interface CardActions {
  onOpenChapter: (book: string, chapter: number) => void;
  onPlayRecording: (sharedRecordingId: string) => void;
  /** Copies a recording someone shared into my own recordings. */
  onSaveRecording: (sharedRecordingId: string) => void;
  isRecordingSaved: (sharedRecordingId: string) => boolean;
  onWillRecord: (message: ChatMessage) => void;
  onNotNow: (message: ChatMessage) => void;
  onOpenQuiz: (message: ChatMessage) => void;
}

/**
 * The card under a chat message that carries one (see chatAttachments.ts).
 * Always rendered as a full-width panel rather than inside the bubble, so
 * buttons have room at the largest text size.
 */
export function AttachmentCard({
  message,
  myUid,
  responses,
  actions,
  isDM,
}: {
  message: ChatMessage;
  myUid: string | undefined;
  responses: ChatResponse[];
  actions: CardActions;
  /** In a DM, a request is for the one other person; in a circle, for anyone. */
  isDM: boolean;
}) {
  const a = message.attachment;
  if (!a) return null;
  switch (a.kind) {
    case 'verse':
      return <VerseCard book={a.book} bookId={a.bookId} chapter={a.chapter} start={a.startVerse} end={a.endVerse} translationId={a.translationId} onOpen={() => actions.onOpenChapter(a.book, a.chapter)} />;
    case 'recording':
      return (
        <CardShell Icon={Play} eyebrow={`Recording · ${a.translation}`} title={passageLabel(a)} caption={`${a.ownerName} · ${formatDuration(a.duration)}`}>
          <AppButton variant="secondary" Icon={Play} label="Play" onPress={() => actions.onPlayRecording(a.sharedRecordingId)} />
          {message.fromUid !== myUid ? <SaveButton id={a.sharedRecordingId} actions={actions} /> : null}
        </CardShell>
      );
    case 'recordingRequest':
      return <RequestCard message={message} myUid={myUid} responses={responses} actions={actions} isDM={isDM} />;
    case 'quiz':
      return <QuizCard message={message} myUid={myUid} responses={responses} actions={actions} />;
  }
}

/** Save / Saved, for a recording someone else shared. */
function SaveButton({ id, actions, label = 'Save' }: { id: string; actions: CardActions; label?: string }) {
  const saved = actions.isRecordingSaved(id);
  return (
    <AppButton
      variant={saved ? 'quiet' : 'secondary'}
      Icon={saved ? Check : Download}
      label={saved ? 'Saved' : label}
      disabled={saved}
      accessibilityLabel={saved ? 'Saved to your recordings' : 'Save to your recordings'}
      onPress={() => actions.onSaveRecording(id)}
    />
  );
}

function CardShell({
  Icon,
  eyebrow,
  title,
  caption,
  children,
}: {
  Icon: typeof Play;
  eyebrow: string;
  title: string;
  caption?: string;
  children?: React.ReactNode;
}) {
  const space = useScaledSpace();
  const palette = useThemeColors();
  return (
    <View className="bg-surface border border-line rounded-card" style={{ padding: space(12), gap: space(10) }}>
      <View className="flex-row items-start" style={{ gap: space(10) }}>
        <View className="bg-accent-soft rounded-full items-center justify-center" style={{ width: space(32), height: space(32) }}>
          <Icon size={16} color={palette.accent} strokeWidth={2.4} />
        </View>
        <View className="flex-1" style={{ gap: space(2) }}>
          <AppText variant="caption" className="font-sans font-semibold text-ink-3">
            {eyebrow}
          </AppText>
          <AppText variant="label" className="font-sans font-semibold text-ink">
            {title}
          </AppText>
          {caption ? (
            <AppText variant="caption" className="font-sans text-ink-2">
              {caption}
            </AppText>
          ) : null}
        </View>
      </View>
      {children ? <View className="flex-row flex-wrap" style={{ gap: space(8) }}>{children}</View> : null}
    </View>
  );
}

function VerseCard({
  book,
  bookId,
  chapter,
  start,
  end,
  translationId,
  onOpen,
}: {
  book: string;
  bookId: string;
  chapter: number;
  start: number;
  end: number;
  translationId: string;
  onOpen: () => void;
}) {
  const space = useScaledSpace();
  // The text isn't stored on the message (licensed translations can't be
  // copied into our database) -- each phone fetches it the normal way.
  const { data } = useChapterText(translationId, bookId, chapter);
  const lines: string[] = [];
  for (let v = start; v <= end && lines.length < 6; v++) {
    const t = data?.verses[String(v)];
    if (t) lines.push(`${v} ${t}`);
  }
  const more = end - start + 1 > lines.length && lines.length > 0;
  return (
    <CardShell Icon={BookOpen} eyebrow={`Verse · ${translationId}`} title={passageLabel({ book, chapter, startVerse: start, endVerse: end })}>
      <View style={{ gap: space(10), width: '100%' }}>
        {lines.length > 0 ? (
          <AppText variant="body" className="font-serif text-ink">
            {lines.join(' ')}
            {more ? ' …' : ''}
          </AppText>
        ) : (
          <AppText variant="caption" className="font-sans text-ink-3">
            Loading the text…
          </AppText>
        )}
        <View className="flex-row">
          <AppButton variant="secondary" Icon={BookOpen} label="Open chapter" onPress={onOpen} />
        </View>
      </View>
    </CardShell>
  );
}

function RequestCard({
  message,
  myUid,
  responses,
  actions,
  isDM,
}: {
  message: ChatMessage;
  myUid: string | undefined;
  responses: ChatResponse[];
  actions: CardActions;
  isDM: boolean;
}) {
  const space = useScaledSpace();
  const palette = useThemeColors();
  const a = message.attachment;
  if (!a || a.kind !== 'recordingRequest') return null;
  const asker = message.fromUid === myUid;
  const mine = responses.find((r) => r.uid === myUid);
  const done = responses.filter((r) => r.status === 'done' && r.sharedRecordingId);
  const willDo = responses.filter((r) => r.status === 'willDo');
  const title = a.translationId ? `${passageLabel(a)} · ${a.translationId}` : passageLabel(a);
  const eyebrow = asker ? 'You asked for a recording' : `${message.fromName} asked for a recording`;

  let caption: string;
  if (done.length > 0) caption = `${done.map((r) => (r.uid === myUid ? 'You' : r.name)).join(', ')} recorded it.`;
  else if (willDo.length > 0) caption = `${willDo.map((r) => (r.uid === myUid ? 'You' : r.name)).join(', ')} said "I will".`;
  else if (isDM && responses.some((r) => r.status === 'notNow')) caption = 'Not right now.';
  else caption = isDM ? 'Waiting for an answer.' : 'Anyone in the circle can take this on.';

  return (
    <CardShell Icon={Mic} eyebrow={eyebrow} title={title} caption={caption}>
      {done.map((r) => (
        <View key={r.id} className="flex-row flex-wrap" style={{ gap: space(8) }}>
          <AppButton variant="secondary" Icon={Play} label={r.uid === myUid ? 'Play yours' : `Play ${r.name.split(' ')[0]}'s`} onPress={() => actions.onPlayRecording(r.sharedRecordingId!)} />
          {r.uid !== myUid ? <SaveButton id={r.sharedRecordingId!} actions={actions} /> : null}
        </View>
      ))}
      {!asker && mine?.status !== 'done' ? (
        mine?.status === 'willDo' ? (
          <>
            <AppButton variant="primary" Icon={Mic} label="Record now" onPress={() => actions.onWillRecord(message)} />
            <AppButton variant="quiet" label="Not now" onPress={() => actions.onNotNow(message)} />
          </>
        ) : (
          <>
            <AppButton variant="primary" Icon={Check} label="I will" onPress={() => actions.onWillRecord(message)} />
            {mine?.status !== 'notNow' ? <AppButton variant="quiet" label="Not now" onPress={() => actions.onNotNow(message)} /> : null}
          </>
        )
      ) : null}
      {!asker && mine?.status === 'done' ? (
        <View className="flex-row items-center" style={{ gap: space(4) }}>
          <Check size={14} color={palette.success} />
          <AppText variant="caption" className="font-sans text-ink-2">
            Sent
          </AppText>
        </View>
      ) : null}
    </CardShell>
  );
}

function QuizCard({
  message,
  myUid,
  responses,
  actions,
}: {
  message: ChatMessage;
  myUid: string | undefined;
  responses: ChatResponse[];
  actions: CardActions;
}) {
  const a = message.attachment;
  if (!a || a.kind !== 'quiz') return null;
  const forMe = a.toUid === myUid;
  const result = responses.find((r) => r.uid === a.toUid && r.status === 'done');
  const ref = `${a.book} ${a.chapter}:${a.verse}`;
  const hidden = a.hidePercent >= 100 ? 'every word hidden' : `${a.hidePercent}% of words hidden`;

  if (result) {
    const who = forMe ? 'You' : result.name.split(' ')[0];
    return <CardShell Icon={Target} eyebrow={`Quiz · ${hidden}`} title={ref} caption={`${who} got ${result.score ?? 0}%.`}>
      {forMe ? <AppButton variant="quiet" label="Try again" onPress={() => actions.onOpenQuiz(message)} /> : null}
    </CardShell>;
  }
  return (
    <CardShell
      Icon={Target}
      eyebrow={forMe ? `${message.fromName} quizzed you` : 'You sent a quiz'}
      title={ref}
      caption={forMe ? `Say or type it with ${hidden}. Just practice: it won't change your reviews.` : `${hidden}. Waiting for their answer.`}
    >
      {forMe ? <AppButton variant="primary" Icon={Target} label="Take the quiz" onPress={() => actions.onOpenQuiz(message)} /> : null}
    </CardShell>
  );
}
