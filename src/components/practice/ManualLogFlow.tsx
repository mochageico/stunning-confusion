import { useMemo, useState } from 'react';
import { Modal, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pickSpotCheck, SelfCheckAnswer, spotCheckLeadIn } from '../../lib/grading';
import type { QueueItem, VerseState } from '../../types';
import ManualLogSheet from './ManualLogSheet';
import { SpotCheck } from './SelfCheck';

// ============================================================================
// MANUAL LOG, WITH THE SPOT CHECK
// ----------------------------------------------------------------------------
// The sheet where someone logs a review done off-app, then, when any verse was
// Got it, one random Got it verse said from the last words of the verse before
// -- the same honesty check Mixed review runs after a self-check. A missed spot
// check means the log can't move the passage up (canMoveUp false), exactly as
// there. Nothing is credited until the check is done, so backing out of it
// logs nothing.
// ============================================================================

export default function ManualLogFlow({
  visible,
  title,
  verses,
  memoryQueue,
  selfCheckedLast,
  onClose,
  onLog,
}: {
  visible: boolean;
  title?: string;
  verses: VerseState[];
  /** The live queue, for the verse before the one spot checked. */
  memoryQueue: QueueItem[];
  selfCheckedLast?: boolean;
  onClose: () => void;
  /** The answers, and false when the spot check was missed. */
  onLog: (answers: SelfCheckAnswer[], canMoveUp: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const [spot, setSpot] = useState<{ answers: SelfCheckAnswer[]; index: number } | null>(null);

  const previous = useMemo(() => {
    if (!spot) return null;
    const v = verses[spot.index];
    const before = memoryQueue.find(
      (q) =>
        q.book === v.book &&
        q.chapter === v.chapter &&
        q.verseNumber === v.verse - 1 &&
        (!v.translationId || (q.translationId || 'ESV') === v.translationId)
    );
    return before?.text ?? null;
  }, [spot, verses, memoryQueue]);

  const finish = (answers: SelfCheckAnswer[], canMoveUp: boolean) => {
    setSpot(null);
    onLog(answers, canMoveUp);
  };

  return (
    <>
      <ManualLogSheet
        visible={visible && !spot}
        title={title}
        verses={verses}
        selfCheckedLast={selfCheckedLast}
        onClose={onClose}
        onLog={(answers) => {
          const index = pickSpotCheck(answers);
          if (index === null) finish(answers, true);
          else setSpot({ answers, index });
        }}
      />
      <Modal visible={!!spot} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setSpot(null)}>
        {spot && (
          <View className="flex-1 bg-canvas px-5" style={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }}>
            <SpotCheck
              verse={verses[spot.index]}
              leadIn={spotCheckLeadIn(previous)}
              onDone={(passed) => finish(spot.answers, passed)}
            />
          </View>
        )}
      </Modal>
    </>
  );
}
