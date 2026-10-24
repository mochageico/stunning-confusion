import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Check, Info, ListOrdered, Trophy, Undo2 } from 'lucide-react-native';

import type { TextScript } from '../../types';
import { buildOrderRound, DrillSection, scoreOrder } from '../../lib/sectionDrills';
import { sectionRangeText } from '../../lib/sections';
import { formatLabel, formatTag } from '../../lib/formatNames';
import { isRtl } from '../../lib/textScript';
import { AppButton, AppText, useFontScale, useScaledSpace } from '../design';
import { useThemeColors } from '../theme';

// ============================================================================
// PUT IN ORDER -- MIXED_REVIEW_PLAN.md, stage 3
// ----------------------------------------------------------------------------
// The chapter's section labels come shuffled; put them in numbered slots in the
// order the sections run. Same tile and slot interaction as the verse-order
// jigsaw (tap a tile to place it in the first empty slot, tap a placed one to
// take it back). Practice: it tests the shape of the chapter, not words out of
// memory, so it never credits a review. The caller checks there are 3+ sections.
// ============================================================================

export default React.memo(function SectionOrderDrill({
  sections,
  script = 'latin',
  onComplete,
  counts = false,
}: {
  sections: DrillSection[];
  script?: TextScript;
  /** Mixed review with this format set to Counts in Settings: the notes say so instead of "never counts". */
  counts?: boolean;
  /** Fires each time the order comes out right. */
  onComplete?: () => void;
}) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  // At large text the picker above leaves a phone almost no height, so the
  // buttons scroll with the slots instead of staying pinned below them.
  const compact = useFontScale() >= 1.3;
  const rowDir = isRtl(script) ? 'flex-row-reverse' : 'flex-row';

  // A new set of sections (another chapter, or sections edited elsewhere)
  // makes every placement meaningless.
  const signature = sections.map((s) => `${s.start}:${s.label ?? ''}`).join('|');
  const [round, setRound] = useState(() => buildOrderRound(sections, script));
  const [slots, setSlots] = useState<(number | null)[]>(() => sections.map(() => null));
  const [checked, setChecked] = useState(false);

  const reshuffle = () => {
    const next = buildOrderRound(sections, script);
    setRound(next);
    setSlots(next.tiles.map(() => null));
    setChecked(false);
  };

  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    reshuffle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const { tiles, bankOrder } = round;
  const score = useMemo(() => scoreOrder(slots, tiles), [slots, tiles]);
  const bankRemaining = bankOrder.filter((t) => !slots.includes(t));

  useEffect(() => {
    if (score.solved) onComplete?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score.solved]);

  const footer = (
    <View className="shrink-0" style={{ gap: space(8) }}>
      {score.solved ? (
        <View className="bg-success-soft border border-success/30 rounded-card flex-row items-center justify-center" style={{ padding: space(10), gap: space(8) }}>
          <Trophy size={Math.round(space(14))} color={palette.success} />
          <AppText variant="caption" className="font-sans font-bold text-success flex-1 text-center">
            {counts ? 'Right order! Mark how it went below.' : `Right order! ${formatTag('putInOrder')} only, nothing logged.`}
          </AppText>
        </View>
      ) : checked ? (
        <View className="bg-warning-soft border border-warning/30 rounded-card" style={{ padding: space(10) }}>
          <AppText variant="caption" className="font-sans font-bold text-warning text-center">
            {score.correct} of {tiles.length} in the right place. Tap a wrong one to move it.
          </AppText>
        </View>
      ) : (
        <View className="flex-row items-center justify-center" style={{ gap: space(6) }}>
          <Info size={Math.round(space(12))} color={palette.ink3} />
          <AppText variant="micro" className="font-sans text-ink-3">
            {counts
              ? `${formatLabel('putInOrder')} counts as a review here: mark how it went when you're done.`
              : `${formatLabel('putInOrder')} is ${formatTag('putInOrder')}: it never counts as a review.`}
          </AppText>
        </View>
      )}
      <View className="flex-row" style={{ gap: space(8) }}>
        <AppButton variant="quiet" Icon={Undo2} label="Reshuffle" onPress={reshuffle} className="flex-1" />
        <AppButton variant="primary" Icon={Check} label="Check order" onPress={() => setChecked(true)} disabled={!score.allPlaced} className="flex-1" />
      </View>
    </View>
  );

  return (
    <View className="flex-1 justify-between">
      <ScrollView className="flex-1 mb-2" contentContainerStyle={{ gap: space(8), paddingBottom: space(8) }}>
        <View className="flex-row items-center" style={{ gap: space(6) }}>
          <ListOrdered size={Math.round(space(14))} color={palette.ink3} />
          <AppText variant="caption" className="text-ink-3 font-sans flex-1">
            Put the sections in the order they run in the chapter. Tap one to place it, tap a placed one to take it back.
          </AppText>
        </View>

        {/* Numbered slots */}
        {slots.map((tileIdx, slotIdx) => {
          const tile = tileIdx === null ? null : tiles[tileIdx] ?? null;
          const isRight = tile !== null && tile.correctIndex === slotIdx;
          const showResult = checked && tile !== null;
          // After a check the section's verses show, so a wrong tile can be learned from.
          const range = showResult && tile ? sectionRangeText(sections[tile.correctIndex]) : null;
          return (
            <Pressable
              key={`slot-${slotIdx}`}
              onPress={() => {
                if (tileIdx === null) return;
                setSlots((prev) => prev.map((s, i) => (i === slotIdx ? null : s)));
                setChecked(false);
              }}
              accessibilityRole="button"
              accessibilityLabel={tile ? `Slot ${slotIdx + 1}: ${tile.text}. Tap to take it back.` : `Slot ${slotIdx + 1}, empty`}
              className={`border rounded-card justify-center ${
                tile === null
                  ? 'border-dashed border-line-strong bg-surface-2'
                  : showResult
                    ? isRight
                      ? 'border-success bg-success-soft'
                      : 'border-danger/60 bg-danger-soft'
                    : 'border-line-strong bg-surface'
              }`}
              style={{ padding: space(10), minHeight: space(52) }}
            >
              {tile === null ? (
                <AppText variant="caption" className="font-sans font-medium text-ink-3">Slot {slotIdx + 1}</AppText>
              ) : (
                <View className={`${rowDir} items-start`} style={{ gap: space(8) }}>
                  <View className={`rounded ${showResult ? (isRight ? 'bg-success' : 'bg-danger') : 'bg-accent'}`} style={{ paddingHorizontal: space(6), paddingVertical: space(2) }}>
                    <AppText variant="micro" className="font-sans font-bold text-on-accent">{slotIdx + 1}</AppText>
                  </View>
                  <View className="flex-1" style={{ gap: space(2) }}>
                    <AppText variant="label" script={script} className="font-serif leading-snug text-ink">{tile.text}</AppText>
                    {range && (
                      <AppText variant="caption" className="font-sans text-ink-3">
                        {isRight ? range : `${range} — goes in slot ${tile.correctIndex + 1}`}
                      </AppText>
                    )}
                  </View>
                </View>
              )}
            </Pressable>
          );
        })}

        {/* Tile bank */}
        {bankRemaining.length > 0 && (
          <View style={{ marginTop: space(4), gap: space(8) }}>
            <AppText variant="caption" className="font-sans font-semibold text-ink-3">Sections to place</AppText>
            {bankRemaining.map((tileIdx) => (
              <Pressable
                key={`bank-${tileIdx}`}
                onPress={() => {
                  const firstEmpty = slots.findIndex((s) => s === null);
                  if (firstEmpty === -1) return;
                  setSlots((prev) => prev.map((s, i) => (i === firstEmpty ? tileIdx : s)));
                  setChecked(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Place ${tiles[tileIdx].text}`}
                className="border border-line bg-surface-2 rounded-card"
                style={{ padding: space(10) }}
              >
                <AppText variant="label" script={script} className="font-serif leading-snug text-ink-2">{tiles[tileIdx].text}</AppText>
              </Pressable>
            ))}
          </View>
        )}
        {compact && footer}
      </ScrollView>

      {!compact && footer}
    </View>
  );
});
