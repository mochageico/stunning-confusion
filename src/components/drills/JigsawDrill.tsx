import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Check, Info, Trophy, Undo2 } from 'lucide-react-native';

import { buildJigsawTiles, shuffleOrder, DrillVerse, JigsawTile } from '../../lib/drills';
import { isRtl, scriptOfVerse } from '../../lib/textScript';
import { AppButton, AppText } from '../design';
import { useThemeColors } from '../theme';

// ============================================================================
// VERSE-ORDER JIGSAW ("Order") -- reassemble the passage's verses in order.
// Ungraded: tests sequence memory, which word-accuracy grading doesn't model
// at all. Needs MIN_JIGSAW_VERSES verses to be worth doing; the caller checks.
// ============================================================================

export default React.memo(function JigsawDrill({
  verses,
  onComplete,
}: {
  verses: DrillVerse[];
  /** Fires each time the order comes out right. */
  onComplete?: () => void;
}) {
  const palette = useThemeColors();
  const script = useMemo(() => (verses.length > 0 ? scriptOfVerse(verses[0]) : 'latin'), [verses]);
  const passageRow = isRtl(script) ? 'flex-row-reverse' : 'flex-row';

  const jigsawTiles = useMemo<JigsawTile[]>(() => buildJigsawTiles(verses), [verses]);
  // Bank order (indices into jigsawTiles) and the slot assignments. A slot
  // holds a tile index, or null while empty.
  const [jigsawBankOrder, setJigsawBankOrder] = useState<number[]>(() => shuffleOrder(verses.length));
  const [jigsawSlots, setJigsawSlots] = useState<(number | null)[]>(() => verses.map(() => null));
  const [jigsawChecked, setJigsawChecked] = useState(false);

  const resetJigsaw = () => {
    setJigsawBankOrder(shuffleOrder(jigsawTiles.length));
    setJigsawSlots(jigsawTiles.map(() => null));
    setJigsawChecked(false);
  };

  // A new passage (a chained review swaps `verses` in place) makes every
  // placement meaningless, and possibly out of bounds.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    resetJigsaw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verses]);

  const placed = jigsawSlots.filter((s) => s !== null).length;
  const allPlaced = placed === jigsawTiles.length;
  const correctCount = jigsawSlots.filter((tileIdx, slotIdx) => tileIdx !== null && jigsawTiles[tileIdx]?.correctIndex === slotIdx).length;
  const solved = allPlaced && correctCount === jigsawTiles.length;
  const bankRemaining = jigsawBankOrder.filter((t) => !jigsawSlots.includes(t));

  useEffect(() => {
    if (solved) onComplete?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solved]);

  return (
    <View className="flex-1 justify-between">
      <ScrollView className="flex-1 mb-2" contentContainerClassName="gap-2 pb-2">
        <View className="flex-row items-center gap-1 mb-0.5">
          <Info size={12} color={palette.ink3} />
          <AppText variant="caption" className="text-ink-3 font-sans flex-1">
            Tap a verse to place it, tap a placed verse to take it back
          </AppText>
        </View>

        {/* Ordered slots */}
        {jigsawSlots.map((tileIdx, slotIdx) => {
          const tile = tileIdx === null ? null : jigsawTiles[tileIdx] ?? null;
          const isRight = tile !== null && tile.correctIndex === slotIdx;
          const showResult = jigsawChecked && tile !== null;
          return (
            <Pressable
              key={`slot-${slotIdx}`}
              onPress={() => {
                if (tileIdx === null) return;
                setJigsawSlots((prev) => prev.map((s, i) => (i === slotIdx ? null : s)));
                setJigsawChecked(false);
              }}
              className={`border rounded-card p-2.5 min-h-[52px] justify-center ${
                tile === null
                  ? 'border-dashed border-line-strong bg-surface-2'
                  : showResult
                    ? isRight
                      ? 'border-success bg-success-soft'
                      : 'border-danger/60 bg-danger-soft'
                    : 'border-line-strong bg-surface'
              }`}
            >
              {tile === null ? (
                <AppText variant="caption" className="font-sans font-medium text-ink-3">Slot {slotIdx + 1}</AppText>
              ) : (
                <View className={`${passageRow} items-start gap-2`}>
                  <View className={`px-1.5 py-0.5 rounded ${showResult ? (isRight ? 'bg-success' : 'bg-danger') : 'bg-accent'}`}>
                    <AppText variant="micro" className="font-sans font-bold text-on-accent">{slotIdx + 1}</AppText>
                  </View>
                  <AppText variant="label" script={script} className="font-serif leading-snug text-ink flex-1">{tile.text}</AppText>
                </View>
              )}
            </Pressable>
          );
        })}

        {/* Tile bank */}
        {bankRemaining.length > 0 && (
          <View className="mt-1 gap-2">
            <AppText variant="caption" className="font-sans font-semibold text-ink-3">Verses to place</AppText>
            {bankRemaining.map((tileIdx) => (
              <Pressable
                key={`bank-${jigsawTiles[tileIdx].id}`}
                onPress={() => {
                  const firstEmpty = jigsawSlots.findIndex((s) => s === null);
                  if (firstEmpty === -1) return;
                  setJigsawSlots((prev) => prev.map((s, i) => (i === firstEmpty ? tileIdx : s)));
                  setJigsawChecked(false);
                }}
                className="border border-line bg-surface-2 rounded-card p-2.5"
              >
                <AppText variant="label" script={script} className="font-serif leading-snug text-ink-2">{jigsawTiles[tileIdx].text}</AppText>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <View className="shrink-0 gap-2">
        {solved ? (
          <View className="bg-success-soft border border-success/30 rounded-card p-2.5 flex-row items-center justify-center gap-2">
            <Trophy size={14} color={palette.success} />
            <AppText variant="caption" className="font-sans font-bold text-success">Correct order! Practice only — nothing logged.</AppText>
          </View>
        ) : jigsawChecked ? (
          <View className="bg-warning-soft border border-warning/30 rounded-card p-2.5">
            <AppText variant="caption" className="font-sans font-bold text-warning text-center">
              {correctCount} of {jigsawTiles.length} in the right place — tap a wrong one to move it.
            </AppText>
          </View>
        ) : null}
        <View className="flex-row gap-2">
          <AppButton variant="quiet" Icon={Undo2} label="Reshuffle" onPress={resetJigsaw} className="flex-1" />
          <AppButton variant="primary" Icon={Check} label="Check order" onPress={() => setJigsawChecked(true)} disabled={!allPlaced} className="flex-1" />
        </View>
      </View>
    </View>
  );
});
