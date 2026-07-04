import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, Pause, Play } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { getProfileForName } from '../data';
import { FadeInView } from '../components/ui';

const WEEKDAY_ABBRS = ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'];

export default function MemberProfileScreen({ state }: { state: AppState }) {
  const { selectedUserProfile, handleBack, navigateTo, viewMemberProfile, playingRecordingId, setPlayingRecordingId, triggerToast } = state;

  if (!selectedUserProfile) return null;

  // viewMemberProfileById() (real Firestore users, e.g. circle co-members) sets
  // a minimal shape with no active-plan/recordings/activity-grid data — those
  // would require exposing another user's private memoryQueue/verses
  // subcollections, which this app doesn't do. viewMemberProfile() (the
  // legacy DUMMY_PROFILES path, still used for illustrative content like the
  // Recent Group Feed) sets the full shape.
  const isRealUser = !!selectedUserProfile.uid;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 16 }}>
        {/* Header / Back Button */}
        <View className="flex-row items-center gap-3 border-b border-neutral-100 pb-3">
          <Pressable
            onPress={handleBack}
            className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
          >
            <ArrowLeft size={14} color="#262626" />
          </Pressable>
          <View>
            <Text className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">
              MEMBER PROFILE
            </Text>
            <Text className="text-base font-serif font-bold text-neutral-900 leading-none mt-0.5">
              {selectedUserProfile.name}
            </Text>
          </View>
        </View>

        {/* User Identity Header */}
        <View className="flex-row items-center gap-3.5 bg-neutral-50/50 p-3 rounded-2xl border border-neutral-200">
          <View className="w-12 h-12 rounded-full border-2 border-neutral-900 bg-emerald-50 items-center justify-center shrink-0">
            <Text className="font-serif font-black text-lg text-emerald-950">{selectedUserProfile.avatar}</Text>
          </View>
          <View>
            <Text className="text-sm font-sans font-black text-neutral-900 leading-tight">
              {selectedUserProfile.name}
            </Text>
            <Text className="text-[10px] font-sans text-neutral-400 mt-0.5">{selectedUserProfile.level}</Text>
          </View>
        </View>

        {/* Calculated Metrics cards (High Contrast) */}
        <View className="flex-row gap-2">
          <View className="flex-1 bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 items-center" style={{ gap: 2 }}>
            <Text className="text-xs font-bold text-neutral-900 font-mono">
              {selectedUserProfile.stats?.memorized || 0}
            </Text>
            <Text className="text-[7.5px] font-bold text-neutral-400 uppercase tracking-wide">MEMORIZED</Text>
          </View>

          <View className="flex-1 bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 items-center" style={{ gap: 2 }}>
            <Text className="text-xs font-bold text-amber-600 font-mono">
              {selectedUserProfile.stats?.learning || 0}
            </Text>
            <Text className="text-[7.5px] font-bold text-neutral-400 uppercase tracking-wide">LEARNING</Text>
          </View>

          <View className="flex-1 bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 items-center" style={{ gap: 2 }}>
            <Text className="text-xs font-bold text-emerald-600 font-mono">
              {selectedUserProfile.stats?.streak || 0}
            </Text>
            <Text className="text-[7.5px] font-bold text-neutral-400 uppercase tracking-wide">STREAK</Text>
          </View>
        </View>

        {/* Active Plan Detail Card (Tappable to analyze) — only for the
            legacy dummy-profile path; real users' plans are private. */}
        {!isRealUser && (
          <View style={{ gap: 6 }}>
            <Text className="text-[9px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
              ACTIVE PLAN (TAP TO ANALYZE)
            </Text>
            <Pressable
              onPress={() => navigateTo('analyzePlan')}
              className="border border-neutral-200 rounded-xl p-3 bg-white shadow-xs"
              style={{ gap: 8 }}
            >
              <View className="flex-row justify-between items-center">
                <Text className="text-xs font-sans font-black text-neutral-800 leading-tight">
                  {selectedUserProfile.planName}
                </Text>
                <Text className="text-[7px] bg-[#1A1A1A] text-white px-1.5 py-0.5 rounded font-sans font-bold uppercase tracking-wider">
                  {selectedUserProfile.preset?.toUpperCase() || 'CUSTOM'}
                </Text>
              </View>
              <Text className="text-[10px] font-sans text-neutral-500 leading-snug">
                Pacing at <Text className="font-semibold text-neutral-800">{selectedUserProfile.newVersesPace} verses/day</Text> with a{' '}
                {selectedUserProfile.maxReviewCap} mins max review limit.
              </Text>
              <View className="flex-row gap-1 pt-1.5 border-t border-neutral-100 items-center justify-between">
                <View className="flex-row gap-1">
                  {WEEKDAY_ABBRS.map((d) => {
                    const active = selectedUserProfile.learningDays?.includes(d);
                    return (
                      <View
                        key={d}
                        className={`w-4.5 h-4.5 rounded-full items-center justify-center ${
                          active ? 'bg-emerald-500' : 'bg-neutral-200/50'
                        }`}
                      >
                        <Text className={`text-[8px] font-sans font-bold ${active ? 'text-white font-black' : 'text-neutral-400'}`}>
                          {d[0]}
                        </Text>
                      </View>
                    );
                  })}
                </View>
                <Text className="text-[9px] font-sans font-bold text-neutral-400">Analyze Plan →</Text>
              </View>
            </Pressable>
          </View>
        )}

        {/* Friends Spot — legacy dummy-profile path only; real users' friend
            lists live on ProfileScreen (derived from shared circles). */}
        {!isRealUser && (
          <View style={{ gap: 6 }}>
            <Text className="text-[9px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
              FRIENDS ({selectedUserProfile.friends?.length || 0})
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 6 }}>
              {(selectedUserProfile.friends || []).map((fName: string) => {
                const fProfile = getProfileForName(fName);
                return (
                  <Pressable
                    key={fName}
                    onPress={() => viewMemberProfile(fName)}
                    className="flex-row items-center gap-2 border border-neutral-200 rounded-xl p-2 bg-white shrink-0"
                  >
                    <View className="w-6 h-6 rounded-full bg-neutral-100 border border-neutral-300 items-center justify-center">
                      <Text className="font-serif font-black text-[9px] text-neutral-800">{fProfile?.avatar || 'AD'}</Text>
                    </View>
                    <View>
                      <Text className="text-[10px] font-bold text-neutral-800 leading-none">{fName}</Text>
                      <Text className="text-[7.5px] font-sans text-neutral-400 mt-0.5">View Profile</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Communities Spot */}
        <View style={{ gap: 6 }}>
          <Text className="text-[9px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
            COMMUNITIES ({selectedUserProfile.communities?.length || 0})
          </Text>
          <View style={{ gap: 6 }}>
            {(selectedUserProfile.communities || []).map((cName: string) => (
              <View key={cName} className="border border-neutral-200 rounded-xl p-2.5 bg-neutral-50/40">
                <Text className="text-xs font-sans font-bold text-neutral-800 leading-tight">{cName}</Text>
                <Text className="text-[9px] font-sans text-neutral-400 mt-0.5">Active Scripture Circle Member</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Past 15 Days Repetitions Activity Grid — legacy dummy-profile path only */}
        {!isRealUser && (
          <View style={{ gap: 6 }}>
            <Text className="text-[9px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
              PAST 15 DAYS REPETITIONS
            </Text>
            <View className="border border-neutral-200 rounded-xl p-2.5 bg-white">
              <View className="flex-row flex-wrap justify-center" style={{ gap: 6 }}>
                {(selectedUserProfile.activityGrid || []).map((item: any, index: number) => {
                  const colorClass =
                    item.count === 0
                      ? 'bg-neutral-50 border-neutral-100'
                      : item.count > 6
                        ? 'bg-emerald-600 border-emerald-700'
                        : 'bg-emerald-200 border-emerald-300';
                  const textClass = item.count > 6 ? 'text-white' : item.count === 0 ? 'text-neutral-900' : 'text-emerald-950';
                  return (
                    <View
                      key={index}
                      className={`h-8 border rounded items-center justify-center font-mono ${colorClass}`}
                      style={{ width: '18%' }}
                    >
                      <Text className="text-[7px] font-sans text-neutral-400 leading-none">{item.day.split(' ')[1]}</Text>
                      <Text className={`text-[9px] font-extrabold leading-none mt-0.5 ${textClass}`}>
                        {item.count > 0 ? `+${item.count}` : '0'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>
        )}

        {/* Recorded Chapters list — legacy dummy-profile path only */}
        {!isRealUser && (
          <View style={{ gap: 6 }}>
            <Text className="text-[9px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
              RECORDED CHAPTERS ({selectedUserProfile.recordings?.length || 0})
            </Text>
            <View style={{ gap: 8, maxHeight: 140 }}>
              {(selectedUserProfile.recordings || []).map((rec: any) => {
                const isPlaying = playingRecordingId === rec.id;
                return (
                  <View key={rec.id} className="border border-neutral-200 rounded-xl p-2.5 bg-white flex-row items-center justify-between">
                    <View>
                      <Text className="text-xs font-bold text-neutral-900 leading-tight">
                        {rec.book} {rec.chapter}
                      </Text>
                      <Text className="text-[8.5px] font-sans text-neutral-400 mt-0.5">
                        {rec.date} • {rec.translation} • {rec.duration} seconds
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => {
                        if (isPlaying) {
                          setPlayingRecordingId(null);
                        } else {
                          setPlayingRecordingId(rec.id);
                          triggerToast(`Playing ${selectedUserProfile.name}'s recording of ${rec.book} ${rec.chapter}... 🎙️`);
                        }
                      }}
                      className={`w-6.5 h-6.5 rounded-full items-center justify-center ${
                        isPlaying ? 'bg-[#1A1A1A]' : 'border border-[#1A1A1A]'
                      }`}
                    >
                      {isPlaying ? <Pause size={10} color="#FFFFFF" /> : <Play size={10} color="#1A1A1A" style={{ marginLeft: 1 }} />}
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>
    </FadeInView>
  );
}
