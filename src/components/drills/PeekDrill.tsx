import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Check, Eye } from 'lucide-react-native';

import { chunkIntoPhrases, DrillVerse } from '../../lib/drills';
import { blankLetters, isRtl, scriptOfVerse } from '../../lib/textScript';
import { AppText } from '../design';
import { useThemeColors } from '../theme';

// ============================================================================
// PEEK -- the verse is hidden phrase by phrase. Try each one in your head, then
// tap it to check. Fewer peeks is better, but no peek is wrong. Ungraded.
// ============================================================================

type PhraseState = 'hidden' | 'peeked' | 'known';

export default React.memo(function PeekDrill({ verse, onComplete }: { verse: DrillVerse; onComplete?: () => void }) {
  const palette = useThemeColors();
  const script = scriptOfVerse(verse);
  const phrases = useMemo(() => chunkIntoPhrases(verse.text, script), [verse.text, script]);
  const [states, setStates] = useState<PhraseState[]>(() => phrases.map(() => 'hidden'));
  const doneRef = useRef(false);

  const set = (i: number, to: PhraseState) => {
    const next = states.map((s, k) => (k === i ? to : s));
    setStates(next);
    if (!doneRef.current && next.every((s) => s !== 'hidden')) {
      doneRef.current = true;
      onComplete?.();
    }
  };

  const peeks = states.filter((s) => s === 'peeked').length;
  const row = isRtl(script) ? 'flex-row-reverse' : 'flex-row';

  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-3 pb-2">
      <AppText variant="label" className="font-sans text-ink-2">
        Say each phrase in your head, then tap it to check. Tap the tick when you had it.
      </AppText>
      {phrases.map((phrase, i) => {
        const state = states[i];
        return (
          <View
            key={i}
            className={`${row} items-center border rounded-card ${state === 'known' ? 'border-success bg-success-soft' : 'border-line bg-surface'}`}
            style={{ gap: 8, padding: 12 }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={state === 'hidden' ? `Peek at phrase ${i + 1}` : `Phrase ${i + 1}`}
              onPress={() => state === 'hidden' && set(i, 'peeked')}
              className="flex-1"
            >
              <AppText variant="body" script={script} className={`font-serif ${state === 'hidden' ? 'text-ink-3' : 'text-ink'}`}>
                {state === 'hidden' ? blankLetters(phrase, script) : phrase}
              </AppText>
            </Pressable>
            {state === 'hidden' && (
              <Pressable accessibilityRole="button" accessibilityLabel="Peek" onPress={() => set(i, 'peeked')} hitSlop={8} className="p-2">
                <Eye size={20} color={palette.ink2} />
              </Pressable>
            )}
            {state !== 'known' && (
              <Pressable accessibilityRole="button" accessibilityLabel="I had it" onPress={() => set(i, 'known')} hitSlop={8} className="p-2">
                <Check size={20} color={palette.success} />
              </Pressable>
            )}
          </View>
        );
      })}
      <AppText variant="caption" className="font-sans text-ink-3">
        {peeks === 0 ? 'No peeks so far' : `${peeks} ${peeks === 1 ? 'peek' : 'peeks'}`}
      </AppText>
    </ScrollView>
  );
});
