import { useEffect, useRef, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';

import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { CONSTELLATIONS } from '../content/constellations';
import { getAppPrefs } from '../lib/appPrefs';
import { EMPTY_SKY, migrateSky, skyAdd, skyMarkFound, skyRemove } from '../lib/constellations';
import type { QueueItem, SkyState } from '../types';

// ============================================================================
// MY SKY
// ----------------------------------------------------------------------------
// Which constellations are in the user's sky, and which of their stars have
// ever been found (a star stays found for good). One doc at
// users/{uid}/mapLayout/sky, owner-only: the existing mapLayout/{layoutId}
// rule already covers it, so no rules deploy. The rules of the mystery are in
// src/lib/constellations.ts (revealedStars and friends); this hook only loads
// and saves. CONSTELLATION_SKY_PLAN.md, stage 1. Modeled on useMapLayout.
// ============================================================================

interface SkyDeps {
  user: { uid: string } | null;
  /** The current queue, read when something is added or when the first sky is made. */
  getQueue: () => QueueItem[];
}

const skyPath = (uid: string) => `users/${uid}/mapLayout/sky`;

const clean = (raw: any): SkyState => ({
  added: Array.isArray(raw?.added) ? raw.added.filter((x: unknown): x is string => typeof x === 'string') : [],
  found:
    raw?.found && typeof raw.found === 'object'
      ? Object.fromEntries(
          Object.entries(raw.found as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []])
        )
      : {},
  v: 1,
});

export function useSky({ user, getQueue }: SkyDeps) {
  const [sky, setSky] = useState<SkyState>(EMPTY_SKY);
  /** False until the doc has been read (or made); screens can wait on it before showing an empty sky. */
  const [skyReady, setSkyReady] = useState(false);
  // Changes made in a row must build on each other, not on the last render.
  const skyRef = useRef(sky);
  const getQueueRef = useRef(getQueue);
  getQueueRef.current = getQueue;

  const keep = (next: SkyState) => {
    skyRef.current = next;
    setSky(next);
  };

  // Signed out (or switched account): nothing of the last user's may linger.
  useEffect(() => {
    if (user?.uid) return;
    keep(EMPTY_SKY);
    setSkyReady(false);
  }, [user?.uid]);

  const write = async (next: SkyState) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return; // demo mode: on screen only
    try {
      await setDoc(doc(db, 'users', uid, 'mapLayout', 'sky'), next);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, skyPath(uid));
    }
  };

  /**
   * Loads the sky; called from loadUserData. When there is no doc yet it makes
   * the first one from what the user already holds (migrateSky) and saves it.
   * If the read fails nothing is made or written, so a bad connection can't
   * start a sky over.
   */
  const loadSky = async (uid: string) => {
    try {
      const snap = await getDoc(doc(db, 'users', uid, 'mapLayout', 'sky'));
      if (snap.exists()) {
        keep(clean(snap.data()));
      } else {
        const first = migrateSky(CONSTELLATIONS, getQueueRef.current(), getAppPrefs().hiddenConstellations);
        keep(first);
        await write(first);
      }
      setSkyReady(true);
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, skyPath(uid));
    }
  };

  /** Puts a constellation in My sky (what shows now is saved as found). */
  const addToSky = (id: string) => {
    const c = CONSTELLATIONS.find((x) => x.id === id);
    if (!c) return;
    const next = skyAdd(skyRef.current, c, getQueueRef.current());
    if (next === skyRef.current) return;
    keep(next);
    void write(next);
  };

  /** Takes it out of My sky; its found stars are kept. */
  const removeFromSky = (id: string) => {
    const next = skyRemove(skyRef.current, id);
    if (next === skyRef.current) return;
    keep(next);
    void write(next);
  };

  /** Saves these stars as found for good. */
  const markFound = (id: string, starIds: string[]) => {
    const next = skyMarkFound(skyRef.current, id, starIds);
    if (next === skyRef.current) return;
    keep(next);
    void write(next);
  };

  return { sky, skyReady, loadSky, addToSky, removeFromSky, markFound };
}
