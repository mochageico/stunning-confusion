import { ScrollView, View } from 'react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppButton, AppText, AppTextInput, OptionCards, useScaledSpace } from '../components/design';
import { ScreenHeader } from '../components/blocks';

const PRIVACY_OPTIONS = [
  { id: 'public' as const, title: 'Public', desc: 'Listed in Find a circle. Anyone can join right away.' },
  { id: 'private' as const, title: 'Private', desc: 'Hidden from search. People join with the invite code you share.' },
];

export default function CommunityCreateScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
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

  const fieldLabel = (text: string) => (
    <AppText variant="caption" className="font-sans font-medium text-ink-2">
      {text}
    </AppText>
  );
  const inputBox = 'bg-surface border border-line rounded-btn text-ink font-sans';

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader
          title="Create a circle"
          subtitle="Gather a few people to memorize together."
          onBack={() => setCommunitySubView('home')}
          backLabel="Community"
        />

        <View style={{ gap: space(16) }}>
          <View style={{ gap: space(4) }}>
            {fieldLabel('Name')}
            <AppTextInput
              value={createGroupName}
              onChangeText={setCreateGroupName}
              placeholder="e.g. Wednesday night Romans"
              accessibilityLabel="Circle name"
              variant="body"
              className={inputBox}
              style={{ paddingHorizontal: space(12), paddingVertical: space(10) }}
            />
          </View>

          <View style={{ gap: space(4) }}>
            {fieldLabel('Description (optional)')}
            <AppTextInput
              value={createGroupDesc}
              onChangeText={setCreateGroupDesc}
              placeholder="Who is it for, and what will you work through?"
              accessibilityLabel="Circle description"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              variant="body"
              className={inputBox}
              style={{ paddingHorizontal: space(12), paddingVertical: space(10), minHeight: space(88) }}
            />
          </View>

          <View style={{ gap: space(6) }}>
            {fieldLabel('Who can join')}
            <OptionCards options={PRIVACY_OPTIONS} value={createGroupPrivacy} onChange={setCreateGroupPrivacy} />
          </View>
        </View>

        <AppButton size="lg" variant="primary" label="Create circle" onPress={handleCreateCircle} />
      </ScrollView>
    </FadeInView>
  );
}
