import { Pressable, ScrollView, Text, View } from 'react-native';
import { RefreshCw, UserPlus, Users } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { AvatarCircle, FadeInView, HelpTooltip } from '../components/ui';

export default function CommunityHomeScreen({ state }: { state: AppState }) {
  const {
    user,
    setCommunitySubView,
    myCircles,
    activeGroupId,
    openCircle,
    viewMemberProfileById,
    activityEvents,
    loadingActivityEvents,
    loadActivityFeed,
    friends,
    incomingFriendRequests,
    navigateTo,
  } = state;

  const formatEventAge = (createdAtMs: number) => {
    const minutes = Math.max(1, Math.round((Date.now() - createdAtMs) / 60000));
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  };

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5" contentContainerStyle={{ gap: 16 }}>
        {/* Sub-view Navigation Controls */}
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => setCommunitySubView('find')}
            className="flex-1 border border-neutral-200 bg-neutral-50/50 p-2.5 rounded-xl flex-row items-center justify-between"
          >
            <View>
              <Text className="text-[8px] font-bold text-indigo-600 uppercase font-sans">Find Circle</Text>
              <Text className="text-xs font-black text-neutral-800 leading-tight">Search Directory 🔍</Text>
            </View>
            <Users size={14} color="#737373" />
          </Pressable>

          <Pressable
            onPress={() => setCommunitySubView('create')}
            className="flex-1 border border-neutral-200 bg-neutral-50/50 p-2.5 rounded-xl flex-row items-center justify-between"
          >
            <View>
              <Text className="text-[8px] font-bold text-emerald-600 uppercase font-sans">Start Group</Text>
              <Text className="text-xs font-black text-neutral-800 leading-tight">Create Circle ➕</Text>
            </View>
            <Users size={14} color="#737373" />
          </Pressable>
        </View>

        {/* List of Joined Circles */}
        <View className="gap-1.5">
          <View className="flex-row items-center px-1">
            <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
              YOUR ACTIVE COMMUNITIES ({myCircles.length})
            </Text>
            <HelpTooltip text="The scripture circles you've joined. Tap one to open its members, shared group plans, challenges, and group chat." />
          </View>

          <View className="gap-2">
            {myCircles.map((c) => {
              const role = c.ownerId === user?.uid ? 'Leader' : 'Member';
              return (
                <Pressable
                  key={c.id}
                  onPress={() => openCircle(c.id)}
                  className="w-full bg-white border border-[#E5E5E5] rounded-2xl p-4 flex-row justify-between items-center shadow-xs"
                >
                  <View className="gap-0.5 pr-3 flex-1">
                    <View className="flex-row items-center gap-1.5">
                      <View
                        className={`px-1.5 py-0.5 rounded ${
                          c.id === activeGroupId ? 'bg-indigo-600' : 'bg-neutral-100 border border-neutral-200'
                        }`}
                      >
                        <Text
                          className={`text-[7px] font-bold font-sans uppercase ${
                            c.id === activeGroupId ? 'text-white' : 'text-neutral-600'
                          }`}
                        >
                          {c.id === activeGroupId ? 'Active Circle' : role}
                        </Text>
                      </View>
                      <View
                        className={`px-1.5 py-0.5 rounded border ${
                          c.isPublic ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'
                        }`}
                      >
                        <Text
                          className={`text-[7px] font-bold font-sans uppercase ${
                            c.isPublic ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {c.isPublic ? 'Public' : 'Private'}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-xs font-sans font-black text-[#1A1A1A] leading-snug mt-1">{c.name}</Text>
                  </View>
                  <Users size={18} color="#1A1A1A" />
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Friends -- real, mutual connections independent of circle
            membership. Same pattern as ProfileScreen's Friends section,
            surfaced here too since Community is where people look for
            other people. */}
        <View className="gap-1.5">
          <View className="flex-row items-center justify-between px-1">
            <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
              FRIENDS ({friends.length})
            </Text>
            <Pressable onPress={() => navigateTo('findFriends')} className="bg-[#1A1A1A] px-2.5 py-1.5 rounded-lg relative flex-row items-center gap-1">
              <UserPlus size={11} color="#FFFFFF" />
              <Text className="text-[9px] text-white font-sans font-bold uppercase tracking-wider">Find Friends</Text>
              {incomingFriendRequests.length > 0 && (
                <View className="absolute -top-1.5 -right-1.5 bg-red-600 w-4 h-4 rounded-full items-center justify-center border border-white">
                  <Text className="text-white text-[8px] font-black">{incomingFriendRequests.length}</Text>
                </View>
              )}
            </Pressable>
          </View>
          {friends.length === 0 ? (
            <Text className="text-[10px] text-neutral-400 font-sans italic px-1">
              No friends yet — tap Find Friends to search for people.
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 2 }}>
              {friends.map((f) => (
                <Pressable
                  key={f.uid}
                  onPress={() => viewMemberProfileById(f.uid)}
                  className="flex-row items-center gap-2 border border-neutral-200 rounded-xl p-2 bg-white shrink-0"
                >
                  <AvatarCircle name={f.displayName} photoUri={f.avatarUrl} size={28} />
                  <View>
                    <Text className="text-[10px] font-bold text-neutral-800 leading-none">{f.displayName}</Text>
                    <Text className="text-[8px] font-sans text-neutral-400 leading-none mt-0.5">View Profile</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Community Activity Feed */}
        <View className="gap-2.5">
          <View className="flex-row justify-between items-center">
            <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
              RECENT GROUP FEED
            </Text>
            <Pressable onPress={loadActivityFeed} className="flex-row items-center gap-1">
              <RefreshCw size={8} color="#1A1A1A" />
              <Text className="text-[9px] font-sans font-bold uppercase text-[#1A1A1A]">Refresh</Text>
            </Pressable>
          </View>

          {loadingActivityEvents ? (
            <View className="py-4 items-center">
              <Text className="text-xs text-neutral-400 font-sans">Loading activity...</Text>
            </View>
          ) : activityEvents.length === 0 ? (
            <View className="border border-dashed border-neutral-200 rounded-xl p-4 items-center">
              <Text className="text-xs text-neutral-400 font-sans text-center">
                No milestones yet. This fills in as you or your real circle members fully memorize a verse or chapter —
                keep at it! 🌱
              </Text>
            </View>
          ) : (
            <View className="border border-neutral-200 rounded-xl p-4 bg-white gap-3.5 shadow-sm">
              {activityEvents.map((event, idx) => (
                <View key={event.id}>
                  <View className="flex-row items-start gap-3">
                    <View
                      className={`w-2 h-2 rounded-full mt-1.5 ${event.type === 'chapter' ? 'bg-emerald-500' : 'bg-emerald-400'}`}
                    />
                    <View className="gap-0.5 flex-1">
                      <Text className="text-xs font-sans text-neutral-700 leading-relaxed">
                        <Text onPress={() => viewMemberProfileById(event.uid)} className="font-black text-black">
                          {event.uid === user?.uid ? 'You' : event.authorName}
                        </Text>{' '}
                        {event.type === 'chapter' ? (
                          <>
                            completed memorizing the entire chapter of{' '}
                            <Text className="font-bold text-neutral-900">
                              {event.book} {event.chapter}
                            </Text>{' '}
                            ({event.verseCount} verses)! 👑
                          </>
                        ) : (
                          <>
                            completed memorizing{' '}
                            <Text className="font-bold text-neutral-900">
                              {event.book} {event.chapter}:{event.verse}
                            </Text>
                            .
                          </>
                        )}
                      </Text>
                      <Text className="text-[9px] text-neutral-400 font-mono">
                        {formatEventAge(event.createdAtMs)}
                        {event.type === 'chapter' ? ' • Milestone Achievement' : ''}
                      </Text>
                    </View>
                  </View>
                  {idx < activityEvents.length - 1 && <View className="border-t border-neutral-100 mt-3.5" />}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}
