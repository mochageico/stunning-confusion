import { useEffect, useRef, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';

import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type { MapLayout } from '../types';

// ============================================================================
// MAP LAYOUT
// ----------------------------------------------------------------------------
// Where the constellation map's stars settled, saved so the map stays put:
// one doc at users/{uid}/mapLayout/main, owner-only in firestore.rules. The
// settling itself is src/lib/mapLayout.ts (stage 3); this hook only loads and
// saves, the save debounced because a re-settle can change many positions at
// once. Modeled on useTakeaways.
// ============================================================================

const SAVE_DELAY_MS = 1500;

interface MapLayoutDeps {
  user: { uid: string } | null;
}

export function useMapLayout({ user }: MapLayoutDeps) {
  const [mapLayout, setMapLayout] = useState<MapLayout | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<MapLayout | null>(null);

  // Signed out (or switched account): nothing of the last user's may linger.
  useEffect(() => {
    if (user?.uid) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    pendingRef.current = null;
    setMapLayout(null);
  }, [user?.uid]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    []
  );

  /** Loads the saved positions; called from loadUserData. */
  const loadMapLayout = async (uid: string) => {
    try {
      const snap = await getDoc(doc(db, 'users', uid, 'mapLayout', 'main'));
      setMapLayout(snap.exists() ? (snap.data() as MapLayout) : null);
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${uid}/mapLayout/main`);
    }
  };

  const flush = async () => {
    saveTimerRef.current = null;
    const layout = pendingRef.current;
    pendingRef.current = null;
    const uid = auth.currentUser?.uid;
    if (!layout || !uid) return;
    try {
      await setDoc(doc(db, 'users', uid, 'mapLayout', 'main'), layout);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/mapLayout/main`);
    }
  };

  /**
   * Keeps these positions: on screen at once, written to the account after
   * things have been quiet for a moment. Demo mode (no signed-in user) keeps
   * them on screen only.
   */
  const saveMapLayout = (layout: MapLayout) => {
    setMapLayout(layout);
    pendingRef.current = layout;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flush, SAVE_DELAY_MS);
  };

  return { mapLayout, loadMapLayout, saveMapLayout };
}
