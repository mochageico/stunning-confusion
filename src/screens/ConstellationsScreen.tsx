import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Check, ChevronRight, Plus, Search } from 'lucide-react-native';

import { FadeInView } from '../components/ui';
import { AppText, AppTextInput, useFontScale, useScaledSpace } from '../components/design';
import { EmptyState, ScreenHeader } from '../components/blocks';
import { FilterChips } from '../components/session';
import { useThemeColors } from '../components/theme';
import { AppButton } from '../components/design';
import { MiniConstellation } from '../components/map/MiniConstellation';
import { SKY } from '../components/map/skyPalette';
import { CONSTELLATIONS } from '../content/constellations';
import { isLearned, revealedStars, searchConstellations } from '../lib/constellations';
import { openConstellationPreview } from '../lib/constellationPreview';
import type { Constellation, QueueItem } from '../types';
import { useAppFields } from '../state/appStore';

// ============================================================================
// Constellations (CONSTELLATION_SKY_PLAN.md, stage 2): the browse page, opened
// from Today's "Explore scripture constellations" button. It follows the app's
// theme (paper in light, dark in dark). Top to bottom: back + title, the
// "My sky" tile (always a night sky), a search field, the All / In my sky
// chips, then one card per constellation. Tapping a card opens its preview
// page; "Add to my sky" on a card adds it without leaving the page. Adding a
// constellation does not add any verse to learn.
// ============================================================================

type Filter = 'all' | 'mine';

/** Verses in a constellation, and how many of them sit in a star the user has learned. */
export function verseCounts(c: Constellation, queue: QueueItem[]): { total: number; known: number } {
  let total = 0;
  let known = 0;
  for (const s of c.stars) {
    const n = s.ref.end - s.ref.start + 1;
    total += n;
    if (isLearned(s.ref, queue)) known += n;
  }
  return { total, known };
}

export default function ConstellationsScreen() {
  const state = useAppFields('addToSky', 'handleBack', 'memoryQueue', 'navigateTo', 'sky');
  const { handleBack, navigateTo, memoryQueue, sky, addToSky } = state;
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const inSky = useMemo(() => new Set(sky.added), [sky.added]);
  const mine = useMemo(() => sky.added.map((id) => CONSTELLATIONS.find((c) => c.id === id)).filter((c): c is Constellation => !!c), [sky.added]);
  const starsLit = useMemo(
    () => mine.reduce((n, c) => n + revealedStars(c, memoryQueue, sky.found[c.id]).size, 0),
    [mine, memoryQueue, sky.found]
  );

  const shown = useMemo(() => {
    const found = searchConstellations(CONSTELLATIONS, query);
    return filter === 'mine' ? found.filter((c) => inSky.has(c.id)) : found;
  }, [query, filter, inSky]);

  const open = (c: Constellation) => {
    openConstellationPreview(c.id);
    navigateTo('constellationPreview');
  };

  const tileSize = Math.round(64 * scale);
  const minis = mine.slice(0, 3);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(16) }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Constellations" onBack={handleBack} backLabel="Today" />

        {/* My sky: always a night sky, whatever the theme. */}
        <Pressable
          onPress={() => navigateTo('mySky')}
          accessibilityRole="button"
          accessibilityLabel="My sky"
          className="flex-row items-center rounded-card active:opacity-80"
          style={{ backgroundColor: SKY.bg, padding: space(14), gap: space(12) }}
        >
          <View className="flex-row items-center" style={{ gap: space(4) }}>
            {minis.length === 0 ? (
              <View style={{ width: tileSize, height: tileSize }} />
            ) : (
              minis.map((c) => (
                <MiniConstellation key={c.id} constellation={c} revealed={revealedStars(c, memoryQueue, sky.found[c.id])} queue={memoryQueue} night width={tileSize} />
              ))
            )}
          </View>
          <View className="flex-1" style={{ gap: space(2) }}>
            <AppText variant="title" className="font-sans font-bold" style={{ color: SKY.ink }}>
              My sky
            </AppText>
            <AppText variant="caption" className="font-sans" style={{ color: SKY.ink3 }}>
              {mine.length === 0
                ? 'Nothing here yet. Add a constellation below.'
                : `${mine.length} ${mine.length === 1 ? 'constellation' : 'constellations'} · ${starsLit} ${starsLit === 1 ? 'star' : 'stars'} lit`}
            </AppText>
          </View>
          <ChevronRight size={Math.round(22 * scale)} color={SKY.ink3} />
        </Pressable>

        <View
          className="flex-row items-center bg-surface border border-line rounded-btn"
          style={{ paddingHorizontal: space(12), gap: space(8) }}
        >
          <View className="shrink-0">
            <Search size={Math.round(18 * scale)} color={palette.ink3} />
          </View>
          <AppTextInput
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            returnKeyType="search"
            placeholder="Search by name, topic or verse"
            accessibilityLabel="Search constellations"
            className="flex-1 font-sans text-ink"
            style={{ paddingVertical: space(10) }}
          />
        </View>

        <FilterChips<Filter>
          options={[
            { id: 'all', label: 'All' },
            { id: 'mine', label: 'In my sky' },
          ]}
          value={filter}
          onChange={setFilter}
          accessibilityLabel="Show"
        />

        {shown.length === 0 ? (
          <EmptyState
            title={filter === 'mine' && !query.trim() ? 'Nothing in your sky yet' : 'No constellations match'}
            message={filter === 'mine' && !query.trim() ? 'Add one from All and it will show up here.' : 'Try a book name, a topic, or a reference like Psalm 23.'}
          />
        ) : (
          <View style={{ gap: space(12) }}>
            {shown.map((c) => {
              const added = inSky.has(c.id);
              const revealed = revealedStars(c, memoryQueue, sky.found[c.id]);
              const counts = verseCounts(c, memoryQueue);
              return (
                <View key={c.id} className="bg-surface border border-line rounded-card" style={{ padding: space(12), gap: space(12) }}>
                  <Pressable
                    onPress={() => open(c)}
                    accessibilityRole="button"
                    accessibilityLabel={`${c.title}. ${c.description}`}
                    className="flex-row items-center active:opacity-70"
                    style={{ gap: space(12) }}
                  >
                    <View className="bg-surface-2 rounded-btn items-center justify-center" style={{ padding: space(4) }}>
                      <MiniConstellation constellation={c} revealed={revealed} queue={memoryQueue} width={Math.round(76 * scale)} />
                    </View>
                    <View className="flex-1" style={{ gap: space(2) }}>
                      <AppText variant="body" className="font-sans font-semibold text-ink">
                        {c.title}
                      </AppText>
                      <AppText variant="caption" className="font-sans text-ink-2">
                        {c.description}
                      </AppText>
                      <AppText variant="caption" className="font-sans text-ink-3">
                        {`${counts.total} ${counts.total === 1 ? 'verse' : 'verses'}${counts.known > 0 ? ` · you know ${counts.known}` : ''}`}
                      </AppText>
                    </View>
                  </Pressable>
                  {added ? (
                    <View className="flex-row items-center self-start" style={{ gap: space(6), minHeight: Math.round(36 * scale) }}>
                      <Check size={Math.round(18 * scale)} color={palette.accent} strokeWidth={2.6} />
                      <AppText variant="label" className="font-sans font-semibold text-accent">
                        In my sky
                      </AppText>
                    </View>
                  ) : (
                    <AppButton size="sm" variant="secondary" Icon={Plus} label="Add to my sky" onPress={() => addToSky(c.id)} className="self-start" />
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </FadeInView>
  );
}
