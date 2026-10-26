import { useEffect, useRef, useState } from 'react';
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';

import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type { StarRef, VerseLink } from '../types';

// ============================================================================
// VERSE LINKS
// ----------------------------------------------------------------------------
// The user's own lines on the constellation map, one small doc per link at
// users/{uid}/verseLinks/{linkId}, owner-only in firestore.rules. A link
// with `curated` set is only the user's label on a curated constellation's line.
// Which links make which constellation, and when a label can be written, is
// in src/lib/constellations.ts; this hook only loads and saves. Modeled on
// useTakeaways.
// ============================================================================

interface VerseLinksDeps {
  user: { uid: string } | null;
}

export function useVerseLinks({ user }: VerseLinksDeps) {
  const [verseLinks, setVerseLinks] = useState<Record<string, VerseLink>>({});
  // Reads inside async work see the latest, not the render they started in.
  const linksRef = useRef(verseLinks);
  linksRef.current = verseLinks;

  // Signed out (or switched account): nothing of the last user's may linger.
  useEffect(() => {
    if (!user?.uid) setVerseLinks({});
  }, [user?.uid]);

  /** Loads every link; called from loadUserData. */
  const loadVerseLinks = async (uid: string) => {
    try {
      const snap = await getDocs(collection(db, 'users', uid, 'verseLinks'));
      const next: Record<string, VerseLink> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as VerseLink;
        next[data.id ?? d.id] = { ...data, id: data.id ?? d.id };
      });
      setVerseLinks(next);
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${uid}/verseLinks`);
    }
  };

  const writeLink = async (record: VerseLink) => {
    setVerseLinks((prev) => ({ ...prev, [record.id]: record }));
    const uid = auth.currentUser?.uid;
    if (!uid) return; // demo mode: the change stays on screen only
    try {
      // A whole-doc set, not a merge: a label that was cleared has to go.
      await setDoc(doc(db, 'users', uid, 'verseLinks', record.id), record);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/verseLinks/${record.id}`);
    }
  };

  /** Joins two stars. Optimistic: the map shows it at once. Returns the new link. */
  const addVerseLink = async (a: StarRef, b: StarRef, extra: { label?: string; curated?: string } = {}): Promise<VerseLink> => {
    const record: VerseLink = { id: makeLinkId(), a, b, createdAt: Date.now() };
    if (extra.label?.trim()) record.label = extra.label.trim();
    if (extra.curated) record.curated = extra.curated;
    await writeLink(record);
    return record;
  };

  /** Sets or clears a link's label (callers check canLabel first). */
  const relabelVerseLink = async (id: string, label: string) => {
    const before = linksRef.current[id];
    if (!before) return;
    const next: VerseLink = { ...before };
    const text = label.trim();
    if (text) next.label = text;
    else delete next.label;
    await writeLink(next);
  };

  const deleteVerseLink = async (id: string) => {
    setVerseLinks((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await deleteDoc(doc(db, 'users', uid, 'verseLinks', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${uid}/verseLinks/${id}`);
    }
  };

  return { verseLinks, loadVerseLinks, addVerseLink, relabelVerseLink, deleteVerseLink };
}

/** Random doc id, fine for a doc nobody else needs to guess. */
const makeLinkId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
