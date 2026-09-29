import { ScrollView, View } from 'react-native';
import { BarChart3, Bell, Settings as SettingsIcon, UserPlus, Users, X } from 'lucide-react-native';

import { FadeInView } from '../components/ui';
import { AppState } from '../state/useAppState';
import { AppIconButton, AppText, useScaledSpace } from '../components/design';
import { Avatar, Badge, GroupedList, ListRow, ScreenHeader, StatRow } from '../components/blocks';
import { useThemeColors } from '../components/theme';

export default function ProfileScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const {
    user,
    memoryQueue,
    learningCount,
    memoryStreak,
    myCircles,
    friends,
    incomingFriendRequests,
    setCurrentTab,
    navigateTo,
    receivedAccountabilityNudges,
    markAccountabilityNudgeRead,
    dismissAccountabilityNudge,
  } = state;

  // "Memorized" here means verses learned -- graduated out of the initial
  // Learning phase into spaced review (Daily/Weekly/Monthly) or fully
  // retained, not just the narrower retained-only memorizedCount.
  const versesLearnedCount = memoryQueue.filter(
    (item) => item.status === 'reviewing' || item.status === 'retained'
  ).length;

  const unreadNudges = receivedAccountabilityNudges.filter((n) => !n.read).length;
  const name = user?.displayName || 'Friend';

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        {/* Settings is the one control up here, top right. Sign out lives in
            Settings, and Messages sits on Community, where the people are. */}
        <ScreenHeader
          title="Profile"
          actions={
            <AppIconButton
              Icon={SettingsIcon}
              variant="outline"
              diameter={36}
              accessibilityLabel="Settings"
              onPress={() => navigateTo('settings')}
            />
          }
        />

        <View className="flex-row items-center" style={{ gap: space(14) }}>
          <Avatar name={name} photoUri={user?.photoURL} size={56} />
          <AppText variant="title" className="font-sans font-bold text-ink flex-1">
            {name}
          </AppText>
        </View>

        <View style={{ gap: space(12) }}>
          <StatRow
            stats={[
              { label: 'Memorized', value: versesLearnedCount },
              { label: 'Learning', value: learningCount },
              // One word each, so no label wraps and pushes its number off the
              // line the others share.
              { label: 'Streak', value: memoryStreak },
            ]}
          />
          <GroupedList>
            <ListRow Icon={BarChart3} title="My progress" onPress={() => navigateTo('dashboard')} />
          </GroupedList>
        </View>

        {/* Nudges from friends. A flat recent list: tap to mark read, X to
            dismiss. Accountability is the only notification type so far. */}
        {receivedAccountabilityNudges.length > 0 && (
          <GroupedList header={unreadNudges > 0 ? `Notifications · ${unreadNudges} new` : 'Notifications'}>
            {receivedAccountabilityNudges.map((n) => (
              <ListRow
                key={n.id}
                Icon={Bell}
                title={n.fromName}
                subtitle={n.message}
                onPress={() => !n.read && markAccountabilityNudgeRead(n.id)}
                accessory={
                  <View className="flex-row items-center" style={{ gap: space(6) }}>
                    {!n.read && <Badge label="New" tone="accent" />}
                    <AppIconButton
                      Icon={X}
                      variant="bare"
                      diameter={30}
                      iconColor={palette.ink3}
                      accessibilityLabel={`Dismiss note from ${n.fromName}`}
                      onPress={() => dismissAccountabilityNudge(n.id)}
                    />
                  </View>
                }
              />
            ))}
          </GroupedList>
        )}

        {/* Friends and circles live on Community. These rows are doors to it,
            with the counts, rather than a second copy of both lists. */}
        <GroupedList>
          <ListRow
            Icon={UserPlus}
            title="Friends"
            value={incomingFriendRequests.length > 0 ? `${incomingFriendRequests.length} ${incomingFriendRequests.length === 1 ? 'request' : 'requests'}` : String(friends.length)}
            onPress={() => setCurrentTab('community')}
          />
          <ListRow Icon={Users} title="Circles" value={String(myCircles.length)} onPress={() => setCurrentTab('community')} />
        </GroupedList>
      </ScrollView>
    </FadeInView>
  );
}
