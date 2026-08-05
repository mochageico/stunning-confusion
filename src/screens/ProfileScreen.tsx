import { Bell, MessageCircle, Pause, Play, Settings as SettingsIcon, X } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { AvatarCircle, FadeInView, HelpTooltip } from '../components/ui';
import { AppState } from '../state/useAppState';
import { recordingLabel } from '../lib/recordingLabel';
import { AppButton, AppText, useScaledSpace } from '../components/design';

export default function ProfileScreen({ state }: { state: AppState }) {
  const {
    user,
    triggerToast,
    memoryQueue,
    learningCount,
    activityLast15Days,
    memoryStreak,
    viewMemberProfileById,
    myCircles,
    friends,
    incomingFriendRequests,
    openCircle,
    setCurrentTab,
    userRecordings,
    playingRecordingId,
    setPlayingRecordingId,
    playingRecProgress,
    setPlayingRecProgress,
    setSelectedRecording,
    navigateTo,
    signOut,
    receivedAccountabilityNudges,
    markAccountabilityNudgeRead,
    dismissAccountabilityNudge,
  } = state;

  const space = useScaledSpace();

  // "Memorized" here means verses learned -- graduated out of the initial
  // Learning phase into spaced review (Daily/Weekly/Monthly) or fully
  // retained, not just the narrower retained-only memorizedCount.
  const versesLearnedCount = memoryQueue.filter(
    (item) => item.status === 'reviewing' || item.status === 'retained'
  ).length;

  const handleSignOut = async () => {
    try {
      await signOut();
      triggerToast('Signed out from Cloud backup.');
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5" contentContainerStyle={{ gap: 16 }}>
        {/* Header row */}
        <View className="flex-row items-center justify-between pb-3 border-b border-[#E5E5E5]">
          <View className="flex-row items-center gap-3">
            <AvatarCircle photoUri={user?.photoURL} name={user?.displayName || 'Friend'} size={48} />
            <View>
              <AppText variant="title" className="font-serif font-bold text-[#1A1A1A] leading-tight">
                {user?.displayName || 'Friend'}
              </AppText>
              {/* A sync status line, not a subtitle -- it was competing with
                  the name at only one step smaller. */}
              <AppText variant="micro" className="font-sans text-neutral-400 mt-0.5">Progress synced to your account</AppText>
            </View>
          </View>

          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={() => navigateTo('messages')}
              className="w-8 h-8 items-center justify-center border border-neutral-200 rounded-lg bg-white"
            >
              <MessageCircle size={14} color="#404040" />
            </Pressable>
            <Pressable
              onPress={() => navigateTo('settings')}
              className="w-8 h-8 items-center justify-center border border-neutral-200 rounded-lg bg-white"
            >
              <SettingsIcon size={14} color="#404040" />
            </Pressable>
            <Pressable
              onPress={handleSignOut}
              className="px-2.5 py-1.5 border border-red-200 bg-red-50/50 rounded-lg"
            >
              <AppText variant="micro" className="text-red-600 font-sans font-bold uppercase tracking-wide">Sign Out</AppText>
            </Pressable>
          </View>
        </View>

        {/* Calculated Metrics cards (High Contrast) */}
        <View className="flex-row gap-2.5">
          <View className="flex-1 bg-[#F3F2F1]/50 border border-[#E5E5E5] rounded-xl p-2.5 items-center gap-0.5">
            <AppText variant="body" className="font-bold text-[#1A1A1A] font-mono">{versesLearnedCount}</AppText>
            <AppText variant="micro" className="font-bold text-neutral-400 uppercase tracking-wide">memorized</AppText>
          </View>

          <View className="flex-1 bg-[#F3F2F1]/50 border border-[#E5E5E5] rounded-xl p-2.5 items-center gap-0.5">
            <AppText variant="body" className="font-bold text-amber-600 font-mono">{learningCount}</AppText>
            <AppText variant="micro" className="font-bold text-neutral-400 uppercase tracking-wide">learning</AppText>
          </View>

          <View className="flex-1 bg-[#F3F2F1]/50 border border-[#E5E5E5] rounded-xl p-2.5 items-center gap-0.5">
            <AppText variant="body" className="font-bold text-emerald-600 font-mono">{memoryStreak}</AppText>
            <AppText variant="micro" className="font-bold text-neutral-400 uppercase tracking-wide">memory streak</AppText>
          </View>
        </View>

        <AppButton size="md" onPress={() => navigateTo('dashboard')} className="w-full bg-[#1A1A1A] rounded-xl items-center justify-center">
          <AppText variant="label" className="text-white font-sans font-bold ">View Full Dashboard 📊</AppText>
        </AppButton>

        {/* GitHub-style visual memory grid representation */}
        <View className="gap-1.5">
          <View className="flex-row items-center justify-between px-1">
            <View className="flex-row items-center">
              <AppText variant="section" className="font-bold text-neutral-400 tracking-wider font-sans uppercase">
                PAST 15 DAYS ACTIVITY
              </AppText>
              <HelpTooltip text="One square per day. A square fills in on days you banked a mastery touch on a verse you're learning — darker green means more touches that day. Spaced reviews aren't counted here." />
            </View>
            <Pressable onPress={() => navigateTo('fullHistory')}>
              <AppText variant="micro" className="font-sans font-bold underline text-neutral-500">View Full History</AppText>
            </Pressable>
          </View>
          {/* One row of 15 plain squares.
              This was 15 labelled boxes wrapping onto three rows, each box
              carrying a day number AND a count -- 30 pieces of text for a
              control whose entire job is "which days did I show up". A
              contribution grid communicates through colour; labelling every
              cell is what made it read as clutter rather than as a glance.
              The dates that bound the range are stated once, underneath. */}
          <View className="border border-[#E5E5E5] rounded-xl px-3 py-2.5 bg-white gap-1.5">
            <View className="flex-row gap-1">
              {activityLast15Days.map((item, index) => (
                <View
                  key={index}
                  style={{ height: space(20) }}
                  className={`flex-1 rounded-sm border ${
                    item.count === 0
                      ? 'bg-[#F3F2F1] border-[#E5E5E5]'
                      : item.count > 6
                        ? 'bg-emerald-600 border-emerald-700'
                        : 'bg-emerald-300 border-emerald-400'
                  }`}
                />
              ))}
            </View>
            <View className="flex-row justify-between">
              <AppText variant="micro" className="font-sans text-neutral-400">{activityLast15Days[0]?.day}</AppText>
              <AppText variant="micro" className="font-sans text-neutral-400">Today</AppText>
            </View>
          </View>
        </View>

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
                  className="border border-neutral-200 rounded-xl p-2.5 bg-neutral-50/50 flex-row justify-between items-center"
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

        {/* LIST OF SAVED VOICE RECORDINGS */}
        <View className="gap-2">
          <View className="flex-row items-center px-1">
            <AppText variant="section" className="font-bold text-neutral-400 tracking-wider font-sans uppercase">
              RECORDED CHAPTERS ({userRecordings.length})
            </AppText>
            <HelpTooltip text="Recitations you've recorded or imported. Tap one to play it back or adjust where each verse starts." />
          </View>

          <View style={{ maxHeight: 190 }}>
            <ScrollView contentContainerStyle={{ gap: 8 }}>
              {userRecordings.length === 0 ? (
                <View className="items-center p-4 bg-[#F3F2F1]/55 rounded-xl border border-dashed border-[#E5E5E5]">
                  <AppText variant="label" className="text-[#888]">No recorded chapters yet. Tap Record tab to make one!</AppText>
                </View>
              ) : (
                userRecordings.map((rec) => {
                  const isPlaying = playingRecordingId === rec.id;
                  return (
                    <Pressable
                      key={rec.id}
                      onPress={() => {
                        setSelectedRecording(rec);
                        navigateTo('recordingDetail');
                      }}
                      className="border border-[#E5E5E5] rounded-xl p-3 bg-white gap-2"
                    >
                      <View className="flex-row items-center justify-between">
                        <View className="flex-1 pr-2">
                          <View className="flex-row items-center gap-1.5">
                            <AppText variant="label" className="font-black text-[#1A1A1A] leading-tight">
                              {recordingLabel(rec)}
                            </AppText>
                            <AppText variant="micro" className="bg-neutral-100 text-neutral-600 font-sans border border-neutral-200 px-1.5 py-0.5 rounded font-normal uppercase">
                              View Sync
                            </AppText>
                          </View>
                          <AppText variant="micro" className="font-sans text-neutral-400 mt-0.5">
                            {rec.date} • {rec.translation} • {rec.duration} seconds
                          </AppText>
                        </View>
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            if (isPlaying) {
                              setPlayingRecordingId(null);
                            } else {
                              setPlayingRecordingId(rec.id);
                              setPlayingRecProgress(0);
                              triggerToast(`Playing ${rec.book} ${rec.chapter}...`);
                            }
                          }}
                          className={`w-7 h-7 rounded-full items-center justify-center shrink-0 ${
                            isPlaying ? 'bg-[#1A1A1A]' : 'border border-[#1A1A1A]'
                          }`}
                        >
                          {isPlaying ? (
                            <Pause size={12} color="#FFFFFF" />
                          ) : (
                            <Play size={12} color="#1A1A1A" style={{ marginLeft: 2 }} />
                          )}
                        </Pressable>
                      </View>

                      {/* Playback bar indicator */}
                      {isPlaying && (
                        <View className="w-full bg-neutral-100 h-1.5 rounded-full overflow-hidden">
                          <View className="bg-[#1A1A1A] h-full" style={{ width: `${playingRecProgress}%` }} />
                        </View>
                      )}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </ScrollView>
    </FadeInView>
  );
}
