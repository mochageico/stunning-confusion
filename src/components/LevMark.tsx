import React from 'react';
import { Text, View } from 'react-native';

import { AppText, useFontScale } from './design';
import { useThemeColors } from './theme';

// The Lev logo: the Hebrew word for "heart" set large, with "Lev" under it.
// Pure type, no icon. Shared by the sign-in screen and the loading screen so
// the first two things people see match.
//
// `withMeaning` adds a dictionary-style line, since most people won't know
// what the word means. The loading screen leaves it off to stay quiet.
export default function LevMark({ withMeaning = false }: { withMeaning?: boolean }) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const size = Math.round(72 * Math.min(scale, 1.3));

  return (
    <View className="items-center" style={{ gap: 4 }} accessible accessibilityRole="header" accessibilityLabel="Lev, Hebrew for heart">
      <Text
        // The logo's lettering stays one size however large the user's text is.
        allowFontScaling={false}
        style={{
          fontFamily: 'NotoSerifHebrew_500Medium',
          fontSize: size,
          lineHeight: Math.round(size * 1.25),
          color: palette.accent,
          writingDirection: 'rtl',
        }}
      >
        {'לב'}
      </Text>
      <AppText variant="display" className="font-serif text-ink text-center" maxScale={1.2}>
        Lev
      </AppText>
      {withMeaning && (
        <AppText variant="caption" className="font-serif italic text-ink-3 text-center">
          noun · Hebrew · heart
        </AppText>
      )}
    </View>
  );
}
