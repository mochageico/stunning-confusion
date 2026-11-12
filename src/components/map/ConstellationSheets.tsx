import React, { useState } from 'react';
import { View } from 'react-native';

import type { Constellation } from '../../types';
import { guideNotes } from '../../lib/constellations';
import { starLabel } from '../../lib/mapLayout';
import { AppButton, AppText, useScaledSpace } from '../design';
import { Dialog } from '../blocks';

// ============================================================================
// The guide for a curated constellation (opened from a line card's "Read the
// guide" and the Guide button). The guide never appears on the map itself.
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
