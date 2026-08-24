import React from 'react';
import { Bell, ChevronRight, Settings as SettingsIcon, X } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { AvatarCircle, FadeInView, HelpTooltip } from '../components/ui';
import { AppState } from '../state/useAppState';
import { AppText, useFontScale, useScaledSpace } from '../components/design';

export default function ProfileScreen({ state }: { state: AppState }) {
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
    { label: 'Memorized', value: versesLearnedCount, tone: 'text-[#1A1A1A]' },
    { label: 'Learning', value: learningCount, tone: 'text-amber-600' },
    // One word each. "Day streak" was the only two-word label and it wrapped
    // at 1.5x, which pushed its number off the baseline the other two shared.
    { label: 'Streak', value: memoryStreak, tone: 'text-emerald-600' },
  ];

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5" contentContainerStyle={{ gap: 16 }}>
        {/* Header row. One control: Settings. Sign Out lives in Settings and
            nowhere else (it's a once-a-year action that was sitting in the
            same visual weight class as everything you actually do here), and
            Messages moved to Community, where the people are. */}
        <View className="flex-row items-center justify-between pb-3 border-b border-[#E5E5E5]">
          <View className="flex-row items-center gap-3 flex-1 pr-2">
            <AvatarCircle photoUri={user?.photoURL} name={user?.displayName || 'Friend'} size={48} />
            {/* Name alone. The line under it said "Progress synced to your
                account" -- a reassurance nobody asked for, printed under every
                visit forever. */}
            <AppText variant="title" className="font-serif font-bold text-[#1A1A1A] leading-tight flex-1">
              {user?.displayName || 'Friend'}
            </AppText>
          </View>

          <Pressable
            onPress={() => navigateTo('settings')}
            hitSlop={8}
            className="w-8 h-8 items-center justify-center border border-neutral-200 rounded-lg bg-white shrink-0"
          >
            <SettingsIcon size={14} color="#404040" />
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
          className="border border-[#E5E5E5] rounded-2xl bg-white overflow-hidden"
        >
          <View className="flex-row items-stretch" style={{ paddingVertical: space(14) }}>
            {stats.map((stat, index) => (
              <React.Fragment key={stat.label}>
                {index > 0 && <View className="w-px bg-[#E5E5E5]" style={{ marginVertical: space(2) }} />}
                {/* Top-aligned, not centred: a label that wraps should grow
                    downward, never nudge its number off the line the other
                    two numbers sit on. */}
                <View className="flex-1 items-center justify-start px-1" style={{ gap: space(3) }}>
                  <AppText variant="display" className={`font-mono font-black ${stat.tone}`}>
                    {stat.value}
                  </AppText>
                  <AppText variant="micro" className="font-sans font-bold uppercase tracking-wide text-neutral-400 text-center">
                    {stat.label}
                  </AppText>
                </View>
              </React.Fragment>
            ))}
          </View>

          <View
            className="flex-row items-center justify-between border-t border-[#E5E5E5] bg-[#FBF9F6]"
            style={{ paddingHorizontal: space(12), paddingVertical: space(10), gap: space(8) }}
          >
            <AppText variant="micro" className="font-sans font-extrabold uppercase tracking-widest text-neutral-500 flex-1">
              My Progress
            </AppText>
            <View className="flex-row items-center shrink-0" style={{ gap: space(3) }}>
              <AppText variant="micro" className="font-sans font-bold text-[#1A1A1A]">See details</AppText>
              <ChevronRight size={Math.round(13 * scale)} color="#1A1A1A" />
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
              <AppText variant="section" className="font-bold text-neutral-400 tracking-wider font-sans uppercase">
                Notifications ({receivedAccountabilityNudges.filter((n) => !n.read).length} new)
              </AppText>
            </View>
            <View className="gap-1.5">
              {receivedAccountabilityNudges.map((n) => (
                <Pressable
                  key={n.id}
                  onPress={() => !n.read && markAccountabilityNudgeRead(n.id)}
                  className={`flex-row items-center gap-2 border rounded-xl p-2.5 ${
                    n.read ? 'border-neutral-200 bg-white' : 'border-amber-300 bg-amber-50'
                  }`}
                >
                  <View className="w-7 h-7 rounded-full bg-amber-100 items-center justify-center shrink-0">
                    <Bell size={12} color="#b45309" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText variant="caption" className="font-bold text-neutral-800">{n.fromName}</AppText>
                    <AppText variant="caption" className="text-neutral-600 font-sans mt-0.5">{n.message}</AppText>
                  </View>
                  <Pressable onPress={() => dismissAccountabilityNudge(n.id)} hitSlop={8}>
                    <X size={14} color="#a3a3a3" />
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
              <AppText variant="section" className="font-bold text-neutral-400 tracking-wider font-sans uppercase">
                FRIENDS ({friends.length})
              </AppText>
              <HelpTooltip text="People who accepted your friend request, or whose request you accepted. Friends stay friends even if you leave a circle together." />
            </View>
            <Pressable
              onPress={() => navigateTo('findFriends')}
              className="bg-[#1A1A1A] px-2 py-1 rounded relative"
            >
              <AppText variant="micro" className="text-white font-sans font-bold uppercase tracking-wider">Find Friends +</AppText>
              {incomingFriendRequests.length > 0 && (
                <View className="absolute -top-1.5 -right-1.5 bg-red-600 w-4 h-4 rounded-full items-center justify-center border border-white">
                  <AppText variant="micro" className="text-white font-black">{incomingFriendRequests.length}</AppText>
                </View>
              )}
            </Pressable>
          </View>
          {friends.length === 0 ? (
            <AppText variant="caption" className="text-neutral-400 font-sans italic px-1">
              No friends yet — search for people to add above.
            </AppText>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 6 }}>
              {friends.map((f) => {
                return (
                  <Pressable
                    key={f.uid}
                    onPress={() => viewMemberProfileById(f.uid)}
                    className="flex-row items-center gap-2 border border-neutral-200 rounded-xl p-2 bg-white shrink-0"
                  >
                    <View className="w-7 h-7 rounded-full border border-neutral-300 bg-indigo-50 items-center justify-center">
                      <AppText variant="caption" className="font-serif font-black ">{f.displayName.charAt(0).toUpperCase()}</AppText>
                    </View>
                    <View>
                      <AppText variant="caption" className="font-bold text-neutral-800 leading-none">{f.displayName}</AppText>
                      <AppText variant="micro" className="font-sans text-neutral-400 leading-none mt-0.5">View Profile</AppText>
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
              <AppText variant="section" className="font-bold text-neutral-400 tracking-wider font-sans uppercase">
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
                  className="border border-neutral-200 rounded-xl px-2.5 py-2 bg-neutral-50/50 flex-row justify-between items-center"
                >
                  {/* Name only -- the description is free text of any length,
                      and this list exists to get you into a circle, not to
                      re-explain each one. */}
                  <View className="flex-1 pr-2">
                    <AppText variant="caption" className="font-sans font-bold text-neutral-800 leading-snug" numberOfLines={1}>
                      {c.name}
                    </AppText>
                  </View>
                  <AppText variant="micro" className="font-bold font-sans bg-neutral-900 text-white px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0">
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
