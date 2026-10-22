import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';

import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type { ChapterSections } from '../types';
import { chapterSectionsKey, emptyDraft, isBlankDraft, SectionDraft } from '../lib/sections';
import { cleanExtra, OutlineExtra } from '../lib/outline';

// ============================================================================
// CHAPTER SECTIONS
// ----------------------------------------------------------------------------
// The user's own sections for each chapter (where each starts, labels, memory-
// phrase words), made on the chapter page. One small doc per chapter at
// users/{uid}/chapterSections/{book|chapter}, owner-only in firestore.rules.
// The logic that reads and changes sections is in src/lib/sections.ts; this
// hook only loads and saves. Modeled on useChapterPhotos. The same doc also
// carries the taps First words saves per chapter (`outlineExtra`).
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
   * Writes a chapter's doc: its sections plus the First words taps that ride
   * along on it. A doc with no sections written, no labels or phrase, and no
   * taps is deleted instead, so "nothing saved" is one state, not two.
   * Optimistic: the page shows the change at once.
   */
  const persist = async (book: string, chapter: number, draft: SectionDraft, extra: OutlineExtra) => {
    const key = chapterSectionsKey(book, chapter);
    const blank = isBlankDraft(draft) && Object.keys(extra).length === 0;
    const record: ChapterSections = {
      key,
      book,
      chapter,
      starts: draft.starts,
      labels: draft.labels,
      phraseWords: draft.phraseWords,
      // Left out when empty: Firestore rejects undefined, and a whole-doc set
      // below drops the field for good.
      ...(Object.keys(extra).length > 0 ? { outlineExtra: extra } : {}),
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

  /** Saves a chapter's sections, keeping the First words taps already saved with it. */
  const saveChapterSections = async (book: string, chapter: number, draft: SectionDraft) => {
    const existing = sectionsForChapter(book, chapter);
    await persist(book, chapter, draft, cleanExtra(existing?.outlineExtra));
  };

  /**
   * Saves the extra words tapped open in First words, keeping the chapter's
   * sections as they are. A chapter with no sections yet gets the one-section
   * placeholder starting on verse 1 (every chapter opens there, in every
   * translation, Hebrew/Greek included), which Edit sections already treats as
   * "no sections". It never starts anywhere else: a placeholder on a later
   * verse would read as a real section start.
   */
  const saveOutlineExtra = async (book: string, chapter: number, extra: OutlineExtra) => {
    const existing = sectionsForChapter(book, chapter);
    const draft: SectionDraft = existing
      ? { starts: existing.starts, labels: existing.labels, phraseWords: existing.phraseWords }
      : emptyDraft(1);
    await persist(book, chapter, draft, cleanExtra(extra));
  };

  return {
    chapterSections,
    loadChapterSections,
    sectionsForChapter,
    saveChapterSections,
    saveOutlineExtra,
  };
}
