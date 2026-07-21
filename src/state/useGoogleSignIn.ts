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
 * Previously `require()` also failed on a real dev-client build, on purpose: this
 * package's own Expo config plugin patches the Podfile to avoid a CocoaPods failure
 * (AppCheckCore/GoogleUtilities/RecaptchaInterop pulled in transitively don't define Swift
 * modules, so CocoaPods refuses to link them as static libraries), but the plugin
 * hard-requires a real `iosUrlScheme` — so until that was provisioned, package.json instead
 * carried an `expo.autolinking.ios.exclude` entry to keep the native iOS pod out of the
 * Podfile entirely. Both are now resolved together (2026-07-21): the plugin is back in
 * app.json's `plugins` with the real `iosUrlScheme` (from GoogleService-Info.plist's
 * REVERSED_CLIENT_ID), `ios.googleServicesFile` points at that plist, and the autolinking
 * exclude has been removed. A fresh EAS dev-client build is required to pick this up — a
 * JS-only reload won't. If the Podfile error above ever resurfaces, check whether these two
 * pieces have drifted out of sync again.
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
