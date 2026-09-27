import { View } from 'react-native';

import { GroupPlan, GroupPlanMembership } from '../types';
import { AppText, useFontScale, useScaledSpace } from './design';
import { SegmentedControl } from './blocks';

// Short forms of GroupPlanDetailScreen's PRIORITY_OPTIONS, for the inline
// control here. Same three modes, same order, same plain language -- see
// src/lib/groupPlanScheduler.ts for what each one actually does to the pull.
const PRIORITY_LABELS: { id: GroupPlanMembership['priority']; short: string }[] = [
  { id: 'group', short: 'Plan first' },
  { id: 'individual', short: 'Mine first' },
  { id: 'additive', short: 'Side by side' },
];

export interface QueueSourcesProps {
  /** Queued (not yet started) verses that came from your own adding. */
  individualQueuedCount: number;
  joinedPlans: GroupPlan[];
  memberships: GroupPlanMembership[];
  /** planId -> verseIds the next pull would take from that plan. */
  previewFromPlans: Record<string, string[]>;
  /** verseIds the next pull would take from your own queue. */
  previewFromIndividual: string[];
  onChangePriority: (planId: string, priority: GroupPlanMembership['priority']) => void;
}

/**
 * "Where verses come from" -- your own queue plus every joined group plan,
 * each with its priority editable inline and a preview of what the next
 * learning day would actually pull.
 *
 * This block exists because the priority setting was real and wired end to
 * end, but completely unobservable: it lived on a Community-tab screen, its
 * only effect showed up here, and nothing on this screen even named which
 * plan a group verse came from. computeDailyPull already returns the full
 * breakdown; before this it was computed and thrown away.
 */
export function QueueSources({
  individualQueuedCount,
  joinedPlans,
  memberships,
  previewFromPlans,
  previewFromIndividual,
  onChangePriority,
}: QueueSourcesProps) {
  const space = useScaledSpace();
  const scale = useFontScale();
  const stacked = scale >= 1.3;

  const planById = new Map(joinedPlans.map((p) => [p.planId, p]));
  const rows = memberships
    .map((m) => ({ membership: m, plan: planById.get(m.planId) }))
    .filter((r): r is { membership: GroupPlanMembership; plan: GroupPlan } => !!r.plan);

  const previewParts = [
    previewFromIndividual.length > 0 ? `${previewFromIndividual.length} of your own` : null,
    ...rows.map((r) => {
      const n = (previewFromPlans[r.membership.planId] || []).length;
      return n > 0 ? `${n} from ${r.plan.name}` : null;
    }),
  ].filter(Boolean) as string[];

  return (
    <View style={{ gap: space(12) }}>
      {/* One card: your own verses, then each joined plan with its priority. */}
      <View className="bg-surface border border-line rounded-card overflow-hidden">
        <View
          className={stacked ? '' : 'flex-row items-center justify-between'}
          style={{ padding: space(12), gap: space(stacked ? 2 : 8) }}
        >
          <AppText variant="label" className="font-sans font-semibold text-ink flex-1">
            My own verses
          </AppText>
          <AppText variant="label" className="font-sans text-ink-3 shrink-0">
            {individualQueuedCount} waiting
          </AppText>
        </View>

        {rows.map(({ membership, plan }) => (
          <View
            key={membership.planId}
            className="border-t border-hairline"
            style={{ padding: space(12), gap: space(10) }}
          >
            <View
              className={stacked ? '' : 'flex-row items-center justify-between'}
              style={{ gap: space(stacked ? 2 : 8) }}
            >
              <AppText variant="label" className="font-sans font-semibold text-ink flex-1">
                {plan.name}
              </AppText>
              <AppText variant="label" className="font-sans text-ink-3 shrink-0">
                {plan.versesPerWeek} a week
              </AppText>
            </View>

            <SegmentedControl
              value={membership.priority}
              onChange={(id) => onChangePriority(membership.planId, id)}
              accessibilityLabel={`Which comes first, ${plan.name} or your own verses`}
              options={PRIORITY_LABELS.map((opt) => ({ id: opt.id, label: opt.short }))}
            />

            {membership.priority === 'additive' && (
              <AppText variant="caption" className="font-sans text-ink-3">
                Starts on top of your daily pace, even when today's review time is already full.
              </AppText>
            )}
          </View>
        ))}
      </View>

      {/* What the next learning day would actually do. The single line that
          answers "does this setting do anything?" */}
      <AppText variant="caption" className="font-sans text-ink-2" style={{ paddingHorizontal: space(4) }}>
        {previewParts.length > 0
          ? `Next learning day: ${previewParts.join(', ')}.`
          : 'Next learning day: nothing waiting to start.'}
      </AppText>
    </View>
  );
}
