import { Pressable, ScrollView, View } from 'react-native';
import { ArrowLeft, CalendarDays, ChevronRight, FolderOpen, History, ListOrdered, SlidersHorizontal } from 'lucide-react-native';

import { AppState, ScreenName } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppText, MIN_TOUCH, useFontScale, useScaledSpace } from '../components/design';

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
// so the menu informs rather than hides.
//
// Community group plans deliberately do NOT live here -- they're group-owned
// content on a different lifecycle, and belong in the Community tab.
// ============================================================================

function DeskRow({
  Icon,
  label,
  detail,
  onPress,
}: {
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  /** Current state, e.g. "12 queued · 3 learning". Shown beside or under the label. */
  detail: string;
  onPress: () => void;
}) {
  const scale = useFontScale();
  const space = useScaledSpace();
  // Label and detail are two pieces of text sharing a row, which is the limit
  // before this becomes the pattern that leaks. Past 1.3x they stack, with the
  // chevron staying put on the right.
  const stacked = scale >= 1.3;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="border-2 border-[#1A1A1A] rounded-xl bg-white shadow-sm flex-row items-center"
      style={{ minHeight: MIN_TOUCH, padding: space(12), gap: space(10) }}
    >
      <View className="shrink-0">
        <Icon size={Math.round(18 * scale)} color="#1A1A1A" />
      </View>
      <View className={stacked ? 'flex-1' : 'flex-1 flex-row items-center'} style={{ gap: space(stacked ? 2 : 8) }}>
        <AppText
          variant="label"
          className={`font-serif font-black text-[#1A1A1A] ${stacked ? '' : 'flex-1'}`}
        >
          {label}
        </AppText>
        <AppText variant="micro" className={`font-mono text-neutral-500 ${stacked ? '' : 'shrink-0'}`}>
          {detail}
        </AppText>
      </View>
      <View className="shrink-0">
        <ChevronRight size={Math.round(16 * scale)} color="#888888" />
      </View>
    </Pressable>
  );
}

export default function MemoryDeskScreen({ state }: { state: AppState }) {
  const { handleBack, navigateTo, memoryQueue, savedPlans, isReviewDue, openActivePlanDesigner, learningDays, newVersesPace } = state;
  const space = useScaledSpace();
  const scale = useFontScale();

  const queuedCount = memoryQueue.filter((item) => item.status === 'queued').length;
  const learningCount = memoryQueue.filter((item) => item.status === 'learning').length;
  const dueTodayCount = memoryQueue.filter(
    (item) => item.status === 'reviewing' && isReviewDue(item.nextReviewDueDate)
  ).length;
  const activePlanName = savedPlans.find((p) => p.isActive)?.name;
  // 'retained' is the terminal status -- the app's own copy calls this
  // "retained for good". There is no 'memorized' status on QueueItem.
  const retainedCount = memoryQueue.filter((item) => item.status === 'retained').length;

  const go = (screen: ScreenName) => () => navigateTo(screen);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(12) }}>
        <View className="flex-row items-center" style={{ gap: space(10) }}>
          <Pressable
            onPress={handleBack}
            accessibilityRole="button"
            className="rounded-full border border-[#E5E5E5] items-center justify-center bg-white shrink-0"
            style={{ width: space(32), height: space(32) }}
          >
            <ArrowLeft size={Math.round(15 * scale)} color="#1A1A1A" />
          </Pressable>
          <View className="flex-1">
            <AppText variant="micro" className="uppercase tracking-wider font-bold text-neutral-500 font-sans">
              Your scripture
            </AppText>
            <AppText variant="display" className="font-serif font-bold text-[#1A1A1A]">
              Memory Desk
            </AppText>
          </View>
        </View>

        <AppText variant="caption" className="text-neutral-600 font-sans">
          Everything about what you're memorizing, how you're memorizing it, and what you've done so far.
        </AppText>

        <View style={{ gap: space(8) }}>
          {/* Queue owns Rhythm now, so its detail line says what your week
              looks like, not just how many verses are sitting there. */}
          <DeskRow
            Icon={ListOrdered}
            label="Memory Queue & Rhythm"
            detail={`${queuedCount} queued · ${newVersesPace}/day, ${learningDays.length} days`}
            onPress={go('activePlan')}
          />
          {/* openActivePlanDesigner, not go('planDesigner'): the designer has
              to be told which plan it's editing. A bare navigateTo left
              editingPlanId null on a fresh launch, and Save then took the
              create-new branch -- minting a duplicate plan with the same name
              and deactivating the real one. */}
          <DeskRow
            Icon={SlidersHorizontal}
            label="Memory Plan"
            detail={activePlanName ?? 'No active plan'}
            onPress={openActivePlanDesigner}
          />
          <DeskRow
            Icon={CalendarDays}
            label="Memory Calendar"
            detail={dueTodayCount === 1 ? '1 due today' : `${dueTodayCount} due today`}
            onPress={go('memoryCalendar')}
          />
          <DeskRow
            Icon={FolderOpen}
            label="Saved Plans"
            detail={savedPlans.length === 1 ? '1 plan' : `${savedPlans.length} plans`}
            onPress={go('savedPlans')}
          />
          <DeskRow
            Icon={History}
            label="History"
            detail={retainedCount === 1 ? '1 retained' : `${retainedCount} retained`}
            onPress={go('fullHistory')}
          />
        </View>
      </ScrollView>
    </FadeInView>
  );
}
