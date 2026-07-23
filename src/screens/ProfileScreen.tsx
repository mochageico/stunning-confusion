import { Bell, MessageCircle, Pause, Play, Settings as SettingsIcon, X } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { AvatarCircle, FadeInView, HelpTooltip } from '../components/ui';
import { AppState } from '../state/useAppState';

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
              <Text className="text-lg font-serif font-bold text-[#1A1A1A] leading-tight">
                {user?.displayName || 'Friend'}
              </Text>
              <Text className="text-xs font-sans text-neutral-400 mt-0.5">Memory Level: Cloud Sync Active</Text>
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
              <Text className="text-red-600 font-sans font-bold text-[9px] uppercase tracking-wide">Sign Out</Text>
            </Pressable>
          </View>
        </View>

        {/* Calculated Metrics cards (High Contrast) */}
        <View className="flex-row gap-2.5">
          <View className="flex-1 bg-[#F3F2F1]/50 border border-[#E5E5E5] rounded-xl p-2.5 items-center gap-0.5">
            <Text className="text-[14px] font-bold text-[#1A1A1A] font-mono">{versesLearnedCount}</Text>
            <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-wide">memorized</Text>
          </View>

          <View className="flex-1 bg-[#F3F2F1]/50 border border-[#E5E5E5] rounded-xl p-2.5 items-center gap-0.5">
            <Text className="text-[14px] font-bold text-amber-600 font-mono">{learningCount}</Text>
            <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-wide">learning</Text>
          </View>

          <View className="flex-1 bg-[#F3F2F1]/50 border border-[#E5E5E5] rounded-xl p-2.5 items-center gap-0.5">
            <Text className="text-[14px] font-bold text-emerald-600 font-mono">{memoryStreak}</Text>
            <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-wide">memory streak</Text>
          </View>
        </View>

        <Pressable
          onPress={() => navigateTo('dashboard')}
          className="w-full py-2.5 bg-[#1A1A1A] rounded-xl items-center justify-center"
        >
          <Text className="text-white font-sans font-bold text-xs">View Full Dashboard 📊</Text>
        </Pressable>

        {/* GitHub-style visual memory grid representation */}
        <View className="gap-1.5">
          <View className="flex-row items-center justify-between px-1">
            <View className="flex-row items-center">
              <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
                PAST 15 DAYS ACTIVITY
              </Text>
              <HelpTooltip text="Your consecutive study streak visualizer. Dark green indicates higher repetition volumes." />
            </View>
            <Pressable onPress={() => navigateTo('fullHistory')}>
              <Text className="text-[9px] font-sans font-bold underline text-neutral-500">View Full History</Text>
            </Pressable>
          </View>
          <View className="border border-[#E5E5E5] rounded-xl p-3 bg-white">
            <View className="flex-row flex-wrap gap-1.5 justify-center">
              {activityLast15Days.map((item, index) => {
                const color =
                  item.count === 0
                    ? 'bg-[#F3F2F1] border-[#E5E5E5]'
                    : item.count > 6
                    ? 'bg-emerald-600 border-emerald-700'
                    : 'bg-emerald-300 border-emerald-400';
                const textColor = item.count === 0 ? 'text-neutral-500' : item.count > 6 ? 'text-white' : 'text-emerald-950';
                return (
                  <View
                    key={index}
                    style={{ width: '18%' }}
                    className={`h-9 border rounded-md items-center justify-center font-mono ${color}`}
                  >
                    <Text className={`text-[8px] font-bold ${textColor}`}>{item.day.split(' ')[1]}</Text>
                    <Text className={`text-[10px] font-extrabold ${textColor}`}>{item.count > 0 ? `+${item.count}` : '0'}</Text>
                  </View>
                );
              })}
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
              <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
                Notifications ({receivedAccountabilityNudges.filter((n) => !n.read).length} new)
              </Text>
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
                    <Text className="text-[10px] font-bold text-neutral-800">{n.fromName}</Text>
                    <Text className="text-[10px] text-neutral-600 font-sans mt-0.5">{n.message}</Text>
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
              <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
                FRIENDS ({friends.length})
              </Text>
              <HelpTooltip text="Real, mutual friend connections — these persist even if you're no longer in a circle together." />
            </View>
            <Pressable
              onPress={() => navigateTo('findFriends')}
              className="bg-[#1A1A1A] px-2 py-1 rounded relative"
            >
              <Text className="text-[9px] text-white font-sans font-bold uppercase tracking-wider">Find Friends +</Text>
              {incomingFriendRequests.length > 0 && (
                <View className="absolute -top-1.5 -right-1.5 bg-red-600 w-4 h-4 rounded-full items-center justify-center border border-white">
                  <Text className="text-white text-[8px] font-black">{incomingFriendRequests.length}</Text>
                </View>
              )}
            </Pressable>
          </View>
          {friends.length === 0 ? (
            <Text className="text-[10px] text-neutral-400 font-sans italic px-1">
              No friends yet — search for people to add above.
            </Text>
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
                      <Text className="font-serif font-black text-[10px]">{f.displayName.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View>
                      <Text className="text-[10px] font-bold text-neutral-800 leading-none">{f.displayName}</Text>
                      <Text className="text-[8px] font-sans text-neutral-400 leading-none mt-0.5">View Profile</Text>
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
              <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
                COMMUNITIES ({myCircles.length})
              </Text>
              <HelpTooltip text="Your active study groups and church pacing networks. Click any community to jump into its dashboard." />
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
                  <View className="flex-1 pr-2">
                    <Text className="text-xs font-sans font-bold text-neutral-800 leading-snug">{c.name}</Text>
                    <Text className="text-[9px] font-sans text-neutral-400 mt-0.5">{c.description}</Text>
                  </View>
                  <Text className="text-[7.5px] font-bold font-sans bg-neutral-900 text-white px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0">
                    {role}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* LIST OF SAVED VOICE RECORDINGS */}
        <View className="gap-2">
          <View className="flex-row items-center px-1">
            <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
              RECORDED CHAPTERS ({userRecordings.length})
            </Text>
            <HelpTooltip text="Chapters recited and recorded. Click any recording to inspect timestamps or verify sync alignments." />
          </View>

          <View style={{ maxHeight: 190 }}>
            <ScrollView contentContainerStyle={{ gap: 8 }}>
              {userRecordings.length === 0 ? (
                <View className="items-center p-4 bg-[#F3F2F1]/55 rounded-xl border border-dashed border-[#E5E5E5]">
                  <Text className="text-xs text-[#888]">No recorded chapters yet. Tap Record tab to make one!</Text>
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
                            <Text className="text-xs font-black text-[#1A1A1A] leading-tight">
                              {rec.book} {rec.chapter}
                            </Text>
                            <Text className="text-[8px] bg-neutral-100 text-neutral-600 font-sans border border-neutral-200 px-1.5 py-0.5 rounded font-normal uppercase">
                              View Sync
                            </Text>
                          </View>
                          <Text className="text-[9px] font-sans text-neutral-400 mt-0.5">
                            {rec.date} • {rec.translation} • {rec.duration} seconds
                          </Text>
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
