import { Pressable, View } from 'react-native';

import { GroupPlan, GroupPlanMembership } from '../types';
import { AppText, MIN_TOUCH, useFontScale, useScaledSpace } from './design';

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
      {/* Your own queue */}
      <View
        className="flex-row items-center justify-between rounded-xl border border-neutral-200 bg-white"
        style={{ padding: space(12), gap: space(8) }}
      >
        <AppText variant="body" className="font-sans font-bold text-[#1A1A1A] flex-1">
          My own verses
        </AppText>
        <AppText variant="micro" className="font-mono text-neutral-500 shrink-0">
          {individualQueuedCount} queued
        </AppText>
      </View>

      {/* Joined group plans */}
      {rows.map(({ membership, plan }) => (
        <View
          key={membership.planId}
          className="rounded-xl border border-indigo-200 bg-indigo-50/40"
          style={{ padding: space(12), gap: space(10) }}
        >
          <View
            className={stacked ? '' : 'flex-row items-center justify-between'}
            style={{ gap: space(stacked ? 4 : 8) }}
          >
            <AppText variant="body" className="font-sans font-bold text-indigo-900 flex-1">
              {plan.name}
            </AppText>
            <AppText variant="micro" className="font-mono text-indigo-700 shrink-0">
              {plan.versesPerWeek}/week
            </AppText>
          </View>

          <View className="flex-row" style={{ gap: space(6) }}>
            {PRIORITY_LABELS.map((opt) => {
              const active = opt.id === membership.priority;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => onChangePriority(membership.planId, opt.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  aria-checked={active}
                  className={`flex-1 items-center justify-center rounded-lg border ${
                    active ? 'border-indigo-600 bg-indigo-600' : 'border-indigo-200 bg-white'
                  }`}
                  style={{ minHeight: MIN_TOUCH * 0.7, paddingVertical: space(6), paddingHorizontal: space(4) }}
                >
                  <AppText
                    variant="micro"
                    className={`font-sans font-bold text-center ${active ? 'text-white' : 'text-indigo-700'}`}
                  >
                    {opt.short}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          {membership.priority === 'additive' && (
            <AppText variant="micro" className="font-sans text-indigo-800/80 leading-relaxed">
              Pulls on top of your daily pace, and keeps going even when the Review Shield is up.
            </AppText>
          )}
        </View>
      ))}

      {/* What the next learning day would actually do. The single line that
          answers "does this setting do anything?" */}
      <View className="rounded-xl border border-neutral-200 bg-neutral-50" style={{ padding: space(12) }}>
        <AppText variant="micro" className="font-sans text-neutral-600 leading-relaxed">
          {previewParts.length > 0
            ? `Next learning day: ${previewParts.join(', ')}.`
            : 'Next learning day: nothing left to pull.'}
        </AppText>
      </View>
    </View>
  );
}
