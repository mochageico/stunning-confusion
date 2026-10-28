import { useMemo, useState } from 'react';
import { View } from 'react-native';

import type { QueueItem } from '../../types';
import type { ReviewNote, ReviewTag } from '../../lib/ladderEngine';
import { seamCue, toDrillVerse } from '../../lib/guided';
import { passageOf } from '../../lib/passages';
import { AppButton, AppText, useScaledSpace } from '../design';
import { Badge, GroupedList, ListRow, type BadgeTone } from '../blocks';
import ThreadRound, { type ThreadRoundResult, type ThreadVerse } from '../ThreadRound';

// ============================================================================
// REVIEW RECAP (REVIEW_LADDER_PLAN.md stage 7)
// ----------------------------------------------------------------------------
// What each passage's review did, one line each with the reason, and the
// "Fix the transitions" drill for the verses that slipped. Both take plain
// props so the demo harness can drive them.
// ============================================================================

const TAG_TONE: Record<ReviewTag, BadgeTone> = {
  Clean: 'success',
  'Won back': 'success',
  Forgiven: 'accent',
  Held: 'warning',
  'Back 1': 'warning',
  'Down a step': 'danger',
};

/** One row per passage the session moved: its tag and the reason. */
export function PassageOutcomes({ notes }: { notes: ReviewNote[] }) {
  if (notes.length === 0) return null;
  return (
    <GroupedList header="What each passage did">
      {notes.map((n, i) => (
        <ListRow
          key={`${n.title}:${n.at}:${i}`}
          title={n.title}
          subtitle={n.firmUp ? `${n.reason} Firm it up tomorrow to win it back.` : n.reason}
          accessory={<Badge label={n.tag} tone={TAG_TONE[n.tag]} />}
        />
      ))}
    </GroupedList>
  );
}

/** Slipped verses in this session's lines that still carry the weak-spot dot, at most `max`. */
export const transitionTargets = (notes: readonly ReviewNote[], queue: readonly QueueItem[], max = 3): string[] => {
  const live = new Map(queue.map((q) => [q.verseId, q]));
  const out: string[] = [];
  for (const n of notes) {
    for (const s of n.slipped) {
      if (live.get(s.verseId)?.slipped && !out.includes(s.verseId)) out.push(s.verseId);
    }
  }
  return out.slice(0, max);
};

type Phase = 'offer' | 'running' | 'done' | 'skipped';

/**
 * "Fix the transitions": for each slipped verse, a Pick-up-the-thread round
 * that starts in the second half of the verse before it and runs through it
 * (the Seam drill). About a minute, never credited, always skippable.
 * Saying the verse clears its weak-spot dot early.
 */
export function FixTransitions({
  queue,
  targets: offered,
  onClear,
}: {
  queue: readonly QueueItem[];
  /** verseIds, in the order to drill. */
  targets: string[];
  /** Called with a verse that was said through: clear its dot. */
  onClear: (verseId: string) => void;
}) {
  const space = useScaledSpace();
  const [phase, setPhase] = useState<Phase>('offer');
  const [index, setIndex] = useState(0);
  const [tries, setTries] = useState(0);
  // Fixed when the drill starts: clearing a dot shrinks `offered` mid-drill.
  const [locked, setLocked] = useState<string[] | null>(null);
  const targets = locked ?? offered;

  const verseId = targets[index];
  const round = useMemo(() => {
    if (phase !== 'running' || !verseId) return null;
    const p = passageOf(queue, verseId);
    if (!p) return null;
    const drill = p.items.map(toDrillVerse);
    const at = p.items.findIndex((q) => q.verseId === verseId);
    const cue = seamCue(drill, at, Math.random);
    return cue ? { verses: drill as ThreadVerse[], cue, at } : null;
    // The queue changes under the drill as dots clear; the round stays put.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, verseId, tries]);

  if (targets.length === 0 || phase === 'skipped') return null;

  const next = () => {
    if (index + 1 >= targets.length) setPhase('done');
    else {
      setIndex(index + 1);
      setTries(0);
    }
  };

  if (phase === 'done') {
    return (
      <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(4) }}>
        <AppText variant="body" className="font-sans font-semibold text-ink">
          Transitions fixed
        </AppText>
        <AppText variant="label" className="font-sans text-ink-2">
          The dots on the verses you said through are gone.
        </AppText>
      </View>
    );
  }

  if (phase === 'running') {
    if (!round) {
      // No usable cue for this verse: move on rather than stall.
      setTimeout(next, 0);
      return null;
    }
    return (
      <View style={{ gap: space(10) }}>
        <AppText variant="label" className="font-sans font-semibold text-ink-2">
          {`Fix the transitions · ${index + 1} of ${targets.length}`}
        </AppText>
        <ThreadRound
          key={`${verseId}:${tries}`}
          verses={round.verses}
          cue={round.cue}
          hideVerseNumber={false}
          creditPreview={() => 'Practice only'}
          allowSelfCheck
          spotCheck={false}
          onDifferentCue={() => setTries((n) => n + 1)}
          onFinish={(r: ThreadRoundResult) => {
            const said = r.perVerse.find((pv) => pv.index === round.at);
            if (said?.ok) onClear(verseId);
            next();
          }}
        />
        <AppButton variant="quiet" label="Skip the rest" onPress={() => setPhase('skipped')} />
      </View>
    );
  }

  return (
    <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(10) }}>
      <View style={{ gap: space(4) }}>
        <AppText variant="body" className="font-sans font-semibold text-ink">
          Fix the transitions
        </AppText>
        <AppText variant="label" className="font-sans text-ink-2">
          {`About a minute. You'll say the end of the verse before, then run into ${targets.length === 1 ? 'the verse' : 'each verse'} that slipped. Saying it clears its dot. It doesn't count as a review.`}
        </AppText>
      </View>
      <AppButton size="md" variant="secondary" label="Start" onPress={() => {
          setLocked(offered);
          setPhase('running');
        }} />
      <AppButton size="md" variant="quiet" label="Skip" onPress={() => setPhase('skipped')} />
    </View>
  );
}
