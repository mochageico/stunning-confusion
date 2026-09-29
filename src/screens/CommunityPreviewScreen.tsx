import { ScrollView, View } from 'react-native';
import { Globe, Lock } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppButton, AppText, useScaledSpace } from '../components/design';
import { GroupedList, ListRow, ScreenHeader } from '../components/blocks';

// A circle you haven't joined, as a read-only page: none of the member, plan
// or chat machinery, since a non-member has no access to it.
export default function CommunityPreviewScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const { user, previewCircle, myCircles, closeCirclePreview, openCircle, joinCircle } = state;

  if (!previewCircle) return null;

  const isAlreadyJoined = myCircles.some((mc) => mc.id === previewCircle.id);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader
          title={previewCircle.name}
          eyebrow={previewCircle.isPublic ? 'Public circle' : 'Private circle'}
          subtitle={previewCircle.description || 'No description yet.'}
          onBack={closeCirclePreview}
          backLabel="Find a circle"
        />

        <GroupedList>
          <ListRow title="Led by" value={previewCircle.ownerName} />
          <ListRow
            Icon={previewCircle.isPublic ? Globe : Lock}
            title="Who can join"
            value={previewCircle.isPublic ? 'Anyone' : 'Invite code'}
          />
        </GroupedList>

        <View style={{ gap: space(8) }}>
          <AppButton
            size="lg"
            variant={isAlreadyJoined ? 'secondary' : 'primary'}
            label={isAlreadyJoined ? 'Open circle' : 'Join circle'}
            onPress={() => (isAlreadyJoined ? openCircle(previewCircle.id) : joinCircle(previewCircle.id, previewCircle.name))}
          />
          {!isAlreadyJoined && (
            <AppText variant="caption" className="font-sans text-ink-3 text-center">
              {user ? "You'll be added as a member right away." : 'Sign in to join this circle.'}
            </AppText>
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}
