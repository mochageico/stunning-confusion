import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Plus, Trash2 } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { MemoryPlan } from '../types';
import { FadeInView } from '../components/ui';
import { AppButton, AppIconButton, AppText, RadioMark, useFontScale, useScaledSpace } from '../components/design';
import { Dialog, ScreenHeader, SectionHeader } from '../components/blocks';
import { useThemeColors } from '../components/theme';

// Review Settings opens from more than one place, so the back link names
// whichever one you came from.
const BACK_LABELS: Partial<Record<string, string>> = {
  activePlan: 'My Verses',
  settings: 'Settings',
  home: 'Today',
};

export default function SavedPlansScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const { handleBack, handleCreateNewPlan, handleActivatePlan, handleDeletePlan, handleEditPlan, savedPlans, backHistory } = state;

  // The plan stays set after the dialog closes so its title doesn't blank
  // out while the dialog fades away.
  const [deletingPlan, setDeletingPlan] = useState<MemoryPlan | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const prevScreen = backHistory[backHistory.length - 1]?.screen;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader
          title="Review Settings"
          subtitle="How long a verse keeps coming back before it's yours for good. Tap one to use it."
          onBack={handleBack}
          backLabel={(prevScreen && BACK_LABELS[prevScreen]) || 'Back'}
        />

        <View style={{ gap: space(6) }}>
          <SectionHeader title="Saved" />
          {/* Pick one, like a settings list on the iPhone: the radio marks
              the one in use, the row itself switches to it. */}
          <View className="bg-surface border border-line rounded-card overflow-hidden">
            {savedPlans.map((plan, i) => (
              <PlanRow
                key={plan.id}
                plan={plan}
                first={i === 0}
                canDelete={savedPlans.length > 1}
                onUse={() => handleActivatePlan(plan.id)}
                onEdit={() => handleEditPlan(plan)}
                onDelete={() => {
                  setDeletingPlan(plan);
                  setConfirmingDelete(true);
                }}
              />
            ))}
          </View>
        </View>

        <View style={{ gap: space(6) }}>
          <AppButton variant="secondary" Icon={Plus} label="New settings" onPress={handleCreateNewPlan} />
          <AppText variant="caption" className="font-sans text-ink-3 text-center">
            Set how long verses keep coming back, and what happens when you miss one.
          </AppText>
        </View>
      </ScrollView>

      <Dialog
        visible={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title={`Delete "${deletingPlan?.name ?? ''}"?`}
        message={
          deletingPlan?.isActive
            ? "These are the settings you're using now, so your verses will switch to the next ones in the list. This can't be undone."
            : "This can't be undone."
        }
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setConfirmingDelete(false)} />
            <AppButton
              variant="destructive"
              label="Delete"
              onPress={() => {
                if (deletingPlan) handleDeletePlan(deletingPlan.id);
                setConfirmingDelete(false);
              }}
            />
          </>
        }
      />
    </FadeInView>
  );
}

/**
 * One saved set of review settings. The tappable part (radio, name, summary)
 * and the Edit/Delete buttons are siblings rather than nested, so a tap on a
 * button can never also switch plans. Past 1.3x the buttons move under the
 * summary so the name keeps the row's width.
 */
function PlanRow({
  plan,
  first,
  canDelete,
  onUse,
  onEdit,
  onDelete,
}: {
  plan: MemoryPlan;
  first: boolean;
  canDelete: boolean;
  onUse: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const stacked = scale >= 1.3;

  // Retention in words. "7-6-5 · 3 touches" meant nothing without already
  // knowing the engine.
  const summary = `Daily for ${plan.dailyPhaseWeeks} weeks, then weekly for ${plan.weeklyPhaseMonths} months, then monthly for ${
    plan.monthlyPhaseYears
  } ${plan.monthlyPhaseYears === 1 ? 'year' : 'years'}${plan.isBuiltIn ? '. Built in.' : '.'}`;

  const buttons = (
    <View className="flex-row items-center shrink-0" style={{ gap: space(4) }}>
      <AppButton size="sm" variant="quiet" label="Edit" onPress={onEdit} />
      {canDelete && (
        <AppIconButton
          Icon={Trash2}
          variant="bare"
          diameter={28}
          iconColor={palette.ink3}
          accessibilityLabel={`Delete ${plan.name}`}
          onPress={onDelete}
        />
      )}
    </View>
  );

  return (
    <View
      className={`${stacked ? '' : 'flex-row items-center'} ${first ? '' : 'border-t border-hairline'}`}
      style={{ paddingHorizontal: space(14), paddingVertical: space(12), gap: space(stacked ? 6 : 8) }}
    >
      <Pressable
        onPress={onUse}
        accessibilityRole="radio"
        accessibilityState={{ checked: !!plan.isActive }}
        aria-checked={!!plan.isActive}
        accessibilityLabel={`${plan.name}. ${summary}`}
        className={`flex-row items-start active:opacity-70 ${stacked ? '' : 'flex-1'}`}
        style={{ gap: space(12) }}
      >
        <RadioMark selected={!!plan.isActive} />
        <View className="flex-1" style={{ gap: space(2) }}>
          <AppText variant="body" className="font-sans font-semibold text-ink">
            {plan.name}
          </AppText>
          <AppText variant="caption" className="font-sans text-ink-3">
            {summary}
          </AppText>
        </View>
      </Pressable>
      {stacked ? (
        // Lined up under the name, past the radio.
        <View className="flex-row" style={{ paddingLeft: Math.round(22 * scale) + space(12) - space(10) }}>
          {buttons}
        </View>
      ) : (
        buttons
      )}
    </View>
  );
}
