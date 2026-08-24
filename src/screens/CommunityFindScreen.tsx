import { useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, HelpTooltip } from '../components/ui';
import { AppButton, AppIconButton, AppTextInput, AppText } from '../components/design';

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
    openCirclePreview,
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
          <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={14} iconColor="#262626" onPress={() => setCommunitySubView('home')} className="rounded-full border border-neutral-200 bg-white" />
          <View>
            <AppText variant="title" className="font-serif font-black text-neutral-900 leading-none mt-1">
              Find a Community
            </AppText>
          </View>
        </View>

        {/* Join via Code */}
        <View className="border border-neutral-200 rounded-2xl p-4 bg-neutral-50/50 gap-3">
          <View className="flex-row items-center">
            <AppText variant="label" className="font-sans font-extrabold text-neutral-800 uppercase tracking-wider">
              Join Private Circle via Invite Code
            </AppText>
            <HelpTooltip text="Private circles don't show up in the directory. If someone shared a code with you, enter it here to join theirs." />
          </View>

          <View className="flex-row gap-2">
            <AppTextInput value={inviteCodeInput} onChangeText={setInviteCodeInput} placeholder="e.g. A1B2C3" autoCapitalize="characters" className="flex-1 px-3 py-2 bg-white border border-neutral-300 rounded-xl font-bold uppercase tracking-wider" />
            <AppButton size="md" onPress={() => joinCircleByCode(inviteCodeInput)} className="bg-[#1A1A1A] rounded-xl items-center justify-center">
              <AppText variant="label" className="text-white font-bold">Join Circle</AppText>
            </AppButton>
          </View>
        </View>

        {/* Search & Filters matrix */}
        <View className="gap-3">
          <AppText variant="section" className="font-bold text-neutral-400 tracking-wider font-sans uppercase">
            SEARCH PUBLIC DIRECTORY
          </AppText>

          <View className="gap-2">
            {/* Text query */}
            <AppTextInput value={findSearchQuery} onChangeText={setFindSearchQuery} placeholder="Search by circle name or description..." className="w-full px-3 py-2 border border-neutral-300 rounded-xl" />
          </View>
        </View>

        {/* Live Filter Results */}
        <View className="gap-2">
          <View className="flex-row justify-between items-center px-1">
            <AppText variant="micro" className="font-black text-neutral-400 uppercase">
              {loadingPublicCircles ? 'LOADING...' : `FOUND ${filteredCircles.length} COMMUNITIES`}
            </AppText>
          </View>

          <View className="gap-2">
            {!loadingPublicCircles && filteredCircles.length === 0 ? (
              <View className="items-center p-6 border border-dashed border-neutral-200 rounded-2xl">
                <AppText variant="label" className="text-neutral-400 text-center">
                  No matching scripture circles found. Try clearing filters!
                </AppText>
              </View>
            ) : (
              filteredCircles.map((c) => {
                const isAlreadyJoined = myCircles.some((mc) => mc.id === c.id);
                return (
                  // The description is deliberately not shown in the list.
                  // It's free text of any length, so it set every row's
                  // height and turned a scannable list into a wall. Tapping
                  // the row opens the preview, which is where the full
                  // description belongs.
                  <Pressable
                    key={c.id}
                    onPress={() => openCirclePreview(c)}
                    className="border border-neutral-200 rounded-2xl p-3 bg-white gap-2.5 active:bg-neutral-50"
                  >
                    <View className="flex-row items-center gap-1.5">
                      <AppText variant="label" className="font-sans font-black text-neutral-900 leading-snug flex-1" numberOfLines={1}>
                        {c.name}
                      </AppText>
                      <View className="px-1.5 py-0.5 rounded border bg-emerald-50 border-emerald-100 shrink-0">
                        <AppText variant="micro" className="font-bold font-sans uppercase text-emerald-700">Public</AppText>
                      </View>
                    </View>

                    <View className="flex-row justify-end items-center pt-2 border-t border-neutral-100">
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          isAlreadyJoined ? openCircle(c.id) : joinCircle(c.id, c.name);
                        }}
                        className={`px-4 py-2.5 rounded-xl shadow-sm ${isAlreadyJoined ? 'bg-neutral-100 border border-neutral-300' : 'bg-[#1A1A1A]'}`}
                      >
                        <AppText variant="section" className={`font-bold uppercase tracking-wider ${isAlreadyJoined ? 'text-neutral-700' : 'text-white'}`}>
                          {isAlreadyJoined ? 'View Dashboard' : 'Join Circle'}
                        </AppText>
                      </Pressable>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>
    </FadeInView>
  );
}
