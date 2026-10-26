import type { StarRef, VerseState } from '../../types';
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
