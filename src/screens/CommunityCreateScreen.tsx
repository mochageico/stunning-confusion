import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, HelpTooltip } from '../components/ui';
import { AppTextInput, AppText } from '../components/design';

export default function CommunityCreateScreen({ state }: { state: AppState }) {
  const {
    setCommunitySubView,
    createGroupName,
    setCreateGroupName,
    createGroupDesc,
    setCreateGroupDesc,
    createGroupPrivacy,
    setCreateGroupPrivacy,
    createCircle,
  } = state;

  const handleCreateCircle = async () => {
    await createCircle(createGroupName, createGroupDesc, createGroupPrivacy === 'public');
    // Reset fields (createCircle itself handles validation/toast/navigation)
    setCreateGroupName('');
    setCreateGroupDesc('');
    setCreateGroupPrivacy('public');
  };

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5" contentContainerStyle={{ gap: 16 }}>
        {/* Header with back */}
        <View className="flex-row items-center gap-3 border-b border-neutral-100 pb-3">
          <Pressable
            onPress={() => setCommunitySubView('home')}
            className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
          >
            <ArrowLeft size={14} color="#262626" />
          </Pressable>
          <View>
            <AppText variant="micro" className="uppercase tracking-wider font-extrabold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-sans">
              ADMINISTRATION
            </AppText>
            <AppText variant="title" className="font-serif font-black text-neutral-900 leading-none mt-1">
              Create Scripture Circle
            </AppText>
          </View>
        </View>

        {/* Creation Form */}
        <View className="gap-4">
          {/* Group Name */}
          <View className="gap-1">
            <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-neutral-400">Circle Name</AppText>
            <AppTextInput value={createGroupName} onChangeText={setCreateGroupName} placeholder="e.g. Wednesday Night Romans Fellowship" className="w-full px-3 py-2 border border-neutral-300 rounded-xl font-bold" />
          </View>

          {/* Short Description */}
          <View className="gap-1">
            <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-neutral-400">
              Short Description
            </AppText>
            <AppTextInput value={createGroupDesc} onChangeText={setCreateGroupDesc} placeholder="Who is this circle for, and what are you working through together?" multiline numberOfLines={3} textAlignVertical="top" className="w-full px-3 py-2 border border-neutral-300 rounded-xl" />
          </View>

          {/* Privacy Flag */}
          <View className="gap-1">
            <View className="flex-row items-center">
              <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-neutral-400">
                Privacy Setting
              </AppText>
              <HelpTooltip text="Public circles show up in the directory and anyone can join them straight away. Private circles are hidden — people can only join with the invite code you share with them." />
            </View>
            <View className="flex-row gap-2 mt-1">
              <Pressable
                onPress={() => setCreateGroupPrivacy('public')}
                className={`flex-1 p-3 rounded-xl border items-center ${
                  createGroupPrivacy === 'public' ? 'bg-white border-neutral-900' : 'bg-neutral-50 border-neutral-200'
                }`}
              >
                <AppText variant="label" className="font-black leading-none">🔓 Public Circle</AppText>
                <AppText variant="micro" className="font-medium text-neutral-400 mt-1">Open to everyone</AppText>
              </Pressable>

              <Pressable
                onPress={() => setCreateGroupPrivacy('private')}
                className={`flex-1 p-3 rounded-xl border items-center ${
                  createGroupPrivacy === 'private' ? 'bg-white border-neutral-900' : 'bg-neutral-50 border-neutral-200'
                }`}
              >
                <AppText variant="label" className="font-black leading-none">🔒 Private Circle</AppText>
                <AppText variant="micro" className="font-medium text-neutral-400 mt-1">Requires code/approval</AppText>
              </Pressable>
            </View>
          </View>

          {/* Create Action */}
          <Pressable onPress={handleCreateCircle} className="w-full py-3 bg-[#1A1A1A] rounded-xl items-center shadow-md">
            <AppText variant="label" className="text-white font-black uppercase tracking-wider">Create Scripture Circle 🛡️</AppText>
          </Pressable>
        </View>
      </ScrollView>
    </FadeInView>
  );
}
