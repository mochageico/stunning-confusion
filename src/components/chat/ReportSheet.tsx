import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { REPORT_REASONS } from '../../state/useSocial';
import { AppButton, AppText, AppTextInput, RadioMark, useScaledSpace } from '../design';
import { Dialog } from '../blocks';

/**
 * "Report" for anything people can post: a person, a message, a recording,
 * a circle. Picks a reason, takes an optional note, and offers to block the
 * person in the same step (most people reporting someone also want them
 * gone). The caller does the actual writes.
 */
export function ReportSheet({
  visible,
  title,
  subjectName,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  /** Whose content this is -- shows "Also block <name>". Omit for a circle. */
  subjectName?: string;
  onClose: () => void;
  onSubmit: (input: { reason: string; note: string; alsoBlock: boolean }) => Promise<void> | void;
}) {
  const space = useScaledSpace();
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (visible) {
      setReason(null);
      setNote('');
      setAlsoBlock(false);
      setSending(false);
    }
  }, [visible]);

  const submit = async () => {
    if (!reason || sending) return;
    setSending(true);
    await onSubmit({ reason, note: note.trim(), alsoBlock });
    setSending(false);
    onClose();
  };

  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      placement="sheet"
      title={title}
      actions={
        <>
          <AppButton variant="quiet" label="Cancel" onPress={onClose} />
          <AppButton variant="destructive" label={sending ? 'Sending…' : 'Send report'} disabled={!reason || sending} onPress={submit} />
        </>
      }
    >
      <AppText variant="body" className="font-sans text-ink-2">
        Reports are private. We review every one within 24 hours and remove anything that breaks the community guidelines.
      </AppText>
      <View style={{ gap: space(2) }}>
        {REPORT_REASONS.map((r) => (
          <Pressable
            key={r.id}
            onPress={() => setReason(r.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: reason === r.id }}
            className="flex-row items-center"
            style={{ gap: space(12), paddingVertical: space(10) }}
          >
            <RadioMark selected={reason === r.id} />
            <AppText variant="body" className="font-sans text-ink flex-1">
              {r.label}
            </AppText>
          </Pressable>
        ))}
      </View>
      <AppTextInput
        value={note}
        onChangeText={setNote}
        placeholder="Anything else we should know? (optional)"
        accessibilityLabel="Details (optional)"
        variant="body"
        multiline
        maxLength={1000}
        className="bg-surface-2 border border-line rounded-btn text-ink font-sans"
        style={{ paddingHorizontal: space(12), paddingVertical: space(10), minHeight: space(72) }}
      />
      {subjectName ? (
        <Pressable
          onPress={() => setAlsoBlock((b) => !b)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: alsoBlock }}
          className="flex-row items-center"
          style={{ gap: space(12), paddingVertical: space(6) }}
        >
          <RadioMark selected={alsoBlock} />
          <View className="flex-1">
            <AppText variant="body" className="font-sans text-ink">
              Also block {subjectName}
            </AppText>
            <AppText variant="caption" className="font-sans text-ink-3">
              They won't be able to message you, and you won't see their posts.
            </AppText>
          </View>
        </Pressable>
      ) : null}
    </Dialog>
  );
}

/** "Block <name>?" confirmation, shared by profiles, chats and the feed. */
export function BlockConfirmDialog({
  visible,
  name,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  name: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      title={`Block ${name}?`}
      message={`${name} won't be able to message you, nudge you, send you a friend request or challenge you, and you won't see their messages, milestones or recordings. If you're friends, that ends too. They aren't told. You can unblock them in Settings.`}
      actions={
        <>
          <AppButton variant="quiet" label="Cancel" onPress={onClose} />
          <AppButton
            variant="destructive"
            label="Block"
            onPress={() => {
              onConfirm();
              onClose();
            }}
          />
        </>
      }
    />
  );
}
