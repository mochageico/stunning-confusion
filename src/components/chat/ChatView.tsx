import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, Send } from 'lucide-react-native';

import type { AppState } from '../../state/useAppState';
import type { ChatScope } from '../../state/useSocial';
import type { ChatMessage } from '../../types';
import { REACTION_EMOJIS } from '../../data';
import { formatClockTime, formatDate } from '../../lib/format';
import { useKeyboardHeight } from '../ui';
import { ReactionBar } from '../ReactionBar';
import { AppButton, AppIconButton, AppText, AppTextInput, useScaledSpace } from '../design';
import { Avatar, Dialog } from '../blocks';
import { AttachmentCard, CardActions } from './AttachmentCard';
import { BlockConfirmDialog, ReportSheet } from './ReportSheet';
import { AttachMenu } from './AttachMenu';

// ============================================================================
// ONE CHAT
// ----------------------------------------------------------------------------
// DMThreadScreen and CircleChatScreen used to be two near-copies of the same
// list and composer. Both are this now; each screen supplies its header and
// anything it pins above the list (a DM's race challenges).
//
// What it adds over the old copies: day dividers and times, avatars and
// names grouped by sender, a "New messages" line where you left off, a
// long-press menu (react, copy, delete, report, block), cards for verses /
// recordings / requests / quizzes, and a + button to send those.
// ============================================================================

/** Messages from one person within this long of each other share a header and a time. */
const GROUP_GAP_MS = 5 * 60 * 1000;

export function ChatView({
  state,
  scope,
  containerId,
  messages,
  loading,
  emptyText,
  placeholder,
  canModerate = false,
  above,
  composerReplacement,
  onChallenge,
}: {
  state: AppState;
  scope: ChatScope;
  containerId: string;
  messages: ChatMessage[];
  loading: boolean;
  emptyText: string;
  placeholder: string;
  /** Circle leader: may delete anyone's message. */
  canModerate?: boolean;
  /** Pinned above the list (a DM's race challenges). */
  above?: React.ReactNode;
  /** Shown instead of the composer (a DM that went read-only). */
  composerReplacement?: React.ReactNode;
  /** DM only: the + menu's "Race a passage". */
  onChallenge?: () => void;
}) {
  const space = useScaledSpace();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const scrollRef = useRef<ScrollView>(null);
  const myUid = state.user?.uid as string | undefined;
  const isDM = scope === 'dm';

  const [draft, setDraft] = useState('');
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);
  const [reportFor, setReportFor] = useState<ChatMessage | null>(null);
  const [blockFor, setBlockFor] = useState<{ uid: string; name: string } | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);

  // Where I'd read up to when this chat opened. Captured once: the marker
  // moves forward as soon as the messages load, and the line must not jump.
  const [initialMarker] = useState(() => state.readMarkerFor(scope, containerId));
  const firstUnreadId = useMemo(() => {
    if (!initialMarker) return null;
    return messages.find((m) => m.createdAt > initialMarker && m.fromUid !== myUid)?.id ?? null;
  }, [initialMarker, messages, myUid]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    if (!state.guidelinesAcceptedAt) {
      state.requireCommunityGuidelines();
      return;
    }
    setDraft('');
    const ok = isDM ? await state.sendDMMessage(text) : await state.sendCircleMessage(text);
    if (!ok) {
      setDraft(text);
      return;
    }
    void state.maybeAskForNotifications(
      isDM && state.activeDMThread ? `Know when ${state.activeDMThread.otherName.split(' ')[0]} replies?` : 'Know when your circle replies?'
    );
  };

  const toggleReaction = (messageId: string, emoji: string) => state.toggleReaction(scope, containerId, messageId, emoji);

  const cardActions: CardActions = {
    onOpenChapter: (book, chapter) => state.navigateTo('chapterLanding', book, chapter, { keepBack: true }),
    onPlayRecording: (id) => void state.playChatRecording(id),
    onSaveRecording: (id) => void state.saveChatRecording(id),
    isRecordingSaved: (id) => state.isChatRecordingSaved(id),
    onWillRecord: (message) => state.startRecordingForRequest(scope, containerId, message),
    onNotNow: (message) => void state.respondToCard(scope, containerId, message.id, 'notNow'),
    onOpenQuiz: (message) => state.openQuiz(containerId, message),
  };

  const bottomPad = keyboardHeight > 0 ? keyboardHeight : insets.bottom;

  return (
    <View style={{ flex: 1 }}>
      {above}
      <ScrollView
        ref={scrollRef}
        className="flex-1 bg-canvas"
        contentContainerStyle={{ padding: space(16), gap: space(4) }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <AppText variant="label" className="text-ink-3 font-sans text-center" style={{ marginTop: space(16) }}>
            Loading…
          </AppText>
        ) : messages.length === 0 ? (
          <AppText variant="label" className="text-ink-3 font-sans text-center" style={{ marginTop: space(16) }}>
            {emptyText}
          </AppText>
        ) : (
          messages.map((msg, i) => {
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const isMine = msg.fromUid === myUid;
            const newDay = !prev || dayKey(prev.createdAt) !== dayKey(msg.createdAt);
            const startsGroup = newDay || !prev || prev.fromUid !== msg.fromUid || gap(prev, msg) > GROUP_GAP_MS || msg.id === firstUnreadId;
            const endsGroup = !next || next.fromUid !== msg.fromUid || gap(msg, next) > GROUP_GAP_MS || dayKey(next.createdAt) !== dayKey(msg.createdAt) || next.id === firstUnreadId;
            const showOthersHeader = !isDM && !isMine && startsGroup;
            return (
              <View key={msg.id} style={{ marginTop: startsGroup && i > 0 ? space(10) : 0 }}>
                {newDay ? <Divider label={dayLabel(msg.createdAt)} /> : null}
                {msg.id === firstUnreadId ? <Divider label="New messages" accent /> : null}
                <View className={`flex-row ${isMine ? 'flex-row-reverse' : ''}`} style={{ gap: space(8) }}>
                  {/* Circle chat: an avatar on the last bubble of each run, a
                      same-width spacer on the others so bubbles line up. */}
                  {!isDM && !isMine ? (
                    <View style={{ width: space(28), justifyContent: 'flex-end' }}>
                      {endsGroup ? <Avatar name={msg.fromName} photoUri={msg.fromAvatarUrl || null} size={space(28)} /> : null}
                    </View>
                  ) : null}
                  <View style={{ maxWidth: '80%', gap: space(6), alignItems: isMine ? 'flex-end' : 'flex-start' }}>
                    {showOthersHeader ? (
                      <AppText variant="caption" className="font-sans font-semibold text-ink-3" style={{ marginLeft: space(4) }}>
                        {msg.fromName}
                      </AppText>
                    ) : null}
                    {/* A message with a card shows just the card -- its text
                        is only the fallback for previews and pushes. */}
                    {msg.attachment ? (
                      <Pressable
                        onPress={() => setPickerFor(pickerFor === msg.id ? null : msg.id)}
                        onLongPress={() => setMenuFor(msg)}
                        delayLongPress={350}
                        accessibilityActions={[{ name: 'longpress', label: 'More options' }]}
                        onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && setMenuFor(msg)}
                        style={{ alignSelf: 'stretch', minWidth: space(240) }}
                      >
                        <AttachmentCard
                          message={msg}
                          myUid={myUid}
                          responses={state.responsesByMessageId[msg.id] || []}
                          actions={cardActions}
                          isDM={isDM}
                        />
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => setPickerFor(pickerFor === msg.id ? null : msg.id)}
                        onLongPress={() => setMenuFor(msg)}
                        delayLongPress={350}
                        accessibilityRole="button"
                        accessibilityLabel={`${isMine ? 'You' : msg.fromName}: ${msg.text}`}
                        accessibilityHint="Tap to react. Long press for more."
                        accessibilityActions={[{ name: 'longpress', label: 'More options' }]}
                        onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && setMenuFor(msg)}
                        className={`rounded-card ${isMine ? 'bg-accent rounded-br-sm' : 'bg-surface border border-line rounded-bl-sm'}`}
                        style={{ paddingHorizontal: space(12), paddingVertical: space(8) }}
                      >
                        <AppText variant="label" className={`font-sans ${isMine ? 'text-on-accent' : 'text-ink'}`}>
                          {msg.text}
                        </AppText>
                      </Pressable>
                    )}
                  </View>
                </View>
                <View style={{ marginLeft: !isDM && !isMine ? space(36) : 0 }}>
                  <ReactionBar
                    reactions={state.reactionsByMessageId[msg.id] || []}
                    myUid={myUid}
                    align={isMine ? 'right' : 'left'}
                    pickerOpen={pickerFor === msg.id}
                    onPickerDone={() => setPickerFor(null)}
                    onToggle={(emoji) => toggleReaction(msg.id, emoji)}
                  />
                </View>
                {endsGroup ? (
                  <AppText
                    variant="caption"
                    className={`font-sans text-ink-3 ${isMine ? 'text-right' : ''}`}
                    style={{ marginTop: space(3), marginLeft: !isDM && !isMine ? space(40) : space(4), marginRight: space(4) }}
                  >
                    {formatClockTime(msg.createdAt)}
                  </AppText>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>

      {composerReplacement ?? (
        <View
          className="flex-row items-end border-t border-hairline bg-surface"
          style={{ gap: space(8), paddingHorizontal: space(12), paddingTop: space(10), paddingBottom: Math.max(bottomPad, 12) }}
        >
          <AppIconButton Icon={Plus} variant="outline" diameter={40} accessibilityLabel="Share a verse, recording or more" onPress={() => setAttachOpen(true)} />
          <AppTextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder}
            accessibilityLabel="Message"
            variant="body"
            multiline
            numberOfLines={1}
            maxLength={2000}
            className="flex-1 bg-surface-2 border border-line rounded-btn text-ink font-sans"
            style={{ paddingHorizontal: space(12), paddingVertical: space(8), minHeight: space(40), maxHeight: 120 }}
          />
          <AppIconButton Icon={Send} variant="filled" diameter={40} onPress={send} disabled={!draft.trim()} accessibilityLabel="Send" />
        </View>
      )}

      <MessageMenu
        message={menuFor}
        isMine={menuFor?.fromUid === myUid}
        canDelete={!!menuFor && (menuFor.fromUid === myUid || canModerate)}
        onClose={() => setMenuFor(null)}
        onReact={(emoji) => menuFor && toggleReaction(menuFor.id, emoji)}
        onDelete={() => menuFor && state.deleteChatMessage(scope, containerId, menuFor)}
        onReport={() => setReportFor(menuFor)}
        onBlock={() => menuFor && setBlockFor({ uid: menuFor.fromUid, name: menuFor.fromName })}
      />

      <ReportSheet
        visible={!!reportFor}
        title="Report message"
        subjectName={reportFor?.fromName}
        onClose={() => setReportFor(null)}
        onSubmit={async ({ reason, note, alsoBlock }) => {
          if (!reportFor) return;
          await state.reportContent({
            kind: isDM ? 'dmMessage' : 'circleMessage',
            targetUid: reportFor.fromUid,
            targetPath: `${isDM ? 'dmThreads' : 'circles'}/${containerId}/messages/${reportFor.id}`,
            contentSnapshot: reportFor.text,
            reason,
            note,
          });
          if (alsoBlock) await state.blockUser(reportFor.fromUid, reportFor.fromName);
        }}
      />

      <BlockConfirmDialog
        visible={!!blockFor}
        name={blockFor?.name || ''}
        onClose={() => setBlockFor(null)}
        onConfirm={() => blockFor && state.blockUser(blockFor.uid, blockFor.name)}
      />

      <AttachMenu state={state} visible={attachOpen} scope={scope} containerId={containerId} onClose={() => setAttachOpen(false)} onChallenge={onChallenge} />
    </View>
  );
}

const dayKey = (iso: string) => new Date(iso).toDateString();
/** "Today", "Yesterday", else "Saturday, October 17". */
const dayLabel = (iso: string) => {
  const rel = formatDate(iso, 'relative');
  return rel === 'Today' || rel === 'Yesterday' ? rel : formatDate(iso, 'long');
};
const gap = (a: ChatMessage, b: ChatMessage) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

function Divider({ label, accent = false }: { label: string; accent?: boolean }) {
  const space = useScaledSpace();
  return (
    <View className="flex-row items-center" style={{ gap: space(10), marginVertical: space(10) }}>
      <View className={`flex-1 h-px ${accent ? 'bg-accent' : 'bg-line'}`} />
      <AppText variant="caption" className={`font-sans font-semibold ${accent ? 'text-accent' : 'text-ink-3'}`}>
        {label}
      </AppText>
      <View className={`flex-1 h-px ${accent ? 'bg-accent' : 'bg-line'}`} />
    </View>
  );
}

function MessageMenu({
  message,
  isMine,
  canDelete,
  onClose,
  onReact,
  onDelete,
  onReport,
  onBlock,
}: {
  message: ChatMessage | null;
  isMine: boolean;
  canDelete: boolean;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onDelete: () => void;
  onReport: () => void;
  onBlock: () => void;
}) {
  const space = useScaledSpace();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const close = () => {
    setConfirmDelete(false);
    onClose();
  };
  const then = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <Dialog visible={!!message} onClose={close} placement="sheet" title={isMine ? 'Your message' : message?.fromName}>
      <View className="flex-row flex-wrap" style={{ gap: space(8) }}>
        {REACTION_EMOJIS.map((emoji) => (
          <Pressable
            key={emoji}
            onPress={then(() => onReact(emoji))}
            accessibilityRole="button"
            accessibilityLabel={`React ${emoji}`}
            className="bg-surface-2 border border-line rounded-full items-center justify-center"
            style={{ width: space(48), height: space(48) }}
          >
            <AppText variant="title">{emoji}</AppText>
          </Pressable>
        ))}
      </View>
      <View style={{ gap: space(8) }}>
        <AppButton variant="secondary" label="Copy text" onPress={then(() => message && Clipboard.setStringAsync(message.text))} />
        {canDelete ? (
          confirmDelete ? (
            <AppButton variant="destructive" label={isMine ? 'Delete for everyone' : 'Remove this message'} onPress={then(onDelete)} />
          ) : (
            <AppButton variant="secondary" label={isMine ? 'Delete' : 'Remove (you lead this circle)'} onPress={() => setConfirmDelete(true)} />
          )
        ) : null}
        {!isMine ? (
          <>
            <AppButton variant="secondary" label="Report message" onPress={then(onReport)} />
            <AppButton variant="secondary" label={`Block ${message?.fromName.split(' ')[0] || ''}`} onPress={then(onBlock)} />
          </>
        ) : null}
      </View>
    </Dialog>
  );
}
