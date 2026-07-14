import { useCallback, useEffect } from 'react';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';

import { auth } from '../firebase';

/**
 * Native Google Sign-In, replacing the web original's `signInWithPopup(auth, googleProvider)`.
 *
 * IMPORTANT: `@react-native-google-signin/google-signin` ships native code, so this only
 * works in a custom dev client / production build — NOT in Expo Go, at any SDK version
 * (third-party native modules have never been loadable inside the generic Expo Go app;
 * see README for the dev-client build steps).
 *
 * The module is therefore loaded lazily inside a try/catch: a plain static `import`
 * executes the native-module lookup the moment the JS bundle loads, which crashed the
 * whole app in Expo Go with "Invariant Violation: 'RNGoogleSignin' could not be found"
 * before a single screen rendered. With the guarded require, Expo Go boots normally and
 * the Google button simply reports that a dev build is needed; a dev-client/production
 * build picks up the real native flow with no further code changes.
 *
 * `require()` also fails on a REAL dev-client build right now, on purpose: package.json's
 * `expo.autolinking.ios.exclude` deliberately keeps this package's native iOS pod out of
 * the Podfile. Without that, `expo prebuild`/EAS Build pulls in GoogleSignIn-iOS's
 * transitive pods (AppCheckCore/GoogleUtilities/RecaptchaInterop), none of which define
 * Swift modules — CocoaPods refuses to link them as static libraries and the build fails
 * ("The following Swift pods cannot yet be integrated as static libraries"). This
 * package's own Expo config plugin (see app.json's dropped plugin entry, same reasoning)
 * would normally patch the Podfile to fix this, but it hard-requires a real
 * `iosUrlScheme` we haven't provisioned yet. Once Google Sign-In is actually configured
 * (real OAuth client IDs, iOS URL scheme, GoogleService-Info.plist), both the plugin and
 * the autolinking exclusion should come out together — not one without the other, or the
 * Podfile error comes back.
 *
 * Requires EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (the Firebase project's "Web client" OAuth
 * client ID from the Google Cloud Console credentials page — Firebase Auth needs the WEB
 * client ID here even on native, because that's the audience it validates the ID token
 * against) to be set, e.g. via a `.env` file. See README for setup.
 */
type GoogleSigninModule = typeof import('@react-native-google-signin/google-signin');

const loadGoogleSignin = (): GoogleSigninModule | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@react-native-google-signin/google-signin');
  } catch {
    // Native module not present in this binary (Expo Go).
    return null;
  }
};

const googleSignin = loadGoogleSignin();

export function useGoogleSignIn() {
  useEffect(() => {
    const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    if (!webClientId || !googleSignin) return;
    googleSignin.GoogleSignin.configure({ webClientId });
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<{ ok: true } | { ok: false; message: string }> => {
    if (!googleSignin) {
      return {
        ok: false,
        message: 'Google Sign-In needs a custom dev build — it is not available inside Expo Go. Use email sign-in for now.',
      };
    }
    if (!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) {
      return {
        ok: false,
        message: 'Google Sign-In is not configured. Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (see README) and rebuild the dev client.',
      };
    }
    const { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } = googleSignin;
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response)) {
        return { ok: false, message: 'Sign in cancelled.' };
      }
      const idToken = response.data.idToken;
      if (!idToken) {
        return { ok: false, message: 'Google did not return an ID token.' };
      }
      const credential = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(auth, credential);
      return { ok: true };
    } catch (error) {
      if (isErrorWithCode(error)) {
        if (error.code === statusCodes.SIGN_IN_CANCELLED) {
          return { ok: false, message: 'Sign in cancelled.' };
        }
        if (error.code === statusCodes.IN_PROGRESS) {
          return { ok: false, message: 'Sign in already in progress.' };
        }
        if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
          return { ok: false, message: 'Google Play Services not available on this device.' };
        }
      }
      console.error('Google sign in error:', error);
      return { ok: false, message: 'Sign in cancelled.' };
    }
  }, []);

  return { signInWithGoogle };
}
