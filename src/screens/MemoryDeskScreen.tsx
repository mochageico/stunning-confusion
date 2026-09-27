import { ScrollView } from 'react-native';
import { CalendarDays, FolderOpen, History, ListOrdered } from 'lucide-react-native';

import { AppState, ScreenName } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { useScaledSpace } from '../components/design';
import { GroupedList, ListRow, ScreenHeader } from '../components/blocks';

// ============================================================================
// MEMORY DESK — one predictable door to everything about your own memory work.
//
// Before this, the pieces were reached from four unrelated places: the queue
// from a link on Home, saved plans from a Home tile, the plan designer only
// via saved plans or onboarding, the calendar only from inside the queue
// screen, and history from the Profile tab.
//
// This is a menu, not an editor. Each row opens a screen that gets the full
// width to itself -- which is what makes it hold up at large font sizes, where
// trying to fit a queue editor and a settings panel on one screen would not.
//
// Every row shows its CURRENT STATE rather than just a name. That's the point:
// you can read where everything stands at a glance without opening anything,
// so the menu informs rather than hides. (ListRow moves the state under the
// title past 1.3x.)
//
// Community group plans deliberately do NOT live here -- they're group-owned
// content on a different lifecycle, and belong in the Community tab.
// ============================================================================

export default function MemoryDeskScreen({ state }: { state: AppState }) {
  const { handleBack, navigateTo, memoryQueue, savedPlans, isReviewDue, reviewsPaused, learningDays, newVersesPace } = state;
  const space = useScaledSpace();

  const queuedCount = memoryQueue.filter((item) => item.status === 'queued').length;
  // Nothing is due while reviews are paused -- same as Home.
  const dueTodayCount = reviewsPaused ? 0 : memoryQueue.filter(
    (item) => item.status === 'reviewing' && isReviewDue(item.nextReviewDueDate)
  ).length;
  const activePlanName = savedPlans.find((p) => p.isActive)?.name;
  // 'retained' is the terminal status -- the app's own copy calls this
  // "retained for good". There is no 'memorized' status on QueueItem.
  const retainedCount = memoryQueue.filter((item) => item.status === 'retained').length;

  const go = (screen: ScreenName) => () => navigateTo(screen);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        {/* Today is the only way in. */}
        <ScreenHeader
          title="My Memory Work"
          subtitle="What you're memorizing, how, and what you've done so far."
          onBack={handleBack}
          backLabel="Today"
        />

        <GroupedList>
          {/* My Verses owns the schedule dials, so its detail line says what
              your week looks like, not just how many verses are sitting
              there. */}
          <ListRow
            Icon={ListOrdered}
            title="My Verses & Schedule"
            value={`${queuedCount} waiting · ${newVersesPace}/day, ${learningDays.length} days`}
            onPress={go('activePlan')}
          />
          <ListRow
            Icon={CalendarDays}
            title="Memory Calendar"
            value={reviewsPaused ? 'Paused' : dueTodayCount === 1 ? '1 due today' : `${dueTodayCount} due today`}
            onPress={go('memoryCalendar')}
          />
          {/* The one door to the Review Settings editor. There used to be a
              second row here opening the ACTIVE preset's editor directly --
              two rows leading to the same editor, one of which silently
              picked which preset you were editing for you. Now you pick from
              the list first, then edit, so the editor always knows what it
              has open. (That mattered beyond tidiness: navigating in without
              an editingPlanId made Save take the create-new branch and mint a
              duplicate.) The active preset's name rides along on this row so
              the desk still tells you where things stand at a glance. */}
          <ListRow
            Icon={FolderOpen}
            title="Review Settings"
            value={activePlanName ? `${activePlanName} · ${savedPlans.length} saved` : `${savedPlans.length} saved`}
            onPress={go('savedPlans')}
          />
          <ListRow
            Icon={History}
            title="History"
            value={retainedCount === 1 ? '1 retained' : `${retainedCount} retained`}
            onPress={go('fullHistory')}
          />
        </GroupedList>
      </ScrollView>
    </FadeInView>
  );
}
