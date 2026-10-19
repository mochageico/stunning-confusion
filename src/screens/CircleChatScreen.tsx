import { View } from 'react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { ChatView } from '../components/chat/ChatView';
import { ScreenHeader } from '../components/blocks';

export default function CircleChatScreen({ state }: { state: AppState }) {
  const { user, activeCircle, activeCircleChatId, activeCircleMessages, loadingActiveCircleMessages, closeCircleChat, handleBack } = state;

  if (!activeCircle || !activeCircleChatId) return null;

  const goBack = () => {
    closeCircleChat();
    handleBack();
  };

  return (
    <FadeInView style={{ flex: 1 }}>
      <View className="border-b border-hairline" style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
        <ScreenHeader inline title={activeCircle.name} eyebrow="Group chat" onBack={goBack} backLabel="Circle" />
      </View>
      <ChatView
        state={state}
        scope="circle"
        containerId={activeCircleChatId}
        messages={activeCircleMessages}
        loading={loadingActiveCircleMessages}
        emptyText="No messages yet. Say hello to the circle."
        placeholder="Message the circle"
        canModerate={activeCircle.ownerId === user?.uid}
      />
    </FadeInView>
  );
}
