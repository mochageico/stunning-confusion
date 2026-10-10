import { ScrollView } from 'react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { useScaledSpace } from '../components/design';
import { ScreenHeader } from '../components/blocks';
import { QueueSources } from '../components/QueueSources';

// WHERE VERSES COME FROM -- only reachable once you've joined a group plan,
// since with one source there's nothing to weigh. Was a card on My Verses.
export default function VerseSourcesScreen({ state }: { state: AppState }) {
  const {
    handleBack,
    memoryQueue,
    joinedGroupPlanDetails,
    joinedGroupPlanMemberships,
    setGroupPlanPriority,
    getNextPullPreview,
  } = state;
  const space = useScaledSpace();

  const individualQueuedCount = memoryQueue.filter(
    (item) => item.status === 'queued' && item.origin !== 'group'
  ).length;
  const pullPreview = getNextPullPreview();

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader
          title="Where verses come from"
          subtitle="Your own verses and each group plan you've joined. Choose which goes first on a learning day."
          onBack={handleBack}
          backLabel="My Verses"
        />
        <QueueSources
          individualQueuedCount={individualQueuedCount}
          joinedPlans={joinedGroupPlanDetails}
          memberships={joinedGroupPlanMemberships}
          previewFromPlans={pullPreview.fromPlans}
          previewFromIndividual={pullPreview.fromIndividual}
          onChangePriority={setGroupPlanPriority}
        />
      </ScrollView>
    </FadeInView>
  );
}
