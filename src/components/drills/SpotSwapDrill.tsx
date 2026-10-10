import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Check, Info, Shuffle } from 'lucide-react-native';

import { buildSwapVerses, scoreSwapAttempt, DEFAULT_SWAPS_PER_VERSE, DrillVerse, SwapVerse } from '../../lib/drills';
import { isRtl, scriptOfVerse, wordGap } from '../../lib/textScript';
import { AppButton, AppText } from '../design';
import { ChipRow } from '../ui';
import { useThemeColors } from '../theme';

// ============================================================================
// SPOT-THE-SWAP -- a few words per verse are replaced with real words from
// elsewhere in the passage; tap the imposters. Ungraded.
// ============================================================================

export default React.memo(function SpotSwapDrill({
  verses,
  onComplete,
}: {
  verses: DrillVerse[];
  /** Fires when an attempt is checked. */
  onComplete?: () => void;
}) {
  const palette = useThemeColors();
  const script = useMemo(() => (verses.length > 0 ? scriptOfVerse(verses[0]) : 'latin'), [verses]);

  const [swapsPerVerse, setSwapsPerVerse] = useState(DEFAULT_SWAPS_PER_VERSE);
  const [swapVerses, setSwapVerses] = useState<SwapVerse[]>(() => buildSwapVerses(verses, DEFAULT_SWAPS_PER_VERSE));
  const [swapSelected, setSwapSelected] = useState<Set<number>>(new Set());
  const [swapSubmitted, setSwapSubmitted] = useState(false);

  const resetSwap = (perVerse: number = swapsPerVerse) => {
    setSwapVerses(buildSwapVerses(verses, perVerse));
    setSwapSelected(new Set());
    setSwapSubmitted(false);
  };

  // A new passage (a chained review swaps `verses` in place) needs new decoys.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    resetSwap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verses]);

  const submit = () => {
    setSwapSubmitted(true);
    onComplete?.();
  };

  const score = scoreSwapAttempt(swapVerses, swapSelected);
  const noDecoys = score.totalDecoys === 0;

  return (
    <View className="flex-1 justify-between">
      <ScrollView className="flex-1 mb-2" contentContainerClassName="gap-3 pb-2">
        <View className="flex-row items-center gap-1">
          <Info size={12} color={palette.ink3} />
          <AppText variant="caption" className="text-ink-3 font-sans flex-1">
            {swapSubmitted ? 'Green = caught, red = missed, amber = wrongly flagged' : 'Tap every word that does not belong'}
          </AppText>
        </View>

        {noDecoys ? (
          <AppText variant="caption" className="text-ink-3 font-sans">
            This passage is too short to hide imposters in. Try a longer selection.
          </AppText>
        ) : (
          swapVerses.map((sv) => (
            <AppText variant="body" script={script} key={sv.id} className="font-serif leading-relaxed text-ink">
              <AppText variant="caption" className="font-sans font-bold text-ink-3">{sv.label} </AppText>
              {sv.tokens.map((tok) => {
                const isSelected = swapSelected.has(tok.index);
                let cls = 'text-ink';
                if (swapSubmitted) {
                  if (tok.isDecoy && isSelected) cls = 'text-success font-bold';
                  else if (tok.isDecoy && !isSelected) cls = 'text-danger font-bold underline';
                  else if (!tok.isDecoy && isSelected) cls = 'text-warning line-through';
                } else if (isSelected) {
                  cls = 'text-accent font-bold underline';
                }
                return (
                  <AppText
                    variant="inherit"
                    key={tok.index}
                    onPress={
                      swapSubmitted
                        ? undefined
                        : () =>
                            setSwapSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(tok.index)) next.delete(tok.index);
                              else next.add(tok.index);
                              return next;
                            })
                    }
                    className={`font-serif ${cls}`}
                  >
                    {tok.display}{wordGap(tok.display)}
                  </AppText>
                );
              })}
            </AppText>
          ))
        )}

        {/* After submitting, show what the swapped words really were */}
        {swapSubmitted && score.totalDecoys > 0 && (
          <View className="bg-surface-2 border border-line rounded-card p-2.5 gap-1">
            <AppText variant="caption" className="font-sans font-semibold text-ink-3">The real words</AppText>
            {swapVerses.flatMap((sv) =>
              sv.tokens
                .filter((t) => t.isDecoy)
                .map((t) => (
                  <AppText variant="label" script={script} key={t.index} className="font-serif text-ink-2">
                    {/* Read right to left in Hebrew, so the arrow points left: imposter ← real word. */}
                    <AppText variant="inherit" className="text-danger line-through">{t.display}</AppText> {isRtl(script) ? '←' : '→'}{' '}
                    <AppText variant="inherit" className="text-success font-bold">{t.original}</AppText>
                  </AppText>
                ))
            )}
          </View>
        )}
      </ScrollView>

      <View className="shrink-0 gap-2">
        {swapSubmitted ? (
          <View className="bg-surface-2 border border-line rounded-card p-2.5">
            <AppText variant="caption" className="font-sans font-bold text-ink text-center">
              Caught {score.caught} of {score.totalDecoys}
              {score.falseAlarms > 0 ? ` · ${score.falseAlarms} wrongly flagged` : ''} — practice only, nothing logged.
            </AppText>
          </View>
        ) : (
          // Label ABOVE the chips -- ChipRow's default chips are flex-1, so
          // next to a label in a justify-between row they size against the
          // leftovers and squash to slivers (same fix as the Build-up settings).
          <View className="bg-surface-2 border border-line rounded-card px-3 py-2 gap-1">
            <AppText variant="caption" className="font-sans font-bold text-ink-2">Swaps per verse</AppText>
            <ChipRow
              options={[
                { id: 1, label: '1' },
                { id: 2, label: '2' },
                { id: 3, label: '3' },
              ]}
              value={swapsPerVerse}
              onChange={(n) => {
                setSwapsPerVerse(n);
                resetSwap(n);
              }}
            />
          </View>
        )}
        <View className="flex-row gap-2">
          <AppButton variant="quiet" Icon={Shuffle} label="New swaps" onPress={() => resetSwap()} className="flex-1" />
          {!swapSubmitted && <AppButton variant="primary" Icon={Check} label="Check" onPress={submit} disabled={noDecoys} className="flex-1" />}
        </View>
      </View>
    </View>
  );
});
