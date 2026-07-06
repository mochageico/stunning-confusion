import { useCallback } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';

import { auth, db } from '../firebase';

type AuthResult = { ok: true } | { ok: false; message: string };

function friendlyAuthError(error: any): string {
  const code = error?.code || '';
  if (code === 'auth/email-already-in-use') return 'That email is already registered — try signing in instead.';
  if (code === 'auth/invalid-email') return 'That email address looks invalid.';
  if (code === 'auth/weak-password') return 'Password should be at least 6 characters.';
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') return 'Incorrect email or password.';
  if (code === 'auth/user-not-found') return 'No account found for that email.';
  if (code === 'auth/operation-not-allowed') {
    return "Email/Password sign-in isn't enabled for this project yet (Firebase Console → Authentication → Sign-in method).";
  }
  return error?.message || 'Something went wrong.';
}

/**
 * Email/Password auth, alongside useGoogleSignIn's native Google flow. Works
 * on web (unlike native Google Sign-In, which needs a dev-client build), so
 * it's also the only way to sign in during `expo start --web` development.
 */
export function useEmailAuth() {
  const signUp = useCallback(async (email: string, password: string, displayName: string): Promise<AuthResult> => {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const trimmedName = displayName.trim();
      if (trimmedName) {
        // onAuthStateChanged (in useAppState) fires as soon as sign-up
        // resolves and creates profiles/{uid} from cred.user.displayName at
        // that moment — which is still empty here since updateProfile()
        // hasn't landed yet. Patch the Firestore doc directly afterward so
        // the real name sticks regardless of that race.
        await updateProfile(cred.user, { displayName: trimmedName });
        await setDoc(doc(db, 'profiles', cred.user.uid), { displayName: trimmedName, updatedAt: new Date() }, { merge: true });
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, message: friendlyAuthError(error) };
    }
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: friendlyAuthError(error) };
    }
  }, []);

  return { signUp, signIn };
}
