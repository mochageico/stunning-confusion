import { useMemo, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { BookOpen, Check, Headphones, Plus } from 'lucide-react-native';

import type { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppButton, AppText, useFontScale, useScaledSpace } from '../components/design';
import { Dialog, ScreenHeader } from '../components/blocks';
import { MiniConstellation } from '../components/map/MiniConstellation';
import { listenVerses, versesForStars } from '../components/map/addStars';
import { GuideBody } from '../components/map/ConstellationSheets';
import { CONSTELLATIONS } from '../content/constellations';
import { guideNotes, isLearned, listenOrder, progress, revealedStars, starLit } from '../lib/constellations';
import { usePreviewId } from '../lib/constellationPreview';
import { starLabel } from '../lib/mapLayout';
import { verseCounts } from './ConstellationsScreen';

// ============================================================================
// Constellation preview (CONSTELLATION_SKY_PLAN.md, stage 2, sketch "Mystery
// 3"): one constellation before (or after) it is in My sky. A big drawing, the
// description, "7 verses · 5 hidden", Add to my sky and Listen (found stars
// only), the guide, and the verse list: a star that shows has its reference and
// "You know it" or a +, a hidden one is a blank bar marked "Hidden". Follows
// the app's theme.
// ============================================================================

export default function ConstellationPreviewScreen({ state }: { state: AppState }) {
  const { handleBack, navigateTo, memoryQueue, sky, addToSky, addVersesToQueue, selectedTranslationId, startPractice, triggerToast } = state;
  const scale = useFontScale();
  const space = useScaledSpace();
  const { width: winWidth } = useWindowDimensions();

  const pickedId = usePreviewId();
  const c = CONSTELLATIONS.find((x) => x.id === pickedId) ?? CONSTELLATIONS[0];
  const [guideOpen, setGuideOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const revealed = useMemo(() => (c ? revealedStars(c, memoryQueue, sky.found[c.id]) : new Set<string>()), [c, memoryQueue, sky.found]);

  if (!c) {
    return (
      <FadeInView style={{ flex: 1 }}>
        <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(16) }}>
          <ScreenHeader title="Constellation" onBack={handleBack} backLabel="Constellations" />
          <AppText variant="body" className="font-sans text-ink-2">
            That constellation isn't available.
          </AppText>
        </ScrollView>
      </FadeInView>
    );
  }

  const added = sky.added.includes(c.id);
  const counts = verseCounts(c, memoryQueue);
  const hiddenVerses = c.stars.reduce((n, s) => (revealed.has(s.id) ? n : n + (s.ref.end - s.ref.start + 1)), 0);
  const prog = progress(c, memoryQueue, revealed);
  const drawing = Math.max(120, Math.min(Math.round(winWidth - 40 - 2 * space(12)), Math.round(250 * Math.max(1, scale * 0.9))));

  const addVerse = async (starId: string) => {
    const s = c.stars.find((x) => x.id === starId);
    if (!s || busy) return;
    setBusy(true);
    try {
      const verses = await versesForStars([s.ref], selectedTranslationId);
      if (verses.length > 0) addVersesToQueue(verses, selectedTranslationId);
    } finally {
      setBusy(false);
    }
  };

  // Listen plays the stars that show (found), in line order: the same rule as My sky's Listen.
  const listen = async () => {
    const byId = new Map(c.stars.map((s) => [s.id, s.ref]));
    const refs = listenOrder(c, revealed).map((id) => byId.get(id)!);
    if (refs.length === 0 || busy) return;
    setBusy(true);
    try {
      const verses = await listenVerses(refs, memoryQueue, selectedTranslationId);
      if (verses.length > 0) startPractice('listen', verses);
      else triggerToast('Nothing to listen to yet.');
    } finally {
      setBusy(false);
    }
  };

  const addToSkyAndOpen = () => {
    addToSky(c.id);
    navigateTo('mySky');
  };

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(16) }}>
        <ScreenHeader title={c.title} onBack={handleBack} backLabel="Constellations" />

        <View className="bg-surface border border-line rounded-card items-center" style={{ padding: space(12) }}>
          <MiniConstellation constellation={c} revealed={revealed} queue={memoryQueue} width={drawing} starSize={4.5} />
        </View>

        <View style={{ gap: space(4) }}>
          <AppText variant="body" className="font-sans text-ink">
            {c.description}
          </AppText>
          <AppText variant="caption" className="font-sans text-ink-3">
            {`${counts.total} ${counts.total === 1 ? 'verse' : 'verses'}${hiddenVerses > 0 ? ` · ${hiddenVerses} hidden` : ''}`}
          </AppText>
        </View>

        <View style={{ gap: space(8) }}>
          {added ? (
            <AppButton variant="secondary" Icon={Check} label="In my sky · open it" onPress={() => navigateTo('mySky')} />
          ) : (
            <AppButton variant="primary" Icon={Plus} label="Add to my sky" onPress={addToSkyAndOpen} />
          )}
          <AppButton variant="secondary" Icon={Headphones} label="Listen" disabled={busy || prog.found === 0} onPress={() => void listen()} />
          {c.guide.trim() || guideNotes(c, revealed).length > 0 ? <AppButton variant="quiet" Icon={BookOpen} label="Read the guide" onPress={() => setGuideOpen(true)} /> : null}
        </View>

        <View style={{ gap: space(6) }}>
          <View className="bg-surface border border-line rounded-card overflow-hidden">
            {c.stars.map((s, i) => {
              const showing = revealed.has(s.id);
              const learned = showing && isLearned(s.ref, memoryQueue);
              const held = showing && starLit(s.ref, memoryQueue);
              return (
                <View
                  key={s.id}
                  className={`flex-row items-center ${i > 0 ? 'border-t border-hairline' : ''}`}
                  style={{ paddingHorizontal: space(14), paddingVertical: space(10), gap: space(10), minHeight: Math.round(48 * scale) }}
                >
                  {showing ? (
                    <>
                      <AppText variant="label" className="font-sans font-semibold text-ink flex-1">
                        {starLabel(s.ref)}
                      </AppText>
                      {learned ? (
                        <AppText variant="caption" className="font-sans font-medium text-ink-2">
                          You know it
                        </AppText>
                      ) : held ? (
                        <AppText variant="caption" className="font-sans font-medium text-ink-2">
                          Learning
                        </AppText>
                      ) : (
                        <AppButton size="sm" variant="secondary" Icon={Plus} label="Add" accessibilityLabel={`Add ${starLabel(s.ref)} to My Verses`} disabled={busy} onPress={() => void addVerse(s.id)} />
                      )}
                    </>
                  ) : (
                    <>
                      <View className="flex-1">
                        {/* layout-ok: a blank bar standing in for a hidden reference, holds no text. */}
                        <View className="bg-fill rounded-full" style={{ height: Math.round(12 * scale), width: '55%' }} />
                      </View>
                      <AppText variant="caption" className="font-sans text-ink-3">
                        Hidden
                      </AppText>
                    </>
                  )}
                </View>
              );
            })}
          </View>
          <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
            Each verse you learn uncovers the ones joined to it.
          </AppText>
        </View>
      </ScrollView>

      <Dialog visible={guideOpen} onClose={() => setGuideOpen(false)} title={c.title}>
        <GuideBody constellation={c} revealed={revealed} />
      </Dialog>
    </FadeInView>
  );
}
