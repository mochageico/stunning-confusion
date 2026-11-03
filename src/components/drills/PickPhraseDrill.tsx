import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { chunkIntoPhrases, DrillVerse } from '../../lib/drills';
import { isRtl, scriptOfVerse } from '../../lib/textScript';
import { AppText } from '../design';

// ============================================================================
// PICK THE PHRASE -- two drills on one idea, both ungraded:
//   'listen'    Listen to the verse, then pick the phrase that's missing from
//               the text. Two gaps on a long verse.
//   'backwards' The last phrase is shown; pick the one that comes before it,
//               and the one before that, back to the start.
// Wrong picks just shake off; the drill is done when the verse is whole.
// ============================================================================

const shuffle = <T,>(xs: T[]): T[] => [...xs].sort(() => Math.random() - 0.5);

interface Props {
  mode: 'listen' | 'backwards';
  verse: DrillVerse;
  /** Other verses in the passage, for decoy phrases. */
  passage: DrillVerse[];
  onComplete?: () => void;
}

export default React.memo(function PickPhraseDrill({ mode, verse, passage, onComplete }: Props) {
  const script = scriptOfVerse(verse);
  const row = isRtl(script) ? 'flex-row-reverse' : 'flex-row';
  const phrases = useMemo(() => chunkIntoPhrases(verse.text, script), [verse.text, script]);
  const decoys = useMemo(
    () =>
      passage
        .filter((v) => v.text !== verse.text)
        .flatMap((v) => chunkIntoPhrases(v.text, scriptOfVerse(v)))
        .filter((p) => !phrases.includes(p)),
    [passage, verse.text, phrases]
  );

  // Listen: which phrases are missing. Backwards: how many from the end are placed.
  const gaps = useMemo(() => {
    if (mode !== 'listen') return [] as number[];
    const count = phrases.length >= 5 ? 2 : 1;
    // Never the first phrase: the opening is what the ear is given.
    const pool = shuffle(phrases.map((_, i) => i).filter((i) => i > 0));
    return pool.slice(0, count).sort((a, b) => a - b);
  }, [mode, phrases]);
  const [filled, setFilled] = useState<number[]>([]);
  const [placedBack, setPlacedBack] = useState(1);
  const [wrong, setWrong] = useState<string | null>(null);
  const doneRef = useRef(false);

  const target = mode === 'listen' ? gaps.find((g) => !filled.includes(g)) : phrases.length - 1 - placedBack;
  const complete = mode === 'listen' ? gaps.length > 0 && filled.length === gaps.length : placedBack >= phrases.length;

  const options = useMemo(() => {
    if (target === undefined || target < 0) return [] as string[];
    const answer = phrases[target];
    const own = phrases.filter((_, i) => i !== target && (mode === 'listen' ? true : i < target));
    const pool = shuffle([...own, ...decoys]).filter((p) => p !== answer);
    return shuffle([answer, ...pool.slice(0, 2)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, phrases, mode]);

  useEffect(() => {
    if (!complete || doneRef.current) return;
    doneRef.current = true;
    onComplete?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete]);

  const pick = (phrase: string) => {
    if (target === undefined || target < 0) return;
    if (phrase !== phrases[target]) {
      setWrong(phrase);
      setTimeout(() => setWrong(null), 600);
      return;
    }
    setWrong(null);
    if (mode === 'listen') setFilled((f) => [...f, target]);
    else setPlacedBack((n) => n + 1);
  };

  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-3 pb-2">
      <AppText variant="label" className="font-sans text-ink-2">
        {mode === 'listen'
          ? 'Listen to the verse, then pick the phrase that is missing from the text.'
          : 'Work backwards from the end. Pick the phrase that comes just before.'}
      </AppText>

      <View className={`${row} flex-wrap border border-line bg-surface rounded-card`} style={{ gap: 6, padding: 12 }}>
        {phrases.map((phrase, i) => {
          if (mode === 'listen') {
            const isGap = gaps.includes(i);
            if (isGap && !filled.includes(i)) {
              return (
                <View
                  key={i}
                  className={`px-3 py-1 rounded-lg border ${i === target ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-2'}`}
                >
                  <AppText variant="label" className="font-sans text-ink-3">
                    ········
                  </AppText>
                </View>
              );
            }
            return (
              <AppText key={i} variant="body" script={script} className={`font-serif ${isGap ? 'text-success' : 'text-ink'}`}>
                {phrase}
              </AppText>
            );
          }
          const shown = i >= phrases.length - placedBack;
          if (!shown) {
            return i === target ? (
              <View key={i} className="px-3 py-1 rounded-lg border border-accent bg-accent-soft">
                <AppText variant="label" className="font-sans text-ink-3">
                  ········
                </AppText>
              </View>
            ) : null;
          }
          return (
            <AppText key={i} variant="body" script={script} className={`font-serif ${i === phrases.length - 1 ? 'text-ink' : 'text-success'}`}>
              {phrase}
            </AppText>
          );
        })}
      </View>

      {!complete ? (
        <View style={{ gap: 8 }}>
          {options.map((o) => (
            <Pressable
              key={o}
              accessibilityRole="button"
              onPress={() => pick(o)}
              className={`border rounded-card px-3 py-3 ${wrong === o ? 'border-danger bg-danger-soft' : 'border-line-strong bg-surface-2'}`}
            >
              <AppText variant="body" script={script} className={`font-serif ${wrong === o ? 'text-danger' : 'text-ink'}`}>
                {o}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : (
        <View className="bg-success-soft border border-success/30 rounded-card p-2.5">
          <AppText variant="caption" className="font-sans font-bold text-center text-success">
            That’s the verse! Practice only — nothing logged.
          </AppText>
        </View>
      )}
    </ScrollView>
  );
});
