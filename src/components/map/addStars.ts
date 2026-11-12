import type { QueueItem, StarRef, VerseState } from '../../types';
import { starVerses } from '../../lib/mapWalk';
import { getBookByName } from '../../data';
import { fetchChapterText } from '../../state/useScripture';

/**
 * The verses of some stars, with text, ready for the usual add path
 * (addVersesToQueue). They go onto the list as waiting; My Schedule's pace
 * decides when each one starts, same as anything added from a chapter page.
 */
export async function versesForStars(refs: StarRef[], translationId: string): Promise<VerseState[]> {
  const out: VerseState[] = [];
  for (const ref of refs) {
    const book = getBookByName(ref.book);
    if (!book) continue;
    const chapter = await fetchChapterText(translationId, book.id, ref.chapter);
    if (!chapter) continue;
    for (let v = ref.start; v <= ref.end; v++) {
      const text = chapter.verses[String(v)];
      if (text) out.push({ book: ref.book, chapter: ref.chapter, verse: v, text, status: 'untouched', translationId });
    }
  }
  return out;
}

/**
 * What Listen plays for some stars, in the order given: the verses the user
 * holds (in the translation they hold them in, so BSB narration plays where
 * it exists), and for a star they don't hold yet, its text in `translationId`.
 * Callers pass only stars that show (the found ones), already in line order.
 */
export async function listenVerses(refs: StarRef[], queue: QueueItem[], translationId: string): Promise<VerseState[]> {
  const out: VerseState[] = [];
  for (const ref of refs) {
    const held = starVerses(ref, queue);
    if (held.length > 0) {
      for (const v of held) {
        out.push({ book: v.book, chapter: v.chapter, verse: v.verse, text: v.text, status: v.item.status === 'retained' ? 'memorized' : 'learning', translationId: v.translationId });
      }
    } else {
      out.push(...(await versesForStars([ref], translationId)));
    }
  }
  return out;
}
