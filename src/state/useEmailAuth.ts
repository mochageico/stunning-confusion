import { useCallback } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';

import { auth, db } from '../firebase';

type AuthResult = { ok: true } | { ok: false; message: string };

// onAuthStateChanged (in useAppState) fires the instant sign-up resolves and
// races the two `await`s below (updateProfile, then the Firestore patch) to
// create profiles/{uid} -- it can easily win, seeing `cred.user.displayName`
// still empty. Rather than let that path fall back to a fake "Anonymous"
// name, it reads this module-level value first: set synchronously below,
// before any `await`, so it's already populated by the time either race path
// runs, regardless of which network call actually finishes first.
export const pendingSignUpDisplayName = { current: null as string | null };

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
    const trimmedName = displayName.trim();
    // Set before the first `await` (see comment on the export above) so it's
    // already in place no matter which async path resolves first.
    pendingSignUpDisplayName.current = trimmedName || null;
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (trimmedName) {
        await updateProfile(cred.user, { displayName: trimmedName });
        await setDoc(doc(db, 'profiles', cred.user.uid), { displayName: trimmedName, updatedAt: new Date() }, { merge: true });
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, message: friendlyAuthError(error) };
    } finally {
      pendingSignUpDisplayName.current = null;
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
