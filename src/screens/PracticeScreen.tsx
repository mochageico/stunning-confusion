import { ScrollView } from 'react-native';

import { FadeInView } from '../components/ui';
import { AppText, useScaledSpace } from '../components/design';
import { ScreenHeader } from '../components/blocks';
import { useAppFields } from '../state/appStore';

// ============================================================================
// PRACTICE (FREE_PRACTICE_PLAN.md)
// ----------------------------------------------------------------------------
// Opened from Today's Practice row. Any verses, any mode, not tied to today's
// reviews: pick verses the way the playlist builder does, then pick a mode.
// Stage 1 stub: the picker and the mode list arrive in stage 3.
// ============================================================================

export default function PracticeScreen() {
  const { navigateTo } = useAppFields('navigateTo');
  const space = useScaledSpace();

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader title="Practice" onBack={() => navigateTo('home')} backLabel="Today" />
        <AppText variant="label" className="font-sans text-ink-3 text-center">
          Picking verses and modes comes next.
        </AppText>
      </ScrollView>
    </FadeInView>
  );
}
