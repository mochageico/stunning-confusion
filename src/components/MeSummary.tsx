import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Bell, BellDot, ChevronRight, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { AppIconButton, AppText, useFontScale, useScaledSpace } from './design';
import { Avatar, Badge, Dialog, GroupedList, ListRow, SectionHeader } from './blocks';
import { ActivityHeatmap } from './ActivityHeatmap';
import { useThemeColors } from './theme';

// ============================================================================
// The top of the Me tab (UI simplify Job 10): who you are and how it's going.
// Avatar, name and streak; three numbers; the past 13 weeks; the next streak
// and verse milestones only (R7, "All" opens the rest); and Notifications
// with a count. Settings rows follow it on the same page (SettingsScreen
// with `asMe`).
// ============================================================================

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 365];
export const MEMORIZED_MILESTONES = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

/** "6h", "45m": short enough to sit under a big number. */
function shortStudyTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  if (hours >= 1) return `${hours}h`;
  return `${Math.floor(totalSeconds / 60)}m`;
}

export function MeSummary({ state, onOpenAccount, onOpenNotificationSettings }: { state: AppState; onOpenAccount: () => void; onOpenNotificationSettings: () => void }) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const {
    user,
    memoryQueue,
    memoryStreak,
    totalStudySeconds,
    activityLast90Days,
    navigateTo,
    receivedAccountabilityNudges,
    markAccountabilityNudgeRead,
    dismissAccountabilityNudge,
  } = state;
  const [showNotes, setShowNotes] = useState(false);

  const name = user?.displayName || 'Friend';
  // Learned: anything past Learning (Settling, Steady, Kept, Secure).
  const learned = memoryQueue.filter((i) => i.status === 'reviewing' || i.status === 'retained').length;
  const reviews = memoryQueue.reduce((sum, i) => sum + (i.totalSuccessfulReviews || 0), 0);
  const unread = receivedAccountabilityNudges.filter((n) => !n.read).length;

  const nextStreak = STREAK_MILESTONES.find((m) => m > memoryStreak);
  const nextVerses = MEMORIZED_MILESTONES.find((m) => m > learned);

  return (
    <>
      {/* Who you are. Tapping it opens the account page. */}
      <Pressable
        onPress={onOpenAccount}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${memoryStreak}-day streak. Account`}
        className="flex-row items-center active:opacity-70"
        style={{ gap: space(14) }}
      >
        <Avatar name={name} photoUri={user?.photoURL} size={56} />
        <View className="flex-1" style={{ gap: space(2) }}>
          <AppText variant="title" className="font-sans font-bold text-ink" numberOfLines={1}>
            {name}
          </AppText>
          <AppText variant="label" className="font-sans text-ink-2">
            {memoryStreak}-day streak
          </AppText>
        </View>
        <ChevronRight size={Math.round(18 * scale)} color={palette.ink3} />
      </Pressable>

      <View className="bg-surface border border-line rounded-card flex-row" style={{ paddingVertical: space(14) }}>
        {[
          { value: learned, label: 'Memorized' },
          { value: reviews, label: 'Reviews' },
          { value: shortStudyTime(totalStudySeconds), label: 'Studied' },
        ].map((s, i) => (
          <View key={s.label} className={`flex-1 items-center ${i ? 'border-l border-hairline' : ''}`} style={{ paddingHorizontal: space(4) }}>
            <AppText variant="display" className="font-sans font-bold text-ink">
              {String(s.value)}
            </AppText>
            <AppText variant="caption" maxScale={1.2} className="font-sans text-ink-3" numberOfLines={1}>
              {s.label}
            </AppText>
          </View>
        ))}
      </View>

      <View style={{ gap: space(6) }}>
        <SectionHeader title="Past 13 weeks" actionLabel="History" onAction={() => navigateTo('fullHistory')} />
        <View className="bg-surface border border-line rounded-card" style={{ padding: space(12) }}>
          <ActivityHeatmap days={activityLast90Days} />
        </View>
      </View>

      <GroupedList header="Milestones" >
        {nextStreak !== undefined && (
          <ListRow title={`Next: ${nextStreak}-day streak`} value={`${nextStreak - memoryStreak} to go`} accessory="none" />
        )}
        {nextVerses !== undefined && <ListRow title={`Next: ${nextVerses} verses`} value={`${nextVerses - learned} to go`} accessory="none" />}
        <ListRow title="All milestones" onPress={() => navigateTo('dashboard')} />
      </GroupedList>

      <GroupedList>
        <ListRow
          Icon={unread > 0 ? BellDot : Bell}
          title="Notifications"
          accessory={unread > 0 ? <Badge label={String(unread)} tone="accent" /> : undefined}
          onPress={() => setShowNotes(true)}
        />
      </GroupedList>

      {/* Nudges from friends, in a centered pop-up: tap to mark read, X to
          dismiss. The notification settings sit at its foot. */}
      <Dialog visible={showNotes} onClose={() => setShowNotes(false)} title="Notifications" placement="center">
        <GroupedList>
          {receivedAccountabilityNudges.length === 0 ? (
            <ListRow Icon={Bell} title="Nothing new" accessory="none" />
          ) : (
            receivedAccountabilityNudges.map((n) => (
              <ListRow
                key={n.id}
                Icon={n.read ? Bell : BellDot}
                title={n.fromName}
                subtitle={n.message}
                onPress={() => !n.read && markAccountabilityNudgeRead(n.id)}
                accessory={
                  <AppIconButton
                    Icon={X}
                    variant="bare"
                    diameter={30}
                    iconColor={palette.ink3}
                    accessibilityLabel={`Dismiss note from ${n.fromName}`}
                    onPress={() => dismissAccountabilityNudge(n.id)}
                  />
                }
              />
            ))
          )}
        </GroupedList>
        <GroupedList>
          <ListRow
            title="Notification settings"
            onPress={() => {
              setShowNotes(false);
              onOpenNotificationSettings();
            }}
          />
        </GroupedList>
      </Dialog>
    </>
  );
}
