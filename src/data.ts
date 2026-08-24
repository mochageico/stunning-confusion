import { VerseState, Recording, MemoryPlan, Rhythm } from './types';
import { BibleBook, BibleTranslation, TranslationCapabilities } from './types';

// Shared by the Save-Recording dialog (App.tsx) and SettingsScreen's default-
// visibility picker, so both always offer the exact same 3 choices.
// The label is the whole control. These carried a `desc` restating them
// ("Public" / "Anyone signed in"), which in a three-across row left each
// description about 68pt of width -- "Anyone signed in" simply ran out of
// the button. The words Private/Circle/Public already mean what they say.
export const RECORDING_VISIBILITY_OPTIONS: Array<{ id: 'private' | 'circle' | 'public'; label: string }> = [
  { id: 'private', label: 'Private' },
  { id: 'circle', label: 'Circle' },
  { id: 'public', label: 'Public' },
];

// Fixed reaction set for DM + Circle chat messages (ReactionBar). Kept small
// and fixed rather than a full emoji picker -- one reaction per user per
// message, see MessageReaction in types.ts.
export const REACTION_EMOJIS = ['👍', '👎', '❤️', '😂', '🔥'] as const;

// The 66-book Protestant canon with standard USFM book IDs and chapter counts.
// This is structural/bibliographic data (names + chapter counts), not the text
// of any particular translation — the same list applies regardless of which
// translation's verse text is eventually loaded for a given book/chapter.
const OT_BOOKS: BibleBook[] = [
  { id: 'GEN', name: 'Genesis', testament: 'ot', chapters: 50 },
  { id: 'EXO', name: 'Exodus', testament: 'ot', chapters: 40 },
  { id: 'LEV', name: 'Leviticus', testament: 'ot', chapters: 27 },
  { id: 'NUM', name: 'Numbers', testament: 'ot', chapters: 36 },
  { id: 'DEU', name: 'Deuteronomy', testament: 'ot', chapters: 34 },
  { id: 'JOS', name: 'Joshua', testament: 'ot', chapters: 24 },
  { id: 'JDG', name: 'Judges', testament: 'ot', chapters: 21 },
  { id: 'RUT', name: 'Ruth', testament: 'ot', chapters: 4 },
  { id: '1SA', name: '1 Samuel', testament: 'ot', chapters: 31 },
  { id: '2SA', name: '2 Samuel', testament: 'ot', chapters: 24 },
  { id: '1KI', name: '1 Kings', testament: 'ot', chapters: 22 },
  { id: '2KI', name: '2 Kings', testament: 'ot', chapters: 25 },
  { id: '1CH', name: '1 Chronicles', testament: 'ot', chapters: 29 },
  { id: '2CH', name: '2 Chronicles', testament: 'ot', chapters: 36 },
  { id: 'EZR', name: 'Ezra', testament: 'ot', chapters: 10 },
  { id: 'NEH', name: 'Nehemiah', testament: 'ot', chapters: 13 },
  { id: 'EST', name: 'Esther', testament: 'ot', chapters: 10 },
  { id: 'JOB', name: 'Job', testament: 'ot', chapters: 42 },
  { id: 'PSA', name: 'Psalms', testament: 'ot', chapters: 150 },
  { id: 'PRO', name: 'Proverbs', testament: 'ot', chapters: 31 },
  { id: 'ECC', name: 'Ecclesiastes', testament: 'ot', chapters: 12 },
  { id: 'SNG', name: 'Song of Solomon', testament: 'ot', chapters: 8 },
  { id: 'ISA', name: 'Isaiah', testament: 'ot', chapters: 66 },
  { id: 'JER', name: 'Jeremiah', testament: 'ot', chapters: 52 },
  { id: 'LAM', name: 'Lamentations', testament: 'ot', chapters: 5 },
  { id: 'EZK', name: 'Ezekiel', testament: 'ot', chapters: 48 },
  { id: 'DAN', name: 'Daniel', testament: 'ot', chapters: 12 },
  { id: 'HOS', name: 'Hosea', testament: 'ot', chapters: 14 },
  { id: 'JOL', name: 'Joel', testament: 'ot', chapters: 3 },
  { id: 'AMO', name: 'Amos', testament: 'ot', chapters: 9 },
  { id: 'OBA', name: 'Obadiah', testament: 'ot', chapters: 1 },
  { id: 'JON', name: 'Jonah', testament: 'ot', chapters: 4 },
  { id: 'MIC', name: 'Micah', testament: 'ot', chapters: 7 },
  { id: 'NAM', name: 'Nahum', testament: 'ot', chapters: 3 },
  { id: 'HAB', name: 'Habakkuk', testament: 'ot', chapters: 3 },
  { id: 'ZEP', name: 'Zephaniah', testament: 'ot', chapters: 3 },
  { id: 'HAG', name: 'Haggai', testament: 'ot', chapters: 2 },
  { id: 'ZEC', name: 'Zechariah', testament: 'ot', chapters: 14 },
  { id: 'MAL', name: 'Malachi', testament: 'ot', chapters: 4 },
];

const NT_BOOKS: BibleBook[] = [
  { id: 'MAT', name: 'Matthew', testament: 'nt', chapters: 28 },
  { id: 'MRK', name: 'Mark', testament: 'nt', chapters: 16 },
  { id: 'LUK', name: 'Luke', testament: 'nt', chapters: 24 },
  { id: 'JHN', name: 'John', testament: 'nt', chapters: 21 },
  { id: 'ACT', name: 'Acts', testament: 'nt', chapters: 28 },
  { id: 'ROM', name: 'Romans', testament: 'nt', chapters: 16 },
  { id: '1CO', name: '1 Corinthians', testament: 'nt', chapters: 16 },
  { id: '2CO', name: '2 Corinthians', testament: 'nt', chapters: 13 },
  { id: 'GAL', name: 'Galatians', testament: 'nt', chapters: 6 },
  { id: 'EPH', name: 'Ephesians', testament: 'nt', chapters: 6 },
  { id: 'PHP', name: 'Philippians', testament: 'nt', chapters: 4 },
  { id: 'COL', name: 'Colossians', testament: 'nt', chapters: 4 },
  { id: '1TH', name: '1 Thessalonians', testament: 'nt', chapters: 5 },
  { id: '2TH', name: '2 Thessalonians', testament: 'nt', chapters: 3 },
  { id: '1TI', name: '1 Timothy', testament: 'nt', chapters: 6 },
  { id: '2TI', name: '2 Timothy', testament: 'nt', chapters: 4 },
  { id: 'TIT', name: 'Titus', testament: 'nt', chapters: 3 },
  { id: 'PHM', name: 'Philemon', testament: 'nt', chapters: 1 },
  { id: 'HEB', name: 'Hebrews', testament: 'nt', chapters: 13 },
  { id: 'JAS', name: 'James', testament: 'nt', chapters: 5 },
  { id: '1PE', name: '1 Peter', testament: 'nt', chapters: 5 },
  { id: '2PE', name: '2 Peter', testament: 'nt', chapters: 3 },
  { id: '1JN', name: '1 John', testament: 'nt', chapters: 5 },
  { id: '2JN', name: '2 John', testament: 'nt', chapters: 1 },
  { id: '3JN', name: '3 John', testament: 'nt', chapters: 1 },
  { id: 'JUD', name: 'Jude', testament: 'nt', chapters: 1 },
  { id: 'REV', name: 'Revelation', testament: 'nt', chapters: 22 },
];

export const BOOKS = {
  ot: OT_BOOKS,
  nt: NT_BOOKS,
};

// The translation a brand-new user starts on, and the one every hardcoded
// verse-fetch path in useAppState falls back to.
//
// This is the Berean Standard Bible, NOT the ESV, and that is a licensing
// decision rather than an editorial one. Crossway gates the ESV licence behind
// roughly twelve months of a live app with a real userbase -- a condition only
// shipping can satisfy, which the app cannot do while it is built around a
// translation it may not carry. The BSB was placed in the public domain on
// 30 April 2023: modern English in much the same register as the ESV or CSB,
// with no licence to obtain, no attribution to render, and no restriction on
// offline storage, printing, or audio. It means the product is never hostage
// to a rights holder.
export const DEFAULT_TRANSLATION_ID = 'BSB';

// Capability preset for a translation nobody owns -- everything permitted,
// cached forever. Shared by every entry below, since all of them are public
// domain today. A licensed translation would spell its own restrictions out
// inline rather than reuse this.
const UNRESTRICTED: TranslationCapabilities = {
  persistText: true,
  cacheTtlMs: null,
  print: true,
  publishAudio: true,
};

// api.bible's terms for licensed text, kept here so the numbers are written
// down at the point of use rather than living only in a plan document:
// cache cleared at least every 14 days, under 500 consecutive verses held,
// FUMS reported on every read, 5,000 queries/day.
// https://scripture.api.bible/license
export const API_BIBLE_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// Crossway's required attribution text for apps displaying ESV® text via their API
// (see scripts/import-bible/adapters/esv.js and https://api.esv.org/docs/).
const ESV_COPYRIGHT_NOTICE =
  'Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), copyright © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.';

// Single source of truth for which translations actually have real text
// imported (see scripts/import-bible/) -- both RecordScreen and
// RecordingDetailScreen used to keep their own separate hardcoded lists,
// which had already drifted (one included a stray 'NASB' code the other
// didn't, and both listed NIV/NKJV/NLT despite zero data ever being
// imported for them).
//
// Order matters: ChapterLandingScreen falls back to BIBLE_TRANSLATIONS[0]
// when the selected id doesn't resolve, so the default belongs first.
export const BIBLE_TRANSLATIONS: BibleTranslation[] = [
  {
    id: 'BSB',
    name: 'Berean Standard Bible',
    isPublicDomain: true,
    source: 'firestore',
    capabilities: UNRESTRICTED,
  },
  {
    id: 'WEB',
    name: 'World English Bible',
    isPublicDomain: true,
    source: 'firestore',
    capabilities: UNRESTRICTED,
  },
  {
    id: 'KJV',
    name: 'King James Version',
    isPublicDomain: true,
    source: 'firestore',
    capabilities: UNRESTRICTED,
  },
  // Kept listed because its text is already imported into Firestore and older
  // queue items reference it, so the app must still be able to name and render
  // it. NOT shippable until Crossway grants a licence -- see
  // capabilityWarningsFor() below for what turning a licensed translation on
  // actually costs.
  {
    id: 'ESV',
    name: 'English Standard Version',
    copyright: ESV_COPYRIGHT_NOTICE,
    isPublicDomain: false,
    source: 'firestore',
    capabilities: {
      persistText: false,
      cacheTtlMs: API_BIBLE_CACHE_TTL_MS,
      print: false,
      publishAudio: false,
    },
  },
];

export const getTranslation = (id: string): BibleTranslation | undefined =>
  BIBLE_TRANSLATIONS.find((t) => t.id === id);

/**
 * Attribution text for one translation, or null when none is required.
 *
 * Replaces a directly-imported ESV_COPYRIGHT_NOTICE constant, which stamped
 * Crossway's notice onto every printed memory grid regardless of which
 * translation the grid was built from -- wrong in both directions once more
 * than one translation exists.
 */
export const copyrightFor = (translationId: string): string | null =>
  getTranslation(translationId)?.copyright ?? null;

/**
 * The work that switching a licensed translation on would require.
 *
 * Deliberately a reporting function, not a guard: the app does not currently
 * gate any feature on capabilities, and every shipped translation is public
 * domain, so this returns [] in practice. It exists so the cost is discoverable
 * from the code the day an ESV or CSB licence lands, instead of being
 * rediscovered by reading a contract.
 */
export const capabilityWarningsFor = (translationId: string): string[] => {
  const t = getTranslation(translationId);
  if (!t) return [];
  const warnings: string[] = [];
  if (!t.capabilities.persistText) {
    warnings.push(
      'Verse text must not be stored in user documents — queue items currently denormalise it (useAppState addVersesToQueue). Store the reference and hydrate at render.'
    );
  }
  if (t.capabilities.cacheTtlMs !== null) {
    warnings.push(`On-device cache must expire after ${Math.round(t.capabilities.cacheTtlMs / 86400000)} days.`);
  }
  if (!t.capabilities.print) warnings.push('Printable memory grids are not permitted for this translation.');
  if (!t.capabilities.publishAudio) {
    warnings.push('Audio recitations may not be published to a public feed — a separate right from displaying the text.');
  }
  if (!t.isPublicDomain) {
    warnings.push('firestore.rules exposes translations/** to signed-out readers; licensed text must not be world-readable.');
  }
  return warnings;
};

// Flat list in canonical (Genesis → Revelation) order, handy for pickers/lookups.
export const ALL_BIBLE_BOOKS: BibleBook[] = [...OT_BOOKS, ...NT_BOOKS];

export const getBookByName = (name: string): BibleBook | undefined =>
  ALL_BIBLE_BOOKS.find((b) => b.name.toLowerCase() === name.toLowerCase());

export const SUGGESTED_FEED_RECORDINGS: Recording[] = [
  {
    id: 'feed_1',
    title: 'Romans 8 Full Chapter Reading',
    book: 'Romans',
    chapter: 8,
    translation: 'ESV',
    duration: 195,
    date: '2026-06-24',
    user: 'Sarah Miller',
    avatar: 'SM',
    category: 'group',
    versesStr: 'Full Chapter'
  },
  {
    id: 'feed_2',
    title: 'Psalms 23 Full Chapter Recital',
    book: 'Psalms',
    chapter: 23,
    translation: 'NKJV',
    duration: 90,
    date: '2026-06-23',
    user: 'Elizabeth K.',
    avatar: 'EK',
    category: 'friends',
    versesStr: 'Full Chapter'
  },
  {
    id: 'feed_3',
    title: 'Genesis 1 Full Chapter Recital',
    book: 'Genesis',
    chapter: 1,
    translation: 'ESV',
    duration: 155,
    date: '2026-06-22',
    user: 'Brother Thomas',
    avatar: 'BT',
    category: 'group',
    versesStr: 'Full Chapter'
  },
  {
    id: 'feed_4',
    title: 'Romans 12 Full Chapter Recital',
    book: 'Romans',
    chapter: 12,
    translation: 'NIV',
    duration: 140,
    date: '2026-06-25',
    user: 'Mark Davis',
    avatar: 'MD',
    category: 'group',
    versesStr: 'Full Chapter'
  },
  {
    id: 'feed_5',
    title: 'John 15 Full Chapter Recital',
    book: 'John',
    chapter: 15,
    translation: 'NIV',
    duration: 165,
    date: '2026-06-21',
    user: 'Pastor Robert',
    avatar: 'PR',
    category: 'global',
    versesStr: 'Full Chapter'
  },
  {
    id: 'feed_6',
    title: 'Genesis 2 Full Chapter Recital',
    book: 'Genesis',
    chapter: 2,
    translation: 'NASB',
    duration: 130,
    date: '2026-06-19',
    user: 'Grace Thompson',
    avatar: 'GT',
    category: 'global',
    versesStr: 'Full Chapter'
  }
];

// The one shipped memory plan. Previously there were three (Example Plan /
// Warrior Track / Gentle Drip), but they were identical on every retention
// field and differed ONLY in pacing -- they were three schedules wearing
// plan costumes, which is exactly what made "pick a plan" confusing. Pacing
// now lives in Rhythm (one per user), so a plan is purely a memorization
// method and there is only one sensible starting point.
//
// This plan is immutable: PlanDesignerScreen forks a renamed copy on first
// edit (see handleSavePlan's fork branch) rather than mutating the baseline.
export const BUILT_IN_PLAN_ID = 'standard-plan';

export const DEFAULT_PLANS: MemoryPlan[] = [
  {
    id: BUILT_IN_PLAN_ID,
    name: 'Standard',
    isBuiltIn: true,
    retentionRigor: 'standard',
    dailyPhaseWeeks: 7,
    weeklyPhaseMonths: 6,
    monthlyPhaseYears: 5,
    masteryTouches: 3,
    reviewsRequired: 1,
    missPolicy: 'standard',
    missPolicyAskEveryTime: false,
    graceCount: 1,
    refresherDailyDays: 7,
    refresherWeeklyWeeks: 4,
    isActive: true,
    updatedAt: new Date().toISOString()
  }
];

// Starting cadence for a brand-new user. Matches what the old 'Example Plan'
// carried, so an existing user's day-to-day pacing is unchanged by the split.
export const DEFAULT_RHYTHM: Rhythm = {
  learningDays: ['M', 'W', 'F'],
  newVersesPace: 3,
  maxReviewCap: 15,
  sabbathEnabled: false,
  sabbathDay: 'Su',
  dayStartHour: 0,
  cognitiveLoadSensitivity: 'medium',
  pausedAt: null,
  pausedUntil: null,
};

