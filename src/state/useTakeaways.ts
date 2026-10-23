import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';

import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type { Takeaway } from '../types';
import { makeTakeaway } from '../lib/takeaways';

// ============================================================================
// TAKEAWAYS
// ----------------------------------------------------------------------------
// The user's own takeaways, one small doc per section at
// users/{uid}/takeaways/{book|chapter|sectionStart}, owner-only in
// firestore.rules. Which sections are ready to ask, and the path's order, are
// in src/lib/takeaways.ts; this hook only loads and saves. Modeled on
// useChapterSections. Sharing with a circle is not built yet.
// ============================================================================

interface TakeawaysDeps {
  user: { uid: string } | null;
}

/** What the ask and the opened takeaway hand to saveTakeaway. */
export interface TakeawaySpot {
  book: string;
  chapter: number;
  sectionStart: number;
  sectionEnd: number;
  label?: string;
}

export function useTakeaways({ user }: TakeawaysDeps) {
  const [takeaways, setTakeaways] = useState<Record<string, Takeaway>>({});

  // Signed out (or switched account): nothing of the last user's may linger.
  useEffect(() => {
    if (!user?.uid) setTakeaways({});
  }, [user?.uid]);

  /** Loads every takeaway; called from loadUserData. */
  const loadTakeaways = async (uid: string) => {
    try {
      const snap = await getDocs(collection(db, 'users', uid, 'takeaways'));
      const next: Record<string, Takeaway> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as Takeaway;
        next[data.id ?? d.id] = { ...data, id: data.id ?? d.id };
      });
      setTakeaways(next);
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${uid}/takeaways`);
    }
  };

  /**
   * Writes one section's takeaway. `status` says what it is: 'saved' (the
   * main point), 'later' (the empty dashed stop) or 'draft' (from Teach-It).
   * Optimistic: the path shows it at once. Demo mode has no signed-in Firebase
   * user, so there the change stays on screen only.
   */
  const saveTakeaway = async (spot: TakeawaySpot, fields: { text: string; note?: string; status: 'saved' | 'later' | 'draft' }) => {
    const id = `${spot.book}|${spot.chapter}|${spot.sectionStart}`;
    const record = makeTakeaway(spot, fields, takeaways[id], new Date().toISOString());
    setTakeaways((prev) => ({ ...prev, [id]: record }));
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      // A whole-doc set, not a merge: a note that was cleared has to go.
      await setDoc(doc(db, 'users', uid, 'takeaways', id), record);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/takeaways/${id}`);
    }
  };

  /** Removes a takeaway or stop altogether (the section is then asked about again once ready). */
  const deleteTakeaway = async (id: string) => {
    setTakeaways((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await deleteDoc(doc(db, 'users', uid, 'takeaways', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${uid}/takeaways/${id}`);
    }
  };

  return { takeaways, loadTakeaways, saveTakeaway, deleteTakeaway };
}
