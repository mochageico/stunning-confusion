import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Ban, Bell, Clock } from 'lucide-react-native';

import { AppButton, Switch, useScaledSpace } from './design';
import { Dialog, GroupedList, ListRow, SectionHeader, SegmentedControl } from './blocks';
import { TimeWheelDialog, formatClock } from './TimeWheel';
import { useAppFields } from '../state/appStore';

/** Settings > Notifications: the review reminder and which social pushes come through. */
export function NotificationSettings() {
  const state = useAppFields(
    'notificationPermission', 'notificationPrefs', 'requestNotificationPermission',
    'updateNotificationPrefs',
  );
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
      {prefs.reviewReminder ? <ReminderTime /> : null}
    </View>
  );
}

/** When the daily reminder comes: one set time, or a random time in a window. */
function ReminderTime() {
  const state = useAppFields('notificationPrefs', 'updateNotificationPrefs');
  const space = useScaledSpace();
  const { notificationPrefs: prefs, updateNotificationPrefs: update } = state;
  const [editing, setEditing] = useState<'start' | 'end' | null>(null);
  const random = prefs.reminderMode === 'random';
  const endHour = prefs.reminderEndHour ?? 21;
  const endMinute = prefs.reminderEndMinute ?? 0;
  const backwards = random && endHour * 60 + endMinute < prefs.reminderHour * 60 + prefs.reminderMinute;

  return (
    <View style={{ gap: space(6) }}>
      <SectionHeader title="Remind me" />
      <SegmentedControl
        options={[
          { id: 'fixed', label: 'Set time' },
          { id: 'random', label: 'Random time' },
        ]}
        value={random ? 'random' : 'fixed'}
        onChange={(mode) => update({ reminderMode: mode as 'fixed' | 'random' })}
      />
      <GroupedList footer={backwards ? 'The "To" time is earlier than "From"; reminders will come between the two.' : undefined}>
        <ListRow
          Icon={Clock}
          title={random ? 'From' : 'Time'}
          value={formatClock(prefs.reminderHour, prefs.reminderMinute)}
          onPress={() => setEditing('start')}
        />
        {random ? <ListRow Icon={Clock} title="To" value={formatClock(endHour, endMinute)} onPress={() => setEditing('end')} /> : null}
      </GroupedList>
      <TimeWheelDialog
        visible={editing !== null}
        title={editing === 'end' ? 'Latest time' : random ? 'Earliest time' : 'Remind me at'}
        hour={editing === 'end' ? endHour : prefs.reminderHour}
        minute={editing === 'end' ? endMinute : prefs.reminderMinute}
        onClose={() => setEditing(null)}
        onDone={(hour, minute) => {
          update(editing === 'end' ? { reminderEndHour: hour, reminderEndMinute: minute } : { reminderHour: hour, reminderMinute: minute });
          setEditing(null);
        }}
      />
    </View>
  );
}

/** Settings > Blocked people, with Unblock. */
export function BlockedPeopleSettings() {
  const state = useAppFields('blockedUsers', 'unblockUser');
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
export function GuidelinesRow() {
  const state = useAppFields('requireCommunityGuidelines');
  return (
    <GroupedList>
      <ListRow title="Community guidelines" onPress={state.requireCommunityGuidelines} />
    </GroupedList>
  );
}

