import { useCallback, useEffect } from 'react';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';

import { auth } from '../firebase';

/**
 * Native Google Sign-In, replacing the web original's `signInWithPopup(auth, googleProvider)`.
 *
 * IMPORTANT: `@react-native-google-signin/google-signin` ships native code, so this only
 * works in a custom dev client / production build — NOT in Expo Go, at any SDK version
 * (third-party native modules have never been loadable inside the generic Expo Go app;
 * see README for the dev-client build steps).
 *
 * Requires EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (the Firebase project's "Web client" OAuth
 * client ID from the Google Cloud Console credentials page — Firebase Auth needs the WEB
 * client ID here even on native, because that's the audience it validates the ID token
 * against) to be set, e.g. via a `.env` file. See README for setup.
 */
export function useGoogleSignIn() {
  useEffect(() => {
    const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    if (!webClientId) return;
    GoogleSignin.configure({ webClientId });
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<{ ok: true } | { ok: false; message: string }> => {
    if (!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) {
      return {
        ok: false,
        message: 'Google Sign-In is not configured. Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (see README) and rebuild the dev client.',
      };
    }
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
