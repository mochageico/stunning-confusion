import { Bell } from 'lucide-react-native';
import { View } from 'react-native';

import type { AppState } from '../state/useAppState';
import { AppButton, AppText, useScaledSpace } from './design';
import { Dialog } from './blocks';
import { useThemeColors } from './theme';

/**
 * The gentle ask before the phone's own permission prompt, shown once at a
 * moment notifications obviously help (just sent a message, joined a
 * circle). iOS only lets an app show its prompt once, so it's worth asking
 * when the answer is most likely yes. See maybeAskForNotifications.
 */
export function NotificationAskSheet({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const palette = useThemeColors();
  const reason = state.notificationAskReason;
  return (
    <Dialog
      visible={!!reason}
      onClose={state.dismissNotificationAsk}
      placement="sheet"
      actions={
        <>
          <AppButton variant="quiet" label="Not now" onPress={state.dismissNotificationAsk} />
          <AppButton
            variant="primary"
            label="Turn on"
            onPress={async () => {
              state.dismissNotificationAsk();
              await state.requestNotificationPermission();
            }}
          />
        </>
      }
    >
      <View className="items-center" style={{ gap: space(10), paddingTop: space(4) }}>
        <View className="bg-accent-soft rounded-full items-center justify-center" style={{ width: space(52), height: space(52) }}>
          <Bell size={24} color={palette.accent} />
        </View>
        <AppText variant="title" className="font-sans font-bold text-ink text-center">
          {reason}
        </AppText>
        <AppText variant="body" className="font-sans text-ink-2 text-center">
          We'll let you know about new messages, friend requests and challenges, and remind you when verses are due. You can change any of it in Settings.
        </AppText>
      </View>
    </Dialog>
  );
}
