import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { BibleTranslation } from '../types';
import { pickerTranslationsFor } from '../data';

/**
 * The translations the signed-in account can pick (see pickerTranslationsFor).
 * Re-reads on sign-in and sign-out, so a tester's unreleased translations
 * appear once their account is known.
 */
export function usePickerTranslations(): BibleTranslation[] {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  useEffect(() => onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null)), []);
  return pickerTranslationsFor(uid);
}
