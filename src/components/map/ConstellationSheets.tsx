import React, { useState } from 'react';
import { View } from 'react-native';

import type { Constellation } from '../../types';
import { guideNotes } from '../../lib/constellations';
import { starLabel } from '../../lib/mapLayout';
import { AppButton, AppText, Switch, useScaledSpace } from '../design';
import { Dialog } from '../blocks';

// ============================================================================
// Two small sheets for the curated constellations: the guide (opened from a
// line card's "Read the guide"), and the show-or-hide list (reached from the
// map's last chip). The guide never appears on the map itself.
// ============================================================================

/**
 * The guide's text: the description, the overall guide, and the guide's note on
 * each line once both of its ends are found (so a note never gives away a star
 * that is still hidden). `revealed` = the star ids that show.
 */
export function GuideBody({ constellation, revealed }: { constellation: Constellation; revealed?: ReadonlySet<string> }) {
  const space = useScaledSpace();
  const notes = revealed ? guideNotes(constellation, revealed) : [];
  return (
    <View style={{ gap: space(12) }}>
      <AppText variant="label" className="font-sans text-ink-2">
        {constellation.description}
      </AppText>
      <AppText variant="body" className="font-serif text-ink">
        {constellation.guide.trim() || 'The guide for this one is still being written.'}
      </AppText>
      {notes.map((n, i) => (
        <View key={i} style={{ gap: space(2) }}>
          <AppText variant="caption" className="font-sans font-semibold text-ink-3">
            {`${starLabel(n.from)} → ${starLabel(n.to)}`}
          </AppText>
          <AppText variant="body" className="font-serif text-ink">
            {n.note}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/** The guide: title, description, the writing, and a way to take the rest of the passages. */
export function GuideSheet({
  constellation,
  revealed,
  onClose,
  onWalk,
  onRemove,
}: {
  constellation: Constellation | null;
  /** The star ids that show: line notes appear once both ends are in it. */
  revealed?: ReadonlySet<string>;
  onClose: () => void;
  /** Set when two of its stars are in My Verses. */
  onWalk?: () => void;
  /** "Remove from my sky" (asks first). Its verses stay on My Verses and the stars it found stay found. */
  onRemove?: () => void;
}) {
  const space = useScaledSpace();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
    <Dialog
      visible={!!constellation && !confirming}
      onClose={onClose}
      placement="sheet"
      title={constellation?.title}
      actions={
        <>
          <AppButton variant="quiet" label="Close" onPress={onClose} />
          {onRemove ? <AppButton variant="quiet" label="Remove from my sky" onPress={() => setConfirming(true)} /> : null}
          {onWalk ? <AppButton variant="secondary" label="Walk this constellation" onPress={onWalk} /> : null}
        </>
      }
    >
      {constellation ? <GuideBody constellation={constellation} revealed={revealed} /> : null}
    </Dialog>
    <Dialog
      visible={confirming}
      onClose={() => setConfirming(false)}
      title="Remove from my sky?"
      message="The verses you added stay on My Verses, and you can add this constellation back any time. Stars you have found stay found."
      actions={
        <>
          <AppButton variant="quiet" label="Keep it" onPress={() => setConfirming(false)} />
          <AppButton
            variant="destructive"
            label="Remove"
            onPress={() => {
              setConfirming(false);
              onRemove?.();
            }}
          />
        </>
      }
    />
    </>
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
