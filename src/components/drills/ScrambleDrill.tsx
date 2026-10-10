import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Check, ChevronRight, Puzzle, Undo2 } from 'lucide-react-native';

import { buildScrambleRounds, DrillVerse, ScrambleRound } from '../../lib/drills';
import { isRtl, scriptOfVerse } from '../../lib/textScript';
import { AppButton, AppText } from '../design';
import { useThemeColors } from '../theme';

// ============================================================================
// PHRASE SCRAMBLE -- rebuild each verse from 3-4 word thought units, one
// verse per round. Ungraded.
// ============================================================================

export default React.memo(function ScrambleDrill({
  verses,
  onComplete,
}: {
  verses: DrillVerse[];
  /** Fires when the last round comes out right. */
  onComplete?: () => void;
}) {
  const palette = useThemeColors();
  const script = useMemo(() => (verses.length > 0 ? scriptOfVerse(verses[0]) : 'latin'), [verses]);
  const passageRow = isRtl(script) ? 'flex-row-reverse' : 'flex-row';

  const [scrambleRounds, setScrambleRounds] = useState<ScrambleRound[]>(() => buildScrambleRounds(verses));
  const [scrambleIndex, setScrambleIndex] = useState(0);
  const [scrambleSlots, setScrambleSlots] = useState<(number | null)[]>([]);
  const [scrambleChecked, setScrambleChecked] = useState(false);
  const [scrambleSolved, setScrambleSolved] = useState<Set<number>>(new Set());

  const currentScrambleRound = scrambleRounds[scrambleIndex] ?? null;

  // Slots are sized to whichever verse is on screen, so they have to be
  // rebuilt on every round change (not just on a full reset).
  useEffect(() => {
    setScrambleSlots(currentScrambleRound ? currentScrambleRound.phrases.map(() => null) : []);
    setScrambleChecked(false);
  }, [scrambleIndex, currentScrambleRound]);

  // A round confirms itself as soon as the tiles are in the right order, so
  // the completion mark can't hang off the Check button (which the user
  // never has to press on a correct run).
  useEffect(() => {
    if (!currentScrambleRound) return;
    const complete = scrambleSlots.length > 0 && scrambleSlots.every((p, i) => p === i);
    if (!complete) return;
    setScrambleSolved((prev) => (prev.has(scrambleIndex) ? prev : new Set(prev).add(scrambleIndex)));
    if (scrambleIndex >= scrambleRounds.length - 1) onComplete?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrambleSlots, scrambleIndex, currentScrambleRound]);

  // Moving to another round empties the slots in the same update. Left to
  // the effect above, the last round's finished tiles would count as solving
  // the new round for one render.
  const goToRound = (rounds: ScrambleRound[], index: number) => {
    setScrambleIndex(index);
    setScrambleSlots(rounds[index] ? rounds[index].phrases.map(() => null) : []);
  };

  const resetScramble = () => {
    const rounds = buildScrambleRounds(verses);
    setScrambleRounds(rounds);
    goToRound(rounds, 0);
    setScrambleChecked(false);
    setScrambleSolved(new Set());
  };

  // A new passage (a chained review swaps `verses` in place) makes every
  // round meaningless, and possibly out of bounds.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    resetScramble();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verses]);

  if (!currentScrambleRound) {
    return (
      <View className="flex-1 items-center justify-center px-6 gap-2">
        <Puzzle size={28} color={palette.ink3} />
        <AppText variant="body" className="font-sans font-bold text-ink-2 text-center">Nothing to scramble</AppText>
        <AppText variant="caption" className="text-ink-3 font-sans text-center">
          These verses are too short to split into phrase tiles. Try Recall instead.
        </AppText>
      </View>
    );
  }

  const round = currentScrambleRound;
  const bankRemaining = round.bankOrder.filter((p) => !scrambleSlots.includes(p));
  const allPlaced = scrambleSlots.length > 0 && scrambleSlots.every((s) => s !== null);
  const solved = allPlaced && scrambleSlots.every((p, i) => p === i);
  const isLastRound = scrambleIndex >= scrambleRounds.length - 1;

  return (
    <View className="flex-1 justify-between">
      <ScrollView className="flex-1 mb-2" contentContainerClassName="gap-2 pb-2">
        <View className="flex-row items-center justify-between">
          <AppText variant="caption" className="font-sans font-semibold text-ink-3 flex-1">
            {round.label} — verse {scrambleIndex + 1} of {scrambleRounds.length}
          </AppText>
          {scrambleSolved.has(scrambleIndex) && <Check size={12} color={palette.success} />}
        </View>

        {/* Construct box. A correct arrangement confirms itself the moment
            it's complete (no Check press needed) -- the last tile landing IS
            the answer. Only a wrong arrangement waits for an explicit Check,
            so the drill never pre-emptively tells you you're wrong while
            you're still placing tiles. */}
        <View
          className={`border rounded-card p-3 min-h-[110px] ${
            solved ? 'border-success bg-success-soft' : scrambleChecked ? 'border-danger/60 bg-danger-soft' : 'border-line bg-surface'
          }`}
        >
          {scrambleSlots.every((s) => s === null) ? (
            <AppText variant="caption" className="text-ink-3 font-sans">Tap the phrases below to build the verse</AppText>
          ) : (
            <View className={`${passageRow} flex-wrap gap-1.5`}>
              {scrambleSlots.map((phraseIdx, slotIdx) =>
                phraseIdx === null ? null : (
                  <Pressable
                    key={`s-${slotIdx}`}
                    onPress={() => {
                      // Remove this tile and close the gap, so the next
                      // placement always lands at the end rather than in a
                      // hole mid-sentence.
                      setScrambleSlots((prev) => {
                        const kept = prev.filter((p, i) => i !== slotIdx && p !== null) as number[];
                        return prev.map((_, i) => (i < kept.length ? kept[i] : null));
                      });
                      setScrambleChecked(false);
                    }}
                    className={`px-2 py-1 rounded-lg border ${
                      scrambleChecked && phraseIdx !== slotIdx ? 'bg-danger-soft border-danger/30' : 'bg-accent border-accent'
                    }`}
                  >
                    <AppText
                      variant="label"
                      script={script}
                      className={`font-serif ${scrambleChecked && phraseIdx !== slotIdx ? 'text-danger' : 'text-on-accent'}`}
                    >
                      {round.phrases[phraseIdx]}
                    </AppText>
                  </Pressable>
                )
              )}
            </View>
          )}
        </View>

        {/* Tile bank */}
        {bankRemaining.length > 0 && (
          <View className={`${passageRow} flex-wrap gap-1.5 mt-1`}>
            {bankRemaining.map((phraseIdx) => (
              <Pressable
                key={`b-${phraseIdx}`}
                onPress={() => {
                  const firstEmpty = scrambleSlots.findIndex((s) => s === null);
                  if (firstEmpty === -1) return;
                  setScrambleSlots((prev) => prev.map((s, i) => (i === firstEmpty ? phraseIdx : s)));
                  setScrambleChecked(false);
                }}
                className="px-2 py-1 rounded-lg border border-line-strong bg-surface-2"
              >
                <AppText variant="label" script={script} className="font-serif text-ink-2">{round.phrases[phraseIdx]}</AppText>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <View className="shrink-0 gap-2">
        {(solved || scrambleChecked) && (
          <View className={`rounded-card p-2.5 ${solved ? 'bg-success-soft border border-success/30' : 'bg-warning-soft border border-warning/30'}`}>
            <AppText variant="caption" className={`font-sans font-bold text-center ${solved ? 'text-success' : 'text-warning'}`}>
              {solved
                ? isLastRound
                  ? 'That’s the whole passage! Practice only — nothing logged.'
                  : 'That’s the verse! Practice only — nothing logged.'
                : 'Not quite — tap a red tile to send it back.'}
            </AppText>
          </View>
        )}
        <View className="flex-row gap-2">
          <AppButton
            variant="quiet"
            Icon={Undo2}
            label="Clear"
            onPress={() => {
              setScrambleSlots(round.phrases.map(() => null));
              setScrambleChecked(false);
            }}
            className="flex-1"
          />
          {solved && !isLastRound ? (
            <AppButton variant="primary" label="Next verse" onPress={() => goToRound(scrambleRounds, scrambleIndex + 1)} className="flex-1">
              <ChevronRight size={15} color={palette.onAccent} />
            </AppButton>
          ) : (
            <AppButton variant="primary" Icon={Check} label="Check" onPress={() => setScrambleChecked(true)} disabled={!allPlaced} className="flex-1" />
          )}
        </View>
      </View>
    </View>
  );
});
