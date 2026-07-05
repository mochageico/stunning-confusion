import { Pressable, ScrollView, Text, View } from 'react-native';
import { RefreshCw, Users } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, HelpTooltip } from '../components/ui';

const LEARNING_DAY_ABBREVIATIONS = ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'];

export default function CommunityHomeScreen({ state }: { state: AppState }) {
  const {
    user,
    setCommunitySubView,
    myCircles,
    activeGroupId,
    openCircle,
    loadSharedPlans,
    loadingSharedPlans,
    sharedPlans,
    joinSharedPlan,
    viewMemberProfile,
    viewMemberProfileById,
    activityEvents,
    loadingActivityEvents,
    loadActivityFeed,
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
            <HelpTooltip text="Scripture circles you actively participate in. Tap any circle to view its dashboard, pacing calendars, and progress statistics." />
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

        {/* Joinable Community Memory Plans */}
        <View className="gap-2.5">
          <View className="flex-row justify-between items-center">
            <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
              COMMUNITY PACING PLANS
            </Text>
            <Pressable onPress={loadSharedPlans} className="flex-row items-center gap-1">
              <RefreshCw size={8} color="#1A1A1A" />
              <Text className="text-[9px] font-sans font-bold uppercase text-[#1A1A1A]">Refresh</Text>
            </Pressable>
          </View>

          {loadingSharedPlans ? (
            <View className="py-4 items-center">
              <Text className="text-xs text-neutral-400 font-sans">Loading shared plans...</Text>
            </View>
          ) : sharedPlans.length === 0 ? (
            <View className="border border-dashed border-neutral-200 rounded-xl p-4 items-center">
              <Text className="text-xs text-neutral-400 font-sans text-center">
                No community memory plans published yet. Be the first to publish a custom plan!
              </Text>
            </View>
          ) : (
            <View className="gap-3">
              {sharedPlans.map((plan) => (
                <View key={plan.id} className="border border-[#E5E5E5] rounded-xl p-3.5 bg-white gap-3 shadow-sm">
                  <View className="flex-row justify-between items-start">
                    <View>
                      <Text className="text-xs font-sans font-black text-[#1A1A1A] leading-tight">{plan.name}</Text>
                      <Text className="text-[9px] font-sans text-neutral-400 mt-0.5">
                        Shared by{' '}
                        <Text
                          onPress={() => viewMemberProfile(plan.creatorName)}
                          className="font-semibold text-[#1A1A1A]"
                        >
                          {plan.creatorName || 'Anonymous'}
                        </Text>
                      </Text>
                    </View>
                    <View className="bg-neutral-100 border border-neutral-200 px-1.5 py-0.5 rounded">
                      <Text className="text-[8px] font-sans font-bold uppercase">{plan.preset}</Text>
                    </View>
                  </View>

                  {/* Plan Metrics bar */}
                  <View className="flex-row gap-2 py-1.5 border-y border-dashed border-neutral-100">
                    <View className="flex-1">
                      <Text className="text-[8px] text-neutral-400 uppercase">Pace</Text>
                      <Text className="text-[10px] font-sans font-bold text-neutral-800">
                        {plan.newVersesPace} lines/day
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-[8px] text-neutral-400 uppercase">Cap</Text>
                      <Text className="text-[10px] font-sans font-bold text-neutral-800">{plan.maxReviewCap} mins</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-[8px] text-neutral-400 uppercase">Members</Text>
                      <Text className="text-[10px] font-sans font-bold text-neutral-800">
                        {plan.downloadsCount || 0} joined
                      </Text>
                    </View>
                  </View>

                  {/* Learning days overview */}
                  <View className="flex-row justify-between items-center pt-1">
                    <View className="flex-row gap-1">
                      {LEARNING_DAY_ABBREVIATIONS.map((d) => {
                        const active = plan.learningDays?.includes(d);
                        return (
                          <View
                            key={d}
                            className={`w-4 h-4 items-center justify-center rounded-full ${
                              active ? 'bg-emerald-500' : 'bg-neutral-50'
                            }`}
                          >
                            <Text
                              className={`text-[8px] font-sans ${
                                active ? 'text-white font-black' : 'text-neutral-300 font-bold'
                              }`}
                            >
                              {d[0]}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                    <Pressable
                      onPress={() => joinSharedPlan(plan)}
                      className="bg-[#1A1A1A] px-2.5 py-1 rounded-md"
                    >
                      <Text className="text-white text-[9px] font-bold uppercase tracking-wider">Join Plan</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
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
