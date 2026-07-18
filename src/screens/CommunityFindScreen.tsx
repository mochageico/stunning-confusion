import { useEffect } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, HelpTooltip } from '../components/ui';

export default function CommunityFindScreen({ state }: { state: AppState }) {
  const {
    setCommunitySubView,
    inviteCodeInput,
    setInviteCodeInput,
    findSearchQuery,
    setFindSearchQuery,
    myCircles,
    publicCircles,
    loadingPublicCircles,
    loadPublicCircles,
    joinCircle,
    joinCircleByCode,
    openCircle,
  } = state;

  useEffect(() => {
    loadPublicCircles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredCircles = publicCircles.filter(
    (c) =>
      c.name.toLowerCase().includes(findSearchQuery.toLowerCase()) ||
      c.description.toLowerCase().includes(findSearchQuery.toLowerCase())
  );

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5" contentContainerStyle={{ gap: 16 }}>
        {/* Header with back */}
        <View className="flex-row items-center gap-3 border-b border-neutral-100 pb-3">
          {state.onboardingStepInProgress === null && (
            <Pressable
              onPress={() => setCommunitySubView('home')}
              className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
            >
              <ArrowLeft size={14} color="#262626" />
            </Pressable>
          )}
          <View>
            <Text className="text-[9px] uppercase tracking-wider font-extrabold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-sans">
              DISCOVER CIRCLES
            </Text>
            <Text className="text-base font-serif font-black text-neutral-900 leading-none mt-1">
              Find a Community
            </Text>
          </View>
        </View>

        {/* Join via Code */}
        <View className="border border-neutral-200 rounded-2xl p-4 bg-neutral-50/50 gap-3">
          <View className="flex-row items-center">
            <Text className="text-xs font-sans font-extrabold text-neutral-800 uppercase tracking-wider">
              Join Private Circle via Invite Code
            </Text>
            <HelpTooltip text="Enter a unique code sent by your study lead or pastor to join a private scripture pacing group." />
          </View>

          <View className="flex-row gap-2">
            <TextInput
              value={inviteCodeInput}
              onChangeText={setInviteCodeInput}
              placeholder="e.g. A1B2C3"
              autoCapitalize="characters"
              className="flex-1 px-3 py-2 bg-white border border-neutral-300 rounded-xl text-xs font-bold uppercase tracking-wider"
            />
            <Pressable onPress={() => joinCircleByCode(inviteCodeInput)} className="px-4 py-2 bg-[#1A1A1A] rounded-xl items-center justify-center">
              <Text className="text-white text-xs font-bold">Join Circle</Text>
            </Pressable>
          </View>
        </View>

        {/* Search & Filters matrix */}
        <View className="gap-3">
          <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
            SEARCH PUBLIC DIRECTORY
          </Text>

          <View className="gap-2">
            {/* Text query */}
            <TextInput
              value={findSearchQuery}
              onChangeText={setFindSearchQuery}
              placeholder="Search by circle name or description..."
              className="w-full px-3 py-2 border border-neutral-300 rounded-xl text-xs"
            />
          </View>
        </View>

        {/* Live Filter Results */}
        <View className="gap-2">
          <View className="flex-row justify-between items-center px-1">
            <Text className="text-[9px] font-black text-neutral-400 uppercase">
              {loadingPublicCircles ? 'LOADING...' : `FOUND ${filteredCircles.length} COMMUNITIES`}
            </Text>
          </View>

          <View className="gap-2">
            {!loadingPublicCircles && filteredCircles.length === 0 ? (
              <View className="items-center p-6 border border-dashed border-neutral-200 rounded-2xl">
                <Text className="text-xs text-neutral-400 text-center">
                  No matching scripture circles found. Try clearing filters!
                </Text>
              </View>
            ) : (
              filteredCircles.map((c) => {
                const isAlreadyJoined = myCircles.some((mc) => mc.id === c.id);
                return (
                  <View key={c.id} className="border border-neutral-200 rounded-2xl p-4 bg-white gap-3">
                    <View className="flex-row justify-between items-start">
                      <View className="flex-1 pr-2">
                        <View className="flex-row items-center gap-1.5">
                          <Text className="text-xs font-sans font-black text-neutral-900 leading-none">{c.name}</Text>
                          <View className="px-1.5 py-0.5 rounded border bg-emerald-50 border-emerald-100">
                            <Text className="text-[7px] font-bold font-sans uppercase text-emerald-700">Public</Text>
                          </View>
                        </View>
                        <Text className="text-[10px] font-sans text-neutral-400 mt-1 leading-snug">{c.description}</Text>
                      </View>
                    </View>

                    <View className="flex-row justify-end items-center pt-2 border-t border-neutral-100">
                      <Pressable
                        onPress={() => (isAlreadyJoined ? openCircle(c.id) : joinCircle(c.id, c.name))}
                        className={`px-3 py-1.5 rounded-lg ${isAlreadyJoined ? 'bg-neutral-100 border border-neutral-300' : 'bg-[#1A1A1A]'}`}
                      >
                        <Text className={`text-[9px] font-bold uppercase tracking-wider ${isAlreadyJoined ? 'text-neutral-600' : 'text-white'}`}>
                          {isAlreadyJoined ? 'View Dashboard' : 'Join Circle'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>
    </FadeInView>
  );
}
