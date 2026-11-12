import React from 'react';
import { View } from 'react-native';

import type { QueueItem, StarRef } from '../../types';
import { AppButton, AppText, useScaledSpace } from '../design';
import { Dialog } from '../blocks';
import VersePlayButton, { type VersePlayButtonProps } from '../VersePlayButton';
import { starLabel } from '../../lib/mapLayout';
import { heldPage, useRangeText, type CardActions } from './MapCards';

// ============================================================================
// MY SKY'S TWO CENTERED POP-UPS (CONSTELLATION_SKY_PLAN.md, stage 3)
// ----------------------------------------------------------------------------
// Both open in the middle of the screen, never as a bottom sheet.
//   - A hidden glow: where the star is joined to, and a button to learn that
//     verse (open its page if it is on My Verses, else add it).
//   - A found star the user doesn't hold: reference, play, the verse, and Add
//     to My Verses. No "joined to" line.
// ============================================================================

/** Everything VersePlayButton needs except which verse (the screen reads these off AppState). */
export type SkyPlayProps = Omit<VersePlayButtonProps, 'book' | 'chapter' | 'verse' | 'translationId'>;

export function HiddenStarPopup({
  visible,
  joined,
  queue,
  actions,
  onClose,
}: {
  visible: boolean;
  /** The passage joined to the tapped star. */
  joined: StarRef | null;
  queue: QueueItem[];
  actions: CardActions;
  onClose: () => void;
}) {
  const ref = joined ? starLabel(joined) : null;
  const page = joined ? heldPage(joined, queue) : null;
  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      title="A hidden star"
      message={
        ref
          ? `It's joined to ${ref}. Learn that verse and this one will appear!`
          : 'Learn the verses around it and this one will appear!'
      }
      actions={
        <>
          <AppButton variant="quiet" label="Close" onPress={onClose} />
          {joined && ref ? (
            <AppButton
              variant="primary"
              label={`Learn ${ref}`}
              accessibilityLabel={`Learn ${ref}`}
              onPress={() => {
                onClose();
                if (page) actions.onOpenVerse(page);
                else actions.onAddVerses(joined);
              }}
            />
          ) : null}
        </>
      }
    />
  );
}

export function FoundStarPopup({
  refr,
  queue,
  translationId,
  play,
  actions,
  onClose,
}: {
  refr: StarRef | null;
  queue: QueueItem[];
  translationId: string;
  play: SkyPlayProps;
  actions: CardActions;
  onClose: () => void;
}) {
  const space = useScaledSpace();
  const text = useRangeText(refr ?? { book: '', chapter: 0, start: 0, end: 0 }, queue, translationId);
  const onList = !!refr && queue.some((q) => q.book === refr.book && q.chapter === refr.chapter && q.verseNumber >= refr.start && q.verseNumber <= refr.end);
  return (
    <Dialog
      visible={!!refr}
      onClose={onClose}
      title={refr ? starLabel(refr) : undefined}
      actions={
        <>
          <AppButton variant="quiet" label="Close" onPress={onClose} />
          {refr && !onList ? (
            <AppButton
              variant="primary"
              label="Add to My Verses"
              onPress={() => {
                onClose();
                actions.onAddVerses(refr);
              }}
            />
          ) : null}
        </>
      }
    >
      {refr ? (
        <View style={{ gap: space(12) }}>
          {/* A play button speaks one verse, so only a single-verse star gets one. */}
          {refr.start === refr.end ? (
            <View className="flex-row">
              <VersePlayButton book={refr.book} chapter={refr.chapter} verse={refr.start} translationId={translationId} {...play} />
            </View>
          ) : null}
          {text ? (
            <AppText variant="body" className="font-serif text-ink">
              {text}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </Dialog>
  );
}
