import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';

import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type { ChapterSections } from '../types';
import { chapterSectionsKey, isBlankDraft, SectionDraft } from '../lib/sections';

// ============================================================================
// CHAPTER SECTIONS
// ----------------------------------------------------------------------------
// The user's own sections for each chapter (where each starts, labels, memory-
// phrase words), made on the chapter page. One small doc per chapter at
// users/{uid}/chapterSections/{book|chapter}, owner-only in firestore.rules.
// The logic that reads and changes sections is in src/lib/sections.ts; this
// hook only loads and saves. Modeled on useChapterPhotos.
// ============================================================================

interface ChapterSectionsDeps {
  user: { uid: string } | null;
}

export function useChapterSections({ user }: ChapterSectionsDeps) {
  const [chapterSections, setChapterSections] = useState<Record<string, ChapterSections>>({});

  // Signed out (or switched account): nothing of the last user's may linger.
  useEffect(() => {
    if (!user?.uid) setChapterSections({});
  }, [user?.uid]);

  /** Loads every chapter's sections; called from loadUserData. */
  const loadChapterSections = async (uid: string) => {
    try {
      const snap = await getDocs(collection(db, 'users', uid, 'chapterSections'));
      const next: Record<string, ChapterSections> = {};
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() as ChapterSections;
        next[data.key ?? docSnap.id] = data;
      });
      setChapterSections(next);
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${uid}/chapterSections`);
    }
  };

  /** This chapter's sections, or null when the user hasn't made any. */
  const sectionsForChapter = (book: string, chapter: number): ChapterSections | null =>
    chapterSections[chapterSectionsKey(book, chapter)] ?? null;

  /**
   * Saves a chapter's sections. A blank draft (one section, nothing typed)
   * deletes the doc instead, so "no sections" is one state, not two.
   * Optimistic: the page shows the new brackets at once.
   */
  const saveChapterSections = async (book: string, chapter: number, draft: SectionDraft) => {
    const key = chapterSectionsKey(book, chapter);
    const blank = isBlankDraft(draft);
    const record: ChapterSections = {
      key,
      book,
      chapter,
      starts: draft.starts,
      labels: draft.labels,
      phraseWords: draft.phraseWords,
      updatedAt: new Date().toISOString(),
    };
    setChapterSections((prev) => {
      const next = { ...prev };
      if (blank) delete next[key];
      else next[key] = record;
      return next;
    });

    // Demo mode has no signed-in Firebase user: the change stays on screen only.
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      // A whole-doc set, not a merge: a label that was cleared has to go.
      if (blank) await deleteDoc(doc(db, 'users', uid, 'chapterSections', key));
      else await setDoc(doc(db, 'users', uid, 'chapterSections', key), record);
    } catch (err) {
      handleFirestoreError(err, blank ? OperationType.DELETE : OperationType.WRITE, `users/${uid}/chapterSections/${key}`);
    }
  };

  return {
    chapterSections,
    loadChapterSections,
    sectionsForChapter,
    saveChapterSections,
  };
}
