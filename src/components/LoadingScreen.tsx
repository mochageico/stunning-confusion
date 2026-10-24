import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

import { AppText } from './design';
import { FadeInView } from './ui';
import { useThemeColors } from './theme';
import { LoadingVerse, pickLoadingVerse } from '../lib/loadingVerses';

// ============================================================
// LoadingScreen — what shows while the app signs in and pulls the user's
// verses down. Most launches only ever see the quiet "Lev" mark; if loading
// runs past VERSE_DELAY_MS, one of the user's own verses fades in underneath
// so a slow connection turns into a moment of review.
// ============================================================

const VERSE_DELAY_MS = 1200;

// A short accent segment sliding across a hairline track.
function SlidingBar() {
  const palette = useThemeColors();
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.cubic), useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [x]);
  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [-48, 120] });
  return (
    <View className="bg-fill rounded-full overflow-hidden" style={{ width: 120, height: 3 }}>
      {/* Plain style, not className: NativeWind doesn't reach Animated.View. */}
      <Animated.View
        style={{ width: 48, height: 3, borderRadius: 2, backgroundColor: palette.accent, transform: [{ translateX }] }}
      />
    </View>
  );
}

export default function LoadingScreen() {
  const [verse, setVerse] = useState<LoadingVerse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      pickLoadingVerse().then((v) => {
        if (!cancelled) setVerse(v);
      });
    }, VERSE_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <View style={{ flex: 1 }} className="bg-canvas items-center justify-center px-8">
      <View className="items-center" style={{ gap: 18 }}>
        <AppText variant="display" className="font-serif text-ink" maxScale={1.2} accessibilityRole="header">
          Lev
        </AppText>
        <SlidingBar />
      </View>
      {verse && (
        <FadeInView style={{ marginTop: 48, maxWidth: 340 }}>
          <AppText variant="body" className="font-serif text-ink-2 text-center">
            {verse.text}
          </AppText>
          <AppText variant="caption" className="text-ink-3 text-center" style={{ marginTop: 8 }}>
            {verse.reference}
          </AppText>
        </FadeInView>
      )}
    </View>
  );
}
