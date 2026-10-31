import type { Recording } from '../types';
import { getBookByName } from '../data';
import { recordingFitsTranslation, resolveChapterAudio } from './appData';
import { hasPlayableAudio } from './studioAudio';
import firebaseConfig from '../../firebase-applet-config.json';

// ============================================================================
// BUILT-IN READINGS
// ----------------------------------------------------------------------------
// Audio the app ships for everyone, as opposed to the user's own recordings.
// Today that is one reading: Abraham Shmuelof's Hebrew Old Testament, for the
// Hebrew/Greek translation. See HEBREW_AUDIO_PLAN.md.
//
// The files are hosted unchanged (the licence forbids altered versions), one
// per HEBREW chapter, so an English chapter can draw on two files (English
// Joel 2:28-32 is Hebrew Joel 3). Each chapter's timings therefore say which
// file every verse is in.
//
// A built-in reading is dressed up as a Recording so Listen, the verse Play
// button and the offline cache handle it exactly like a user's own.
// ============================================================================

export const LIBRARY_READER = {
  id: 'shmuelof',
  name: 'Abraham Shmuelof',
  credit: 'Hebrew reading by Abraham Shmuelof, CC BY-NC-ND 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
} as const;

export interface LibraryVerseTiming {
  file: string;
  startSec: number;
  endSec: number;
}

/** Firestore audioLibrary/{readerId}/chapters/{BOOKID}_{chapter}, in English numbering. */
export interface LibraryChapterTimings {
  book: string; // app book id, e.g. 'JOL'
  chapter: number;
  verses: Record<string, LibraryVerseTiming>;
}

/** Whether a built-in reading exists for this translation and book. */
export function hasLibraryAudio(translationId: string | undefined, bookName: string): boolean {
  return translationId === 'HEBGRK' && getBookByName(bookName)?.testament === 'ot';
}

/** Firestore doc id for a chapter's timings, or null when there's no built-in reading. */
export function libraryTimingsKey(translationId: string | undefined, bookName: string, chapter: number): string | null {
  if (!hasLibraryAudio(translationId, bookName)) return null;
  const book = getBookByName(bookName);
  return book ? `${book.id}_${chapter}` : null;
}

export const libraryStoragePath = (file: string) => `audioLibrary/${LIBRARY_READER.id}/${file}`;

// Public, tokenless URL: the files are openly licensed and the Storage rule
// lets anyone read them, so media players can stream without an auth header.
const libraryUrl = (file: string) =>
  `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/${encodeURIComponent(
    libraryStoragePath(file)
  )}?alt=media`;

/** The reading of one audio file, with the timings of the verses of `chapter` that are in it. */
export function libraryRecording(bookName: string, timings: LibraryChapterTimings, file: string): Recording {
  return {
    // Keyed by file, not chapter: Listen reuses the loaded player while the id stays the same.
    id: `library_${LIBRARY_READER.id}_${file}`,
    title: `Hebrew reading · ${LIBRARY_READER.name}`,
    user: LIBRARY_READER.name,
    book: bookName,
    chapter: timings.chapter,
    translation: 'HEBGRK',
    duration: 0,
    date: '',
    audioUrl: libraryUrl(file),
    audioPath: libraryStoragePath(file),
    verseTimestamps: Object.entries(timings.verses)
      .filter(([, t]) => t.file === file)
      .map(([verse, t]) => ({ verse: Number(verse), startSec: t.startSec, endSec: t.endSec })),
  };
}

export const isLibraryRecording = (recording: Pick<Recording, 'id'> | null | undefined): boolean =>
  !!recording?.id.startsWith('library_');

export interface VerseAudio {
  recording: Recording;
  startSec: number;
  endSec: number;
}

/**
 * What plays for one verse, layered like texture packs: the recording picked
 * for this chapter first, then the chapter's recordings top to bottom (the
 * drag order on the chapter page), and the first that has this verse tagged
 * wins. So a verses 1-5 take above a whole-chapter take plays 1-5 from the
 * first and the rest from the second. Then the built-in reading, then nothing.
 */
export function resolveVerseAudio(
  userRecordings: Recording[],
  selectedChapterAudios: Record<string, Recording | null>,
  book: string,
  chapter: number,
  verse: number,
  translationId: string,
  libraryTimings: LibraryChapterTimings | null | undefined
): VerseAudio | null {
  const picked = resolveChapterAudio(userRecordings, selectedChapterAudios, book, chapter, translationId);
  const layers = [
    ...(picked ? [picked] : []),
    ...userRecordings
      .filter(
        (r) =>
          r.id !== picked?.id &&
          r.book.toLowerCase() === book.toLowerCase() &&
          r.chapter === chapter &&
          recordingFitsTranslation(r, translationId)
      )
      .sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER)),
  ];
  for (const rec of layers) {
    const timing = hasPlayableAudio(rec) ? rec.verseTimestamps?.find((t) => t.verse === verse) : undefined;
    if (timing) return { recording: rec, startSec: timing.startSec, endSec: timing.endSec };
  }

  const t = hasLibraryAudio(translationId, book) ? libraryTimings?.verses[String(verse)] : undefined;
  if (!libraryTimings || !t) return null;
  return { recording: libraryRecording(book, libraryTimings, t.file), startSec: t.startSec, endSec: t.endSec };
}
