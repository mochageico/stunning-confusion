import React, { useMemo, useRef, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { Eye } from 'lucide-react-native';

import { DrillVerse } from '../../lib/drills';
import { OPENING_WORDS, OpeningResult, openingAccuracy, openingOf } from '../../lib/openings';
import { isRtl, normalizeToken, typedLetters } from '../../lib/textScript';
import { AppButton, AppText, AppTextInput, useScaledSpace } from '../design';
import { scrollFieldIntoView } from '../ui';

// ============================================================================
// OPENINGS -- Mixed review's quick pass over a long stretch. Each verse asks
// only for the first letters of its first few words: know where a verse
// starts and the rest tends to follow. Three letters per verse is a few taps
// instead of a whole verse typed. Peeking shows the opening and counts that
// verse's opening as missed. The caller checks the rest of each verse
// (OpeningsRound in MixedReviewScreen), so nothing here is final.
// ============================================================================

export default React.memo(function OpeningsDrill({
  verses,
  onComplete,
}: {
  verses: DrillVerse[];
  onComplete: (results: OpeningResult[]) => void;
}) {
  const space = useScaledSpace();
  const openings = useMemo(() => verses.map((v) => openingOf(v)), [verses]);
  const [results, setResults] = useState<OpeningResult[]>([]);
  const [typed, setTyped] = useState('');
  const [peeked, setPeeked] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  const index = results.length;
  const done = index >= verses.length;
  const current = openings[index];

  const record = (accuracy: number, wasPeeked: boolean) => {
    setResults((prev) => [...prev, { accuracy, peeked: wasPeeked }]);
    setTyped('');
    setPeeked(false);
    scrollRef.current?.scrollToEnd({ animated: true });
  };

  const onChange = (text: string) => {
    setTyped(text);
    if (!current) return;
    const letters = typedLetters(text.trim(), current.script).filter((ch) => normalizeToken(ch, current.script) !== '');
    // The last letter in: judged at once, so the next verse is ready to type.
    if (letters.length >= current.initials.length) record(openingAccuracy(text, current.initials, current.script), false);
  };

  const rowCls = (r: OpeningResult | undefined) =>
    r === undefined ? 'border-line bg-surface' : r.accuracy === 1 ? 'border-success bg-success-soft' : 'border-danger bg-danger-soft';

  return (
    <View className="flex-1 justify-between">
      <ScrollView ref={scrollRef} className="flex-1 mb-2" contentContainerClassName="pb-2" keyboardShouldPersistTaps="handled">
        <AppText variant="label" className="font-sans text-ink-2" style={{ marginBottom: space(10) }}>
          Type the first letter of each of the first {OPENING_WORDS} words of every verse.
        </AppText>
        {verses.map((v, i) => {
          const o = openings[i];
          const r = results[i];
          const active = i === index && !done;
          const rtl = isRtl(o.script);
          return (
            <View
              key={`${v.chapter}:${v.verse}`}
              className={`flex-row items-center border rounded-card ${active ? 'border-accent bg-accent-soft' : rowCls(r)}`}
              style={{ padding: space(10), gap: space(10), marginBottom: space(8), opacity: r === undefined && !active ? 0.55 : 1 }}
            >
              <AppText variant="label" className="font-sans font-bold text-ink-3" style={{ minWidth: space(30) }}>
                v{v.verse}
              </AppText>
              {r !== undefined || (active && peeked) ? (
                <AppText
                  variant="body"
                  script={o.script}
                  className={`font-serif flex-1 ${r === undefined ? 'text-ink' : r.accuracy === 1 ? 'text-success' : 'text-danger'}`}
                  style={rtl ? { textAlign: 'right' } : undefined}
                >
                  {o.words.join(' ')} …
                </AppText>
              ) : active ? (
                <AppTextInput
                  ref={inputRef}
                  onFocus={() => scrollFieldIntoView(scrollRef.current, inputRef.current)}
                  value={typed}
                  onChangeText={onChange}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={o.initials.map(() => '·').join(' ')}
                  accessibilityLabel={`First letters of the first ${o.words.length} words of verse ${v.verse}`}
                  className="flex-1 border border-accent rounded-btn bg-surface px-3 py-1 font-sans font-semibold text-ink"
                />
              ) : (
                <AppText variant="body" className="font-sans text-ink-3 flex-1">
                  {o.initials.map(() => '·').join(' ')}
                </AppText>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View className="shrink-0 gap-2">
        {done ? (
          <>
            <AppText variant="caption" className="font-sans font-bold text-ink text-center">
              {results.filter((r) => r.accuracy === 1).length} of {verses.length} openings right
              {results.some((r) => r.peeked) ? ` · ${results.filter((r) => r.peeked).length} peeked` : ''}
            </AppText>
            <AppButton size="lg" variant="primary" label="Next" onPress={() => onComplete(results)} />
          </>
        ) : peeked ? (
          <AppButton size="lg" variant="primary" label="Got it, next verse" onPress={() => record(0, true)} />
        ) : (
          <AppButton variant="secondary" Icon={Eye} label="Peek at this opening" onPress={() => setPeeked(true)} />
        )}
      </View>
    </View>
  );
});
