module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // Must be listed last — react-native-reanimated v4 moved its worklet
    // compilation into this separate package. (Removing this didn't fix
    // a native-only Expo Go freeze under investigation, so restored to
    // isolate the next experiment -- a NativeWind version pin -- as a
    // single variable.)
    // babel-lucide-per-icon.js: bundle only the icons the app imports.
    plugins: ['./babel-lucide-per-icon.js', 'react-native-worklets/plugin'],
  };
};
