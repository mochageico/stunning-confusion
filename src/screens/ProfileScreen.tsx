import React from 'react';
import { Bell, ChevronRight, Settings as SettingsIcon, X } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { AvatarCircle, FadeInView, HelpTooltip } from '../components/ui';
import { AppState } from '../state/useAppState';
import { AppText, useFontScale, useScaledSpace } from '../components/design';

import { useThemeColors } from '../components/theme';
export default function ProfileScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const {
    user,
    triggerToast,
    memoryQueue,
    learningCount,
    memoryStreak,
    viewMemberProfileById,
    myCircles,
    friends,
    incomingFriendRequests,
    openCircle,
    setCurrentTab,
    navigateTo,
    receivedAccountabilityNudges,
    markAccountabilityNudgeRead,
    dismissAccountabilityNudge,
  } = state;

  const scale = useFontScale();
  const space = useScaledSpace();

  // "Memorized" here means verses learned -- graduated out of the initial
  // Learning phase into spaced review (Daily/Weekly/Monthly) or fully
  // retained, not just the narrower retained-only memorizedCount.
  const versesLearnedCount = memoryQueue.filter(
    (item) => item.status === 'reviewing' || item.status === 'retained'
  ).length;

  const stats = [
    { label: 'Memorized', value: versesLearnedCount, tone: 'text-ink' },
    { label: 'Learning', value: learningCount, tone: 'text-warning' },
    // One word each. "Day streak" was the only two-word label and it wrapped
    // at 1.5x, which pushed its number off the baseline the other two shared.
    { label: 'Streak', value: memoryStreak, tone: 'text-success' },
  ];

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5" contentContainerStyle={{ gap: 16 }}>
        {/* Header row. One control: Settings. Sign Out lives in Settings and
            nowhere else (it's a once-a-year action that was sitting in the
            same visual weight class as everything you actually do here), and
            Messages moved to Community, where the people are. */}
        <View className="flex-row items-center justify-between pb-3 border-b border-line">
          <View className="flex-row items-center gap-3 flex-1 pr-2">
            <AvatarCircle photoUri={user?.photoURL} name={user?.displayName || 'Friend'} size={48} />
            {/* Name alone. The line under it said "Progress synced to your
                account" -- a reassurance nobody asked for, printed under every
                visit forever. */}
            <AppText variant="title" className="font-serif font-bold text-ink leading-tight flex-1">
              {user?.displayName || 'Friend'}
            </AppText>
          </View>

          <Pressable
            onPress={() => navigateTo('settings')}
            hitSlop={8}
            className="w-8 h-8 items-center justify-center border border-line rounded-lg bg-surface shrink-0"
          >
            <SettingsIcon size={14} color={palette.ink2} />
          </Pressable>
        </View>

        {/* MY PROGRESS — the three headline numbers and the way into the full
            breakdown, as ONE object. It was three separate bordered tiles with
            a big black button underneath repeating the same intent; the tiles
            now sit in a single card whose footer IS the button, and the whole
            card is tappable. */}
        <Pressable
          onPress={() => navigateTo('dashboard')}
          accessibilityRole="button"
          accessibilityLabel="View my full progress"
          className="border border-line rounded-2xl bg-surface overflow-hidden"
        >
          <View className="flex-row items-stretch" style={{ paddingVertical: space(14) }}>
            {stats.map((stat, index) => (
              <React.Fragment key={stat.label}>
                {index > 0 && <View className="w-px bg-fill" style={{ marginVertical: space(2) }} />}
                {/* Top-aligned, not centred: a label that wraps should grow
                    downward, never nudge its number off the line the other
                    two numbers sit on. */}
                <View className="flex-1 items-center justify-start px-1" style={{ gap: space(3) }}>
                  <AppText variant="display" className={`font-mono font-black ${stat.tone}`}>
                    {stat.value}
                  </AppText>
                  <AppText variant="micro" className="font-sans font-bold uppercase tracking-wide text-ink-3 text-center">
                    {stat.label}
                  </AppText>
                </View>
              </React.Fragment>
            ))}
          </View>

          <View
            className="flex-row items-center justify-between border-t border-line bg-surface-2"
            style={{ paddingHorizontal: space(12), paddingVertical: space(10), gap: space(8) }}
          >
            <AppText variant="micro" className="font-sans font-extrabold uppercase tracking-widest text-ink-3 flex-1">
              My Progress
            </AppText>
            <View className="flex-row items-center shrink-0" style={{ gap: space(3) }}>
              <AppText variant="micro" className="font-sans font-bold text-ink">See details</AppText>
              <ChevronRight size={Math.round(13 * scale)} color={palette.ink} />
            </View>
          </View>
        </Pressable>

        {/* NOTIFICATIONS — accountability nudges received from friends.
            Minimal v1: a flat recent list, tap to mark read, X to dismiss.
            No routing/categories yet -- accountability is the only
            notification type that exists so far. */}
        {receivedAccountabilityNudges.length > 0 && (
          <View className="gap-1.5">
            <View className="flex-row items-center px-1">
              <AppText variant="section" className="font-bold text-ink-3 tracking-wider font-sans uppercase">
                Notifications ({receivedAccountabilityNudges.filter((n) => !n.read).length} new)
              </AppText>
            </View>
            <View className="gap-1.5">
              {receivedAccountabilityNudges.map((n) => (
                <Pressable
                  key={n.id}
                  onPress={() => !n.read && markAccountabilityNudgeRead(n.id)}
                  className={`flex-row items-center gap-2 border rounded-xl p-2.5 ${
                    n.read ? 'border-line bg-surface' : 'border-warning/30 bg-warning-soft'
                  }`}
                >
                  <View className="w-7 h-7 rounded-full bg-warning-soft items-center justify-center shrink-0">
                    <Bell size={12} color={palette.warning} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText variant="caption" className="font-bold text-ink">{n.fromName}</AppText>
                    <AppText variant="caption" className="text-ink-2 font-sans mt-0.5">{n.message}</AppText>
                  </View>
                  <Pressable onPress={() => dismissAccountabilityNudge(n.id)} hitSlop={8}>
                    <X size={14} color={palette.ink3} />
                  </Pressable>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* MY FRIENDS SECTION — real, mutual, persistent connections
            (independent of circle membership, unlike the old circleFriends) */}
        <View className="gap-1.5">
          <View className="flex-row items-center justify-between px-1">
            <View className="flex-row items-center">
              <AppText variant="section" className="font-bold text-ink-3 tracking-wider font-sans uppercase">
                FRIENDS ({friends.length})
              </AppText>
              <HelpTooltip text="People who accepted your friend request, or whose request you accepted. Friends stay friends even if you leave a circle together." />
            </View>
            <Pressable
              onPress={() => navigateTo('findFriends')}
              className="bg-accent px-2 py-1 rounded relative"
            >
              <AppText variant="micro" className="text-on-accent font-sans font-bold uppercase tracking-wider">Find Friends +</AppText>
              {incomingFriendRequests.length > 0 && (
                <View className="absolute -top-1.5 -right-1.5 bg-danger w-4 h-4 rounded-full items-center justify-center border border-surface">
                  <AppText variant="micro" className="text-on-accent font-black">{incomingFriendRequests.length}</AppText>
                </View>
              )}
            </Pressable>
          </View>
          {friends.length === 0 ? (
            <AppText variant="caption" className="text-ink-3 font-sans italic px-1">
              No friends yet — search for people to add above.
            </AppText>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 6 }}>
              {friends.map((f) => {
                return (
                  <Pressable
                    key={f.uid}
                    onPress={() => viewMemberProfileById(f.uid)}
                    className="flex-row items-center gap-2 border border-line rounded-xl p-2 bg-surface shrink-0"
                  >
                    <View className="w-7 h-7 rounded-full border border-line-strong bg-accent-soft items-center justify-center">
                      <AppText variant="caption" className="font-serif font-black ">{f.displayName.charAt(0).toUpperCase()}</AppText>
                    </View>
                    <View>
                      <AppText variant="caption" className="font-bold text-ink leading-none">{f.displayName}</AppText>
                      <AppText variant="micro" className="font-sans text-ink-3 leading-none mt-0.5">View Profile</AppText>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* MY COMMUNITIES SECTION */}
        <View className="gap-1.5">
          <View className="flex-row items-center justify-between px-1">
            <View className="flex-row items-center">
              <AppText variant="section" className="font-bold text-ink-3 tracking-wider font-sans uppercase">
                COMMUNITIES ({myCircles.length})
              </AppText>
              <HelpTooltip text="The scripture circles you belong to. Tap one to open it." />
            </View>
          </View>
          <View className="gap-1.5">
            {myCircles.map((c) => {
              const role = c.ownerId === user?.uid ? 'Leader' : 'Member';
              return (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    setCurrentTab('community');
                    openCircle(c.id);
                    triggerToast(`Viewing ${c.name} Circle! 🛡️`);
                  }}
                  className="border border-line rounded-xl px-2.5 py-2 bg-surface-2 flex-row justify-between items-center"
                >
                  {/* Name only -- the description is free text of any length,
                      and this list exists to get you into a circle, not to
                      re-explain each one. */}
                  <View className="flex-1 pr-2">
                    <AppText variant="caption" className="font-sans font-bold text-ink leading-snug" numberOfLines={1}>
                      {c.name}
                    </AppText>
                  </View>
                  <AppText variant="micro" className="font-bold font-sans bg-ink text-on-accent px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0">
                    {role}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* RECORDED CHAPTERS used to sit here, duplicating the "Prior
            Recordings" list that already lives on the Record tab -- right
            where you make them, and where you'd look for them. One list, one
            home. */}
      </ScrollView>
    </FadeInView>
  );
}
