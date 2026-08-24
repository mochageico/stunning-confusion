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
    // 'default', NOT 'portrait' -- deliberately. On iOS the app-level
    // supported-orientation mask is a hard outer bound: a view controller can
    // narrow it but never exceed it, so 'portrait' here would make
    // ScreenOrientation.unlockAsync() a no-op forever. The app is still
    // portrait-locked in practice -- expo-screen-orientation's
    // initialOrientation below pins it at launch -- but the photo viewer can
    // now unlock landscape at runtime without another native build.
    orientation: 'default',
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
      // NSPhotoLibraryUsageDescription/NSCameraUsageDescription are NOT set
      // here -- the expo-image-picker plugin below owns both strings. A raw
      // infoPlist entry would win over the plugin's, so keeping them in one
      // place stops the two from silently drifting apart.
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
      // CAMERA is for photographing a physical Bible page directly. Picking an
      // existing photo needs no permission on Android 13+ (expo-image-picker
      // goes through the system photo picker, which grants per-image access).
      permissions: ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS', 'android.permission.CAMERA'],
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
      'expo-image',
      // Pins the app to portrait at launch, restoring the behaviour that
      // orientation: 'default' above gives up. Both halves are required: the
      // config allows rotation, this forbids it until something asks.
      ['expo-screen-orientation', { initialOrientation: 'PORTRAIT' }],
      [
        'expo-speech-recognition',
        {
          microphonePermission: 'Scripture Memory uses your microphone to grade spoken recitation practice.',
          speechRecognitionPermission: 'Scripture Memory uses speech recognition to check your spoken recitation against the verse.',
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission:
            'Scripture Memory lets you attach photos of your own Bible pages to a chapter, so you can see the page you memorized from while you listen.',
          cameraPermission:
            'Scripture Memory uses your camera to photograph your Bible pages, so you can see the page you memorized from while you listen.',
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
