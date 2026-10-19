import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Ban, Bell } from 'lucide-react-native';

import type { AppState } from '../state/useAppState';
import { ChipRow } from './ui';
import { AppButton, Switch, useScaledSpace } from './design';
import { Dialog, GroupedList, ListRow, SectionHeader } from './blocks';

// Times offered for the daily reminder. A fixed list rather than a clock
// picker: no new native dependency, and nobody needs 7:43.
const REMINDER_TIMES = [6, 7, 8, 9, 12, 17, 19, 21].map((h) => ({
  id: h,
  label: h === 12 ? 'Noon' : h < 12 ? `${h} AM` : `${h - 12} PM`,
}));

/** Settings > Notifications: the review reminder and which social pushes come through. */
export function NotificationSettings({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const { notificationPrefs: prefs, notificationPermission: permission, updateNotificationPrefs: update } = state;

  if (permission === 'unsupported') {
    return (
      <GroupedList header="Notifications" footer="Reminders and message notifications work in the phone app.">
        <ListRow Icon={Bell} title="Not available here" accessory="none" />
      </GroupedList>
    );
  }

  if (permission !== 'granted') {
    return (
      <GroupedList
        header="Notifications"
        footer={
          permission === 'denied'
            ? 'Notifications are turned off for this app in your phone’s settings.'
            : 'Get a daily reminder when verses are due, and hear about messages, friend requests and challenges.'
        }
      >
        <ListRow
          Icon={Bell}
          title={permission === 'denied' ? 'Open phone settings' : 'Turn on notifications'}
          onPress={() => (permission === 'denied' ? Linking.openSettings() : state.requestNotificationPermission())}
        />
      </GroupedList>
    );
  }

  return (
    <View style={{ gap: space(12) }}>
      <GroupedList header="Notifications">
        <ListRow
          title="Daily review reminder"
          subtitle="Only on days with verses to review or learn"
          accessory={<Switch value={prefs.reviewReminder} onChange={(v) => update({ reviewReminder: v })} accessibilityLabel="Daily review reminder" />}
        />
        <ListRow
          title="Messages"
          accessory={<Switch value={prefs.messages} onChange={(v) => update({ messages: v })} accessibilityLabel="Message notifications" />}
        />
        <ListRow
          title="Circle chats"
          accessory={<Switch value={prefs.circleChat} onChange={(v) => update({ circleChat: v })} accessibilityLabel="Circle chat notifications" />}
        />
        <ListRow
          title="Friends"
          subtitle="Requests, nudges, challenges, quizzes and recording requests"
          accessory={<Switch value={prefs.friendActivity} onChange={(v) => update({ friendActivity: v })} accessibilityLabel="Friend notifications" />}
        />
      </GroupedList>
      {prefs.reviewReminder ? (
        <View style={{ gap: space(6) }}>
          <SectionHeader title="Remind me at" />
          <ChipRow wrap options={REMINDER_TIMES} value={prefs.reminderHour} onChange={(h) => update({ reminderHour: h, reminderMinute: 0 })} />
        </View>
      ) : null}
    </View>
  );
}

/** Settings > Blocked people, with Unblock. */
export function BlockedPeopleSettings({ state }: { state: AppState }) {
  const [confirm, setConfirm] = useState<{ uid: string; name: string } | null>(null);
  const { blockedUsers } = state;
  return (
    <>
      <GroupedList
        header={`Blocked people${blockedUsers.length ? ` · ${blockedUsers.length}` : ''}`}
        footer="Blocked people can't message, nudge, friend-request or challenge you, and you won't see their posts. They aren't told."
      >
        {blockedUsers.length === 0 ? (
          <ListRow Icon={Ban} title="No one" accessory="none" />
        ) : (
          blockedUsers.map((b) => (
            <ListRow key={b.uid} Icon={Ban} title={b.displayName} value="Unblock" onPress={() => setConfirm({ uid: b.uid, name: b.displayName })} />
          ))
        )}
      </GroupedList>
      <Dialog
        visible={!!confirm}
        onClose={() => setConfirm(null)}
        title={`Unblock ${confirm?.name}?`}
        message="They'll be able to find you and send a friend request again. Any friendship that ended when you blocked them doesn't come back on its own."
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setConfirm(null)} />
            <AppButton
              variant="primary"
              label="Unblock"
              onPress={() => {
                if (confirm) state.unblockUser(confirm.uid);
                setConfirm(null);
              }}
            />
          </>
        }
      />
    </>
  );
}

/** Where the community guidelines can be read again. */
export function GuidelinesRow({ state }: { state: AppState }) {
  return (
    <GroupedList>
      <ListRow title="Community guidelines" onPress={state.requireCommunityGuidelines} />
    </GroupedList>
  );
}

