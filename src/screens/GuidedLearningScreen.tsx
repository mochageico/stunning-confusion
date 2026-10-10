import { ScrollView } from 'react-native';
import { Compass } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { useScaledSpace } from '../components/design';
import { EmptyState, ScreenHeader } from '../components/blocks';

// ============================================================================
// GUIDED LEARNING -- placeholder route (phase 3 of the Guided learning plan).
// ----------------------------------------------------------------------------
// The route, app state and credit path are wired; phase 4 replaces this body
// with the real sitting, rendered from sessionReducer in src/lib/guided.ts.
// Nothing links here yet, so users can't reach it.
// ============================================================================

export default function GuidedLearningScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader title="Guided learning" onBack={() => state.navigateTo('home')} backLabel="Today" />
        <EmptyState Icon={Compass} title="Not ready yet" message="Guided learning is still being built." />
      </ScrollView>
    </FadeInView>
  );
}
