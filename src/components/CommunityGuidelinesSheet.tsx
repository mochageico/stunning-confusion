import { View } from 'react-native';

import type { AppState } from '../state/useAppState';
import { AppButton, AppText, useScaledSpace } from './design';
import { Dialog } from './blocks';

const RULES: { title: string; body: string }[] = [
  { title: 'Be kind', body: 'Encourage each other. No harassment, bullying, threats or hate of any kind.' },
  { title: 'Keep it clean', body: 'No sexual, violent or otherwise inappropriate messages, names, photos or recordings.' },
  { title: 'Be yourself', body: "Don't pretend to be someone else, and don't spam or advertise." },
  { title: 'Look out for others', body: "If something isn't right, report it. You can block anyone, any time. We review every report within 24 hours and remove content or accounts that break these rules." },
];

/**
 * Shown once, before someone first posts anything or opens Community: the
 * terms everyone agrees to, which App Store guideline 1.2 requires for any
 * app where people can message each other or share content. Accepting is
 * remembered per account (users/{uid}/settings/community).
 */
export function CommunityGuidelinesSheet({ state }: { state: AppState }) {
  const space = useScaledSpace();
  return (
    <Dialog
      visible={state.guidelinesPromptOpen}
      onClose={state.closeCommunityGuidelines}
      placement="sheet"
      title="Community guidelines"
      actions={
        <>
          <AppButton variant="quiet" label="Not now" onPress={state.closeCommunityGuidelines} />
          <AppButton variant="primary" label="I agree" onPress={state.acceptCommunityGuidelines} />
        </>
      }
    >
      <AppText variant="body" className="font-sans text-ink-2">
        Circles, friends and chat are for memorizing Scripture together. To use them, please agree to these:
      </AppText>
      <View style={{ gap: space(12) }}>
        {RULES.map((r) => (
          <View key={r.title} style={{ gap: space(2) }}>
            <AppText variant="label" className="font-sans font-semibold text-ink">
              {r.title}
            </AppText>
            <AppText variant="caption" className="font-sans text-ink-2">
              {r.body}
            </AppText>
          </View>
        ))}
      </View>
      <AppText variant="caption" className="font-sans text-ink-3">
        There's no tolerance for objectionable content or abusive users. Breaking these rules can get your account removed.
      </AppText>
    </Dialog>
  );
}
