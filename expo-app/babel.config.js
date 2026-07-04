module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // Must be listed last — react-native-reanimated v4 moved its worklet
    // compilation into this separate package.
    plugins: ['react-native-worklets/plugin'],
  };
};
