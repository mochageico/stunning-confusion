import React from 'react';
import { View } from 'react-native';

import type { Constellation, QueueItem, StarRef } from '../../types';
import { AppButton, AppText, Switch, useScaledSpace } from '../design';
import { Dialog } from '../blocks';
import { starLit } from '../../lib/constellations';
import { starLabel } from '../../lib/mapLayout';

// ============================================================================
// Two small sheets for the curated constellations: the guide (opened from a
// line card's "Read the guide"), and the show-or-hide list (reached from the
// map's last chip). The guide never appears on the map itself.
// ============================================================================

/** The guide: title, description, the writing, and a way to take the rest of the passages. */
export function GuideSheet({
  constellation,
  queue,
  onClose,
  onAddRest,
}: {
  constellation: Constellation | null;
  queue: QueueItem[];
  onClose: () => void;
  onAddRest: (refs: StarRef[]) => void;
}) {
  const space = useScaledSpace();
  const missing = constellation ? constellation.stars.filter((s) => !starLit(s.ref, queue)).map((s) => s.ref) : [];
  return (
    <Dialog
      visible={!!constellation}
      onClose={onClose}
      placement="sheet"
      title={constellation?.title}
      actions={
        <>
          <AppButton variant="quiet" label="Close" onPress={onClose} />
          {missing.length > 0 ? (
            <AppButton
              variant="primary"
              label="Add the rest to My Verses"
              onPress={() => {
                onAddRest(missing);
                onClose();
              }}
            />
          ) : null}
        </>
      }
    >
      {constellation ? (
        <View style={{ gap: space(12) }}>
          <AppText variant="label" className="font-sans text-ink-2">
            {constellation.description}
          </AppText>
          <AppText variant="body" className="font-serif text-ink">
            {constellation.guide.trim() || 'The guide for this one is still being written.'}
          </AppText>
          {missing.length > 0 ? (
            <AppText variant="caption" className="font-sans text-ink-2">
              Not in My Verses yet: {missing.map(starLabel).join(', ')}.
            </AppText>
          ) : null}
        </View>
      ) : null}
    </Dialog>
  );
}

/** Every curated constellation with a switch. Off = gone from the map and the chips. */
export function ConstellationListSheet({
  visible,
  constellations,
  hidden,
  onToggle,
  onClose,
}: {
  visible: boolean;
  constellations: Constellation[];
  hidden: string[];
  onToggle: (id: string, show: boolean) => void;
  onClose: () => void;
}) {
  const space = useScaledSpace();
  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      placement="sheet"
      title="Show or hide"
      message="Choose which constellations appear on your map. Hiding one never takes verses off My Verses."
      actions={<AppButton variant="primary" label="Done" onPress={onClose} />}
    >
      {constellations.map((c) => {
        const on = !hidden.includes(c.id);
        return (
          <View key={c.id} className="flex-row items-center border-b border-hairline" style={{ gap: space(12), paddingVertical: space(10), minHeight: 52 }}>
            <View className="flex-1" style={{ gap: space(2) }}>
              <AppText variant="label" className="font-sans font-bold text-ink">
                {c.title}
              </AppText>
              <AppText variant="caption" className="font-sans text-ink-2">
                {c.description}
              </AppText>
            </View>
            <Switch value={on} onChange={(next) => onToggle(c.id, next)} accessibilityLabel={`Show ${c.title}`} />
          </View>
        );
      })}
    </Dialog>
  );
}
