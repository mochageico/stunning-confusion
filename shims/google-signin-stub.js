// Stand-in for '@react-native-google-signin/google-signin', substituted by
// metro.config.js only when EXPO_GO_MODE=1. That package calls
// TurboModuleRegistry.getEnforcing(...) at import time, which crashes the
// whole app on load inside plain Expo Go (no third-party native module can
// ever be bundled there) — this stub keeps the app loadable, with the actual
// sign-in call rejecting so callers see a clear message instead of a crash.
module.exports = {
  GoogleSignin: {
    configure: () => {},
    hasPlayServices: async () => true,
    signIn: async () => {
      throw new Error('Google Sign-In is unavailable in Expo Go — build a dev client to test it.');
    },
  },
  isErrorWithCode: () => false,
  isSuccessResponse: () => false,
  statusCodes: {
    SIGN_IN_CANCELLED: '__stub_sign_in_cancelled__',
    IN_PROGRESS: '__stub_in_progress__',
    PLAY_SERVICES_NOT_AVAILABLE: '__stub_play_services_unavailable__',
  },
};
