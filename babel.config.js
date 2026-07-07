module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // react-native-worklets/plugin (Reanimated v4's worklet compiler)
    // temporarily removed while debugging a native-only Expo Go freeze —
    // nothing in this app's own code uses Reanimated/worklets directly,
    // so this transform runs over every file for no functional benefit
    // and is the current top suspect for the hang.
    plugins: [],
  };
};
