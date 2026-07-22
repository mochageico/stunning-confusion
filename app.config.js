// Dynamic config (replaces the old static app.json) -- needed so the
// development/preview/production EAS build profiles can each get their own
// bundle identifier/package/app name. Without this, all three profiles
// shared one bundle identifier and iOS treated them as the SAME app --
// installing a preview build silently overwrote the installed dev-client
// build (and vice versa), since they occupied the same app slot on the
// device. eas.json now sets APP_VARIANT per profile to pick the right one.
const VARIANT = process.env.APP_VARIANT || 'production';

const BASE_BUNDLE_ID = 'com.micahgoeke.scripturememory.app';
const BASE_ANDROID_PACKAGE = 'com.scripturememory.app';
const BASE_NAME = 'Scripture Memory';

const bundleIdentifier =
  VARIANT === 'development' ? `${BASE_BUNDLE_ID}.dev` : VARIANT === 'preview' ? `${BASE_BUNDLE_ID}.preview` : BASE_BUNDLE_ID;
const androidPackage =
  VARIANT === 'development'
    ? `${BASE_ANDROID_PACKAGE}.dev`
    : VARIANT === 'preview'
      ? `${BASE_ANDROID_PACKAGE}.preview`
      : BASE_ANDROID_PACKAGE;
const appName = VARIANT === 'development' ? `${BASE_NAME} (Dev)` : VARIANT === 'preview' ? `${BASE_NAME} (Preview)` : BASE_NAME;

module.exports = {
  expo: {
    name: appName,
    slug: 'scripture-memory',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    scheme: 'scripturememory',
    runtimeVersion: {
      policy: 'fingerprint',
    },
    updates: {
      url: 'https://u.expo.dev/e386c8cc-1d69-41c6-9af3-8de3e85d862d',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier,
      googleServicesFile: './GoogleService-Info.plist',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: androidPackage,
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      permissions: ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS'],
    },
    web: {
      favicon: './assets/favicon.png',
      bundler: 'metro',
    },
    plugins: [
      'expo-font',
      'expo-dev-client',
      'expo-audio',
      'expo-status-bar',
      'expo-asset',
      [
        'expo-speech-recognition',
        {
          microphonePermission: 'Scripture Memory uses your microphone to grade spoken recitation practice.',
          speechRecognitionPermission: 'Scripture Memory uses speech recognition to check your spoken recitation against the verse.',
        },
      ],
      [
        '@react-native-google-signin/google-signin',
        {
          iosUrlScheme: 'com.googleusercontent.apps.280157168827-1b1uhb645h0g3kevfc551v9426ftprpd',
        },
      ],
      './plugins/withPodfileModularHeaders.js',
    ],
    extra: {
      eas: {
        projectId: 'e386c8cc-1d69-41c6-9af3-8de3e85d862d',
      },
    },
    owner: 'lev-scripture-memory',
  },
};
