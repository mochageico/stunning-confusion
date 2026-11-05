import type { Recording } from '../types';
import { getBookByName } from '../data';
import { recordingFitsTranslation, resolveChapterAudio } from './appData';
import { hasPlayableAudio } from './studioAudio';
import firebaseConfig from '../../firebase-applet-config.json';

// ============================================================================
// BUILT-IN READINGS
// ----------------------------------------------------------------------------
// Audio the app ships for everyone, as opposed to the user's own recordings.
// One reading per translation, at most:
//  - Abraham Shmuelof's Hebrew Old Testament, for Hebrew/Greek. Hosted
//    unchanged (the licence forbids altered versions), one file per HEBREW
//    chapter, so an English chapter can draw on two files (English Joel
//    2:28-32 is Hebrew Joel 3). See HEBREW_AUDIO_PLAN.md.
//  - Bob Souer's BSB, the whole Bible, one file per chapter. See BSB_AUDIO_PLAN.md.
// Each chapter's timings say which file every verse is in.
//
// A built-in reading is dressed up as a Recording so Listen, the verse Play
// button and the offline cache handle it exactly like a user's own.
// ============================================================================

export interface LibraryReader {
  /** Storage folder and Firestore doc id under audioLibrary/. No underscores (see libraryReaderOf). */
  id: string;
  /** The one translation this reading is of. */
  translation: string;
  /** Only this testament has the reading; unset means the whole Bible. */
  testament?: 'ot' | 'nt';
  name: string;
  /** "{label} · {name}" titles the reading, e.g. "BSB reading · Bob Souer". */
  label: string;
  /** "Built in · {language}" under the title. */
  language: string;
  credit: string;
  licenseUrl: string;
}

export const LIBRARY_READERS: Record<string, LibraryReader> = {
  shmuelof: {
    id: 'shmuelof',
    translation: 'HEBGRK',
    testament: 'ot',
    name: 'Abraham Shmuelof',
    label: 'Hebrew reading',
    language: 'Hebrew',
    credit: 'Hebrew reading by Abraham Shmuelof, CC BY-NC-ND 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
  },
  souer: {
    id: 'souer',
    translation: 'BSB',
    name: 'Bob Souer',
    label: 'BSB reading',
    language: 'BSB',
    credit: 'BSB read by Bob Souer · public domain (CC0)',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
};

/** The built-in reading for this translation and book, if there is one. */
export function libraryReaderFor(translationId: string | undefined, bookName: string): LibraryReader | null {
  if (!translationId) return null;
  const reader = Object.values(LIBRARY_READERS).find((r) => r.translation === translationId);
  if (!reader) return null;
  const book = getBookByName(bookName);
  if (!book || (reader.testament && book.testament !== reader.testament)) return null;
  return reader;
}

/** The reader behind a built-in recording (its id is `library_{readerId}_{file}`). */
export function libraryReaderOf(recording: Pick<Recording, 'id'> | null | undefined): LibraryReader | null {
  const m = /^library_([^_]+)_/.exec(recording?.id ?? '');
  return (m && LIBRARY_READERS[m[1]]) || null;
}

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
  return !!libraryReaderFor(translationId, bookName);
}

/**
 * Key for a chapter's timings, `{readerId}/{BOOKID}_{chapter}` (e.g.
 * `souer/PSA_23`), or null when there's no built-in reading. The reader is in
 * the key so the BSB and Hebrew Psalm 23 never share a cache entry.
 */
export function libraryTimingsKey(translationId: string | undefined, bookName: string, chapter: number): string | null {
  const reader = libraryReaderFor(translationId, bookName);
  const book = getBookByName(bookName);
  return reader && book ? `${reader.id}/${book.id}_${chapter}` : null;
}

/** `souer/PSA_23` -> { readerId: 'souer', chapterId: 'PSA_23' } (the Firestore path parts). */
export function splitLibraryTimingsKey(key: string): { readerId: string; chapterId: string } {
  const slash = key.indexOf('/');
  return { readerId: key.slice(0, slash), chapterId: key.slice(slash + 1) };
}

export const libraryStoragePath = (reader: LibraryReader, file: string) => `audioLibrary/${reader.id}/${file}`;

// Public, tokenless URL: the files are openly licensed and the Storage rule
// lets anyone read them, so media players can stream without an auth header.
const libraryUrl = (reader: LibraryReader, file: string) =>
  `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/${encodeURIComponent(
    libraryStoragePath(reader, file)
  )}?alt=media`;

/** The reading of one audio file, with the timings of the verses of `chapter` that are in it. */
export function libraryRecording(reader: LibraryReader, bookName: string, timings: LibraryChapterTimings, file: string): Recording {
  return {
    // Keyed by file, not chapter: Listen reuses the loaded player while the id stays the same.
    id: `library_${reader.id}_${file}`,
    title: `${reader.label} · ${reader.name}`,
    user: reader.name,
    book: bookName,
    chapter: timings.chapter,
    translation: reader.translation,
    duration: 0,
    date: '',
    audioUrl: libraryUrl(reader, file),
    audioPath: libraryStoragePath(reader, file),
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

  const reader = libraryReaderFor(translationId, book);
  const t = reader ? libraryTimings?.verses[String(verse)] : undefined;
  if (!reader || !libraryTimings || !t) return null;
  return { recording: libraryRecording(reader, book, libraryTimings, t.file), startSec: t.startSec, endSec: t.endSec };
}
