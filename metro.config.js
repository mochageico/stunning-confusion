const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Workaround for a known Expo SDK 53+ issue where Metro's package-exports
// resolution can pick the wrong Firebase Auth build and throw
// "Component auth has not been registered yet" at runtime
// (see expo/expo#36588). Firebase's React Native auth persistence build
// is resolved correctly once this is disabled.
config.resolver.unstable_enablePackageExports = false;

// compromise (Spot the swap's part-of-speech tagger) publishes its entry
// points only through package "exports", which is off just above. Point the
// one entry the app uses at its prebuilt file.
const COMPROMISE_TWO = require.resolve('compromise/two');
const resolveBeforeCompromise = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'compromise/two') return { type: 'sourceFile', filePath: COMPROMISE_TWO };
  return resolveBeforeCompromise
    ? resolveBeforeCompromise(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

// EXPO_GO_MODE=1 swaps '@react-native-google-signin/google-signin' (a
// third-party native module that can never be bundled inside the generic
// Expo Go app, and crashes on import there) for a harmless stub, so the rest
// of the app — including real mic recording — can be tested in Expo Go
// without a dev-client build. Leave EXPO_GO_MODE unset for real dev-client /
// production builds, where the real native module is needed and used.
if (process.env.EXPO_GO_MODE === '1') {
  const defaultResolveRequest = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === '@react-native-google-signin/google-signin') {
      return context.resolveRequest(context, require.resolve('./shims/google-signin-stub.js'), platform);
    }
    return defaultResolveRequest
      ? defaultResolveRequest(context, moduleName, platform)
      : context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = withNativeWind(config, { input: './global.css' });
