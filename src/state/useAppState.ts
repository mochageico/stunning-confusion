import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import {
  deleteUser,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
} from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';

import { auth, db, storage, handleFirestoreError, OperationType } from '../firebase';
import {
  ALL_BIBLE_BOOKS,
  BOOKS,
  DEFAULT_PLANS,
  DEFAULT_TRANSLATION_ID,
  getBookByName,
  INITIAL_RECORDINGS,
  INITIAL_VERSES,
  SUGGESTED_FEED_RECORDINGS,
} from '../data';
import { fetchChapterText, useChapterText } from './useScripture';
import {
  AccountabilityNudge,
  ActivityEvent,
  ChatMessage,
  Circle,
  CircleMember,
  DMThread,
  Friend,
  FriendRequest,
  MemoryPlan,
  QueueItem,
  Recording,
  StudyPlan,
  StudyPlanMembership,
  TouchLog,
  VerseState,
  VerseTimestamp,
} from '../types';
import { computeDailyPull, PersonalPacingSettings } from '../lib/studyPlanScheduler';

export type ScreenName =
  | 'home'
  | 'books'
  | 'chapters'
  | 'chapterLanding'
  | 'audioFeed'
  | 'planDesigner'
  | 'activePlan'
  | 'savedPlans'
  | 'memoryCalendar'
  | 'memberProfile'
  | 'studyPlanDetail'
  | 'fullHistory'
  | 'dashboard'
  | 'settings'
  | 'recordingDetail'
  | 'findFriends'
  | 'messages'
  | 'dmThread'
  | 'circleChat';

// Screens App.tsx's router only renders while currentTab === 'home' (see
// Screens() in App.tsx). navigateTo() needs this list so it can switch tabs
// itself — otherwise navigating to e.g. 'activePlan' from the Profile tab
// silently no-ops, since the router keeps showing the current tab's screen.
const HOME_TAB_SCREENS: ScreenName[] = [
  'home',
  'books',
  'chapters',
  'chapterLanding',
  'audioFeed',
  'planDesigner',
  'activePlan',
  'savedPlans',
  'memoryCalendar',
];

export type TabName = 'home' | 'community' | 'record' | 'profile';

// Canonical QueueItem.verseId shape, translation-prefixed so the same
// book/chapter/verse in two different translations are two independent
// queue items with independent progress (e.g. "ESV_EPH_2_5" vs
// "KJV_EPH_2_5"). Every site that constructs a QueueItem's verseId should
// go through this instead of an ad-hoc template literal, since it must stay
// consistent across every call site or two code paths adding "the same"
// verse could silently create duplicate, non-deduplicating queue items.
// Pre-existing items from before translations existed keep their old
// translation-less id ("EPH_2_5") rather than being migrated -- see
// loadUserData's translationId default-to-'ESV' fallback.
export const buildVerseId = (translationId: string, bookId: string, chapter: number, verse: number): string =>
  `${translationId}_${bookId}_${chapter}_${verse}`;

const generateInitialQueue = (verses: VerseState[]): QueueItem[] => {
  return verses.map((v, index) => {
    const verseId = `${v.book.substring(0, 3).toUpperCase()}_${v.chapter}_${v.verse}`;
    const origin = v.book === 'John' ? 'group' : 'individual';

    // Seed some specific verses into interesting states to match the dynamic requirements
    if (v.book === 'John' && v.chapter === 15 && v.verse === 1) {
      return {
        verseId,
        translationId: 'ESV',
        book: v.book,
        chapter: v.chapter,
        verseNumber: v.verse,
        text: v.text,
        orderIndex: index,
        status: 'reviewing',
        origin: 'group',
        retentionPhase: 'weekly',
        dateStarted: new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString(),
        lastReviewDate: new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString(),
        nextReviewDueDate: new Date().toISOString(), // Due today
        currentStreakCount: 8,
        totalSuccessfulReviews: 8,
        gracePeriodUsedToday: false,
      };
    }
    if (v.book === 'John' && v.chapter === 15 && v.verse === 2) {
      return {
        verseId,
        translationId: 'ESV',
        book: v.book,
        chapter: v.chapter,
        verseNumber: v.verse,
        text: v.text,
        orderIndex: index,
        status: 'reviewing',
        origin: 'individual',
        retentionPhase: 'weekly',
        dateStarted: new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString(),
        lastReviewDate: new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString(),
        nextReviewDueDate: new Date().toISOString(), // Due today
        currentStreakCount: 8,
        totalSuccessfulReviews: 8,
        gracePeriodUsedToday: false,
      };
    }
    if (v.book === 'Genesis' && v.chapter === 1 && v.verse === 1) {
      return {
        verseId,
        translationId: 'ESV',
        book: v.book,
        chapter: v.chapter,
        verseNumber: v.verse,
        text: v.text,
        orderIndex: index,
        status: 'retained',
        origin: 'individual',
        retentionPhase: 'none',
        dateStarted: new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString(),
        lastReviewDate: new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString(),
        nextReviewDueDate: null,
        currentStreakCount: 0,
        totalSuccessfulReviews: 24,
        gracePeriodUsedToday: false,
      };
    }
    if (v.book === 'Genesis' && v.chapter === 1 && v.verse === 2) {
      return {
        verseId,
        translationId: 'ESV',
        book: v.book,
        chapter: v.chapter,
        verseNumber: v.verse,
        text: v.text,
        orderIndex: index,
        status: 'retained',
        origin: 'individual',
        retentionPhase: 'none',
        dateStarted: new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString(),
        lastReviewDate: new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString(),
        nextReviewDueDate: null,
        currentStreakCount: 0,
        totalSuccessfulReviews: 24,
        gracePeriodUsedToday: false,
      };
    }
    if (
      v.book === 'Genesis' &&
      v.chapter === 1 &&
      (v.verse === 3 || v.verse === 4 || v.verse === 5 || v.verse === 6)
    ) {
      return {
        verseId,
        translationId: 'ESV',
        book: v.book,
        chapter: v.chapter,
        verseNumber: v.verse,
        text: v.text,
        orderIndex: index,
        status: 'learning',
        origin,
        retentionPhase: 'none',
        dateStarted: new Date().toISOString(),
        lastReviewDate: null,
        nextReviewDueDate: null,
        currentStreakCount: 0,
        totalSuccessfulReviews: 0,
        gracePeriodUsedToday: false,
      };
    }

    return {
      verseId,
      translationId: 'ESV',
      book: v.book,
      chapter: v.chapter,
      verseNumber: v.verse,
      text: v.text,
      orderIndex: index,
      status: 'queued',
      origin,
      retentionPhase: 'none',
      dateStarted: null,
      lastReviewDate: null,
      nextReviewDueDate: null,
      currentStreakCount: 0,
      totalSuccessfulReviews: 0,
      gracePeriodUsedToday: false,
    };
  }) as QueueItem[];
};

// Demotion softening: base length of a temporary "refresher" stint. A miss
// out of Weekly drops to Daily for this many days; a miss out of Monthly
// drops to Weekly for this many weeks. Each additional consecutive
// non-grace miss adds one more base unit (7, then 14, then 21 days, etc.),
// matching how Daily's own graduation target grows by a day per miss.
const REFRESHER_BASE_DAILY_DAYS = 7;
const REFRESHER_BASE_WEEKLY_WEEKS = 4;

// Applies exactly one "miss" to a draft QueueItem (mutated in place) and
// returns a tag describing what happened, so callers can build a toast.
// Called once per real failed review, and once per calendar cycle silently
// skipped while the app wasn't opened (see the catch-up loop in
// handleReviewCompleted) -- both are the same kind of "miss" to this engine.
const applyMissToItem = (draft: QueueItem): 'grace' | 'daily-extended' | 'refresher-start' | 'refresher-extended' | 'none' => {
  if (!draft.gracePeriodUsedToday) {
    draft.gracePeriodUsedToday = true;
    return 'grace';
  }

  const priorStreak = draft.currentStreakCount;
  draft.currentStreakCount = 0;
  // gracePeriodUsedToday stays true here -- grace only refills on an actual
  // success (handled in handleReviewCompleted's success branch). Otherwise
  // consecutive misses would each get a fresh grace instead of escalating.

  if (draft.refresherActive) {
    const extension = draft.refresherReturnPhase === 'monthly' ? REFRESHER_BASE_WEEKLY_WEEKS : REFRESHER_BASE_DAILY_DAYS;
    draft.refresherTargetUnits = (draft.refresherTargetUnits || 0) + extension;
    return 'refresher-extended';
  }

  if (draft.retentionPhase === 'daily') {
    draft.dailyPhaseExtensionDays = (draft.dailyPhaseExtensionDays || 0) + 1;
    return 'daily-extended';
  }

  if (draft.retentionPhase === 'weekly') {
    draft.refresherActive = true;
    draft.refresherReturnPhase = 'weekly';
    draft.refresherReturnProgress = priorStreak;
    draft.refresherTargetUnits = REFRESHER_BASE_DAILY_DAYS;
    draft.retentionPhase = 'daily';
    return 'refresher-start';
  }

  if (draft.retentionPhase === 'monthly') {
    draft.refresherActive = true;
    draft.refresherReturnPhase = 'monthly';
    draft.refresherReturnProgress = priorStreak;
    draft.refresherTargetUnits = REFRESHER_BASE_WEEKLY_WEEKS;
    draft.retentionPhase = 'weekly';
    return 'refresher-start';
  }

  return 'none';
};

// Builds the toast copy for a single miss tag (see applyMissToItem). Shared
// between the "silently missed cycles while away" catch-up and today's own
// failed attempt, so both describe the same outcomes the same way.
const describeMissOutcome = (
  tag: 'grace' | 'daily-extended' | 'refresher-start' | 'refresher-extended' | 'none',
  draft: QueueItem,
  dailyGraduationDaysTotal: number
): string | null => {
  const returnLabel = draft.refresherReturnPhase === 'monthly' ? 'Monthly' : 'Weekly';
  const unitLabel = draft.refresherReturnPhase === 'monthly' ? 'weeks' : 'days';
  switch (tag) {
    case 'grace':
      return 'Grace period used! Get it right next time to avoid falling back. 🛡️';
    case 'daily-extended':
      return `Missed after your grace period was already used -- streak reset, and Daily now needs ${dailyGraduationDaysTotal} days total instead of fewer. Still Daily, just a bit longer. 🔄`;
    case 'refresher-start':
      return `Missed after your grace period was already used -- sent to a ${draft.refresherTargetUnits}-${
        unitLabel === 'weeks' ? 'week' : 'day'
      } refresher, then back to ${returnLabel} review right where you left off. 🔄`;
    case 'refresher-extended':
      return `Missed again during the refresher -- it's now ${draft.refresherTargetUnits} ${unitLabel} before you return to ${returnLabel} review. 🔄`;
    default:
      return null;
  }
};

// Sabbath support: a plan can designate one weekday as a full day off from
// both learning and review. The engine treats it as not existing for
// scheduling purposes -- due dates never land on it, and time spent on it
// doesn't count as elapsed when detecting silently-missed review cycles.
const DAY_ABBREVS = ['Su', 'M', 'T', 'W', 'Th', 'F', 'S']; // index matches Date.getDay()

// "What day is it, logically, right now" -- lets a user whose day-start-hour
// is 1am/2am (MemoryPlan.dayStartHour) have their "today" not flip over at
// real midnight. Every place that asks "what day/weekday is it" for
// scheduling or notification-limit purposes should use this instead of a
// bare `new Date()` -- genuine event TIMESTAMPS (createdAt/updatedAt/etc.)
// must keep using real `new Date()`, never this. At dayStartHour=0 (the
// default) this returns exactly `new Date()`, so existing behavior is
// unchanged unless a user opts into a later day-start hour.
const getLogicalDate = (dayStartHour: number, base: Date = new Date()): Date => {
  if (!dayStartHour) return base;
  return new Date(base.getTime() - dayStartHour * 60 * 60 * 1000);
};

// Days are keyed in LOCAL time, not UTC (toISOString): for anyone west of
// Greenwich, an evening practice session's UTC date is already "tomorrow",
// which would shift the activity grid and break streaks at the day
// boundary. Pure/pair with getLogicalDate -- pass a logical date in, get a
// stable per-logical-day string key out.
const localDayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Default cap on accountability nudges a user will receive per logical day
// (from any friend, combined) before senders are told they've hit it —
// applies unless the recipient has set UserProfile.accountabilityDailyCap.
const ACCOUNTABILITY_DEFAULT_DAILY_CAP = 5;

const advancePastSabbath = (date: Date, sabbathEnabled: boolean, sabbathDay: string): Date => {
  if (!sabbathEnabled) return date;
  const result = new Date(date);
  while (DAY_ABBREVS[result.getDay()] === sabbathDay) {
    result.setDate(result.getDate() + 1);
  }
  return result;
};

// Finds the next date (today counts) whose day-of-week matches `weekday`,
// then nudges off the Sabbath if it happens to land there. Used by manual
// memory-status overrides to let a batch's weekly/monthly review cycle
// consistently land on a chosen weekday -- a phase's due date always
// recurs by a fixed number of days from wherever it first starts (7 for
// weekly, 30 for monthly), so picking which day the FIRST one lands on is
// all that's needed; no scheduling-engine changes required.
const nextOccurrenceOfWeekday = (from: Date, weekday: string, sabbathEnabled: boolean, sabbathDay: string): Date => {
  const result = new Date(from);
  result.setHours(0, 0, 0, 0);
  let scanned = 0;
  while (DAY_ABBREVS[result.getDay()] !== weekday && scanned < 7) {
    result.setDate(result.getDate() + 1);
    scanned++;
  }
  return advancePastSabbath(result, sabbathEnabled, sabbathDay);
};

// Chapter review-day anchoring ("Snap-to-Grid" -- see QueueItem.
// chapterReviewAnchorDay in types.ts): the Nth future occurrence of
// `weekday` on/after `from` (n=1 is the very next one). Weekday is
// invariant under a +7 shift, so jumping whole weeks from the first
// occurrence keeps this exactly on the anchor day for any n -- this is what
// lets Monthly reuse the same weekday as Weekly by just asking for n=4.
const nthOccurrenceOfWeekday = (from: Date, weekday: string, n: number, sabbathEnabled: boolean, sabbathDay: string): Date => {
  const first = nextOccurrenceOfWeekday(from, weekday, sabbathEnabled, sabbathDay);
  if (n <= 1) return first;
  const result = new Date(first);
  result.setDate(result.getDate() + (n - 1) * 7);
  return advancePastSabbath(result, sabbathEnabled, sabbathDay);
};

// Has any OTHER verse of this book+chapter already established a shared
// review-anchor weekday? Undefined if no chunk of this chapter has ever
// graduated out of Daily review.
const findChapterReviewAnchor = (book: string, chapter: number, queue: QueueItem[]): string | undefined =>
  queue.find((q) => q.book === book && q.chapter === chapter && q.chapterReviewAnchorDay)?.chapterReviewAnchorDay;

const DAY_FULL_NAMES: Record<string, string> = {
  Su: 'Sundays',
  M: 'Mondays',
  T: 'Tuesdays',
  W: 'Wednesdays',
  Th: 'Thursdays',
  F: 'Fridays',
  S: 'Saturdays',
};

// Shared iteration cap for the day-by-day scans below, so a corrupted or
// mistyped date (e.g. a garbled year from a date picker, or a stale due-date
// far in the past) can't turn a bounded loop into a multi-million-iteration
// scan that hangs the JS thread for a very long time -- past the cap, the
// range is treated as unreasonable and scanning just stops early.
const MAX_LEARNING_DAY_SCAN = 18250; // ~50 years

const countSabbathDaysInRange = (from: Date, to: Date, sabbathDay: string): number => {
  let count = 0;
  const cursor = new Date(from);
  cursor.setDate(cursor.getDate() + 1);
  let scanned = 0;
  while (cursor <= to && scanned < MAX_LEARNING_DAY_SCAN) {
    if (DAY_ABBREVS[cursor.getDay()] === sabbathDay) count++;
    cursor.setDate(cursor.getDate() + 1);
    scanned++;
  }
  return count;
};

// Back-compat: normalizes a raw Firestore 'groupPlans' doc into the current
// StudyPlan shape. Docs created before the Study Plan revamp (the old
// GroupPlan model) have `scriptureRange`/`pacingPerWeek` instead of
// `verseIds`/`versesPerWeek`, and no `description`/`createdAt`/`updatedAt` --
// reading one of those directly as a StudyPlan left `verseIds` undefined,
// crashing any `plan.verseIds.length` in the UI. Same pattern already used
// for old MemoryPlan docs missing retention-rigor/mastery-touches fields.
const normalizeStudyPlan = (planId: string, data: any): StudyPlan => ({
  planId,
  circleId: data.circleId,
  name: data.name || 'Untitled Plan',
  description: data.description || '',
  managerId: data.managerId,
  managerName: data.managerName,
  versesPerWeek: data.versesPerWeek ?? data.pacingPerWeek ?? 3,
  verseIds: data.verseIds || data.scriptureRange || [],
  createdAt: data.createdAt || data.startDate || new Date().toISOString(),
  updatedAt: data.updatedAt || data.startDate || new Date().toISOString(),
});

// Due-ness is calendar-day granularity, not exact-clock-time -- a review
// whose nextReviewDueDate falls anywhere on today's calendar date is due
// NOW, not only once the clock reaches that same time-of-day. Reviews are
// never day-gated (see project philosophy); comparing exact timestamps
// silently reintroduced a day-boundary-like gate (a verse graduated at
// 9pm wouldn't show as due again until 9pm the next day), which is what
// caused Home's Due Reviews to disagree with the Memory Calendar (which
// already compared by date, not exact time). Also treats any date whose
// day has already fully passed as due, matching the old "overdue" case.
// Exported (not just hook-internal) so components importing pure helpers
// directly from this module, like PracticeModals' resolveChapterAudio use,
// can share it too instead of re-deriving the same date logic.
export function isReviewDue(dueDateISO: string | null | undefined, referenceDate: Date = new Date()): boolean {
  if (!dueDateISO) return true;
  const due = new Date(dueDateISO);
  return due.toDateString() === referenceDate.toDateString() || due.getTime() < referenceDate.getTime();
}

// Resolves which of the user's own recordings represents a given chapter's
// narration, mirroring the precedence ChapterLandingScreen's "Change"
// selector already used inline: an explicit user choice always wins;
// otherwise fall back to the first of this user's own recordings of that
// chapter. Shared (rather than duplicated) so PracticeModals' real-audio
// Listen mode and ChapterLandingScreen's audio card can never quietly
// disagree about which recording is "the" audio for a chapter.
export function resolveChapterAudio(
  userRecordings: Recording[],
  selectedChapterAudios: Record<string, Recording | null>,
  book: string,
  chapter: number
): Recording | null {
  const key = `${book}_${chapter}`;
  const assigned = selectedChapterAudios[key];
  if (assigned) return assigned;
  return userRecordings.find((r) => r.book.toLowerCase() === book.toLowerCase() && r.chapter === chapter) || null;
}

// Shared QueueItem -> VerseState mapper for launching a practice session --
// mirrors the same shape HomeScreen/PracticeModals already build inline, but
// startReviewSession needs its own copy (below) since it isn't a React
// component and can't reach a screen-local helper.
export function mapQueueItemsToVerseStates(items: QueueItem[]): VerseState[] {
  return items.map((item) => ({
    book: item.book,
    chapter: item.chapter,
    verse: item.verseNumber,
    text: item.text,
    status: item.status === 'retained' ? 'memorized' : 'learning',
  }));
}

/**
 * Centralizes every piece of state and business-logic handler from the original
 * web app's single-file App component. Screens receive the return value of this
 * hook as a single `state` prop and destructure whatever they need from it, mirroring
 * the original app's single-closure architecture so porting each screen's JSX carries
 * minimal behavioral risk.
 */
export function useAppState() {
  // ==========================================
  // CORE APP STATES
  // ==========================================
  const [verses, setVerses] = useState<VerseState[]>(INITIAL_VERSES);
  const [memoryQueue, setMemoryQueue] = useState<QueueItem[]>(() => generateInitialQueue(INITIAL_VERSES));
  const [primingLookahead, setPrimingLookahead] = useState<number>(30);
  const [cognitiveLoadSensitivity, setCognitiveLoadSensitivity] = useState<'low' | 'medium' | 'high'>('medium');

  // Memory queue interactive adder states
  const [showAddQueueItemModal, setShowAddQueueItemModal] = useState(false);
  const [selectedAddBook, setSelectedAddBook] = useState('Romans');
  const [selectedAddChapter, setSelectedAddChapter] = useState(8);
  const [selectedAddVerse, setSelectedAddVerse] = useState(11);
  const [selectedAddEndVerse, setSelectedAddEndVerse] = useState(11);
  const [selectedAddOrigin, setSelectedAddOrigin] = useState<'individual' | 'group'>('individual');

  // Firebase Auth & Sync states
  const [user, setUser] = useState<any>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [currentTab, setCurrentTab] = useState<TabName>('home');
  const [currentScreen, setCurrentScreen] = useState<ScreenName>('home');

  // Navigation stack helpers
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  // Which translation's text ChapterLandingScreen's verse picker shows and
  // adds to the queue -- a session-level browsing choice (persists across
  // book/chapter navigation, resets on app restart), not a per-verse or
  // per-plan setting.
  const [selectedTranslationId, setSelectedTranslationId] = useState<string>(DEFAULT_TRANSLATION_ID);
  const [backHistory, setBackHistory] = useState<
    Array<{ screen: ScreenName; book: string | null; chapter: number | null }>
  >([]);

  // Selection state for Chapter Landing
  const [selectedVerseNumbers, setSelectedVerseNumbers] = useState<number[]>([]);
  const [chapterViewMode, setChapterViewMode] = useState<'list' | 'grid' | 'memoryGrid'>('list');

  // Memory Grid highlights -- user-chosen "meaningful anchor" verses (starts
  // blank, no auto-coloring pattern). Device-local for now (AsyncStorage, not
  // synced to Firestore) -- same scope as the Recall practice preferences.
  // Keyed by verseAnnotationKey (book_chapter_verse) so the Chapter page,
  // Listen mode, and Recall all read/write the same set.
  const [highlightedVerses, setHighlightedVerses] = useState<Set<string>>(new Set());
  const HIGHLIGHTED_VERSES_KEY = 'memoryGrid:highlightedVerses:v1';
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(HIGHLIGHTED_VERSES_KEY);
        if (raw) setHighlightedVerses(new Set(JSON.parse(raw)));
      } catch {
        // Corrupt/missing -- just start blank.
      }
    })();
  }, []);
  const toggleVerseHighlight = (key: string) => {
    setHighlightedVerses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      AsyncStorage.setItem(HIGHLIGHTED_VERSES_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  };

  // Memory Grid doodles -- backbone feature (single-pen freehand strokes per
  // verse box), same device-local storage scope as highlights above. Each
  // value is an array of SVG path "d" strings for that verse.
  const [verseDoodles, setVerseDoodles] = useState<Record<string, string[]>>({});
  const VERSE_DOODLES_KEY = 'memoryGrid:doodles:v1';
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(VERSE_DOODLES_KEY);
        if (raw) setVerseDoodles(JSON.parse(raw));
      } catch {
        // Corrupt/missing -- just start blank.
      }
    })();
  }, []);
  const saveVerseDoodle = (key: string, strokes: string[]) => {
    setVerseDoodles((prev) => {
      const next = { ...prev, [key]: strokes };
      AsyncStorage.setItem(VERSE_DOODLES_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  // Memory Grid column count -- 2 or 4 (never odd, so boxes tile evenly on a
  // phone width), one shared preference across Chapter page / Listen / Recall.
  const [memoryGridColumns, setMemoryGridColumnsState] = useState<2 | 4>(4);
  const MEMORY_GRID_COLUMNS_KEY = 'memoryGrid:columns:v1';
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(MEMORY_GRID_COLUMNS_KEY);
        if (raw === '2' || raw === '4') setMemoryGridColumnsState(Number(raw) as 2 | 4);
      } catch {
        // Corrupt/missing -- just start at the default.
      }
    })();
  }, []);
  const setMemoryGridColumns = (columns: 2 | 4) => {
    setMemoryGridColumnsState(columns);
    AsyncStorage.setItem(MEMORY_GRID_COLUMNS_KEY, String(columns)).catch(() => {});
  };

  // Whether RecordingDetailScreen's verse-sync timeline is in edit mode.
  // The draft marker positions themselves live as local component state in
  // that screen (derived fresh from selectedRecording.verseTimestamps each
  // time it's opened) rather than here, since they're pure editing-session
  // scratch state with no reason to survive a navigation away and back.
  const [isEditingSync, setIsEditingSync] = useState<boolean>(false);

  // Memory Plan Designer States
  const [preset, setPreset] = useState<'drip' | 'warrior' | 'custom'>('custom');
  const [learningDays, setLearningDays] = useState<string[]>(['M', 'W', 'F']);
  const [newVersesPace, setNewVersesPace] = useState<number>(3);
  const [maxReviewCap, setMaxReviewCap] = useState<number>(15);
  // Retention rigor: how long a verse stays in each review phase before
  // graduating (default 7-6-5 == today's previously-hardcoded behavior).
  const [retentionRigor, setRetentionRigor] = useState<'light' | 'standard' | 'deep' | 'custom'>('standard');
  const [dailyPhaseWeeks, setDailyPhaseWeeks] = useState<number>(7);
  const [weeklyPhaseMonths, setWeeklyPhaseMonths] = useState<number>(6);
  const [monthlyPhaseYears, setMonthlyPhaseYears] = useState<number>(5);

  // Practice Overlays
  const [activeModal, setActiveModal] = useState<'listen' | 'learn' | null>(null);
  const [modalVerses, setModalVerses] = useState<VerseState[]>([]);

  // Real, measured cumulative practice time (Dashboard's "Time Studied"),
  // in seconds. Tracked via the activeModal effect below, not an estimate.
  const [totalStudySeconds, setTotalStudySeconds] = useState<number>(0);
  const studySessionStartRef = useRef<number | null>(null);

  // Chained review session ("Review All Due") -- groups still to come after
  // the one currently showing in the overlay above. A ref (not state) since
  // it's only ever read/written by the session functions below, never
  // rendered directly; reviewSessionPosition/Total ARE state because
  // PracticeModals shows them as a "2 of 5" progress badge.
  const reviewQueueRef = useRef<QueueItem[][]>([]);
  const [reviewSessionPosition, setReviewSessionPosition] = useState(0);
  const [reviewSessionTotal, setReviewSessionTotal] = useState(0);

  // Teleprompter / Recording State (fully simulated — no real microphone capture in the web original)
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  // Snapshot of recordingSeconds taken the instant recording stops — the Save
  // Recitation dialog reads this (not recordingSeconds directly), since the
  // recording timer effect zeroes recordingSeconds out as soon as isRecording
  // flips false, well before the dialog is dismissed.
  const [lastRecordingDuration, setLastRecordingDuration] = useState(0);
  // Tap-to-mark verse timestamps (Option 1 of timestamp automation): verse
  // number -> audioRecorder.currentTime at the moment the user tapped that
  // verse in the teleprompter. Reset on every new recording, seeded with the
  // chapter's first verse at t=0 so the user only needs to tap starting from
  // the second verse onward.
  const [verseTapTimestamps, setVerseTapTimestamps] = useState<Record<number, number>>({});
  const [recordingBook, setRecordingBook] = useState('Romans');
  const [recordingChapter, setRecordingChapter] = useState(8);
  const [recordingTranslation, setRecordingTranslation] = useState('ESV');
  const [userRecordings, setUserRecordings] = useState<Recording[]>(INITIAL_RECORDINGS);

  // Import-audio tagging: the reverse of live recording. Instead of tapping
  // each verse while the mic records, the user picks an existing audio file
  // and taps each verse while LISTENING BACK to it. Reuses the exact same
  // teleprompter + buildVerseTimestamps mechanism as live recording — only
  // the time source differs (playback position instead of recorder position).
  const [importedAudioUri, setImportedAudioUri] = useState<string | null>(null);
  const [importedAudioName, setImportedAudioName] = useState<string | null>(null);
  // Deliberately NOT seeded with verse 1 at t=0 the way live recording is:
  // a live recording's t=0 IS the moment the user hit Start, but an imported
  // file may have lead-in silence or an intro before verse 1 actually
  // begins, so verse 1 needs its own real tap like every other verse.
  const [importTapTimestamps, setImportTapTimestamps] = useState<Record<number, number>>({});
  // Which flow the open Save dialog belongs to — set right before opening
  // it, read by saveRecordedAudio to route to the matching persist path and
  // by App.tsx's dialog to label the "Scope" row correctly.
  const [pendingRecordingSource, setPendingRecordingSource] = useState<'live' | 'import'>('live');

  const [saveRecordingDialog, setSaveRecordingDialog] = useState(false);
  // Per-recording visibility choice for the Save dialog. Pre-filled from
  // profiles/{uid}.defaultRecordingVisibility (whatever the user picked the
  // very first time they saved a recording); null means "no default yet,"
  // in which case the dialog defaults its picker to 'private' but does not
  // treat that as an already-set preference.
  const [defaultRecordingVisibility, setDefaultRecordingVisibility] = useState<
    'private' | 'circle' | 'public' | null
  >(null);
  const [pickedRecordingVisibility, setPickedRecordingVisibility] = useState<'private' | 'circle' | 'public'>(
    'private'
  );
  const [typedRecordingName, setTypedRecordingName] = useState('');

  // First-run "Getting Started" checklist overlay -- shown automatically
  // whenever the loaded/created profile's onboardingCompleted field isn't
  // true (loadUserData sets this), and re-openable anytime from Settings.
  const [showOnboarding, setShowOnboarding] = useState(false);
  // Which step (0-3) the user is currently OUT doing in the real app, if
  // any -- non-null means the checklist overlay is hidden, the bottom tab
  // bar is replaced with a single "Back to Guide" bar (App.tsx), and a
  // per-step instruction banner is shown, so a user mid-step can't wander
  // off into unrelated parts of the app and get lost. Set by
  // startOnboardingStep, cleared by returnToOnboardingGuide.
  const [onboardingStepInProgress, setOnboardingStepInProgress] = useState<number | null>(null);
  // Step 1 ("Your Memory Plan") is purely informational -- there's no real
  // state to derive completion from the way the other 3 steps have real
  // queue/touch/circle data. Session-local (not persisted): true once the
  // user has actually stepped into it once via startOnboardingStep.
  const [onboardingStep1Acknowledged, setOnboardingStep1Acknowledged] = useState(false);
  // Guards the completion-nudge toast (below) from firing more than once
  // per step per session.
  const onboardingNudgedStepsRef = useRef<Set<number>>(new Set());

  // Real shared-recordings feed (guest/signed-out preview still falls back
  // to the illustrative SUGGESTED_FEED_RECORDINGS, same "try before sign up"
  // pattern as INITIAL_VERSES/INITIAL_RECORDINGS).
  const [feedRecordings, setFeedRecordings] = useState<Recording[]>(SUGGESTED_FEED_RECORDINGS);
  const [loadingFeedRecordings, setLoadingFeedRecordings] = useState(false);
  const [audioSearchQuery, setAudioSearchQuery] = useState('');
  const [activeFeedFilter, setActiveFeedFilter] = useState<'global' | 'group' | 'friends'>('global');
  const [feedBookFilter, setFeedBookFilter] = useState<string>('');
  const [feedChapterFilter, setFeedChapterFilter] = useState<string>('');

  // Audio Selection mapping for specific chapters — which real recording
  // (from userRecordings) is chosen as the narration for a given chapter.
  // Playback itself uses the same playingRecordingId/playingRecProgress
  // mechanism as everywhere else in the app (Profile, RecordingDetail, the
  // floating now-playing bar), not a separate simulation.
  const [selectedChapterAudios, setSelectedChapterAudios] = useState<Record<string, Recording | null>>({});
  const [showAudioSelector, setShowAudioSelector] = useState(false);

  // General App Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 3-Touch Mastery & Study Plan States
  const [masteryTouches, setMasteryTouches] = useState<number>(3);
  const [reviewsRequired, setReviewsRequired] = useState<number>(1);
  // Sabbath: an optional single weekday, off by default, free from both
  // learning and reviewing -- the engine treats it as not existing at all.
  const [sabbathEnabled, setSabbathEnabled] = useState<boolean>(false);
  const [sabbathDay, setSabbathDay] = useState<string>('Su');
  // See MemoryPlan.dayStartHour in types.ts -- 0/1/2, defaults to real midnight.
  const [dayStartHour, setDayStartHour] = useState<number>(0);
  // Every StudyPlan this member has joined (possibly more than one, each with
  // its own priority setting -- see src/lib/studyPlanScheduler.ts) plus the
  // resolved StudyPlan docs themselves (versesPerWeek, verseIds, etc.), kept
  // in sync so the scheduler always has real, current data to work from.
  const [joinedStudyPlanMemberships, setJoinedStudyPlanMemberships] = useState<StudyPlanMembership[]>([]);
  const [joinedStudyPlanDetails, setJoinedStudyPlanDetails] = useState<StudyPlan[]>([]);
  const [viewingStudyPlan, setViewingStudyPlan] = useState<StudyPlan | null>(null);
  const [viewingGroupDetail, setViewingGroupDetail] = useState<boolean>(false);

  // Scripture Circles (real Firestore-backed community groups — see circles/{id}
  // in firestore.rules). myCircles/publicCircles/activeCircle* replace the old
  // local-only joinedGroups/groupMembersMap/groupAnnouncements/groupPlansList mocks.
  const [myCircles, setMyCircles] = useState<Circle[]>([]);
  const [loadingMyCircles, setLoadingMyCircles] = useState(false);
  const [publicCircles, setPublicCircles] = useState<Circle[]>([]);
  const [loadingPublicCircles, setLoadingPublicCircles] = useState(false);

  const [activeCircle, setActiveCircle] = useState<Circle | null>(null);
  const [activeCircleMembers, setActiveCircleMembers] = useState<CircleMember[]>([]);
  const [activeCircleStudyPlans, setActiveCircleStudyPlans] = useState<StudyPlan[]>([]);
  const [loadingActiveCircle, setLoadingActiveCircle] = useState(false);

  // "Friends" = real co-members across every circle the user belongs to
  // (deduped, self excluded) — there's no separate friend-request system.
  const [circleFriends, setCircleFriends] = useState<CircleMember[]>([]);

  // Real memorization-milestone activity feed (Community) — events from the
  // signed-in user and their real circleFriends.
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [loadingActivityEvents, setLoadingActivityEvents] = useState(false);

  // Real friends — a mutual, persistent connection independent of circle
  // membership, replacing "Friends" being just live circle co-membership.
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<FriendRequest[]>([]);
  const [outgoingFriendRequests, setOutgoingFriendRequests] = useState<FriendRequest[]>([]);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<
    Array<{ uid: string; displayName: string; avatarUrl: string; email: string }>
  >([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const userSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Accountability nudges -- see AccountabilityNudge in types.ts. Own daily
  // received cap defaults to ACCOUNTABILITY_DEFAULT_DAILY_CAP until loaded
  // from profiles/{uid}.accountabilityDailyCap in loadUserData.
  const [accountabilityDailyCap, setAccountabilityDailyCapState] = useState<number>(ACCOUNTABILITY_DEFAULT_DAILY_CAP);
  // My own private "when did I last nudge this friend" log -- keyed by friendUid.
  const [accountabilitySentLog, setAccountabilitySentLog] = useState<Record<string, string>>({});
  const [receivedAccountabilityNudges, setReceivedAccountabilityNudges] = useState<AccountabilityNudge[]>([]);
  const [loadingAccountabilityNudges, setLoadingAccountabilityNudges] = useState(false);

  // Messaging: DM inbox (dmThreads) + whichever thread/circle chat is
  // currently open. Both message lists are live (onSnapshot), unlike the
  // rest of this app's one-shot getDocs loads -- chat is the one place a
  // stale view actually matters.
  const [dmThreads, setDmThreads] = useState<DMThread[]>([]);
  const [loadingDmThreads, setLoadingDmThreads] = useState(false);
  const [activeDMThread, setActiveDMThread] = useState<DMThread | null>(null);
  const [activeDMMessages, setActiveDMMessages] = useState<ChatMessage[]>([]);
  const [loadingActiveDMMessages, setLoadingActiveDMMessages] = useState(false);
  const [activeCircleChatId, setActiveCircleChatId] = useState<string | null>(null);
  const [activeCircleMessages, setActiveCircleMessages] = useState<ChatMessage[]>([]);
  const [loadingActiveCircleMessages, setLoadingActiveCircleMessages] = useState(false);

  // Selected Recording for Chapter Recording Landing Page
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);

  // Community Sub-views and Custom Search/Join state
  const [communitySubView, setCommunitySubView] = useState<'home' | 'find' | 'create'>('home');
  const [activeGroupId, setActiveGroupId] = useState<string>('');

  const [isEditingCircleSettings, setIsEditingCircleSettings] = useState<boolean>(false);
  // Study Plan creation only asks for a title + description -- pacing and
  // the verse queue itself are set/built from the plan's own landing page
  // (StudyPlanDetailScreen), using local ephemeral form state there instead
  // of more global fields here.
  const [showCreatePlanForm, setShowCreatePlanForm] = useState<boolean>(false);
  const [newPlanName, setNewPlanName] = useState<string>('');
  const [newPlanDesc, setNewPlanDesc] = useState<string>('');

  // Community Search, Filters & Creation inputs
  const [findSearchQuery, setFindSearchQuery] = useState<string>('');
  const [inviteCodeInput, setInviteCodeInput] = useState<string>('');

  const [createGroupName, setCreateGroupName] = useState<string>('');
  const [createGroupDesc, setCreateGroupDesc] = useState<string>('');
  const [createGroupPrivacy, setCreateGroupPrivacy] = useState<'public' | 'private'>('public');

  // Dashboard Metrics popover / progress modal helper
  const [showProgressModal, setShowProgressModal] = useState(false);

  // Active playing of saved rec
  const [playingRecordingId, setPlayingRecordingId] = useState<string | null>(null);
  const [playingRecProgress, setPlayingRecProgress] = useState(0);
  // Set by seekRecordingToTime when asked to jump to a segment of a recording
  // that wasn't already playing — consumed once playback actually starts.
  const pendingSeekSecondsRef = useRef<number | null>(null);

  // Real audio recorder (mic capture) for the Record tab.
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // Captured the instant recording stops — audioRecorder.currentTime resets
  // once stop() resolves, and recordingSeconds gets zeroed by the recording
  // timer effect (below) well before the user taps "Confirm & Save" in the
  // dialog, so neither is safe to read directly inside saveRecordedAudio.
  const capturedDurationRef = useRef(0);

  // Real audio player for saved recordings that have a Storage-backed audioUrl.
  // Recordings without one (e.g. the illustrative community feed placeholders)
  // fall back to the simulated progress timer below.
  const nowPlayingRecording = [...userRecordings, ...feedRecordings].find((r) => r.id === playingRecordingId) || null;
  const recordingPlayer = useAudioPlayer(nowPlayingRecording?.audioUrl ?? undefined);
  const recordingPlayerStatus = useAudioPlayerStatus(recordingPlayer);

  // Separate player for the import-audio tagging flow above — kept distinct
  // from recordingPlayer (which is reserved for "now playing a saved
  // Recording" everywhere else in the app: Profile, RecordingDetail, the
  // floating now-playing bar) so tagging playback can't collide with those.
  const importPlayer = useAudioPlayer(importedAudioUri ?? undefined);
  const importPlayerStatus = useAudioPlayerStatus(importPlayer);

  // Memory Queue auto-sync bookkeeping (debounce timer + last-synced verseIds, for deletion diffing)
  const queueSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSyncedQueueIdsRef = useRef<Set<string>>(new Set());
  // Guards the auto-sync until this user's real queue has been loaded from
  // Firestore. Without it, the sign-in/account-switch transition (which
  // clears memoryQueue synchronously) could commit an empty/stale queue —
  // including deletions — into the NEW account before loadUserData finishes.
  const queueHydratedRef = useRef(false);

  // Profile public-stats auto-sync debounce timer (memorizedCount/learningCount)
  const profileStatsSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // View Interactive Other Profiles
  const [selectedUserProfile, setSelectedUserProfile] = useState<any | null>(null);

  // Shared Community Plans States
  const [sharedPlans, setSharedPlans] = useState<any[]>([]);
  const [loadingSharedPlans, setLoadingSharedPlans] = useState(false);
  const [customPlanName, setCustomPlanName] = useState('My Custom Plan');
  const [shareWithCommunity, setShareWithCommunity] = useState(false);

  // Multi-Plan States
  const [savedPlans, setSavedPlans] = useState<MemoryPlan[]>(DEFAULT_PLANS);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);

  // ==========================================
  // MEMORY QUEUE — SYNCHRONOUS MIRROR
  // ==========================================
  // React state reads inside an async handler see the render-time snapshot,
  // not updates made moments earlier in the same interaction. That silently
  // lost progress when several verses finished practice together: each
  // handleReviewCompleted call rebuilt the queue from the same stale
  // snapshot, so only the last verse's update survived. This ref is always
  // current; every queue *mutation* below goes through updateMemoryQueue so
  // sequential updates compose instead of clobbering each other.
  const memoryQueueRef = useRef(memoryQueue);
  useEffect(() => {
    memoryQueueRef.current = memoryQueue;
  }, [memoryQueue]);

  const updateMemoryQueue = (updater: (prev: QueueItem[]) => QueueItem[]) => {
    memoryQueueRef.current = updater(memoryQueueRef.current);
    setMemoryQueue(memoryQueueRef.current);
  };

  // ==========================================
  // PLAN <-> DESIGNER STATE SYNC HELPERS
  // ==========================================
  // Single source of truth for "load a plan's settings into the live
  // designer state" and "flatten a plan into the memoryPlans/{uid} doc's
  // top-level fields". Previously this was six hand-copied 14-setter
  // blocks, several of which had drifted out of sync (navigateTo('activePlan')
  // only synced 5 of the 14 fields; handleSavePlan's Firestore write dropped
  // the rigor/mastery/sabbath fields entirely).
  const syncDesignerFromPlan = (plan: MemoryPlan) => {
    setPreset(plan.preset);
    setLearningDays(plan.learningDays);
    setNewVersesPace(plan.newVersesPace);
    setMaxReviewCap(plan.maxReviewCap);
    setRetentionRigor(plan.retentionRigor || 'standard');
    setDailyPhaseWeeks(plan.dailyPhaseWeeks ?? 7);
    setWeeklyPhaseMonths(plan.weeklyPhaseMonths ?? 6);
    setMonthlyPhaseYears(plan.monthlyPhaseYears ?? 5);
    setMasteryTouches(plan.masteryTouches ?? 3);
    setReviewsRequired(plan.reviewsRequired ?? 1);
    setSabbathEnabled(plan.sabbathEnabled ?? false);
    setSabbathDay(plan.sabbathDay || 'Su');
    setDayStartHour(plan.dayStartHour ?? 0);
    setCognitiveLoadSensitivity(plan.cognitiveLoadSensitivity || 'medium');
    setCustomPlanName(plan.name);
  };

  const planTopLevelFields = (plan: MemoryPlan) => ({
    preset: plan.preset,
    learningDays: plan.learningDays,
    newVersesPace: plan.newVersesPace,
    maxReviewCap: plan.maxReviewCap,
    retentionRigor: plan.retentionRigor,
    dailyPhaseWeeks: plan.dailyPhaseWeeks,
    weeklyPhaseMonths: plan.weeklyPhaseMonths,
    monthlyPhaseYears: plan.monthlyPhaseYears,
    masteryTouches: plan.masteryTouches,
    reviewsRequired: plan.reviewsRequired,
    sabbathEnabled: plan.sabbathEnabled,
    sabbathDay: plan.sabbathDay,
    dayStartHour: plan.dayStartHour,
    cognitiveLoadSensitivity: plan.cognitiveLoadSensitivity,
    name: plan.name,
  });

  // ==========================================
  // NAVIGATION HANDLERS
  // ==========================================
  const navigateTo = (screen: ScreenName, book: string | null = null, chapter: number | null = null) => {
    // Record history for seamless back navigation
    setBackHistory((prev) => [...prev, { screen: currentScreen, book: selectedBook, chapter: selectedChapter }]);

    if (book) setSelectedBook(book);
    if (chapter) setSelectedChapter(chapter);

    if (HOME_TAB_SCREENS.includes(screen) && currentTab !== 'home') {
      setCurrentTab('home');
    }

    if (screen === 'activePlan') {
      const active = savedPlans.find((p) => p.isActive) || savedPlans[0];
      if (active) {
        setEditingPlanId(active.id);
        syncDesignerFromPlan(active);
      }
    }

    setCurrentScreen(screen);
    // Reset selections on screen change
    setSelectedVerseNumbers([]);
  };

  const handleBack = () => {
    if (backHistory.length > 0) {
      const prev = backHistory[backHistory.length - 1];
      setBackHistory((history) => history.slice(0, history.length - 1));

      setSelectedBook(prev.book);
      setSelectedChapter(prev.chapter);
      setCurrentScreen(prev.screen);
    } else {
      // Default fallback
      setCurrentScreen('home');
    }
    setSelectedVerseNumbers([]);
  };

  // Tab controller
  const selectTab = (tab: TabName) => {
    setCurrentTab(tab);
    // Recording playback (playingRecordingId) is intentionally left running
    // across tab switches — that's the whole point of the floating
    // now-playing bar.

    if (
      currentScreen === 'memberProfile' ||
      currentScreen === 'studyPlanDetail' ||
      currentScreen === 'fullHistory' ||
      currentScreen === 'dashboard' ||
      currentScreen === 'settings' ||
      currentScreen === 'recordingDetail' ||
      currentScreen === 'messages' ||
      currentScreen === 'dmThread' ||
      currentScreen === 'circleChat'
    ) {
      setCurrentScreen('home');
      setBackHistory([]);
    }

    if (tab === 'home') {
      setCurrentScreen('home');
      setBackHistory([]);
    }
  };

  // ==========================================
  // TOAST HELPER
  // ==========================================
  // Tracks the active hide-timer so showing a new toast cancels the old
  // one's timer — otherwise an earlier toast's 3s timeout would hide a
  // newer message early (very visible during multi-verse practice, where
  // several toasts fire back-to-back).
  const triggerToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 3000);
  };

  // ==========================================
  // SCRIPTURE CIRCLES (real Firestore community groups)
  // ==========================================
  const generateInviteCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

  // generateInviteCode() alone had no collision check -- two circles could
  // theoretically land on the same code. Retries against a real Firestore
  // uniqueness query (the same one joinCircleByCode already runs) before
  // accepting one; if genuinely unlucky enough to collide every attempt,
  // appends a timestamp fragment rather than ever failing circle creation.
  const generateUniqueInviteCode = async (): Promise<string> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateInviteCode();
      const q = query(collection(db, 'circles'), where('inviteCode', '==', code));
      const snap = await getDocs(q);
      if (snap.empty) return code;
    }
    return `${generateInviteCode()}${Date.now().toString(36).slice(-4).toUpperCase()}`;
  };

  const loadMyCircles = async () => {
    if (!auth.currentUser) {
      setMyCircles([]);
      return;
    }
    const uid = auth.currentUser.uid;
    setLoadingMyCircles(true);
    try {
      const profileSnap = await getDoc(doc(db, 'profiles', uid));
      const circleIds: string[] = profileSnap.exists() ? profileSnap.data().circleIds || [] : [];

      const results = await Promise.all(
        circleIds.map(async (id) => {
          const [circleSnap, memberSnap] = await Promise.all([
            getDoc(doc(db, 'circles', id)),
            getDoc(doc(db, 'circles', id, 'members', uid)),
          ]);
          // Self-heal: a circle may have been disbanded, or this user kicked
          // from it, since circleIds was last written — neither of those can
          // update this user's OTHER-side data (disbanding can't touch every
          // member's profile; kicking can't either), so prune stale ids here.
          if (!circleSnap.exists() || !memberSnap.exists()) return null;
          return { id: circleSnap.id, ...circleSnap.data() } as Circle;
        })
      );

      const staleIds = circleIds.filter((id, idx) => results[idx] === null);
      if (staleIds.length > 0) {
        updateDoc(doc(db, 'profiles', uid), { circleIds: arrayRemove(...staleIds) }).catch((err) =>
          console.error('Failed to prune stale circleIds:', err)
        );
      }

      const validCircles = results.filter((c): c is Circle => c !== null);
      setMyCircles(validCircles);
      loadCircleFriends(validCircles);
    } catch (err) {
      console.error('Failed to load my circles:', err);
    } finally {
      setLoadingMyCircles(false);
    }
  };

  // Gathers real co-members across every circle in myCircles (deduped, self
  // excluded) for ProfileScreen's "Friends" section. Call after myCircles is
  // populated/changes — e.g. right after loadMyCircles(), or on-demand from a
  // screen if circle membership might have changed since the last load.
  const loadCircleFriends = async (circles: Circle[]) => {
    if (circles.length === 0) {
      setCircleFriends([]);
      return;
    }
    try {
      const results = await Promise.all(circles.map((c) => getDocs(collection(db, 'circles', c.id, 'members'))));
      const byUid = new Map<string, CircleMember>();
      results.forEach((snap) => {
        snap.docs.forEach((d) => {
          const m = d.data() as CircleMember;
          if (m.uid !== auth.currentUser?.uid) byUid.set(m.uid, m);
        });
      });
      setCircleFriends(Array.from(byUid.values()));
    } catch (err) {
      console.error('Failed to load circle friends:', err);
    }
  };

  // Real activity feed: events from the signed-in user and their real
  // circleFriends. Re-run this (not just rely on the reactive effect below)
  // after actions that might change circleFriends but wouldn't otherwise
  // trigger it quickly enough, e.g. a manual refresh button.
  const loadActivityFeed = async () => {
    if (!auth.currentUser) {
      setActivityEvents([]);
      return;
    }
    const uids = Array.from(
      new Set([auth.currentUser.uid, ...circleFriends.map((f) => f.uid), ...friends.map((f) => f.uid)])
    ).slice(0, 30);
    setLoadingActivityEvents(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'activityEvents'), where('uid', 'in', uids), orderBy('createdAt', 'desc'), limit(20))
      );
      const events: ActivityEvent[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          uid: data.uid,
          authorName: data.authorName,
          book: data.book,
          chapter: data.chapter,
          type: data.type,
          verse: data.verse,
          verseCount: data.verseCount,
          createdAtMs: data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now(),
        };
      });
      setActivityEvents(events);
    } catch (err) {
      console.error('Failed to load activity feed:', err);
    } finally {
      setLoadingActivityEvents(false);
    }
  };

  // Real Community audio feed: every 'public' sharedRecordings doc, plus
  // every 'circle' one whose snapshot sharedWithUids includes the signed-in
  // user (see firestore.rules for why that's a snapshot, not a live check).
  // Signed-out/guest keeps the illustrative SUGGESTED_FEED_RECORDINGS.
  const loadSharedRecordings = async () => {
    if (!auth.currentUser) {
      setFeedRecordings(SUGGESTED_FEED_RECORDINGS);
      return;
    }
    setLoadingFeedRecordings(true);
    try {
      const uid = auth.currentUser.uid;
      const [publicSnap, circleSnap] = await Promise.all([
        getDocs(query(collection(db, 'sharedRecordings'), where('visibility', '==', 'public'), orderBy('createdAt', 'desc'), limit(30))),
        getDocs(
          query(
            collection(db, 'sharedRecordings'),
            where('sharedWithUids', 'array-contains', uid),
            orderBy('createdAt', 'desc'),
            limit(30)
          )
        ),
      ]);
      const byId = new Map<string, Recording>();
      [...publicSnap.docs, ...circleSnap.docs].forEach((d) => {
        byId.set(d.id, { id: d.id, ...d.data() } as Recording);
      });
      setFeedRecordings(Array.from(byId.values()));
    } catch (err) {
      console.error('Failed to load shared recordings feed:', err);
    } finally {
      setLoadingFeedRecordings(false);
    }
  };

  // ==========================================
  // REAL FRIENDS SYSTEM — search, requests, accept/decline, unfriend.
  // Independent of circles: a friendship is mutual and persists even if you
  // never share a circle again (unlike circleFriends, live-recomputed
  // co-membership).
  // ==========================================
  const loadFriends = async () => {
    if (!auth.currentUser) {
      setFriends([]);
      return;
    }
    setLoadingFriends(true);
    try {
      const snap = await getDocs(collection(db, 'profiles', auth.currentUser.uid, 'friends'));
      setFriends(snap.docs.map((d) => d.data() as Friend));
    } catch (err) {
      console.error('Failed to load friends:', err);
    } finally {
      setLoadingFriends(false);
    }
  };

  const loadFriendRequests = async () => {
    if (!auth.currentUser) {
      setIncomingFriendRequests([]);
      setOutgoingFriendRequests([]);
      return;
    }
    const uid = auth.currentUser.uid;
    try {
      const [incomingSnap, outgoingSnap] = await Promise.all([
        getDocs(query(collection(db, 'friendRequests'), where('toUid', '==', uid), where('status', '==', 'pending'))),
        getDocs(query(collection(db, 'friendRequests'), where('fromUid', '==', uid), where('status', '==', 'pending'))),
      ]);
      setIncomingFriendRequests(incomingSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as FriendRequest));
      setOutgoingFriendRequests(outgoingSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as FriendRequest));
    } catch (err) {
      console.error('Failed to load friend requests:', err);
    }
  };

  // No backend/search service in this project, so this is the standard
  // Firestore-only approach: exact match on email, or a prefix range-query
  // on the lowercased name (see displayNameLower in loadUserData).
  const searchUsers = async (rawQuery: string) => {
    const q = rawQuery.trim();
    if (!q || !auth.currentUser) {
      setUserSearchResults([]);
      return;
    }
    setSearchingUsers(true);
    try {
      let snap;
      if (q.includes('@')) {
        snap = await getDocs(query(collection(db, 'profiles'), where('email', '==', q.toLowerCase()), limit(10)));
      } else {
        const lower = q.toLowerCase();
        snap = await getDocs(
          query(
            collection(db, 'profiles'),
            orderBy('displayNameLower'),
            where('displayNameLower', '>=', lower),
            where('displayNameLower', '<', lower + '\uf8ff'),
            limit(10)
          )
        );
      }
      const results = snap.docs
        .filter((d) => d.id !== auth.currentUser?.uid)
        .map((d) => {
          const data = d.data();
          return {
            uid: d.id,
            displayName: data.displayName || 'Anonymous Disciple',
            avatarUrl: data.avatarUrl || '',
            email: data.email || '',
          };
        });
      setUserSearchResults(results);
    } catch (err) {
      console.error('Failed to search users:', err);
      triggerToast('Search failed — please try again.');
    } finally {
      setSearchingUsers(false);
    }
  };

  // Live "as you type" friend search, debounced so it does not fire a
  // Firestore query on every keystroke. searchUsers itself already does a
  // prefix match on displayNameLower, so this just makes results appear
  // while typing instead of requiring Enter or the Search button.
  useEffect(() => {
    if (userSearchDebounceRef.current) clearTimeout(userSearchDebounceRef.current);
    if (!userSearchQuery.trim()) {
      setUserSearchResults([]);
      return;
    }
    userSearchDebounceRef.current = setTimeout(() => {
      searchUsers(userSearchQuery);
    }, 300);
    return () => {
      if (userSearchDebounceRef.current) clearTimeout(userSearchDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSearchQuery]);

  // Deterministic doc id (not auto-generated) so re-sending a request to the
  // same person is idempotent rather than creating duplicates.
  const sendFriendRequest = async (toUid: string, toName: string) => {
    if (!auth.currentUser || auth.currentUser.uid === toUid) return;
    const fromUid = auth.currentUser.uid;
    const requestId = `${fromUid}_${toUid}`;
    try {
      await setDoc(doc(db, 'friendRequests', requestId), {
        fromUid,
        fromName: auth.currentUser.displayName || 'Anonymous Disciple',
        toUid,
        toName,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      triggerToast(`Friend request sent to ${toName}! 🤝`);
      loadFriendRequests();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `friendRequests/${requestId}`);
    }
  };

  const acceptFriendRequest = async (request: FriendRequest) => {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'friendRequests', request.id), { status: 'accepted' });
      const friendsSince = new Date().toISOString();
      batch.set(doc(db, 'profiles', myUid, 'friends', request.fromUid), {
        uid: request.fromUid,
        displayName: request.fromName,
        avatarUrl: '',
        friendsSince,
      });
      batch.set(doc(db, 'profiles', request.fromUid, 'friends', myUid), {
        uid: myUid,
        displayName: auth.currentUser.displayName || 'Anonymous Disciple',
        avatarUrl: '',
        friendsSince,
      });
      await batch.commit();
      triggerToast(`You and ${request.fromName} are now friends! 🎉`);
      loadFriendRequests();
      loadFriends();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `friendRequests/${request.id}`);
    }
  };

  const declineFriendRequest = async (request: FriendRequest) => {
    try {
      await updateDoc(doc(db, 'friendRequests', request.id), { status: 'declined' });
      setIncomingFriendRequests((prev) => prev.filter((r) => r.id !== request.id));
      triggerToast('Request declined.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `friendRequests/${request.id}`);
    }
  };

  const cancelFriendRequest = async (request: FriendRequest) => {
    try {
      await deleteDoc(doc(db, 'friendRequests', request.id));
      setOutgoingFriendRequests((prev) => prev.filter((r) => r.id !== request.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `friendRequests/${request.id}`);
    }
  };

  const removeFriend = async (friend: Friend) => {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'profiles', myUid, 'friends', friend.uid));
      batch.delete(doc(db, 'profiles', friend.uid, 'friends', myUid));
      await batch.commit();
      setFriends((prev) => prev.filter((f) => f.uid !== friend.uid));
      triggerToast(`Removed ${friend.displayName} from friends.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `profiles/${myUid}/friends/${friend.uid}`);
    }
  };

  // ==========================================
  // ACCOUNTABILITY NUDGES -- friend-only, custom-message notification,
  // deliberately separate from any messaging/DM system. Two independent
  // daily limits, both keyed to the current user's dayStartHour setting:
  //   - Sender: at most 1 nudge to a given friend per logical day (hard,
  //     not configurable) -- enforced via canSendAccountabilityNudge below,
  //     which the UI uses to grey out the button before a tap is even
  //     attempted.
  //   - Receiver: a configurable daily cap (any sender combined), checked
  //     at send time against profiles/{toUid}.accountabilityDailyCap and
  //     profiles/{toUid}/accountabilityMeta/counter.
  // No Cloud Functions in this project (see firestore.rules comment on the
  // counter doc) -- this is read-then-write from the sender's client, same
  // "reasonable trust, not airtight" posture as the rest of the app. The
  // counter's day-rollover uses the SENDER's own logical day as a stand-in
  // for the receiver's, a deliberate simplification (the two would only
  // disagree for a few hours around midnight if their dayStartHour settings
  // differ), rather than plumbing the receiver's private setting to the
  // sender's client just for this.
  // ==========================================
  const loadAccountabilitySentLog = async () => {
    if (!auth.currentUser) {
      setAccountabilitySentLog({});
      return;
    }
    try {
      const snap = await getDocs(collection(db, 'profiles', auth.currentUser.uid, 'accountabilitySentLog'));
      const log: Record<string, string> = {};
      snap.docs.forEach((d) => {
        log[d.id] = (d.data().lastSentAt as string) || '';
      });
      setAccountabilitySentLog(log);
    } catch (err) {
      console.error('Failed to load accountability sent log:', err);
    }
  };

  const loadReceivedAccountabilityNudges = async () => {
    if (!auth.currentUser) {
      setReceivedAccountabilityNudges([]);
      return;
    }
    setLoadingAccountabilityNudges(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'accountabilityNudges'), where('toUid', '==', auth.currentUser.uid), orderBy('createdAt', 'desc'), limit(50))
      );
      setReceivedAccountabilityNudges(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AccountabilityNudge));
    } catch (err) {
      console.error('Failed to load accountability nudges:', err);
    } finally {
      setLoadingAccountabilityNudges(false);
    }
  };

  // Pure/cheap -- the UI calls this to decide whether a friend's nudge
  // button is greyed out, without any Firestore round-trip.
  const canSendAccountabilityNudge = (friendUid: string): boolean => {
    const lastSentAt = accountabilitySentLog[friendUid];
    if (!lastSentAt) return true;
    return localDayKey(getLogicalDate(dayStartHour, new Date(lastSentAt))) !== localDayKey(getLogicalDate(dayStartHour));
  };

  const sendAccountabilityNudge = async (friend: Friend, message: string) => {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;
    if (!friends.some((f) => f.uid === friend.uid)) {
      triggerToast('You can only send accountability nudges to friends.');
      return;
    }
    if (!canSendAccountabilityNudge(friend.uid)) {
      triggerToast(`Accountability notification already sent for today -- you can send another tomorrow!`);
      return;
    }
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      triggerToast('Write a quick message before sending.');
      return;
    }
    try {
      const todayKey = localDayKey(getLogicalDate(dayStartHour));
      const counterRef = doc(db, 'profiles', friend.uid, 'accountabilityMeta', 'counter');
      const [counterSnap, friendProfileSnap] = await Promise.all([getDoc(counterRef), getDoc(doc(db, 'profiles', friend.uid))]);
      const cap = (friendProfileSnap.data()?.accountabilityDailyCap as number) ?? ACCOUNTABILITY_DEFAULT_DAILY_CAP;
      const counterData = counterSnap.data() as { dateKey?: string; count?: number } | undefined;
      const isSameDay = counterData?.dateKey === todayKey;
      const countSoFar = isSameDay ? counterData?.count || 0 : 0;

      if (isSameDay && countSoFar >= cap) {
        triggerToast(`${friend.displayName} has reached their daily accountability-notification limit -- try again tomorrow.`);
        return;
      }

      if (isSameDay) {
        await updateDoc(counterRef, { count: increment(1), dateKey: todayKey });
      } else {
        await setDoc(counterRef, { count: 1, dateKey: todayKey });
      }

      const nowISO = new Date().toISOString();
      await addDoc(collection(db, 'accountabilityNudges'), {
        fromUid: myUid,
        fromName: auth.currentUser.displayName || 'Anonymous Disciple',
        fromAvatarUrl: '',
        toUid: friend.uid,
        message: trimmedMessage,
        createdAt: nowISO,
        read: false,
      });
      await setDoc(doc(db, 'profiles', myUid, 'accountabilitySentLog', friend.uid), { lastSentAt: nowISO });

      setAccountabilitySentLog((prev) => ({ ...prev, [friend.uid]: nowISO }));
      triggerToast(`Accountability nudge sent to ${friend.displayName}! 📣`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'accountabilityNudges');
      triggerToast('Could not send that nudge -- please try again.');
    }
  };

  const markAccountabilityNudgeRead = async (nudgeId: string) => {
    setReceivedAccountabilityNudges((prev) => prev.map((n) => (n.id === nudgeId ? { ...n, read: true } : n)));
    try {
      await updateDoc(doc(db, 'accountabilityNudges', nudgeId), { read: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `accountabilityNudges/${nudgeId}`);
    }
  };

  const dismissAccountabilityNudge = async (nudgeId: string) => {
    setReceivedAccountabilityNudges((prev) => prev.filter((n) => n.id !== nudgeId));
    try {
      await deleteDoc(doc(db, 'accountabilityNudges', nudgeId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `accountabilityNudges/${nudgeId}`);
    }
  };

  const updateAccountabilityDailyCap = async (cap: number) => {
    setAccountabilityDailyCapState(cap);
    if (!auth.currentUser) return;
    try {
      await setDoc(doc(db, 'profiles', auth.currentUser.uid), { accountabilityDailyCap: cap }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `profiles/${auth.currentUser.uid}`);
    }
  };

  // ==========================================
  // MESSAGING -- DM threads (friend OR shared-circle gated, re-checked
  // server-side on every send) and per-circle group chat. Both message lists
  // are live (onSnapshot) rather than this app's usual one-shot getDocs --
  // chat is the one place a stale view actually matters, and there's no
  // Cloud Functions/push infra to notify otherwise.
  // ==========================================

  // Whichever friend/circle relationship justified opening the DM is
  // re-verified every render against live friends/myCircles + the other
  // person's circleIds snapshotted at open time -- purely a UI hint for the
  // read-only banner; the real enforcement is the Firestore rule re-checking
  // dmGated() on every message create, so this can never be used to bypass
  // anything even if it drifts stale.
  const [activeDMOtherCircleIds, setActiveDMOtherCircleIds] = useState<string[]>([]);
  const activeDMThreadActive =
    !!activeDMThread &&
    (friends.some((f) => f.uid === activeDMThread.otherUid) ||
      myCircles.some((c) => activeDMOtherCircleIds.includes(c.id)));

  const openDMThread = async (otherUid: string, otherName: string, otherAvatarUrl: string) => {
    if (!auth.currentUser || otherUid === auth.currentUser.uid) return;
    const myUid = auth.currentUser.uid;
    const threadId = [myUid, otherUid].sort().join('_');
    const threadRef = doc(db, 'dmThreads', threadId);
    try {
      const [threadSnap, theirProfileSnap] = await Promise.all([getDoc(threadRef), getDoc(doc(db, 'profiles', otherUid))]);
      const theirCircleIds: string[] = theirProfileSnap.data()?.circleIds || [];
      const isFriend = friends.some((f) => f.uid === otherUid);
      const sharesCircle = myCircles.some((c) => theirCircleIds.includes(c.id));

      let data = threadSnap.data();
      if (!data) {
        if (!isFriend && !sharesCircle) {
          triggerToast('You can only message friends or people who share a community with you.');
          return;
        }
        const nowISO = new Date().toISOString();
        const myName = auth.currentUser.displayName || 'Anonymous Disciple';
        data = {
          participantUids: [myUid, otherUid].sort(),
          participantNames: { [myUid]: myName, [otherUid]: otherName },
          participantAvatars: { [myUid]: '', [otherUid]: otherAvatarUrl },
          lastMessage: '',
          lastMessageAt: nowISO,
          createdAt: nowISO,
        };
        await setDoc(threadRef, data);
      }

      setActiveDMOtherCircleIds(theirCircleIds);
      setActiveDMThread({
        id: threadId,
        participantUids: data.participantUids,
        otherUid,
        otherName: data.participantNames?.[otherUid] || otherName,
        otherAvatarUrl: data.participantAvatars?.[otherUid] || otherAvatarUrl,
        lastMessage: data.lastMessage || '',
        lastMessageAt: data.lastMessageAt,
        createdAt: data.createdAt,
      });
      navigateTo('dmThread');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `dmThreads/${threadId}`);
      triggerToast("Couldn't open that conversation -- please try again.");
    }
  };

  const closeDMThread = () => {
    setActiveDMThread(null);
    setActiveDMMessages([]);
    setActiveDMOtherCircleIds([]);
  };

  const sendDMMessage = async (text: string) => {
    if (!auth.currentUser || !activeDMThread) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    const nowISO = new Date().toISOString();
    try {
      await addDoc(collection(db, 'dmThreads', activeDMThread.id, 'messages'), {
        fromUid: auth.currentUser.uid,
        fromName: auth.currentUser.displayName || 'Anonymous Disciple',
        fromAvatarUrl: '',
        text: trimmed,
        createdAt: nowISO,
      });
      await updateDoc(doc(db, 'dmThreads', activeDMThread.id), { lastMessage: trimmed, lastMessageAt: nowISO });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `dmThreads/${activeDMThread.id}/messages`);
      triggerToast("You're no longer connected, so this can't be sent -- send a friend request to keep the conversation going.");
    }
  };

  const openCircleChat = (circleId: string) => {
    setActiveCircleChatId(circleId);
    navigateTo('circleChat');
  };

  const closeCircleChat = () => {
    setActiveCircleChatId(null);
    setActiveCircleMessages([]);
  };

  const sendCircleMessage = async (text: string) => {
    if (!auth.currentUser || !activeCircleChatId) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      await addDoc(collection(db, 'circles', activeCircleChatId, 'messages'), {
        fromUid: auth.currentUser.uid,
        fromName: auth.currentUser.displayName || 'Anonymous Disciple',
        fromAvatarUrl: '',
        text: trimmed,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `circles/${activeCircleChatId}/messages`);
      triggerToast("Couldn't send that message -- please try again.");
    }
  };

  // Live DM inbox -- reloads automatically on sign-in/out.
  useEffect(() => {
    if (!user) {
      setDmThreads([]);
      return;
    }
    setLoadingDmThreads(true);
    const q = query(
      collection(db, 'dmThreads'),
      where('participantUids', 'array-contains', user.uid),
      orderBy('lastMessageAt', 'desc'),
      limit(50)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setDmThreads(
          snap.docs.map((d) => {
            const data = d.data();
            const otherUid = ((data.participantUids as string[]) || []).find((uid) => uid !== user.uid) || '';
            return {
              id: d.id,
              participantUids: data.participantUids,
              otherUid,
              otherName: data.participantNames?.[otherUid] || 'Someone',
              otherAvatarUrl: data.participantAvatars?.[otherUid] || '',
              lastMessage: data.lastMessage || '',
              lastMessageAt: data.lastMessageAt,
              createdAt: data.createdAt,
            } as DMThread;
          })
        );
        setLoadingDmThreads(false);
      },
      (err) => {
        console.error('Failed to load DM threads:', err);
        setLoadingDmThreads(false);
      }
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Live messages for whichever DM thread is currently open.
  useEffect(() => {
    if (!activeDMThread) {
      setActiveDMMessages([]);
      return;
    }
    setLoadingActiveDMMessages(true);
    const q = query(collection(db, 'dmThreads', activeDMThread.id, 'messages'), orderBy('createdAt', 'asc'), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setActiveDMMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ChatMessage));
        setLoadingActiveDMMessages(false);
      },
      (err) => {
        console.error('Failed to load DM messages:', err);
        setLoadingActiveDMMessages(false);
      }
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDMThread?.id]);

  // Live messages for whichever circle's group chat is currently open.
  useEffect(() => {
    if (!activeCircleChatId) {
      setActiveCircleMessages([]);
      return;
    }
    setLoadingActiveCircleMessages(true);
    const q = query(collection(db, 'circles', activeCircleChatId, 'messages'), orderBy('createdAt', 'asc'), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setActiveCircleMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ChatMessage));
        setLoadingActiveCircleMessages(false);
      },
      (err) => {
        console.error('Failed to load circle chat messages:', err);
        setLoadingActiveCircleMessages(false);
      }
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCircleChatId]);

  const loadPublicCircles = async () => {
    setLoadingPublicCircles(true);
    try {
      const q = query(collection(db, 'circles'), where('isPublic', '==', true));
      const snap = await getDocs(q);
      setPublicCircles(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Circle));
    } catch (err) {
      console.error('Failed to load public circles:', err);
    } finally {
      setLoadingPublicCircles(false);
    }
  };

  const loadActiveCircleData = async (circleId: string) => {
    setLoadingActiveCircle(true);
    try {
      const [circleSnap, membersSnap, plansSnap] = await Promise.all([
        getDoc(doc(db, 'circles', circleId)),
        getDocs(collection(db, 'circles', circleId, 'members')),
        getDocs(collection(db, 'circles', circleId, 'groupPlans')),
      ]);
      setActiveCircle(circleSnap.exists() ? ({ id: circleSnap.id, ...circleSnap.data() } as Circle) : null);
      setActiveCircleMembers(membersSnap.docs.map((d) => d.data() as CircleMember));
      setActiveCircleStudyPlans(plansSnap.docs.map((d) => normalizeStudyPlan(d.id, d.data())));
    } catch (err) {
      console.error('Failed to load circle detail:', err);
    } finally {
      setLoadingActiveCircle(false);
    }
  };

  // Opens a circle's detail console and (re)loads its live data — the one
  // entry point screens should use instead of juggling several setters.
  const openCircle = (circleId: string) => {
    setActiveGroupId(circleId);
    setViewingGroupDetail(true);
    setCommunitySubView('home');
    loadActiveCircleData(circleId);
  };

  const createCircle = async (name: string, description: string, isPublic: boolean) => {
    if (!auth.currentUser) {
      triggerToast('Sign in to create a Scripture Circle.');
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      triggerToast('Please specify a circle name! 🏷️');
      return;
    }
    const uid = auth.currentUser.uid;
    const circleRef = doc(collection(db, 'circles'));
    const now = new Date().toISOString();
    const inviteCode = await generateUniqueInviteCode();
    const newCircle: Circle = {
      id: circleRef.id,
      name: trimmedName,
      description: description.trim() || 'A new Scripture Circle — pacing to be set by shared plans.',
      isPublic,
      ownerId: uid,
      ownerName: user?.displayName || 'Anonymous Disciple',
      inviteCode,
      createdAt: now,
      updatedAt: now,
    };
    const newMember: CircleMember = {
      uid,
      displayName: user?.displayName || 'Anonymous Disciple',
      avatarUrl: user?.photoURL || '',
      role: 'leader',
      joinedAt: now,
    };

    try {
      const batch = writeBatch(db);
      batch.set(circleRef, newCircle);
      batch.set(doc(db, 'circles', circleRef.id, 'members', uid), newMember);
      batch.set(doc(db, 'profiles', uid), { circleIds: arrayUnion(circleRef.id) }, { merge: true });
      await batch.commit();
      setMyCircles((prev) => [...prev, newCircle]);
      openCircle(circleRef.id);
      triggerToast(`Successfully created "${trimmedName}" Scripture Circle! 🛡️`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleRef.id}`);
    }
  };

  const joinCircle = async (circleId: string, circleName?: string) => {
    if (!auth.currentUser) {
      triggerToast('Sign in to join a Scripture Circle.');
      return;
    }
    const uid = auth.currentUser.uid;
    const memberRef = doc(db, 'circles', circleId, 'members', uid);
    try {
      const existing = await getDoc(memberRef);
      if (existing.exists()) {
        openCircle(circleId);
        triggerToast("You're already in this circle!");
        return;
      }

      const now = new Date().toISOString();
      const newMember: CircleMember = {
        uid,
        displayName: user?.displayName || 'Anonymous Disciple',
        avatarUrl: user?.photoURL || '',
        role: 'member',
        joinedAt: now,
      };

      const batch = writeBatch(db);
      batch.set(memberRef, newMember);
      batch.set(doc(db, 'profiles', uid), { circleIds: arrayUnion(circleId) }, { merge: true });
      await batch.commit();

      await loadMyCircles();
      openCircle(circleId);
      triggerToast(`Successfully joined "${circleName || 'the circle'}"! 🛡️`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/members/${uid}`);
    }
  };

  const joinCircleByCode = async (codeInput: string) => {
    const code = codeInput.trim().toUpperCase();
    if (!code) {
      triggerToast('Please enter an invite code! 🔑');
      return;
    }
    try {
      const q = query(collection(db, 'circles'), where('inviteCode', '==', code));
      const snap = await getDocs(q);
      if (snap.empty) {
        triggerToast(`No circle found for code "${code}".`);
        return;
      }
      const circleDoc = snap.docs[0];
      await joinCircle(circleDoc.id, (circleDoc.data() as Circle).name);
      setInviteCodeInput('');
    } catch (err) {
      console.error('Failed to join by code:', err);
      triggerToast('Failed to join via invite code.');
    }
  };

  const leaveCircle = async (circleId: string) => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'circles', circleId, 'members', uid));
      batch.update(doc(db, 'profiles', uid), { circleIds: arrayRemove(circleId) });
      await batch.commit();
      setMyCircles((prev) => prev.filter((c) => c.id !== circleId));
      setViewingGroupDetail(false);
      triggerToast('You have left the Scripture Circle. 🚪');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/members`);
    }
  };

  const disbandCircle = async (circleId: string) => {
    if (!auth.currentUser) return;
    try {
      const [membersSnap, plansSnap] = await Promise.all([
        getDocs(collection(db, 'circles', circleId, 'members')),
        getDocs(collection(db, 'circles', circleId, 'groupPlans')),
      ]);
      const batch = writeBatch(db);
      membersSnap.docs.forEach((d) => batch.delete(d.ref));
      plansSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(db, 'circles', circleId));
      await batch.commit();

      // Other members' profiles/{uid}.circleIds still reference this circle —
      // we can't write their profile docs (owner-only), so loadMyCircles()
      // self-heals for them next time they load. We can clean up our own.
      await updateDoc(doc(db, 'profiles', auth.currentUser.uid), { circleIds: arrayRemove(circleId) });

      setMyCircles((prev) => prev.filter((c) => c.id !== circleId));
      setViewingGroupDetail(false);
      triggerToast('Disbanded the Scripture Circle. 🌪️');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}`);
    }
  };

  const removeCircleMember = async (circleId: string, memberUid: string) => {
    try {
      await deleteDoc(doc(db, 'circles', circleId, 'members', memberUid));
      setActiveCircleMembers((prev) => prev.filter((m) => m.uid !== memberUid));
      triggerToast('Removed member from the scripture circle. 🧹');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/members/${memberUid}`);
    }
  };

  const updateCircleSettings = async (circleId: string, fields: Partial<Pick<Circle, 'name' | 'description' | 'isPublic'>>) => {
    try {
      await updateDoc(doc(db, 'circles', circleId), { ...fields, updatedAt: new Date().toISOString() });
      setActiveCircle((prev) => (prev ? { ...prev, ...fields } : prev));
      setMyCircles((prev) => prev.map((c) => (c.id === circleId ? { ...c, ...fields } : c)));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}`);
    }
  };

  // Creation only asks for a title + description -- no book/chapter/speed
  // up front. Per explicit user direction: real people rarely memorize
  // whole books together, so the actual verse queue is built incrementally
  // from the plan's own landing page (addVersesToStudyPlan below), and its
  // pace (versesPerWeek) is set/edited there too, not at creation time.
  const createStudyPlan = async (circleId: string, input: { name: string; description: string }) => {
    if (!auth.currentUser) return;
    const trimmedName = input.name.trim();
    if (!trimmedName) {
      triggerToast('Please specify a plan title! 🏷️');
      return;
    }
    const planRef = doc(collection(db, 'circles', circleId, 'groupPlans'));
    const now = new Date().toISOString();
    const newPlan: StudyPlan = {
      planId: planRef.id,
      circleId,
      name: trimmedName,
      description: input.description.trim(),
      managerId: auth.currentUser.uid,
      managerName: user?.displayName || 'Anonymous Disciple',
      versesPerWeek: 3,
      verseIds: [],
      createdAt: now,
      updatedAt: now,
    };

    try {
      await setDoc(planRef, newPlan);
      setActiveCircleStudyPlans((prev) => [...prev, newPlan]);
      triggerToast(`Created "${trimmedName}"! Add verses and set a pace from its page. 🛡️`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/groupPlans/${planRef.id}`);
    }
  };

  const updateStudyPlan = async (
    circleId: string,
    planId: string,
    fields: Partial<Pick<StudyPlan, 'name' | 'description' | 'versesPerWeek'>>
  ) => {
    try {
      const updatedAt = new Date().toISOString();
      await updateDoc(doc(db, 'circles', circleId, 'groupPlans', planId), { ...fields, updatedAt });
      const apply = (p: StudyPlan) => (p.planId === planId ? { ...p, ...fields, updatedAt } : p);
      setActiveCircleStudyPlans((prev) => prev.map(apply));
      setJoinedStudyPlanDetails((prev) => prev.map(apply));
      setViewingStudyPlan((prev) => (prev && prev.planId === planId ? apply(prev) : prev));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/groupPlans/${planId}`);
    }
  };

  // Manager builds a plan's verse queue incrementally, a handful of verses
  // at a time, from real scripture text -- rather than committing a whole
  // book/chapter up front like the old "Deploy New Circle Plan" form did.
  const addVersesToStudyPlan = async (
    circleId: string,
    planId: string,
    book: string,
    chapter: number,
    startVerse: number,
    endVerse: number
  ) => {
    const bookId = getBookByName(book)?.id;
    if (!bookId) {
      triggerToast(`Unrecognized book: ${book}`);
      return;
    }
    const chapterData = await fetchChapterText(DEFAULT_TRANSLATION_ID, bookId, chapter);
    if (!chapterData) {
      triggerToast(`Couldn't find ${book} ${chapter} in the scripture library yet.`);
      return;
    }
    const lo = Math.min(startVerse, endVerse);
    const hi = Math.max(startVerse, endVerse);
    const newVerseIds: string[] = [];
    for (let v = lo; v <= hi; v++) {
      if (chapterData.verses[String(v)]) newVerseIds.push(`${bookId}_${chapter}_${v}`);
    }
    if (newVerseIds.length === 0) {
      triggerToast(`No verses found in ${book} ${chapter}:${lo}-${hi}.`);
      return;
    }

    const existingPlan = activeCircleStudyPlans.find((p) => p.planId === planId);
    const mergedVerseIds = Array.from(new Set([...(existingPlan?.verseIds || []), ...newVerseIds]));

    try {
      const updatedAt = new Date().toISOString();
      await updateDoc(doc(db, 'circles', circleId, 'groupPlans', planId), { verseIds: mergedVerseIds, updatedAt });
      const apply = (p: StudyPlan) => (p.planId === planId ? { ...p, verseIds: mergedVerseIds, updatedAt } : p);
      setActiveCircleStudyPlans((prev) => prev.map(apply));
      setJoinedStudyPlanDetails((prev) => prev.map(apply));
      setViewingStudyPlan((prev) => (prev && prev.planId === planId ? apply(prev) : prev));

      // Self-heal the manager's OWN queue immediately if they're also a
      // member -- other members' queues pick up the new verses the next
      // time their own session loads (see loadUserData), since a client
      // can't write into another user's private memoryQueue.
      if (joinedStudyPlanMemberships.some((m) => m.planId === planId)) {
        await addStudyPlanVersesToOwnQueue(planId, newVerseIds);
      }

      triggerToast(`Added ${newVerseIds.length} verse${newVerseIds.length === 1 ? '' : 's'} to the plan. 📖`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/groupPlans/${planId}`);
    }
  };

  const deleteStudyPlan = async (circleId: string, planId: string) => {
    try {
      await deleteDoc(doc(db, 'circles', circleId, 'groupPlans', planId));
      setActiveCircleStudyPlans((prev) => prev.filter((p) => p.planId !== planId));
      setJoinedStudyPlanDetails((prev) => prev.filter((p) => p.planId !== planId));
      setViewingStudyPlan((prev) => (prev && prev.planId === planId ? null : prev));
      triggerToast('Deleted study plan. 🗑️');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/groupPlans/${planId}`);
    }
  };

  // Real-user member profile lookup (by uid) -- the only member-profile
  // lookup in the app; the old name-keyed viewMemberProfile(), which served
  // fabricated DUMMY_PROFILES content, was removed.
  const viewMemberProfileById = async (uid: string) => {
    try {
      const snap = await getDoc(doc(db, 'profiles', uid));
      if (!snap.exists()) {
        triggerToast("Couldn't find that member's profile.");
        return;
      }
      const data = snap.data();
      const theirCircleIds: string[] = data.circleIds || [];
      const sharedCircleNames = myCircles.filter((c) => theirCircleIds.includes(c.id)).map((c) => c.name);
      setSelectedUserProfile({
        uid,
        name: data.displayName || 'Anonymous Disciple',
        avatar: (data.displayName || 'A').charAt(0).toUpperCase(),
        stats: {
          memorized: data.memorizedCount || 0,
          learning: data.learningCount || 0,
          streak: data.streakDays || 0,
        },
        communities: sharedCircleNames,
      });
      navigateTo('memberProfile');
    } catch (err) {
      console.error('Failed to load member profile:', err);
      triggerToast("Couldn't load that member's profile.");
    }
  };

  // ==========================================
  // SHARED / GROUP MEMORY PLAN HANDLERS
  // ==========================================
  const loadSharedPlans = async () => {
    setLoadingSharedPlans(true);
    try {
      const q = query(collection(db, 'sharedPlans'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      const plans: any[] = [];
      querySnapshot.forEach((docSnap) => {
        plans.push({ id: docSnap.id, ...docSnap.data() });
      });
      setSharedPlans(plans);
    } catch (err) {
      console.error('Error loading shared plans:', err);
      setSharedPlans([]);
      triggerToast("Couldn't load community pacing plans right now.");
    } finally {
      setLoadingSharedPlans(false);
    }
  };

  const joinSharedPlan = async (plan: any) => {
    try {
      // Normalize the loosely-typed shared-plan doc into a full MemoryPlan
      // once, then reuse it for both the designer sync and the Firestore
      // write, so defaults can't drift between the two.
      const adopted: MemoryPlan = {
        id: 'shared-' + (plan.id || Date.now()),
        name: plan.name || 'Custom Plan',
        preset: plan.preset || 'custom',
        learningDays: plan.learningDays || ['M', 'W', 'F'],
        newVersesPace: plan.newVersesPace ?? 3,
        maxReviewCap: plan.maxReviewCap ?? 15,
        retentionRigor: plan.retentionRigor || 'standard',
        dailyPhaseWeeks: plan.dailyPhaseWeeks ?? 7,
        weeklyPhaseMonths: plan.weeklyPhaseMonths ?? 6,
        monthlyPhaseYears: plan.monthlyPhaseYears ?? 5,
        masteryTouches: plan.masteryTouches ?? 3,
        reviewsRequired: plan.reviewsRequired ?? 1,
        sabbathEnabled: plan.sabbathEnabled ?? false,
        sabbathDay: plan.sabbathDay || 'Su',
        dayStartHour: plan.dayStartHour ?? 0,
        cognitiveLoadSensitivity: plan.cognitiveLoadSensitivity || 'medium',
        isActive: true,
        updatedAt: new Date().toISOString(),
      };
      syncDesignerFromPlan(adopted);

      if (auth.currentUser) {
        const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
        // merge: true — this doc also holds savedPlans and activeGroupPlanId;
        // a plain setDoc here silently erased both of them.
        await setDoc(
          planRef,
          {
            ...planTopLevelFields(adopted),
            updatedAt: new Date(),
          },
          { merge: true }
        );

        if (plan.id && !plan.id.startsWith('mock-')) {
          try {
            const planDocRef = doc(db, 'sharedPlans', plan.id);
            await setDoc(
              planDocRef,
              {
                ...plan,
                downloadsCount: (plan.downloadsCount || 0) + 1,
              },
              { merge: true }
            );
          } catch (e) {
            console.warn('Could not update downloads count:', e);
          }
        }
      }

      triggerToast(`Successfully joined "${plan.name}"! 🎯`);
      loadSharedPlans();
    } catch (err) {
      console.error('Error joining shared plan:', err);
      triggerToast('Failed to join this memory plan.');
    }
  };

  // Fetches real verse text for whichever of `verseIds` aren't already in
  // the member's own queue and appends them as 'queued', tagged to this
  // plan -- shared by joinStudyPlan (the plan's full current range) and
  // addVersesToStudyPlan's self-heal path (just the newly-added verses).
  const addStudyPlanVersesToOwnQueue = async (planId: string, verseIds: string[]) => {
    // StudyPlan.verseIds are translation-less ("GEN_1_3") -- group plans
    // don't have per-member translation choice yet, always resolved as
    // DEFAULT_TRANSLATION_ID, so "already in my queue" means the
    // DEFAULT_TRANSLATION_ID-prefixed form of this reference already exists
    // (QueueItem.verseId is translation-prefixed -- see buildVerseId).
    const currentQueueIds = new Set(memoryQueueRef.current.map((item) => item.verseId));
    const missingRefs = verseIds
      .map((vId) => {
        const [bookId, chapterStr, verseStr] = vId.split('_');
        return { bookId, chapter: parseInt(chapterStr, 10), verseNumber: parseInt(verseStr, 10) };
      })
      .filter((ref) => !currentQueueIds.has(buildVerseId(DEFAULT_TRANSLATION_ID, ref.bookId, ref.chapter, ref.verseNumber)));
    if (missingRefs.length === 0) return;

    // Group by book+chapter so each real chapter is only fetched once,
    // regardless of how many of its verses are in this plan's range.
    const byChapter = new Map<string, { bookId: string; chapter: number; verseNumbers: number[] }>();
    missingRefs.forEach(({ bookId, chapter, verseNumber }) => {
      const key = `${bookId}_${chapter}`;
      if (!byChapter.has(key)) byChapter.set(key, { bookId, chapter, verseNumbers: [] });
      byChapter.get(key)!.verseNumbers.push(verseNumber);
    });

    const newItems: QueueItem[] = [];
    for (const { bookId, chapter, verseNumbers } of byChapter.values()) {
      const bookMeta = ALL_BIBLE_BOOKS.find((b) => b.id === bookId);
      const chapterData = await fetchChapterText(DEFAULT_TRANSLATION_ID, bookId, chapter);
      if (!bookMeta || !chapterData) continue;
      verseNumbers.forEach((verseNumber) => {
        const text = chapterData.verses[String(verseNumber)];
        if (!text) return;
        newItems.push({
          verseId: buildVerseId(DEFAULT_TRANSLATION_ID, bookId, chapter, verseNumber),
          translationId: DEFAULT_TRANSLATION_ID,
          book: bookMeta.name,
          chapter,
          verseNumber,
          text,
          orderIndex: memoryQueueRef.current.length + newItems.length,
          status: 'queued',
          origin: 'group',
          originPlanId: planId,
          retentionPhase: 'none',
          dateStarted: null,
          lastReviewDate: null,
          nextReviewDueDate: null,
          currentStreakCount: 0,
          totalSuccessfulReviews: 0,
          gracePeriodUsedToday: false,
        });
      });
    }

    if (newItems.length > 0) {
      // No manual Firestore batch write here — the memoryQueue auto-sync
      // effect picks up this queue update and persists it (including
      // deletion-diffing), debounced.
      updateMemoryQueue((prev) => [...prev, ...newItems]);
    }
  };

  const persistJoinedStudyPlans = async (memberships: StudyPlanMembership[]) => {
    if (!auth.currentUser) return;
    try {
      const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
      // merge: true — this doc also holds savedPlans and other top-level
      // plan fields; a plain setDoc here would silently erase them.
      await setDoc(planRef, { joinedStudyPlans: memberships, updatedAt: new Date() }, { merge: true });
    } catch (err) {
      console.error('Failed to persist joined study plans:', err);
    }
  };

  const joinStudyPlan = async (plan: StudyPlan, priority: StudyPlanMembership['priority'] = 'individual') => {
    try {
      await addStudyPlanVersesToOwnQueue(plan.planId, plan.verseIds);

      const membership: StudyPlanMembership = {
        planId: plan.planId,
        circleId: plan.circleId,
        priority,
        joinedAt: new Date().toISOString(),
      };
      const updatedMemberships = [...joinedStudyPlanMemberships.filter((m) => m.planId !== plan.planId), membership];
      setJoinedStudyPlanMemberships(updatedMemberships);
      setJoinedStudyPlanDetails((prev) => [...prev.filter((p) => p.planId !== plan.planId), plan]);
      await persistJoinedStudyPlans(updatedMemberships);

      triggerToast(`Joined "${plan.name}"! Verses added to your queue. 🎯`);
    } catch (err) {
      console.error('Error joining study plan:', err);
      triggerToast('Failed to join this study plan.');
    }
  };

  // Only strips verses that are still 'queued' (never actually started) --
  // anything already being learned/reviewed/retained is left alone, since
  // leaving a plan shouldn't erase real progress already made on it.
  const leaveStudyPlan = async (planId: string) => {
    const updatedMemberships = joinedStudyPlanMemberships.filter((m) => m.planId !== planId);
    setJoinedStudyPlanMemberships(updatedMemberships);
    setJoinedStudyPlanDetails((prev) => prev.filter((p) => p.planId !== planId));
    updateMemoryQueue((prev) => prev.filter((item) => !(item.originPlanId === planId && item.status === 'queued')));
    await persistJoinedStudyPlans(updatedMemberships);
    triggerToast('Left the study plan.');
  };

  const setStudyPlanPriority = async (planId: string, priority: StudyPlanMembership['priority']) => {
    const updatedMemberships = joinedStudyPlanMemberships.map((m) => (m.planId === planId ? { ...m, priority } : m));
    setJoinedStudyPlanMemberships(updatedMemberships);
    await persistJoinedStudyPlans(updatedMemberships);
  };

  // Leaving/disbanding an entire circle should also drop membership in
  // whatever Study Plans belonged to it -- mirrors the old single-plan
  // code's setActiveGroupPlan(null) on the same actions, just generalized
  // to however many plans of that circle this member had joined.
  const clearStudyPlanMembershipsForCircle = (circleId: string) => {
    const updatedMemberships = joinedStudyPlanMemberships.filter((m) => m.circleId !== circleId);
    setJoinedStudyPlanMemberships(updatedMemberships);
    setJoinedStudyPlanDetails((prev) => prev.filter((p) => p.circleId !== circleId));
    persistJoinedStudyPlans(updatedMemberships);
  };

  const handleActivatePlan = async (planId: string) => {
    const updatedPlans = savedPlans.map((p) => ({
      ...p,
      isActive: p.id === planId,
    }));
    setSavedPlans(updatedPlans);

    const activePlan = updatedPlans.find((p) => p.isActive);
    if (activePlan) {
      syncDesignerFromPlan(activePlan);

      triggerToast(`Activated plan: "${activePlan.name}" ⚡`);

      if (auth.currentUser) {
        try {
          const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
          // merge: true — preserve activeGroupPlanId, which lives on this
          // same doc but isn't part of this write.
          await setDoc(
            planRef,
            {
              savedPlans: updatedPlans,
              ...planTopLevelFields(activePlan),
              updatedAt: new Date(),
            },
            { merge: true }
          );
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `memoryPlans/${auth.currentUser.uid}`);
        }
      }
    }
  };

  // Deletes a saved plan. Refuses to delete the last remaining plan (a user
  // must always have at least one). If the deleted plan was the active one,
  // the first remaining plan becomes active and its settings are synced into
  // the live editing state, the same way switching plans normally works.
  const handleDeletePlan = async (planId: string) => {
    if (savedPlans.length <= 1) {
      triggerToast("Can't delete your only plan — save another one first.");
      return;
    }
    const deletedPlan = savedPlans.find((p) => p.id === planId);
    const wasActive = !!deletedPlan?.isActive;
    let updatedPlans = savedPlans.filter((p) => p.id !== planId);
    if (wasActive) {
      updatedPlans = updatedPlans.map((p, i) => ({ ...p, isActive: i === 0 }));
    }

    if (wasActive) {
      syncDesignerFromPlan(updatedPlans[0]);
    }
    if (editingPlanId === planId) setEditingPlanId(null);

    setSavedPlans(updatedPlans);
    triggerToast(`Deleted "${deletedPlan?.name || 'plan'}".`);

    if (auth.currentUser) {
      try {
        const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
        const activePlan = updatedPlans.find((p) => p.isActive) || updatedPlans[0];
        await setDoc(
          planRef,
          {
            savedPlans: updatedPlans,
            ...planTopLevelFields(activePlan),
            updatedAt: new Date(),
          },
          { merge: true }
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `memoryPlans/${auth.currentUser.uid}`);
      }
    }
  };

  const handleEditPlan = (plan: MemoryPlan) => {
    setEditingPlanId(plan.id);
    syncDesignerFromPlan(plan);
    navigateTo('planDesigner');
  };

  const handleCreateNewPlan = () => {
    setEditingPlanId(null);
    setPreset('custom');
    setLearningDays(['M', 'W', 'F']);
    setNewVersesPace(3);
    setMaxReviewCap(15);
    setRetentionRigor('standard');
    setDailyPhaseWeeks(7);
    setWeeklyPhaseMonths(6);
    setMonthlyPhaseYears(5);
    setMasteryTouches(3);
    setReviewsRequired(1);
    setSabbathEnabled(false);
    setSabbathDay('Su');
    setCognitiveLoadSensitivity('medium');
    setCustomPlanName('New Custom Plan');
    navigateTo('planDesigner');
  };

  const handleSavePlan = async () => {
    let updatedPlans = [...savedPlans];

    if (editingPlanId) {
      updatedPlans = updatedPlans.map((p) => {
        if (p.id === editingPlanId) {
          return {
            ...p,
            name: customPlanName || 'My Custom Plan',
            preset,
            learningDays,
            newVersesPace,
            maxReviewCap,
            retentionRigor,
            dailyPhaseWeeks,
            weeklyPhaseMonths,
            monthlyPhaseYears,
            masteryTouches,
            reviewsRequired,
            sabbathEnabled,
            sabbathDay,
            dayStartHour,
            cognitiveLoadSensitivity,
            updatedAt: new Date().toISOString(),
          };
        }
        return p;
      });
      triggerToast(`Plan "${customPlanName}" updated successfully! 🎯`);
    } else {
      const newPlanId = 'plan-' + Date.now();
      const newPlan: MemoryPlan = {
        id: newPlanId,
        name: customPlanName || 'My Custom Plan',
        preset,
        learningDays,
        newVersesPace,
        maxReviewCap,
        retentionRigor,
        dailyPhaseWeeks,
        weeklyPhaseMonths,
        monthlyPhaseYears,
        masteryTouches,
        reviewsRequired,
        sabbathEnabled,
        sabbathDay,
        dayStartHour,
        cognitiveLoadSensitivity,
        isActive: true,
        updatedAt: new Date().toISOString(),
      };

      updatedPlans = updatedPlans.map((p) => ({ ...p, isActive: false }));
      updatedPlans.push(newPlan);
      triggerToast(`New plan "${customPlanName}" saved and activated! 🎯`);
    }

    const activePlan = updatedPlans.find((p) => p.isActive) || updatedPlans[0];
    if (activePlan) {
      syncDesignerFromPlan(activePlan);
    }

    setSavedPlans(updatedPlans);
    setEditingPlanId(null);

    if (auth.currentUser) {
      try {
        const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
        // merge: true — a plain setDoc here erased activeGroupPlanId every
        // time a plan was saved. The full
        // planTopLevelFields spread also fixes this write silently dropping
        // the rigor/mastery/sabbath fields.
        await setDoc(
          planRef,
          {
            savedPlans: updatedPlans,
            ...planTopLevelFields(activePlan),
            updatedAt: new Date(),
          },
          { merge: true }
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `memoryPlans/${auth.currentUser.uid}`);
      }
    }

    navigateTo('savedPlans');
  };

  // Persists just the Memory Rhythm fields (learning days, pace, and review
  // cap) to whichever plan is currently selected, in place — unlike
  // handleSavePlan, this doesn't navigate away or clear editingPlanId, since
  // it's used inline on the Memory Plan & Queue screen.
  const saveActivePlanRhythm = async () => {
    const targetId = editingPlanId || savedPlans.find((p) => p.isActive)?.id || savedPlans[0]?.id;
    if (!targetId) {
      triggerToast('No memory plan found to save to.');
      return;
    }

    const updatedPlans = savedPlans.map((p) =>
      p.id === targetId
        ? { ...p, learningDays, newVersesPace, maxReviewCap, preset, updatedAt: new Date().toISOString() }
        : p
    );
    setSavedPlans(updatedPlans);

    const targetPlan = updatedPlans.find((p) => p.id === targetId)!;

    if (auth.currentUser) {
      try {
        const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
        await setDoc(
          planRef,
          {
            savedPlans: updatedPlans,
            learningDays: targetPlan.learningDays,
            newVersesPace: targetPlan.newVersesPace,
            maxReviewCap: targetPlan.maxReviewCap,
            preset: targetPlan.preset,
            updatedAt: new Date(),
          },
          { merge: true }
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `memoryPlans/${auth.currentUser.uid}`);
      }
    }

    triggerToast(`Memory rhythm saved to "${targetPlan.name}"! 🎯`);
  };

  const publishSharedPlan = async () => {
    if (!customPlanName.trim()) {
      triggerToast('Please provide a name for your custom plan.');
      return;
    }
    try {
      const planPayload = {
        name: customPlanName,
        preset,
        learningDays,
        newVersesPace,
        maxReviewCap,
        retentionRigor,
        dailyPhaseWeeks,
        weeklyPhaseMonths,
        monthlyPhaseYears,
        masteryTouches,
        reviewsRequired,
        sabbathEnabled,
        sabbathDay,
        dayStartHour,
        cognitiveLoadSensitivity,
        creatorName: user?.displayName || 'Anonymous Disciple',
        creatorId: user?.uid || 'anonymous',
        createdAt: new Date().toISOString(),
        downloadsCount: 0,
      };

      if (auth.currentUser) {
        const sharedColRef = collection(db, 'sharedPlans');
        await addDoc(sharedColRef, planPayload);

        // Also save/update inside savedPlans array!
        let updatedPlans = [...savedPlans];
        if (editingPlanId) {
          updatedPlans = updatedPlans.map((p) => {
            if (p.id === editingPlanId) {
              return {
                ...p,
                name: customPlanName,
                preset,
                learningDays,
                newVersesPace,
                maxReviewCap,
                retentionRigor,
                dailyPhaseWeeks,
                weeklyPhaseMonths,
                monthlyPhaseYears,
                masteryTouches,
                reviewsRequired,
                sabbathEnabled,
                sabbathDay,
                dayStartHour,
                cognitiveLoadSensitivity,
                updatedAt: new Date().toISOString(),
              };
            }
            return p;
          });
        } else {
          const newPlanId = 'plan-' + Date.now();
          const newPlan: MemoryPlan = {
            id: newPlanId,
            name: customPlanName,
            preset,
            learningDays,
            newVersesPace,
            maxReviewCap,
            retentionRigor,
            dailyPhaseWeeks,
            weeklyPhaseMonths,
            monthlyPhaseYears,
            masteryTouches,
            reviewsRequired,
            sabbathEnabled,
            sabbathDay,
            dayStartHour,
            cognitiveLoadSensitivity,
            isActive: true,
            updatedAt: new Date().toISOString(),
          };
          updatedPlans = updatedPlans.map((p) => ({ ...p, isActive: false }));
          updatedPlans.push(newPlan);
        }

        const activePlan = updatedPlans.find((p) => p.isActive) || updatedPlans[0];
        setSavedPlans(updatedPlans);
        setEditingPlanId(null);

        const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
        await setDoc(
          planRef,
          {
            savedPlans: updatedPlans,
            ...planTopLevelFields(activePlan),
            updatedAt: new Date(),
          },
          { merge: true }
        );

        triggerToast(`"${customPlanName}" published to Scripture Circles! 🚀`);
      } else {
        triggerToast(`Plan "${customPlanName}" saved locally! Sign in to publish. 🎯`);
      }

      loadSharedPlans();
      navigateTo('savedPlans');
    } catch (e) {
      console.error('Error publishing plan:', e);
      triggerToast('Failed to publish memory plan.');
    }
  };

  // Fetch shared plans once on mount
  useEffect(() => {
    loadSharedPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload the activity feed whenever the signed-in user or their real
  // circleFriends/friends lists change (sign-in/out, joining a new circle,
  // accepting a friend, etc.) — reactive rather than sequenced after
  // loadMyCircles(), since loadCircleFriends() inside it isn't awaited and
  // can finish later.
  useEffect(() => {
    loadActivityFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, circleFriends, friends]);

  // Same reasoning, for the real shared-recordings feed.
  useEffect(() => {
    loadSharedRecordings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, circleFriends, friends]);

  // Load real friends + pending requests on sign-in/out.
  useEffect(() => {
    loadFriends();
    loadFriendRequests();
    loadAccountabilitySentLog();
    loadReceivedAccountabilityNudges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadUserData = async (currentUser: any) => {
    console.log('loadUserData started for UID:', currentUser.uid);
    try {
      // 1. Profile
      console.log('Step 1: Fetching profile...');
      const profileRef = doc(db, 'profiles', currentUser.uid);
      let profileSnap;
      try {
        profileSnap = await getDoc(profileRef);
        console.log('Profile fetched successfully. Exists:', profileSnap.exists());
      } catch (e) {
        handleFirestoreError(e, OperationType.GET, `profiles/${currentUser.uid}`);
      }

      if (profileSnap && profileSnap.exists()) {
        setDefaultRecordingVisibility(profileSnap.data().defaultRecordingVisibility || null);
        setTotalStudySeconds(profileSnap.data().totalStudySeconds || 0);
        setAccountabilityDailyCapState(profileSnap.data().accountabilityDailyCap ?? ACCOUNTABILITY_DEFAULT_DAILY_CAP);
        // Covers both a brand-new profile (never set, so !== true) and
        // anyone who dismissed the app mid-onboarding without finishing it.
        setShowOnboarding(profileSnap.data().onboardingCompleted !== true);
      }

      if (profileSnap && !profileSnap.exists()) {
        const newProfile = {
          displayName: currentUser.displayName || 'Anonymous',
          // Lowercased once at creation for prefix-match user search (Find
          // Friends) — this app has no backend/search service, so this is
          // the standard Firestore-only trick (range query on a normalized
          // field). updateDisplayName keeps this in sync on rename.
          displayNameLower: (currentUser.displayName || 'anonymous').toLowerCase(),
          email: currentUser.email || '',
          avatarUrl: currentUser.photoURL || '',
          createdAt: new Date(),
          updatedAt: new Date(),
          streakDays: 0,
        };
        console.log('Creating new profile...');
        try {
          await setDoc(profileRef, newProfile);
          console.log('Profile created successfully.');
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, `profiles/${currentUser.uid}`);
        }
        // Brand-new account, never seen the Getting Started checklist.
        setShowOnboarding(true);
      }

      // 2. Memory Plan
      console.log('Step 2: Fetching memory plan...');
      const planRef = doc(db, 'memoryPlans', currentUser.uid);
      let planSnap;
      try {
        planSnap = await getDoc(planRef);
        console.log('Memory plan fetched successfully. Exists:', planSnap.exists());
      } catch (e) {
        handleFirestoreError(e, OperationType.GET, `memoryPlans/${currentUser.uid}`);
      }

      if (planSnap && planSnap.exists()) {
        const planData = planSnap.data();
        let plansList: MemoryPlan[] = planData.savedPlans || [];

        // If there are no saved plans in the cloud but we have top-level plan parameters, migrate them as active
        if (plansList.length === 0) {
          const activePlan: MemoryPlan = {
            id: 'example-plan',
            name: planData.name || 'Example Plan',
            preset: planData.preset || 'custom',
            learningDays: planData.learningDays || ['M', 'W', 'F'],
            newVersesPace: planData.newVersesPace || 3,
            maxReviewCap: planData.maxReviewCap || 15,
            retentionRigor: planData.retentionRigor || 'standard',
            dailyPhaseWeeks: planData.dailyPhaseWeeks ?? 7,
            weeklyPhaseMonths: planData.weeklyPhaseMonths ?? 6,
            monthlyPhaseYears: planData.monthlyPhaseYears ?? 5,
            masteryTouches: planData.masteryTouches ?? 3,
            reviewsRequired: planData.reviewsRequired ?? 1,
            sabbathEnabled: planData.sabbathEnabled ?? false,
            sabbathDay: planData.sabbathDay || 'Su',
            dayStartHour: planData.dayStartHour ?? 0,
            cognitiveLoadSensitivity: planData.cognitiveLoadSensitivity || 'medium',
            isActive: true,
            updatedAt: new Date().toISOString(),
          };
          plansList = [activePlan];
        }

        // Back-compat: plans saved before retention-rigor/mastery-touches/
        // sabbath/cognitiveLoadSensitivity existed won't have these fields
        // in Firestore — default them to prior hardcoded behavior so
        // existing plans don't change silently.
        plansList = plansList.map((p) => ({
          ...p,
          retentionRigor: p.retentionRigor || 'standard',
          dailyPhaseWeeks: p.dailyPhaseWeeks ?? 7,
          weeklyPhaseMonths: p.weeklyPhaseMonths ?? 6,
          monthlyPhaseYears: p.monthlyPhaseYears ?? 5,
          masteryTouches: p.masteryTouches ?? 3,
          reviewsRequired: p.reviewsRequired ?? 1,
          sabbathEnabled: p.sabbathEnabled ?? false,
          sabbathDay: p.sabbathDay || 'Su',
          dayStartHour: p.dayStartHour ?? 0,
          cognitiveLoadSensitivity: p.cognitiveLoadSensitivity || 'medium',
        }));

        setSavedPlans(plansList);

        // Joined Study Plans: resolve membership records into the real
        // StudyPlan docs they point to. This also fixes a pre-existing bug
        // where the old singular activeGroupPlan was written to Firestore on
        // join but never actually read back on load -- it silently reset to
        // null every reload even though the user was still really a member.
        const memberships: StudyPlanMembership[] = planData.joinedStudyPlans || [];
        setJoinedStudyPlanMemberships(memberships);
        if (memberships.length > 0) {
          try {
            const planDocs = await Promise.all(
              memberships.map((m) => getDoc(doc(db, 'circles', m.circleId, 'groupPlans', m.planId)))
            );
            const resolvedPlans = planDocs
              .filter((snap) => snap.exists())
              .map((snap) => normalizeStudyPlan(snap.id, snap.data()));
            setJoinedStudyPlanDetails(resolvedPlans);
          } catch (e) {
            console.error('Failed to resolve joined study plans:', e);
          }
        } else {
          setJoinedStudyPlanDetails([]);
        }

        // Find the active plan and sync current state
        const active = plansList.find((p) => p.isActive) || plansList[0];
        if (active) {
          syncDesignerFromPlan(active);
        }
      } else {
        console.log('Creating new memory plan...');
        setSavedPlans(DEFAULT_PLANS);
        try {
          await setDoc(planRef, {
            savedPlans: DEFAULT_PLANS,
            ...planTopLevelFields(DEFAULT_PLANS[0]),
            updatedAt: new Date(),
          });
          console.log('Memory plan created successfully.');
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, `memoryPlans/${currentUser.uid}`);
        }
      }

      // 3. User Verses & Deterministic Memory Queue
      console.log('Step 3: Fetching user verses and memory queue...');
      const versesCol = collection(db, 'users', currentUser.uid, 'verses');
      const queueCol = collection(db, 'users', currentUser.uid, 'memoryQueue');

      let vSnap, qSnap;
      try {
        vSnap = await getDocs(versesCol);
      } catch (e) {
        handleFirestoreError(e, OperationType.GET, `users/${currentUser.uid}/verses`);
      }
      try {
        qSnap = await getDocs(queueCol);
      } catch (e) {
        handleFirestoreError(e, OperationType.GET, `users/${currentUser.uid}/memoryQueue`);
      }
      console.log('User data fetched. Verses:', vSnap?.size, 'Queue:', qSnap?.size);

      // A brand-new account starts with a genuinely empty verse list — no
      // pre-seeded demo progress. (Previously this wrote INITIAL_VERSES,
      // several already marked 'memorized'/'learning', into every new
      // user's real data, making new accounts look like they'd already been
      // used.) The signed-out/guest local state still uses INITIAL_VERSES as
      // a try-before-you-sign-up preview — that's unaffected by this.
      if (vSnap && vSnap.empty) {
        setVerses([]);
      } else if (vSnap) {
        const loadedVerses: VerseState[] = [];
        vSnap.forEach((docSnap) => {
          const data = docSnap.data();
          loadedVerses.push({
            book: data.book,
            chapter: data.chapter,
            verse: data.verse,
            text: data.text,
            status: data.status,
            dueDate: data.dueDate || undefined,
          });
        });
        loadedVerses.sort((a, b) => {
          if (a.book !== b.book) return a.book.localeCompare(b.book);
          if (a.chapter !== b.chapter) return a.chapter - b.chapter;
          return a.verse - b.verse;
        });
        setVerses(loadedVerses);
      }

      // Same for the memory queue — a brand-new account starts with nothing
      // queued, rather than the demo Genesis/Psalms/John/Romans set already
      // partway "learned". Real content now comes from the Add Verses flow
      // or joining a circle's group plan, both backed by real ESV text.
      if (qSnap && qSnap.empty) {
        updateMemoryQueue(() => []);
        prevSyncedQueueIdsRef.current = new Set();
      } else if (qSnap) {
        const loadedQueue: QueueItem[] = [];
        qSnap.forEach((docSnap) => {
          const data = docSnap.data();
          loadedQueue.push({
            verseId: data.verseId,
            // Pre-existing docs from before translations existed have no
            // stored translationId -- they were always ESV (the only
            // translation that ever existed), so default to that rather
            // than leaving it undefined.
            translationId: data.translationId || 'ESV',
            book: data.book,
            chapter: data.chapter,
            verseNumber: data.verseNumber !== undefined ? data.verseNumber : data.verse || 1,
            text: data.text || '',
            orderIndex: data.orderIndex !== undefined ? data.orderIndex : 0,
            status: data.status || 'queued',
            retentionPhase: data.retentionPhase || 'none',
            dateStarted: data.dateStarted || null,
            lastReviewDate: data.lastReviewDate || null,
            nextReviewDueDate: data.nextReviewDueDate || null,
            currentStreakCount: data.currentStreakCount || 0,
            totalSuccessfulReviews: data.totalSuccessfulReviews || 0,
            gracePeriodUsedToday: data.gracePeriodUsedToday || false,
            dailyPhaseExtensionDays: data.dailyPhaseExtensionDays || 0,
            refresherActive: data.refresherActive || false,
            // These were previously dropped on load, which silently reset
            // banked mastery touches, the activity heatmap/streak (both
            // derived from touchLogs), and the individual/group badge on
            // every app restart.
            touchLogs: data.touchLogs || [],
            reviewsToday: data.reviewsToday || 0,
            // Omit these entirely rather than setting them to
            // `undefined` when absent -- Firestore's SDK throws on a field
            // literally valued `undefined` (unlike simply not having the
            // key), which was breaking the memory-queue auto-sync for every
            // verse not currently in a refresher.
            ...(data.origin !== undefined ? { origin: data.origin } : {}),
            ...(data.refresherReturnPhase !== undefined ? { refresherReturnPhase: data.refresherReturnPhase } : {}),
            ...(data.refresherReturnProgress !== undefined ? { refresherReturnProgress: data.refresherReturnProgress } : {}),
            ...(data.refresherTargetUnits !== undefined ? { refresherTargetUnits: data.refresherTargetUnits } : {}),
          });
        });
        loadedQueue.sort((a, b) => a.orderIndex - b.orderIndex);
        updateMemoryQueue(() => loadedQueue);
        // Baseline for the auto-sync's deletion diffing: what's in Firestore
        // right now is by definition already synced.
        prevSyncedQueueIdsRef.current = new Set(loadedQueue.map((i) => i.verseId));
      }

      // 4. Saved voice recordings (private to this user)
      console.log('Step 4: Fetching saved recordings...');
      try {
        const recordingsSnap = await getDocs(
          query(collection(db, 'users', currentUser.uid, 'recordings'), orderBy('createdAt', 'desc'))
        );
        setUserRecordings(recordingsSnap.docs.map((docSnap) => docSnap.data() as Recording));
      } catch (e) {
        handleFirestoreError(e, OperationType.GET, `users/${currentUser.uid}/recordings`);
      }

      triggerToast('Cloud profile and scripture data synchronized! ☁️');
    } catch (err) {
      console.error('Error in loadUserData master catch block:', err);
      triggerToast('Could not sync with Cloud storage.');
    }
  };

  // Firebase Auth State Listener & Data Loader
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setLoadingAuth(false);

      // Whatever circle/plan was being viewed belonged to whichever user (or
      // signed-out guest) was active before this auth transition — showing
      // it to a newly-signed-in different user would be stale and incorrect
      // (e.g. an old "Active" plan badge that doesn't reflect their real
      // membership). Reset on every auth transition, not just sign-out.
      setActiveCircle(null);
      setActiveCircleMembers([]);
      setActiveCircleStudyPlans([]);
      setJoinedStudyPlanMemberships([]);
      setJoinedStudyPlanDetails([]);
      setViewingStudyPlan(null);
      setViewingGroupDetail(false);
      setActiveGroupId('');
      setCommunitySubView('home');

      // Same reasoning -- a new sign-in shouldn't show the previous
      // account's (or guest session's) cumulative practice time.
      setTotalStudySeconds(0);
      studySessionStartRef.current = null;

      // Clear verses/memoryQueue synchronously, in the same tick as setUser
      // above (React 18 batches these into one render, before the `await`
      // below yields). Without this, the memoryQueue auto-sync effect
      // (keyed on [memoryQueue, user]) can fire with the PREVIOUS user's
      // still-in-state queue but the NEW user's uid already active, writing
      // stale data into the new account's real Firestore memoryQueue before
      // loadUserData below even gets a chance to establish a clean baseline.
      // Belt-and-suspenders on top of that: mark the queue un-hydrated (the
      // auto-sync refuses to run at all until this user's real queue has
      // loaded — otherwise a slow load could let the debounced sync commit
      // this transitional empty queue, deleting the account's real docs) and
      // reset the deletion-diff baseline, which still described the previous
      // account.
      queueHydratedRef.current = false;
      prevSyncedQueueIdsRef.current = new Set();
      setVerses([]);
      updateMemoryQueue(() => []);
      // Same reasoning applies to saved recordings — clear synchronously so a
      // just-signed-out or just-switched-to account never briefly shows the
      // previous user's "Recorded Chapters" list.
      setUserRecordings([]);

      if (currentUser) {
        await loadUserData(currentUser);
        queueHydratedRef.current = true;
        await loadMyCircles();
      } else {
        // Reset state to initial local data
        setVerses(INITIAL_VERSES);
        updateMemoryQueue(() => generateInitialQueue(INITIAL_VERSES));
        queueHydratedRef.current = true;
        setPreset('custom');
        setLearningDays(['M', 'W', 'F']);
        setNewVersesPace(3);
        setMaxReviewCap(15);
        setMyCircles([]);
        setCircleFriends([]);
        setDefaultRecordingVisibility(null);
        setAccountabilityDailyCapState(ACCOUNTABILITY_DEFAULT_DAILY_CAP);
        setAccountabilitySentLog({});
        setReceivedAccountabilityNudges([]);
        setActiveDMThread(null);
        setActiveDMMessages([]);
        setActiveDMOtherCircleIds([]);
        setActiveCircleChatId(null);
        setActiveCircleMessages([]);
        // Signed-out/guest preview only — matches the same "try before you
        // sign up" pattern as INITIAL_VERSES.
        setUserRecordings(INITIAL_RECORDINGS);
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  // Firebase's `User` object is mutated in place by updateProfile() -- simply
  // re-setting `user` to the same reference (auth.currentUser) wouldn't
  // trigger a re-render. Spreading its own enumerable properties into a
  // plain object gives a genuinely new reference while staying duck-type
  // compatible with every `user?.displayName`/`user?.uid`/`user?.photoURL`
  // read elsewhere in the app (all simple property reads, no method calls).
  const updateDisplayName = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || !auth.currentUser) return;
    try {
      await updateProfile(auth.currentUser, { displayName: trimmed });
      await setDoc(
        doc(db, 'profiles', auth.currentUser.uid),
        { displayName: trimmed, displayNameLower: trimmed.toLowerCase(), updatedAt: new Date() },
        { merge: true }
      );
      setUser({ ...auth.currentUser } as any);
      triggerToast('Display name updated! ✏️');
    } catch (err) {
      console.error('Failed to update display name:', err);
      triggerToast('Failed to update display name.');
    }
  };

  // Unlike the implicit first-save default (set once, silently, the first
  // time someone saves a recording), this is a real, always-available
  // editor for the same profiles/{uid}.defaultRecordingVisibility field.
  const updateDefaultRecordingVisibility = async (vis: 'private' | 'circle' | 'public') => {
    setDefaultRecordingVisibility(vis);
    if (!auth.currentUser) return;
    try {
      await setDoc(doc(db, 'profiles', auth.currentUser.uid), { defaultRecordingVisibility: vis }, { merge: true });
      triggerToast('Default recording visibility updated! 🎙️');
    } catch (err) {
      console.error('Failed to update default recording visibility:', err);
      triggerToast('Failed to update default recording visibility.');
    }
  };

  const dismissOnboarding = async () => {
    setShowOnboarding(false);
    setOnboardingStepInProgress(null);
    if (!auth.currentUser) return;
    try {
      await setDoc(doc(db, 'profiles', auth.currentUser.uid), { onboardingCompleted: true }, { merge: true });
    } catch (err) {
      console.error('Failed to persist onboarding completion:', err);
    }
  };

  // Derived completion for each of the 4 Getting-Started steps -- real state
  // where one exists (queued verses / a practiced touch / a joined circle),
  // step 1 is the one exception (purely informational, nothing to derive).
  // Steps are gated on this array in order: OnboardingScreen only lets step
  // N be started once onboardingStepComplete[N-1] is true.
  const onboardingStepComplete: [boolean, boolean, boolean, boolean] = [
    onboardingStep1Acknowledged,
    memoryQueue.length > 0,
    memoryQueue.some((item) => (item.touchLogs?.length || 0) > 0),
    myCircles.length > 0,
  ];

  // Hides the checklist, marks this step "in progress" (App.tsx swaps the
  // tab bar for a single "Back to Guide" bar and shows a per-step
  // instruction banner while this is set), then runs the real navigation
  // for that step.
  const startOnboardingStep = (index: number, navigateAction: () => void) => {
    if (index === 0) setOnboardingStep1Acknowledged(true);
    setShowOnboarding(false);
    setOnboardingStepInProgress(index);
    navigateAction();
  };

  const returnToOnboardingGuide = () => {
    setOnboardingStepInProgress(null);
    setShowOnboarding(true);
  };

  // One-time-per-step toast when the step the user is currently "out doing"
  // genuinely completes (real data changed), so they know to head back
  // instead of wondering whether they're done.
  useEffect(() => {
    if (onboardingStepInProgress === null) return;
    const idx = onboardingStepInProgress;
    if (onboardingStepComplete[idx] && !onboardingNudgedStepsRef.current.has(idx)) {
      onboardingNudgedStepsRef.current.add(idx);
      triggerToast('Nice work! Tap "Back to Guide" to continue. ✅');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingStepInProgress, memoryQueue, myCircles]);

  // Permanently deletes the signed-in account: every memoryQueue/verses/
  // recordings doc (+ their Storage audio files), the memoryPlans doc, this
  // member's doc in every circle they belong to, the profiles doc, and
  // finally the Firebase Auth user itself.
  //
  // Ordering is deliberate and safety-critical: `reauthPassword`, if given,
  // is applied FIRST, before touching any data. Firebase only reveals a
  // stale session by throwing 'auth/requires-recent-login' from deleteUser()
  // itself -- which is necessarily the LAST step (once it succeeds,
  // auth.currentUser is gone and any further Firestore write would fail
  // security rules requiring request.auth). Reauthenticating reactively
  // *after* deletion would risk the exact worst case this function must
  // avoid: real user data wiped, but the login credential still standing.
  // Doing it up front instead means the whole operation runs under a
  // guaranteed-fresh session or doesn't start at all.
  //
  // Google-signed-in accounts can't reauthenticate here directly (that flow
  // lives in the separate useGoogleSignIn hook, which needs a live component
  // to call from) -- SettingsScreen re-invokes signInWithGoogle() itself
  // first for those accounts, then calls this with no password.
  const deleteAccount = async (
    reauthPassword?: string
  ): Promise<{ ok: true } | { ok: false; requiresReauth: boolean; message: string }> => {
    if (!auth.currentUser) return { ok: false, requiresReauth: false, message: 'Not signed in.' };
    try {
      if (reauthPassword && auth.currentUser.email) {
        const cred = EmailAuthProvider.credential(auth.currentUser.email, reauthPassword);
        await reauthenticateWithCredential(auth.currentUser, cred);
      }

      const uid = auth.currentUser.uid;
      const [queueSnap, versesSnap, recordingsSnap] = await Promise.all([
        getDocs(collection(db, 'users', uid, 'memoryQueue')),
        getDocs(collection(db, 'users', uid, 'verses')),
        getDocs(collection(db, 'users', uid, 'recordings')),
      ]);

      const batch = writeBatch(db);
      queueSnap.docs.forEach((d) => batch.delete(d.ref));
      versesSnap.docs.forEach((d) => batch.delete(d.ref));
      recordingsSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(db, 'memoryPlans', uid));
      // Known limitation, documented rather than solved this pass: if this
      // member owns/leads any of these circles, its ownerId is simply left
      // pointing at the now-deleted uid -- same "orphaned reference, self-
      // heals on next load" tolerance loadMyCircles already has elsewhere.
      myCircles.forEach((c) => batch.delete(doc(db, 'circles', c.id, 'members', uid)));
      batch.delete(doc(db, 'profiles', uid));
      await batch.commit();

      // Storage deletes can't ride in a Firestore batch -- best-effort, one
      // failed audio file shouldn't block the rest of account deletion.
      await Promise.all(
        recordingsSnap.docs.map(async (d) => {
          const audioPath = d.data().audioPath;
          if (!audioPath) return;
          try {
            await deleteObject(storageRef(storage, audioPath));
          } catch (err) {
            console.error('Failed to delete a recording audio file during account deletion:', err);
          }
        })
      );

      await deleteUser(auth.currentUser);
      return { ok: true };
    } catch (err: any) {
      if (err?.code === 'auth/requires-recent-login') {
        return { ok: false, requiresReauth: true, message: 'Please confirm your identity to delete your account.' };
      }
      if (err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential') {
        return { ok: false, requiresReauth: true, message: 'Incorrect password.' };
      }
      console.error('Failed to delete account:', err);
      return { ok: false, requiresReauth: false, message: 'Failed to delete account. Please try again.' };
    }
  };

  // ==========================================
  // TIMERS & EFFECTS
  // ==========================================
  // NOTE: the web original also reset a `#phone_viewport` DOM node's scrollTop on
  // screen/tab change. That was working around every screen sharing one scrollable
  // container; here each screen is its own mounted component, so its ScrollView
  // naturally starts at the top on mount and no equivalent effect is needed.

  // Recording Timer -- keeps ticking while recording and not paused. Only
  // resets to 0 when recording stops entirely, not when merely paused, so
  // resuming continues from where the elapsed time left off.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isRecording && !isRecordingPaused) {
      interval = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else if (!isRecording) {
      setRecordingSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording, isRecordingPaused]);

  // Saved Recording Playback — real audio (via expo-audio) for recordings with
  // a Storage-backed audioUrl; falls back to a simulated progress timer for
  // mock entries that don't have one (e.g. the illustrative community feed).
  useEffect(() => {
    if (!playingRecordingId || !nowPlayingRecording?.audioUrl) return;
    // Recording leaves iOS's audio session configured for recording, which
    // can make playback silent/misrouted or end almost instantly — switch it
    // back to a playback-friendly mode every time before actually playing,
    // regardless of whether handleStopRecording already did so.
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).finally(() => {
      recordingPlayer.play();
      if (pendingSeekSecondsRef.current != null) {
        recordingPlayer.seekTo(pendingSeekSecondsRef.current);
        pendingSeekSecondsRef.current = null;
      }
    });
    return () => {
      // By the time this cleanup runs, playingRecordingId may have already
      // changed (e.g. playback just finished), which swaps recordingPlayer's
      // source and releases the underlying native player before this fires —
      // calling .pause() on it then throws NativeSharedObjectNotFoundException.
      // Pausing an already-released player is a no-op anyway, so swallow it.
      try {
        recordingPlayer.pause();
      } catch {
        // already released — nothing to pause
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingRecordingId, nowPlayingRecording?.audioUrl]);

  useEffect(() => {
    if (!playingRecordingId || !nowPlayingRecording?.audioUrl) return;
    if (recordingPlayerStatus.didJustFinish) {
      setPlayingRecordingId(null);
      setPlayingRecProgress(0);
      triggerToast('Recording playback completed.');
      return;
    }
    const totalSec = recordingPlayerStatus.duration || nowPlayingRecording.duration || 1;
    setPlayingRecProgress(Math.min(100, (recordingPlayerStatus.currentTime / totalSec) * 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingPlayerStatus, playingRecordingId, nowPlayingRecording?.audioUrl]);

  // No fake playback: a recording with no real Storage-backed audioUrl (e.g.
  // an illustrative guest-preview entry) can't actually play, so say so
  // honestly instead of running a simulated progress bar to a fake
  // "completed" toast.
  useEffect(() => {
    if (playingRecordingId && !nowPlayingRecording?.audioUrl) {
      setPlayingRecordingId(null);
      setPlayingRecProgress(0);
      triggerToast('No audio available for this recording.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingRecordingId, nowPlayingRecording]);

  // Seek the currently-playing real recording by a relative number of seconds
  // (used by RecordingDetailScreen's -5s/+5s buttons).
  const seekRecordingBy = async (deltaSeconds: number) => {
    if (!playingRecordingId || !nowPlayingRecording?.audioUrl) return;
    const totalSec = recordingPlayerStatus.duration || nowPlayingRecording.duration || 0;
    const newTime = Math.max(0, Math.min(totalSec, recordingPlayerStatus.currentTime + deltaSeconds));
    await recordingPlayer.seekTo(newTime);
  };

  // Jumps to an absolute point in a recording — used by the Verse Audio-Sync
  // Matrix's "tap a segment to preview it" buttons. If that recording isn't
  // already the one playing, starts it and defers the seek until playback
  // actually begins (recordingPlayer's source only exists once it's playing).
  const seekRecordingToTime = async (recording: Recording, seconds: number) => {
    if (playingRecordingId === recording.id) {
      await recordingPlayer.seekTo(seconds);
      return;
    }
    pendingSeekSecondsRef.current = seconds;
    setPlayingRecordingId(recording.id);
    setPlayingRecProgress(0);
  };

  // Memory Queue Auto-Sync: several actions (reordering, adding verses, deleting)
  // only mutate memoryQueue locally without their own explicit Firestore write.
  // Rather than remembering to add a batch write to every future mutation site,
  // mirror the queue to Firestore automatically whenever it changes (debounced),
  // including deleting documents for verses that were removed from the queue.
  useEffect(() => {
    if (!auth.currentUser) return;
    // Never sync before this user's real queue has been loaded — see the
    // auth listener for the account-switch race this prevents.
    if (!queueHydratedRef.current) return;
    if (queueSyncTimerRef.current) clearTimeout(queueSyncTimerRef.current);

    queueSyncTimerRef.current = setTimeout(async () => {
      const uid = auth.currentUser?.uid;
      if (!uid || !queueHydratedRef.current) return;

      const currentIds = new Set(memoryQueue.map((item) => item.verseId));
      const removedIds = [...prevSyncedQueueIdsRef.current].filter((id) => !currentIds.has(id));

      try {
        const batch = writeBatch(db);
        memoryQueue.forEach((item) => {
          batch.set(doc(db, 'users', uid, 'memoryQueue', item.verseId), item);
        });
        removedIds.forEach((id) => {
          batch.delete(doc(db, 'users', uid, 'memoryQueue', id));
        });
        await batch.commit();
        prevSyncedQueueIdsRef.current = currentIds;
      } catch (err) {
        console.error('Failed to auto-sync memory queue to Firestore:', err);
      }
    }, 800);

    return () => {
      if (queueSyncTimerRef.current) clearTimeout(queueSyncTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoryQueue, user]);

  // Format record duration
  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Date formatter
  const getTodayDateString = () => {
    const options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' };
    return new Date().toLocaleDateString('en-US', options);
  };

  // Time-of-day greeting -- was hardcoded "Good morning" regardless of actual time.
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 5) return 'Good night';
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    if (hour < 21) return 'Good evening';
    return 'Good night';
  };

  // ==========================================
  // 7-6-5 DETERMINISTIC RETENTION ENGINE & HELPERS
  // ==========================================
  const getTodayAbbreviation = () => DAY_ABBREVS[getLogicalDate(dayStartHour).getDay()];

  const isTodayLearningDay = () => {
    const todayAbbr = getTodayAbbreviation();
    if (sabbathEnabled && todayAbbr === sabbathDay) return false;
    return learningDays.includes(todayAbbr);
  };

  // Wraps setDate + sabbath-adjustment + toISOString for the many places
  // handleReviewCompleted schedules a next-due date, so a sabbath day never
  // ends up as a scheduled due date.
  const nextDueDateISO = (days: number) => {
    const d = getLogicalDate(dayStartHour);
    d.setDate(d.getDate() + days);
    return advancePastSabbath(d, sabbathEnabled, sabbathDay).toISOString();
  };

  const validateTouch = (item: QueueItem, _type: 'speak' | 'type' | 'reveal'): boolean => {
    if (!item.touchLogs || item.touchLogs.length === 0) return true;
    const lastTouch = item.touchLogs[item.touchLogs.length - 1];
    const lastTime = new Date(lastTouch.timestamp).getTime();
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    return now - lastTime >= ONE_HOUR;
  };

  // A quick spaced-repetition review (you already know the verse, you're
  // just confirming recall) is fast -- flat per-verse, not tiered by phase.
  // A fresh Learning-phase touch is real, unhurried practice, so it costs
  // much more per verse. (2026-07: the old 30/45/60s daily/weekly/monthly
  // tiering plus 120s/learning verse was making the estimate feel wildly
  // inflated in practice -- simplified to these two flat numbers.)
  const REVIEW_SECONDS_PER_VERSE = 25;
  const LEARNING_SECONDS_PER_VERSE = 180;

  // Shared by getEstimatedReviewTime (today only) and getMemoryLoadForecast
  // (today + future days), so both always price a "due review" the same
  // way and never quietly disagree. For today, a missing due date or one
  // whose calendar day is today-or-earlier counts as due; for a future day,
  // only an exact due-date match counts.
  const computeDayReviewLoad = (queue: QueueItem[], date: Date, isToday: boolean) => {
    let seconds = 0;
    let count = 0;
    queue.forEach((item) => {
      if (item.status !== 'reviewing') return;
      const due = item.nextReviewDueDate ? new Date(item.nextReviewDueDate) : null;
      const isDue = isToday ? isReviewDue(item.nextReviewDueDate, date) : !!due && due.toDateString() === date.toDateString();
      if (!isDue) return;
      count += 1;
      seconds += REVIEW_SECONDS_PER_VERSE;
    });
    return { seconds, count };
  };

  const getEstimatedReviewTime = (queue: QueueItem[], sensitivity: 'low' | 'medium' | 'high') => {
    const learningSeconds = queue.filter((item) => item.status === 'learning').length * LEARNING_SECONDS_PER_VERSE;
    const { seconds: reviewSeconds } = computeDayReviewLoad(queue, getLogicalDate(dayStartHour), true);
    const multiplier = sensitivity === 'low' ? 0.75 : sensitivity === 'high' ? 1.5 : 1.0;
    return Math.ceil(((learningSeconds + reviewSeconds) * multiplier) / 60);
  };

  // Projects daily memorization workload for the next `days` days, sharing
  // computeDayReviewLoad's math with getEstimatedReviewTime so "today" here
  // always matches Home's real today-estimate, and using the plan's actual
  // learningDays instead of a fake "every other day" guess. Learning-phase
  // items are treated as an ongoing cost that doesn't shrink (this doesn't
  // simulate future mastery graduations); verses newly pulled on a future
  // learning day join that ongoing cost starting the day they're pulled.
  const getMemoryLoadForecast = (
    queue: QueueItem[],
    sensitivity: 'low' | 'medium' | 'high',
    learningDaysList: string[],
    pace: number,
    days: number
  ) => {
    const baseLearningCount = queue.filter((item) => item.status === 'learning').length;
    const multiplier = sensitivity === 'low' ? 0.75 : sensitivity === 'high' ? 1.5 : 1.0;
    let cumulativeNewVerses = 0;

    return Array.from({ length: days }, (_, i) => {
      const date = getLogicalDate(dayStartHour);
      date.setDate(date.getDate() + i);
      const isLearnDay = learningDaysList.includes(DAY_ABBREVS[date.getDay()]);
      // Today's own pull, if any, is already reflected in the real queue
      // (baseLearningCount) -- only project pulls for days after today.
      if (i > 0 && isLearnDay) cumulativeNewVerses += pace;

      const { seconds: reviewSeconds, count: dueReviewCount } = computeDayReviewLoad(queue, date, i === 0);
      const learningCount = baseLearningCount + cumulativeNewVerses;
      const loadMins = Math.ceil(((reviewSeconds + learningCount * LEARNING_SECONDS_PER_VERSE) * multiplier) / 60);

      return { date, isLearnDay, loadMins, versesCount: learningCount + dueReviewCount };
    });
  };

  // `bypassShield`: the caller (HomeScreen) already showed an "are you
  // sure?" confirm card explaining the shield is active and re-invokes with
  // this set once the user confirms they want to pull anyway -- see the
  // Pull New Verses button. Every other guard (non-learning-day, nothing
  // left queued) still applies unconditionally; only the review-time shield
  // itself is bypassable, since that's the one guarding a real but
  // reversible choice ("I know reviews are already full today, pull more
  // anyway"), not a hard constraint.
  const triggerDailyPull = async (opts?: { bypassShield?: boolean }) => {
    if (!isTodayLearningDay()) {
      triggerToast(`Today (${getTodayAbbreviation()}) is a non-learning day. Focus on reviews! 📅`);
      return;
    }

    const estTime = getEstimatedReviewTime(memoryQueue, cognitiveLoadSensitivity);
    if (estTime >= maxReviewCap && !opts?.bypassShield) {
      triggerToast(`Review Shield is Active! Review time (${estTime}m) >= limit (${maxReviewCap}m). No new verses pulled today. 🛡️`);
      return;
    }

    if (!memoryQueue.some((item) => item.status === 'queued')) {
      triggerToast('No more queued verses to pull! 🎉');
      return;
    }

    // Blends the personal queue with however many StudyPlans this member has
    // joined, at whatever pace/priority each calls for -- see
    // src/lib/studyPlanScheduler.ts for the full resolution rules (additive
    // plans first and uncapped, then group-priority > individual >
    // individual-priority within the personal daily budget).
    const personal: PersonalPacingSettings = { newVersesPace, learningDays };
    const { verseIds: pulledVerseIds, fromIndividual, fromPlans } = computeDailyPull(
      memoryQueue,
      personal,
      joinedStudyPlanDetails,
      joinedStudyPlanMemberships,
      new Date()
    );

    if (pulledVerseIds.length === 0) {
      triggerToast('No more queued verses to pull! 🎉');
      return;
    }

    const pulledSet = new Set(pulledVerseIds);
    const itemsToPull = memoryQueueRef.current.filter((item) => pulledSet.has(item.verseId));

    const updatedQueue = memoryQueueRef.current.map((item) => {
      if (!pulledSet.has(item.verseId)) return item;
      return {
        ...item,
        status: 'learning' as const,
        dateStarted: new Date().toISOString(),
        lastReviewDate: null,
        nextReviewDueDate: null,
        currentStreakCount: 0,
        totalSuccessfulReviews: 0,
        gracePeriodUsedToday: false,
      };
    });

    updateMemoryQueue(() => updatedQueue);

    if (auth.currentUser) {
      try {
        const batch = writeBatch(db);
        itemsToPull.forEach((item) => {
          const docRef = doc(db, 'users', auth.currentUser!.uid, 'memoryQueue', item.verseId);
          batch.set(docRef, {
            ...item,
            status: 'learning',
            dateStarted: new Date().toISOString(),
            lastReviewDate: null,
            nextReviewDueDate: null,
            currentStreakCount: 0,
            totalSuccessfulReviews: 0,
            gracePeriodUsedToday: false,
          });
        });
        await batch.commit();
      } catch (err) {
        console.error('Failed to commit pull batch to firestore:', err);
      }
    }

    const planBreakdown = Object.entries(fromPlans)
      .map(([planId, ids]) => {
        const planName = joinedStudyPlanDetails.find((p) => p.planId === planId)?.name || 'a study plan';
        return `${ids.length} from "${planName}"`;
      })
      .join(', ');
    const breakdown =
      fromIndividual.length > 0 && planBreakdown
        ? ` (${fromIndividual.length} individual, ${planBreakdown})`
        : planBreakdown
          ? ` (${planBreakdown})`
          : '';

    triggerToast(
      `Successfully pulled ${pulledVerseIds.length} new ${pulledVerseIds.length === 1 ? 'verse' : 'verses'} into your learning queue!${breakdown} 🚀`
    );
  };

  // Manually moves specific queued verses straight into Learning, bypassing
  // triggerDailyPull's pace/learning-day/review-cap gating -- those exist to
  // keep the *automatic* daily pull from overloading a non-learning day, but
  // a deliberate "start this verse now" action is a different, intentional
  // choice and shouldn't be blocked by them. Persistence is handled by the
  // existing debounced memoryQueue auto-sync effect, same as every other
  // queue mutation (reorder, delete, add).
  const promoteToLearning = (verseIds: string[]) => {
    const idSet = new Set(verseIds);
    const nowISO = new Date().toISOString();
    let promotedCount = 0;
    updateMemoryQueue((prev) =>
      prev.map((item) => {
        if (!idSet.has(item.verseId) || item.status !== 'queued') return item;
        promotedCount++;
        return {
          ...item,
          status: 'learning' as const,
          dateStarted: nowISO,
          lastReviewDate: null,
          nextReviewDueDate: null,
          currentStreakCount: 0,
          totalSuccessfulReviews: 0,
          gracePeriodUsedToday: false,
        };
      })
    );
    if (promotedCount > 0) {
      triggerToast(`Moved ${promotedCount === 1 ? 'that verse' : `${promotedCount} verses`} into Learning! 📖`);
    }
  };

  // Adds specific already-fetched verses (e.g. a selection made on
  // ChapterLandingScreen, which already has real text loaded) to the queue
  // as 'queued' items. Skips any verse whose verseId is already present in
  // the queue in any status, rather than duplicating it -- selecting a mix
  // of new and already-queued/learning/reviewing verses just adds the new
  // ones. Persistence is handled by the existing debounced auto-sync
  // effect, same as every other queue mutation.
  const addVersesToQueue = (versesToAdd: VerseState[], translationId: string) => {
    const existingIds = new Set(memoryQueueRef.current.map((q) => q.verseId));
    const newItems: QueueItem[] = [];
    let skipped = 0;
    versesToAdd.forEach((v) => {
      const bookMeta = getBookByName(v.book);
      if (!bookMeta) {
        skipped++;
        return;
      }
      const verseId = buildVerseId(translationId, bookMeta.id, v.chapter, v.verse);
      if (existingIds.has(verseId)) {
        skipped++;
        return;
      }
      existingIds.add(verseId); // guards against duplicate verses within versesToAdd itself
      newItems.push({
        verseId,
        translationId,
        book: v.book,
        chapter: v.chapter,
        verseNumber: v.verse,
        text: v.text,
        orderIndex: memoryQueueRef.current.length + newItems.length,
        status: 'queued',
        origin: 'individual',
        retentionPhase: 'none',
        dateStarted: null,
        lastReviewDate: null,
        nextReviewDueDate: null,
        currentStreakCount: 0,
        totalSuccessfulReviews: 0,
        gracePeriodUsedToday: false,
      });
    });

    if (newItems.length === 0) {
      triggerToast(skipped > 0 ? 'Those verses are already in your Memory Queue.' : 'No verses to add.');
      return;
    }

    updateMemoryQueue((prev) => [...prev, ...newItems]);
    const skippedNote = skipped > 0 ? ` (${skipped} already in queue, skipped)` : '';
    triggerToast(
      `Added ${newItems.length} ${newItems.length === 1 ? 'verse' : 'verses'} to your Memory Queue!${skippedNote} 📖`
    );
  };

  // Manually places a set of verses at a specific point in the memory-
  // progression ladder, bypassing the normal learn-then-graduate flow --
  // for verses already memorized outside the app (e.g. "I already know all
  // of Ephesians, put it straight into Weekly review"). Creates a fresh
  // QueueItem for any verse not yet queued; overwrites an existing one's
  // phase/streak/schedule fields in place otherwise. Every demotion-
  // softening/mastery-touch field is cleared to a blank slate for the new
  // phase, since this is a deliberate manual reset, not a real graduation.
  //
  // targetWeekday (weekly/monthly only) lets a batch's review cycle land on
  // a chosen day of the week -- since a phase's due date always recurs by a
  // fixed number of days from wherever it first starts (7 for weekly, 30
  // for monthly), picking which day the FIRST one lands on is all that's
  // needed to keep every future cycle on that same weekday.
  const overrideVerseMemoryStatus = (
    versesToOverride: VerseState[],
    targetPhase: 'learning' | 'daily' | 'weekly' | 'monthly' | 'retained',
    translationId: string,
    targetWeekday?: string
  ) => {
    const nowISO = new Date().toISOString();
    const existingByVerseId = new Map(memoryQueueRef.current.map((q) => [q.verseId, q]));
    const cycleDays = targetPhase === 'daily' ? 1 : targetPhase === 'weekly' ? 7 : 30;

    const dueDateISO: string | null =
      targetPhase === 'learning' || targetPhase === 'retained'
        ? null
        : targetWeekday && (targetPhase === 'weekly' || targetPhase === 'monthly')
          ? nextOccurrenceOfWeekday(getLogicalDate(dayStartHour), targetWeekday, sabbathEnabled, sabbathDay).toISOString()
          : nextDueDateISO(cycleDays);

    const nextQueue = [...memoryQueueRef.current];
    const additions: QueueItem[] = [];
    let updatedCount = 0;

    versesToOverride.forEach((v) => {
      const bookMeta = getBookByName(v.book);
      if (!bookMeta) return;
      const verseId = buildVerseId(translationId, bookMeta.id, v.chapter, v.verse);
      const existing = existingByVerseId.get(verseId);

      const base: QueueItem = existing
        ? { ...existing }
        : {
            verseId,
            translationId,
            book: v.book,
            chapter: v.chapter,
            verseNumber: v.verse,
            text: v.text,
            orderIndex: memoryQueueRef.current.length + additions.length,
            status: 'queued',
            origin: 'individual',
            retentionPhase: 'none',
            dateStarted: null,
            lastReviewDate: null,
            nextReviewDueDate: null,
            currentStreakCount: 0,
            totalSuccessfulReviews: 0,
            gracePeriodUsedToday: false,
          };

      delete base.touchLogs;
      base.reviewsToday = 0;
      base.gracePeriodUsedToday = false;
      base.dailyPhaseExtensionDays = 0;
      delete base.refresherActive;
      delete base.refresherReturnPhase;
      delete base.refresherReturnProgress;
      delete base.refresherTargetUnits;

      if (targetPhase === 'learning') {
        base.status = 'learning';
        base.retentionPhase = 'none';
        base.dateStarted = nowISO;
        base.lastReviewDate = null;
        base.nextReviewDueDate = null;
        base.currentStreakCount = 0;
      } else if (targetPhase === 'retained') {
        base.status = 'retained';
        base.retentionPhase = 'none';
        base.dateStarted = base.dateStarted || nowISO;
        base.nextReviewDueDate = null;
        base.currentStreakCount = 0;
      } else {
        base.status = 'reviewing';
        base.retentionPhase = targetPhase;
        base.dateStarted = base.dateStarted || nowISO;
        base.lastReviewDate = base.lastReviewDate || nowISO;
        base.currentStreakCount = 1;
        base.nextReviewDueDate = dueDateISO;
      }

      if (existing) {
        const idx = nextQueue.findIndex((q) => q.verseId === verseId);
        if (idx !== -1) nextQueue[idx] = base;
        updatedCount++;
      } else {
        additions.push(base);
      }
    });

    const total = updatedCount + additions.length;
    if (total === 0) {
      triggerToast('No recognized verses to update.');
      return;
    }

    updateMemoryQueue(() => [...nextQueue, ...additions]);

    const phaseLabel =
      targetPhase === 'learning'
        ? 'Learning'
        : targetPhase === 'retained'
          ? 'Retained'
          : `${targetPhase[0].toUpperCase()}${targetPhase.slice(1)} Review`;
    const dueNote = dueDateISO
      ? ` Next due ${new Date(dueDateISO).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}.`
      : '';
    triggerToast(`Set ${total} ${total === 1 ? 'verse' : 'verses'} to ${phaseLabel}.${dueNote} 🎯`);
  };

  // `opts.perfect` — accuracy tier of the practice run behind this result
  // (graded in src/lib/recitation.ts). A success with perfect === false was
  // "close enough" (>= 90% word accuracy): it still counts as a completed
  // spaced-repetition review, but does NOT bank a mastery touch for a
  // learning verse — touches require a perfect run. Omitted (undefined)
  // means the drill couldn't measure accuracy (e.g. reveal mode's
  // self-assessment) and is treated as the user claiming a perfect run.
  const handleReviewCompleted = async (
    item: QueueItem,
    success: boolean,
    drillType?: 'speak' | 'type' | 'reveal',
    opts?: { perfect?: boolean }
  ) => {
    let updatedItem = { ...item };
    updatedItem.lastReviewDate = new Date().toISOString();

    // Catch up on any full review cycles silently missed while the app
    // wasn't opened -- being late is the same kind of "miss" as an active
    // failed attempt, just detected from elapsed time instead of a tap.
    // Being less than one full cycle late isn't a miss at all, which is
    // also what gives due dates their day-or-two of natural flexibility.
    // Any sabbath days in the elapsed span don't count as elapsed time --
    // the engine treats them as though they didn't happen at all.
    if (item.status === 'reviewing' && updatedItem.nextReviewDueDate) {
      const cycleLengthDays = updatedItem.retentionPhase === 'weekly' ? 7 : updatedItem.retentionPhase === 'monthly' ? 30 : 1;
      const dueDate = new Date(updatedItem.nextReviewDueDate);
      const now = getLogicalDate(dayStartHour);
      const rawElapsedDays = Math.floor((now.getTime() - dueDate.getTime()) / (24 * 3600 * 1000));
      const sabbathDaysElapsed = sabbathEnabled ? countSabbathDaysInRange(dueDate, now, sabbathDay) : 0;
      const adjustedElapsedDays = Math.max(0, rawElapsedDays - sabbathDaysElapsed);
      const missedCycles = Math.max(0, Math.floor(adjustedElapsedDays / cycleLengthDays));
      let lastMissTag: ReturnType<typeof applyMissToItem> = 'none';
      for (let i = 0; i < missedCycles; i++) {
        lastMissTag = applyMissToItem(updatedItem);
      }
      if (missedCycles > 0) {
        if (lastMissTag !== 'grace' && lastMissTag !== 'none') {
          updatedItem.reviewsToday = 0;
        }
        const dailyGraduationDaysTotal = dailyPhaseWeeks * 7 + (updatedItem.dailyPhaseExtensionDays || 0);
        const message = describeMissOutcome(lastMissTag, updatedItem, dailyGraduationDaysTotal);
        if (message) {
          triggerToast(`${missedCycles} review cycle${missedCycles > 1 ? 's' : ''} passed unattempted. ${message}`);
        }
      }
    }

    if (success) {
      if (item.status === 'learning') {
        // Perfection gate: a run with any missed words never banks a touch,
        // no matter how close — "close enough" only exists for reviews.
        if (opts?.perfect === false) {
          triggerToast('Good recall! A run must be perfect (no missed words) to bank a mastery touch. 🔒');
          return;
        }
        // 3-Touch Mastery Gate checks. PracticeModals' Learn/Reveal tabs
        // always pass an explicit drillType now; 'speak' only remains as a
        // fallback for any caller that doesn't.
        const inferredType = drillType || 'speak';
        const isValid = validateTouch(item, inferredType);

        if (isValid) {
          const newTouch: TouchLog = {
            timestamp: new Date().toISOString(),
            drillType: inferredType,
          };
          const updatedLogs = [...(item.touchLogs || []), newTouch];
          updatedItem.touchLogs = updatedLogs;
          updatedItem.totalSuccessfulReviews += 1;
          updatedItem.currentStreakCount += 1;

          if (updatedLogs.length >= masteryTouches) {
            // Retention beats new learning: a verse can bank all its touches,
            // but doesn't actually graduate to spaced review while other
            // verses still have reviews due today. It releases automatically
            // the moment the last due review clears (see the sweep at the
            // end of this function).
            const dueReviewsPending = memoryQueueRef.current.some(
              (q) =>
                q.verseId !== item.verseId &&
                q.status === 'reviewing' &&
                isReviewDue(q.nextReviewDueDate, getLogicalDate(dayStartHour))
            );
            if (dueReviewsPending) {
              triggerToast(`Mastery touches complete (${updatedLogs.length}/${masteryTouches})! Finish today's reviews to lock this verse in. 🔒`);
            } else {
              updatedItem.status = 'reviewing';
              updatedItem.retentionPhase = 'daily';
              updatedItem.dateStarted = new Date().toISOString();
              updatedItem.currentStreakCount = 1;
              updatedItem.nextReviewDueDate = nextDueDateISO(1);
              updatedItem.reviewsToday = 0;
              triggerToast('Passage mastered! Transitioned to 7-6-5 spaced review. 🎉');
            }
          } else {
            triggerToast(`Recall logged! Mastery progress: ${updatedLogs.length}/${masteryTouches} touches. 🌟`);
          }
        } else {
          triggerToast('Touch logged, but within 1-hour constraint. Only 1 touch per hour counts toward Mastery! ⏳');
        }
      } else if (item.status === 'reviewing') {
        // Check reviewsRequired per day constraint
        const lastReviewDateStr = item.lastReviewDate;
        const isSameDay =
          lastReviewDateStr &&
          getLogicalDate(dayStartHour, new Date(lastReviewDateStr)).toDateString() === getLogicalDate(dayStartHour).toDateString();
        const currentReviewsToday = isSameDay ? (item.reviewsToday || 0) + 1 : 1;
        updatedItem.reviewsToday = currentReviewsToday;
        updatedItem.totalSuccessfulReviews += 1;
        updatedItem.gracePeriodUsedToday = false;

        // Graduation thresholds derived from the plan's retention rigor
        // (weeks/months/years -> review-count thresholds the engine checks).
        // Daily's own target also grows permanently from past misses (see
        // applyMissToItem); Weekly/Monthly instead send misses to a
        // temporary refresher rather than extending their own target.
        const dailyGraduationDays = dailyPhaseWeeks * 7 + (updatedItem.dailyPhaseExtensionDays || 0);
        const weeklyGraduationReviews = Math.round(weeklyPhaseMonths * (52 / 12));
        const monthlyGraduationReviews = monthlyPhaseYears * 12;

        if (currentReviewsToday >= reviewsRequired) {
          // Advances once per completed day/week/month cycle (not once per
          // rep), so it accurately tracks elapsed cycles even when "Reviews
          // Required per Day" is set above 1.
          updatedItem.currentStreakCount += 1;

          // Chapter review-day anchoring ("Snap-to-Grid"): tomorrow is the
          // earliest a freshly-computed Weekly/Monthly due date can land,
          // matching nextDueDateISO's own "at least one day out" convention.
          const tomorrow = getLogicalDate(dayStartHour);
          tomorrow.setDate(tomorrow.getDate() + 1);

          if (updatedItem.refresherActive) {
            if (updatedItem.currentStreakCount >= (updatedItem.refresherTargetUnits || 1)) {
              const returnPhase = updatedItem.refresherReturnPhase || 'weekly';
              updatedItem.retentionPhase = returnPhase;
              updatedItem.currentStreakCount = updatedItem.refresherReturnProgress || 1;
              updatedItem.refresherActive = false;
              // delete rather than set to undefined -- Firestore's setDoc()
              // rejects explicit undefined field values at runtime.
              delete updatedItem.refresherReturnPhase;
              delete updatedItem.refresherReturnProgress;
              delete updatedItem.refresherTargetUnits;
              // Clearing a refresher is a transition back to steady-state
              // review, just like a real graduation -- re-anchor the same way.
              const returnAnchor =
                updatedItem.chapterReviewAnchorDay ||
                findChapterReviewAnchor(updatedItem.book, updatedItem.chapter, memoryQueueRef.current) ||
                DAY_ABBREVS[getLogicalDate(dayStartHour).getDay()];
              updatedItem.chapterReviewAnchorDay = returnAnchor;
              updatedItem.nextReviewDueDate = nthOccurrenceOfWeekday(
                tomorrow,
                returnAnchor,
                returnPhase === 'monthly' ? 4 : 1,
                sabbathEnabled,
                sabbathDay
              ).toISOString();
              triggerToast(
                `Refresher complete! Back to ${returnPhase === 'monthly' ? 'Monthly' : 'Weekly'} review, resuming right where you left off, aligned to ${DAY_FULL_NAMES[returnAnchor]}. 🌟`
              );
            } else {
              updatedItem.nextReviewDueDate = nextDueDateISO(updatedItem.retentionPhase === 'weekly' ? 7 : 1);
              triggerToast(`Refresher review complete! (${updatedItem.currentStreakCount}/${updatedItem.refresherTargetUnits}) 📅`);
            }
          } else if (updatedItem.retentionPhase === 'daily') {
            if (updatedItem.currentStreakCount >= dailyGraduationDays) {
              updatedItem.retentionPhase = 'weekly';
              updatedItem.currentStreakCount = 1;
              updatedItem.dailyPhaseExtensionDays = 0;
              // First graduation out of Daily for this chunk -- adopt a
              // sibling chunk's existing anchor if this chapter already has
              // one, otherwise this chunk sets it for the whole chapter.
              const anchor =
                findChapterReviewAnchor(updatedItem.book, updatedItem.chapter, memoryQueueRef.current) ||
                DAY_ABBREVS[getLogicalDate(dayStartHour).getDay()];
              updatedItem.chapterReviewAnchorDay = anchor;
              updatedItem.nextReviewDueDate = nthOccurrenceOfWeekday(tomorrow, anchor, 1, sabbathEnabled, sabbathDay).toISOString();
              triggerToast(`Graduated to Weekly Review phase, aligned to ${DAY_FULL_NAMES[anchor]} with the rest of ${updatedItem.book} ${updatedItem.chapter}! 🌟`);
            } else {
              updatedItem.nextReviewDueDate = nextDueDateISO(1);
              triggerToast('Daily reviews complete! Spaced date advanced. 📅');
            }
          } else if (updatedItem.retentionPhase === 'weekly') {
            if (updatedItem.currentStreakCount >= weeklyGraduationReviews) {
              updatedItem.retentionPhase = 'monthly';
              updatedItem.currentStreakCount = 1;
              // Should already have an anchor from the Daily->Weekly step --
              // only a legacy pre-feature weekly item transitioning for the
              // first time under this code would still be missing one.
              const anchor =
                updatedItem.chapterReviewAnchorDay ||
                findChapterReviewAnchor(updatedItem.book, updatedItem.chapter, memoryQueueRef.current) ||
                DAY_ABBREVS[getLogicalDate(dayStartHour).getDay()];
              updatedItem.chapterReviewAnchorDay = anchor;
              updatedItem.nextReviewDueDate = nthOccurrenceOfWeekday(tomorrow, anchor, 4, sabbathEnabled, sabbathDay).toISOString();
              triggerToast(`Graduated to Monthly Review phase, still aligned to ${DAY_FULL_NAMES[anchor]}! 🌟`);
            } else if (updatedItem.chapterReviewAnchorDay) {
              updatedItem.nextReviewDueDate = nthOccurrenceOfWeekday(
                tomorrow,
                updatedItem.chapterReviewAnchorDay,
                1,
                sabbathEnabled,
                sabbathDay
              ).toISOString();
              triggerToast('Weekly review complete! Spaced date advanced. 📅');
            } else {
              // Not retroactive -- a legacy weekly item with no anchor yet
              // keeps the old unanchored math until it actually transitions.
              updatedItem.nextReviewDueDate = nextDueDateISO(7);
              triggerToast('Weekly review complete! Spaced date advanced. 📅');
            }
          } else if (updatedItem.retentionPhase === 'monthly') {
            if (updatedItem.currentStreakCount >= monthlyGraduationReviews) {
              updatedItem.status = 'retained';
              updatedItem.retentionPhase = 'none';
              updatedItem.nextReviewDueDate = null;
              triggerToast('Successfully RETAINED forever! 🏆🎉');
            } else if (updatedItem.chapterReviewAnchorDay) {
              updatedItem.nextReviewDueDate = nthOccurrenceOfWeekday(
                tomorrow,
                updatedItem.chapterReviewAnchorDay,
                4,
                sabbathEnabled,
                sabbathDay
              ).toISOString();
              triggerToast('Monthly review complete! Spaced date advanced. 📅');
            } else {
              // Not retroactive -- see the Weekly same-phase branch above.
              updatedItem.nextReviewDueDate = nextDueDateISO(30);
              triggerToast('Monthly review complete! Spaced date advanced. 📅');
            }
          }
          updatedItem.reviewsToday = 0; // Reset for next review cycle
        } else {
          triggerToast(`Review logged! (${currentReviewsToday}/${reviewsRequired} required for today) 📅`);
        }
      }
    } else {
      // FAILED REVIEW (today's actual attempt, on top of any catch-up above)
      if (item.status === 'reviewing') {
        const tag = applyMissToItem(updatedItem);
        if (tag !== 'grace' && tag !== 'none') {
          updatedItem.reviewsToday = 0;
        }
        const dailyGraduationDaysTotal = dailyPhaseWeeks * 7 + (updatedItem.dailyPhaseExtensionDays || 0);
        const message = describeMissOutcome(tag, updatedItem, dailyGraduationDaysTotal);
        if (message) triggerToast(message);
      } else {
        triggerToast('Incorrect. Keep practicing! 🔄');
      }
    }

    // A "reviewing" item was just resolved (success or failure), which may
    // have cleared the last due review for today. If so, release any
    // learning verses that banked all their mastery touches while reviews
    // were still pending (see the touch-gate above) -- retention comes
    // first, but a fully-touched verse shouldn't wait a moment longer than
    // it has to once nothing is left to review.
    // Built through updateMemoryQueue (the always-current ref), NOT the
    // render-time memoryQueue snapshot: when a passage of several verses is
    // completed together, this function runs once per verse in the same
    // interaction, and rebuilding from the stale snapshot made each call
    // erase the previous verse's update.
    let releasedCount = 0;
    updateMemoryQueue((prev) => {
      let finalQueue = prev.map((q) => (q.verseId === item.verseId ? updatedItem : q));
      if (item.status === 'reviewing') {
        const dueReviewsRemaining = finalQueue.some(
          (q) => q.status === 'reviewing' && isReviewDue(q.nextReviewDueDate, getLogicalDate(dayStartHour))
        );
        if (!dueReviewsRemaining) {
          finalQueue = finalQueue.map((q) => {
            if (q.status === 'learning' && (q.touchLogs?.length || 0) >= masteryTouches) {
              releasedCount++;
              return {
                ...q,
                status: 'reviewing' as const,
                retentionPhase: 'daily' as const,
                dateStarted: new Date().toISOString(),
                currentStreakCount: 1,
                nextReviewDueDate: nextDueDateISO(1),
                reviewsToday: 0,
              };
            }
            return q;
          });
        }
      }
      return finalQueue;
    });
    if (releasedCount > 0) {
      triggerToast(
        `All reviews done! ${releasedCount} verse${releasedCount > 1 ? 's' : ''} locked in and moved to spaced review. 🔓`
      );
    }

    if (auth.currentUser) {
      try {
        const docRef = doc(db, 'users', auth.currentUser.uid, 'memoryQueue', item.verseId);
        await setDoc(docRef, updatedItem);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${auth.currentUser.uid}/memoryQueue/${item.verseId}`);
      }

      // Real activity-feed milestone: only fires on the actual queued->retained
      // transition (never re-fires on subsequent successful reviews of an
      // already-retained item). If every other verse from this same
      // book+chapter already in the queue is also retained, this is a whole
      // chapter finishing, not just one verse.
      const justRetained = item.status !== 'retained' && updatedItem.status === 'retained';
      if (justRetained) {
        const chapterMates = memoryQueueRef.current.filter((q) => q.book === item.book && q.chapter === item.chapter);
        const isChapterComplete = chapterMates.every((q) => q.verseId === item.verseId || q.status === 'retained');
        const eventId = `evt_${Date.now()}`;
        const eventData = {
          uid: auth.currentUser.uid,
          authorName: auth.currentUser.displayName || 'Someone',
          book: item.book,
          chapter: item.chapter,
          ...(isChapterComplete
            ? { type: 'chapter' as const, verseCount: chapterMates.length }
            : { type: 'verse' as const, verse: item.verseNumber }),
          createdAt: serverTimestamp(),
        };
        try {
          await setDoc(doc(db, 'activityEvents', eventId), eventData);
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `activityEvents/${eventId}`);
        }
      }
    }
  };

  const triggerMockDueReviews = async () => {
    if (memoryQueue.length === 0) {
      triggerToast('Your memory queue is empty! Please add some verses first.');
      return;
    }

    // Undoes today's completed reviews -- and ONLY those. A verse qualifies
    // solely by having lastReviewDate on today's calendar date (i.e. you
    // actually completed it today); its nextReviewDueDate gets pushed back
    // to due so it reappears in Due Reviews. Nothing else about the verse
    // is touched -- not retentionPhase, not streaks, not lastReviewDate
    // itself, and nothing reviewed on any earlier day is affected at all.
    // (An earlier version of this button touched every verse currently in
    // ANY review phase regardless of when it was last reviewed, which on a
    // real account with a large memorized library meant hundreds of verses
    // with real, varied schedules all got collapsed to "due right now" in
    // one click -- their real per-verse due dates aren't recoverable from
    // here. This version is deliberately narrow to make that impossible.)
    const todayStr = getLogicalDate(dayStartHour).toDateString();
    const reviewedToday = memoryQueueRef.current.filter(
      (item) =>
        item.status === 'reviewing' &&
        item.lastReviewDate &&
        getLogicalDate(dayStartHour, new Date(item.lastReviewDate)).toDateString() === todayStr
    );

    if (reviewedToday.length === 0) {
      triggerToast("Nothing reviewed today yet to reset.");
      return;
    }

    const targetIds = new Set(reviewedToday.map((item) => item.verseId));
    const resetDueDate = new Date(Date.now() - 24 * 3600 * 1000).toISOString(); // due yesterday
    const updatedQueue = memoryQueueRef.current.map((item) =>
      targetIds.has(item.verseId) ? { ...item, nextReviewDueDate: resetDueDate } : item
    );

    updateMemoryQueue(() => updatedQueue);

    if (auth.currentUser) {
      try {
        const batch = writeBatch(db);
        reviewedToday.forEach((item) => {
          const docRef = doc(db, 'users', auth.currentUser!.uid, 'memoryQueue', item.verseId);
          batch.update(docRef, { nextReviewDueDate: resetDueDate });
        });
        await batch.commit();
      } catch (err) {
        console.error('Failed to sync mock queue items:', err);
      }
    }
    triggerToast(`🧪 ${reviewedToday.length} verse${reviewedToday.length === 1 ? '' : 's'} reviewed today reset back to due.`);
  };

  const handleUpdateVerseStatus = async (
    versesToUpdate: VerseState[],
    newStatus: 'memorized' | 'learning',
    customDrillType?: 'speak' | 'type' | 'reveal',
    opts?: { perfect?: boolean }
  ) => {
    setVerses((prev) => {
      return prev.map((v) => {
        const isTarget = versesToUpdate.some((u) => u.book === v.book && u.chapter === v.chapter && u.verse === v.verse);
        if (isTarget) {
          return {
            ...v,
            status: newStatus,
            dueDate: newStatus === 'memorized' ? 'Completed' : 'Due: Tomorrow',
          };
        }
        return v;
      });
    });

    if (auth.currentUser) {
      try {
        const batch = writeBatch(db);
        versesToUpdate.forEach((v) => {
          const vId = `${v.book}_${v.chapter}_${v.verse}`;
          const docRef = doc(db, 'users', auth.currentUser!.uid, 'verses', vId);
          batch.set(docRef, {
            book: v.book,
            chapter: v.chapter,
            verse: v.verse,
            text: v.text,
            status: newStatus,
            dueDate: newStatus === 'memorized' ? 'Completed' : 'Due: Tomorrow',
            updatedAt: new Date(),
          });
        });
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `users/${auth.currentUser.uid}/verses`);
      }
    }

    // Route completion results to our 7-6-5 Deterministic Retention Engine!
    const success = newStatus === 'memorized';
    // PracticeModals' Learn/Reveal tabs always pass an explicit
    // customDrillType now; 'speak' only remains as a fallback.
    const drillType = customDrillType || 'speak';
    for (const v of versesToUpdate) {
      // Read through the ref, not the render-time snapshot — each loop
      // iteration must see the queue updates the previous iteration made.
      const itemInQueue = memoryQueueRef.current.find(
        (q) => q.book === v.book && q.chapter === v.chapter && q.verseNumber === v.verse
      );
      if (itemInQueue) {
        await handleReviewCompleted(itemInQueue, success, drillType, opts);
      }
    }

    const refStr =
      versesToUpdate.length === 1
        ? `${versesToUpdate[0].book} ${versesToUpdate[0].chapter}:${versesToUpdate[0].verse}`
        : `${versesToUpdate[0].book} ${versesToUpdate[0].chapter}:${versesToUpdate[0].verse}-${versesToUpdate[versesToUpdate.length - 1].verse}`;

    triggerToast(`Completed practice for ${refStr}!`);
  };

  // Launch practice session
  const startPractice = (mode: 'listen' | 'learn', passageVerses: VerseState[]) => {
    setModalVerses(passageVerses);
    setActiveModal(mode);
  };

  // ==========================================
  // CHAINED REVIEW SESSION -- "Review All Due" on Home queues up every
  // due group (each its own book/chapter cluster) and walks through them
  // one at a time in the SAME overlay, per explicit user direction ("let
  // them continuously review... in order, without having to be taken back
  // to the home screen each time"). Each group is still graded
  // independently (a separate onUpdateStatus call per group, exactly as if
  // the user had tapped each group's button one by one) -- only the
  // navigation between them is automatic.
  // ==========================================
  const startReviewSession = (groups: QueueItem[][]) => {
    const nonEmpty = groups.filter((g) => g.length > 0);
    if (nonEmpty.length === 0) return;
    reviewQueueRef.current = nonEmpty.slice(1);
    setReviewSessionTotal(nonEmpty.length);
    setReviewSessionPosition(1);
    setModalVerses(mapQueueItemsToVerseStates(nonEmpty[0]));
    setActiveModal('learn');
  };

  // Called after a group is graded/logged (never after an early X-out --
  // see abortReviewSession) -- moves on to the next queued group in place,
  // or closes normally if this wasn't a chained session (queue empty) /
  // it was the last group.
  const advanceReviewSession = () => {
    if (reviewQueueRef.current.length === 0) {
      setActiveModal(null);
      setModalVerses([]);
      setReviewSessionPosition(0);
      setReviewSessionTotal(0);
      return;
    }
    const [next, ...rest] = reviewQueueRef.current;
    reviewQueueRef.current = rest;
    setReviewSessionPosition((p) => p + 1);
    setModalVerses(mapQueueItemsToVerseStates(next));
  };

  // Explicit exit (the overlay's X button) -- always a full stop, even
  // mid-session: abandons whatever groups were still queued rather than
  // skipping to the next one, since tapping X reads as "I'm done for now."
  const abortReviewSession = () => {
    reviewQueueRef.current = [];
    setReviewSessionPosition(0);
    setReviewSessionTotal(0);
    setActiveModal(null);
    setModalVerses([]);
  };

  // Sanity ceiling on any single recorded session -- guards against a
  // backgrounded/left-open practice overlay (activeModal stays non-null,
  // e.g. a phone put to sleep mid-session) producing a nonsense multi-hour
  // "time studied" entry. Same spirit as MAX_LEARNING_DAY_SCAN elsewhere.
  const MAX_SESSION_SECONDS = 3600;

  const recordStudySession = (elapsedSeconds: number) => {
    setTotalStudySeconds((prev) => prev + elapsedSeconds);
    if (auth.currentUser) {
      updateDoc(doc(db, 'profiles', auth.currentUser.uid), { totalStudySeconds: increment(elapsedSeconds) }).catch(
        (err) => console.error('Failed to sync study time:', err)
      );
    }
  };

  // Real, measured practice time: activeModal is null whenever no
  // practice/listen overlay is open, and stays non-null across a chained
  // multi-group "Review All Due" session (advancing between groups swaps
  // modalVerses in place without touching activeModal), returning to null
  // only on a real close -- so this one effect captures exactly one
  // continuous practice session, with no changes needed in PracticeModals.
  useEffect(() => {
    if (activeModal) {
      if (studySessionStartRef.current === null) {
        studySessionStartRef.current = Date.now();
      }
    } else if (studySessionStartRef.current !== null) {
      const elapsedSeconds = Math.min(
        MAX_SESSION_SECONDS,
        Math.round((Date.now() - studySessionStartRef.current) / 1000)
      );
      studySessionStartRef.current = null;
      if (elapsedSeconds > 0) recordStudySession(elapsedSeconds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModal]);

  // ==========================================
  // COMPUTED METRICS
  // ==========================================
  const totalVersesCount = memoryQueue.length || verses.length || 1;
  const memorizedCount = memoryQueue.filter((v) => v.status === 'retained').length;
  const learningCount = memoryQueue.filter((v) => v.status === 'learning').length;
  const untouchedCount = memoryQueue.filter((v) => v.status === 'queued').length;
  const memorizedPercent = Math.round((memorizedCount / totalVersesCount) * 100) || 0;

  // Real per-day practice activity, derived from touchLogs already recorded
  // on each queue item (the same log the 3-Touch Mastery gate uses) — a
  // brand-new account with no practice history naturally gets all zeros
  // here, instead of the previous hardcoded demo grid every account showed.
  // Days are keyed in LOCAL time, not UTC (toISOString): for anyone west of
  // Greenwich, an evening practice session's UTC date is already "tomorrow",
  // which shifted the activity grid and broke streaks at the day boundary.

  const activityByDay = new Map<string, number>();
  memoryQueue.forEach((item) => {
    (item.touchLogs || []).forEach((log) => {
      const day = localDayKey(getLogicalDate(dayStartHour, new Date(log.timestamp)));
      activityByDay.set(day, (activityByDay.get(day) || 0) + 1);
    });
  });

  // Shared by the 15-day grid (ProfileScreen) and the Dashboard's bigger
  // 90-day heatmap -- same window construction, just a different length.
  const buildActivityWindow = (days: number) =>
    Array.from({ length: days }, (_, i) => {
      const d = getLogicalDate(dayStartHour);
      d.setDate(d.getDate() - (days - 1 - i));
      const key = localDayKey(d);
      return {
        day: d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
        count: activityByDay.get(key) || 0,
      };
    });

  const activityLast15Days = buildActivityWindow(15);
  const activityLast90Days = buildActivityWindow(90);

  // Consecutive days of practice counting back from today; 0 for a new/idle account.
  const memoryStreak = (() => {
    let streak = 0;
    const d = getLogicalDate(dayStartHour);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const key = localDayKey(d);
      if ((activityByDay.get(key) || 0) > 0) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  })();

  // Patch memorizedCount/learningCount/streakDays into this user's own
  // profiles/{uid} doc (debounced) so other users viewing their real member
  // profile (e.g. in a shared circle) see meaningful stats without needing
  // read access to this user's private memoryQueue/verses subcollections.
  useEffect(() => {
    if (!auth.currentUser) return;
    if (profileStatsSyncTimerRef.current) clearTimeout(profileStatsSyncTimerRef.current);

    profileStatsSyncTimerRef.current = setTimeout(() => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      updateDoc(doc(db, 'profiles', uid), { memorizedCount, learningCount, streakDays: memoryStreak }).catch((err) =>
        console.error('Failed to sync profile stats:', err)
      );
    }, 800);

    return () => {
      if (profileStatsSyncTimerRef.current) clearTimeout(profileStatsSyncTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memorizedCount, learningCount, memoryStreak, user]);

  // Real chapter text for whichever book/chapter the user is currently browsing,
  // fetched from Firestore's scripture library (falls back to empty until loaded).
  const activeBookId = selectedBook ? getBookByName(selectedBook)?.id ?? null : null;
  const {
    data: activeChapterTextData,
    loading: activeChapterTextLoading,
    error: activeChapterTextError,
  } = useChapterText(selectedTranslationId, activeBookId, selectedChapter);

  // Merge real verse text with this user's personal progress (tracked in memoryQueue)
  // to build the VerseState list the Chapter Landing screen renders.
  const activeChapterVerses: VerseState[] = activeChapterTextData
    ? Object.keys(activeChapterTextData.verses)
        .map(Number)
        .sort((a, b) => a - b)
        .map((verseNum) => {
          // Matched by translation too, not just book/chapter/verse -- ESV
          // Ephesians 2:5 being in-progress must not show as "already
          // learning" while browsing the same reference in KJV, since
          // they're independent QueueItems (see buildVerseId).
          const queueItem = memoryQueue.find(
            (q) =>
              q.book === selectedBook &&
              q.chapter === selectedChapter &&
              q.verseNumber === verseNum &&
              (q.translationId || 'ESV') === selectedTranslationId
          );
          let status: VerseState['status'] = 'untouched';
          let dueDate: string | undefined;
          if (queueItem) {
            if (queueItem.status === 'retained') {
              status = 'memorized';
              dueDate = 'Completed';
            } else if (queueItem.status === 'reviewing') {
              status = 'memorized';
              const isDue = isReviewDue(queueItem.nextReviewDueDate, getLogicalDate(dayStartHour));
              if (isDue) dueDate = 'Due: Today';
            } else if (queueItem.status === 'learning') {
              status = 'learning';
              dueDate = 'Due: Today';
            }
          }
          return {
            book: selectedBook || '',
            chapter: selectedChapter || 0,
            verse: verseNum,
            text: activeChapterTextData.verses[String(verseNum)],
            status,
            dueDate,
          };
        })
    : [];

  // Real chapter text for the Record tab's teleprompter (previously showed
  // verses.filter(...) — this user's own partial memory-queue verses for the
  // chapter, not the full chapter — which broke "Full Chapter Recitation"
  // for any chapter not fully added to the queue, and ignored the translation
  // dropdown entirely). Tap-to-mark timestamps need the complete verse list.
  const recordingBookId = recordingBook ? getBookByName(recordingBook)?.id ?? null : null;
  const { data: recordingChapterTextData } = useChapterText(recordingTranslation, recordingBookId, recordingChapter);
  const recordingChapterVerses: { verse: number; text: string }[] = recordingChapterTextData
    ? Object.keys(recordingChapterTextData.verses)
        .map(Number)
        .sort((a, b) => a - b)
        .map((verseNum) => ({ verse: verseNum, text: recordingChapterTextData.verses[String(verseNum)] }))
    : [];

  // Real chapter text for whichever recording is open in RecordingDetailScreen
  // — drives the Verse Audio-Sync Matrix's preview text (previously a fixed,
  // Romans-8-specific SYNC_VERSE_PREVIEWS array shown for every recording).
  const selectedRecordingBookId = selectedRecording ? getBookByName(selectedRecording.book)?.id ?? null : null;
  const { data: selectedRecordingChapterTextData } = useChapterText(
    selectedRecording?.translation ?? null,
    selectedRecordingBookId,
    selectedRecording?.chapter ?? null
  );

  const isVerseSelected = (vNum: number) => selectedVerseNumbers.includes(vNum);

  const toggleVerseSelection = (vNum: number) => {
    setSelectedVerseNumbers((prev) => {
      if (prev.includes(vNum)) {
        return prev.filter((n) => n !== vNum);
      } else {
        return [...prev, vNum].sort((a, b) => a - b);
      }
    });
  };

  // Select all verses helper
  const toggleSelectAll = () => {
    if (selectedVerseNumbers.length === activeChapterVerses.length) {
      setSelectedVerseNumbers([]);
    } else {
      setSelectedVerseNumbers(activeChapterVerses.map((v) => v.verse));
    }
  };

  // ==========================================
  // VOICE RECORDER FLOW — real mic capture via expo-audio, uploaded to
  // Firebase Storage (recordings/{uid}/{id}.<ext>) with metadata written to
  // Firestore (users/{uid}/recordings/{id}). Private to the recording user —
  // no circle/group sharing yet (see firestore.rules + storage.rules).
  // ==========================================
  const handleStartRecording = async () => {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        triggerToast('Microphone permission is required to record.');
        return;
      }
      // Required on iOS — expo-audio refuses to record until the audio
      // session is explicitly switched into recording mode.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setIsRecording(true);
      setIsRecordingPaused(false);
      setRecordingSeconds(0);
      // Seed the chapter's first verse at t=0 — recording always starts on
      // verse 1, so the user only needs to tap starting from the next verse.
      const firstVerse = recordingChapterVerses[0]?.verse;
      setVerseTapTimestamps(firstVerse !== undefined ? { [firstVerse]: 0 } : {});
      triggerToast('Recording started — tap each verse number as you reach it.');
    } catch (err) {
      console.error('Failed to start recording:', err);
      triggerToast('Could not start recording — check microphone permissions.');
    }
  };

  const handleStopRecording = async () => {
    capturedDurationRef.current = Math.round(audioRecorder.currentTime) || recordingSeconds || 1;
    setLastRecordingDuration(capturedDurationRef.current);
    try {
      await audioRecorder.stop();
    } catch (err) {
      console.error('Failed to stop recording:', err);
    }
    try {
      // Switch back out of recording mode immediately, so anything played
      // back before the next recording starts doesn't inherit a session
      // still configured for recording.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch (err) {
      console.error('Failed to reset audio mode after recording:', err);
    }
    setIsRecording(false);
    setIsRecordingPaused(false);
    setPendingRecordingSource('live');
    setPickedRecordingVisibility(defaultRecordingVisibility || 'private');
    setSaveRecordingDialog(true);
  };

  // Pauses mid-recording without finalizing it -- the recording timer holds
  // at its current value (see the Recording Timer effect) rather than
  // resetting, since only a real stop should do that.
  const handlePauseRecording = () => {
    if (!isRecording || isRecordingPaused) return;
    audioRecorder.pause();
    setIsRecordingPaused(true);
    triggerToast('Recording paused.');
  };

  const handleResumeRecording = () => {
    if (!isRecording || !isRecordingPaused) return;
    audioRecorder.record();
    setIsRecordingPaused(false);
    triggerToast('Recording resumed.');
  };

  // Discards the in-progress recording entirely (no save dialog) and
  // returns to the idle state so the user can start a fresh take.
  const handleResetRecording = async () => {
    try {
      await audioRecorder.stop();
    } catch (err) {
      console.error('Failed to stop recording during reset:', err);
    }
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch (err) {
      console.error('Failed to reset audio mode after resetting recording:', err);
    }
    setIsRecording(false);
    setIsRecordingPaused(false);
    setVerseTapTimestamps({});
    triggerToast('Recording discarded — tap to start again.');
  };

  // Tap-to-mark: called when the user taps a verse in the teleprompter while
  // recording. Re-tapping the same verse overwrites its mark with the newer
  // time, so an accidental early tap can just be corrected with another tap.
  const handleMarkVerseTap = (verseNumber: number) => {
    if (!isRecording || isRecordingPaused) return;
    setVerseTapTimestamps((prev) => ({ ...prev, [verseNumber]: audioRecorder.currentTime }));
  };

  // ==========================================
  // IMPORT-AUDIO TAGGING FLOW — pick an existing audio file, then tap each
  // verse while LISTENING BACK to it (mirrors handleMarkVerseTap above, but
  // keyed to playback position instead of recorder position).
  // ==========================================
  const pickImportAudio = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      // Switch to playback mode up front -- picking a file mid-recording
      // isn't a real flow, but if audio mode were ever left in "recording"
      // from a previous take, playback would be silent/misrouted otherwise.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      setImportedAudioUri(asset.uri);
      setImportedAudioName(asset.name || 'Imported audio');
      setImportTapTimestamps({});
      triggerToast('Audio loaded — press play and tap each verse as you hear it start.');
    } catch (err) {
      console.error('Failed to pick import audio:', err);
      triggerToast('Could not open that file — please try another.');
    }
  };

  // Clears the picked file and any taps so far, returning to the "choose a
  // file" state. Does NOT touch anything already saved.
  const clearImportedAudio = () => {
    // .pause() can throw if the native player was already released (same
    // race the saved-recording player guards against elsewhere) — pausing
    // an already-idle/released player is a no-op either way.
    try {
      importPlayer.pause();
    } catch {
      // already released — nothing to pause
    }
    setImportedAudioUri(null);
    setImportedAudioName(null);
    setImportTapTimestamps({});
  };

  const toggleImportPlayback = () => {
    if (!importedAudioUri) return;
    if (importPlayerStatus.playing) {
      importPlayer.pause();
    } else {
      importPlayer.play();
    }
  };

  const seekImportAudioBy = (deltaSeconds: number) => {
    if (!importedAudioUri) return;
    const total = importPlayerStatus.duration || 0;
    const next = Math.max(0, Math.min(total, importPlayerStatus.currentTime + deltaSeconds));
    importPlayer.seekTo(next);
  };

  // Re-tapping the same verse overwrites its mark with the newer time, same
  // forgiving behavior as the live-recording version.
  const handleMarkImportTap = (verseNumber: number) => {
    if (!importedAudioUri) return;
    setImportTapTimestamps((prev) => ({ ...prev, [verseNumber]: importPlayerStatus.currentTime }));
  };

  const resetImportTaps = () => {
    setImportTapTimestamps({});
    triggerToast('Verse tags cleared — tap through again from the top.');
  };

  // Turns the sparse verse->tap-time map into a contiguous per-verse
  // start/end range: a verse's start is its own tap (or the previous verse's
  // end, if it was never tapped), and its end is the next tapped verse found
  // ahead of it (or the total recording duration, if none of the remaining
  // verses were tapped). Returns [] if nothing was tapped at all, rather than
  // producing a single verse spanning the whole recording followed by
  // degenerate zero-length ones — that's just "the feature wasn't used."
  const buildVerseTimestamps = (
    verseNumbers: number[],
    tapTimestamps: Record<number, number>,
    totalDurationSec: number
  ): VerseTimestamp[] => {
    if (Object.keys(tapTimestamps).length === 0) return [];

    const sorted = [...verseNumbers].sort((a, b) => a - b);
    const result: VerseTimestamp[] = [];
    let cursor = 0;
    for (let i = 0; i < sorted.length; i++) {
      const v = sorted[i];
      const start = tapTimestamps[v] !== undefined ? tapTimestamps[v] : cursor;
      let end = totalDurationSec;
      for (let j = i + 1; j < sorted.length; j++) {
        if (tapTimestamps[sorted[j]] !== undefined) {
          end = tapTimestamps[sorted[j]];
          break;
        }
      }
      result.push({ verse: v, startSec: Math.round(start), endSec: Math.round(end) });
      cursor = end;
    }
    return result;
  };

  // Shared upload + Firestore write for a finished recitation, used by both
  // the live-record flow and the import-audio flow below — so visibility
  // defaults, the sharedRecordings ACL snapshot, and the profile
  // default-visibility bookkeeping can't drift between the two.
  const persistRecording = async (params: {
    uri: string;
    durationSec: number;
    verseTimestamps: VerseTimestamp[];
    titleSuffix: string;
    sourceType: 'recorded' | 'imported';
  }) => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      triggerToast('Sign in to save recordings.');
      return;
    }

    const id = `rec_${Date.now()}`;
    // On web, expo-audio's HIGH_QUALITY preset records to audio/webm regardless
    // of the .m4a extension used natively — match the actual encoded format.
    // An imported file keeps its own extension instead (whatever the user
    // picked), read straight from its filename.
    const ext =
      params.sourceType === 'imported'
        ? importedAudioName?.split('.').pop()?.toLowerCase() || 'm4a'
        : Platform.OS === 'web'
          ? 'webm'
          : 'm4a';
    const contentType = params.sourceType === 'imported' ? 'audio/*' : Platform.OS === 'web' ? 'audio/webm' : 'audio/m4a';
    const audioPath = `recordings/${uid}/${id}.${ext}`;

    triggerToast('Uploading recitation...');
    try {
      const fileRef = storageRef(storage, audioPath);
      // Firebase Storage's ONE-SHOT upload path (used by both uploadBytes()
      // and uploadString(), regardless of the input form -- a base64 string
      // just gets decoded to a Uint8Array first) always builds the final
      // request body via `new Blob([multipartBoundaryText, ourData,
      // multipartBoundaryText])` internally, to attach the JSON metadata and
      // our bytes in one multipart/related request. React Native 0.74+'s
      // Blob constructor rejects any part that isn't itself a Blob or a
      // string, so that internal concat throws "Creating blobs from
      // 'ArrayBuffer' and 'ArrayBufferView' are not supported" on a real
      // device no matter what we hand the public API (confirmed: the
      // previous fix here switched to uploadString + base64 and it crashed
      // in exactly the same place, just later).
      //
      // uploadBytesResumable()'s chunked wire protocol avoids that Blob
      // concat entirely -- BUT only when it actually chunks. A previous
      // version of this comment claimed it "never hits this restriction, on
      // any platform" -- that was wrong: @firebase/storage's UploadTask
      // silently falls back to the exact same one-shot multipart path (and
      // the exact same crash) for any upload <= 256KB, which a short single-
      // verse recording/import very plausibly is. See the patch in
      // firebase.ts (right after `export const storage = getStorage(app)`)
      // for the actual fix -- it forces every upload through the chunked
      // path regardless of size, rather than relying on file size to happen
      // to clear that threshold.
      const response = await fetch(params.uri);
      const arrayBuffer = await response.arrayBuffer();
      const uploadTask = uploadBytesResumable(fileRef, arrayBuffer, { contentType });
      await uploadTask;
      const audioUrl = await getDownloadURL(fileRef);

      const newRec: Recording = {
        id,
        title: `${recordingBook} ${recordingChapter} ${params.titleSuffix}`,
        book: recordingBook,
        chapter: recordingChapter,
        translation: recordingTranslation,
        duration: params.durationSec,
        date: new Date().toISOString().split('T')[0],
        userId: uid,
        user: auth.currentUser?.displayName || 'Me',
        avatar: (auth.currentUser?.displayName || 'M').charAt(0).toUpperCase(),
        audioUrl,
        audioPath,
        versesStr: 'Full Chapter',
        verseTimestamps: params.verseTimestamps,
        sharedVisibility: pickedRecordingVisibility,
        sourceType: params.sourceType,
      };

      await setDoc(doc(db, 'users', uid, 'recordings', id), { ...newRec, createdAt: serverTimestamp() });

      if (pickedRecordingVisibility !== 'private') {
        // Snapshot ACL (see firestore.rules comment on sharedRecordings for
        // why this can't just be a live circle-membership check) — everyone
        // this recording is visible to right now, computed once at share
        // time: every real co-member across the owner's circles, plus real
        // friends (so friends can see circle-shared recordings too, even
        // outside a shared circle, per the explicit design decision).
        const sharedWithUids = Array.from(
          new Set([...circleFriends.map((f) => f.uid), ...friends.map((f) => f.uid)])
        );
        try {
          await setDoc(doc(db, 'sharedRecordings', id), {
            ...newRec,
            ownerId: uid,
            visibility: pickedRecordingVisibility,
            sharedWithUids,
            createdAt: serverTimestamp(),
          });
        } catch (err) {
          console.error('Failed to publish shared recording copy:', err);
        }
      }

      if (defaultRecordingVisibility === null) {
        setDefaultRecordingVisibility(pickedRecordingVisibility);
        updateDoc(doc(db, 'profiles', uid), { defaultRecordingVisibility: pickedRecordingVisibility }).catch((err) =>
          console.error('Failed to save default recording visibility:', err)
        );
      }

      setUserRecordings((prev) => [newRec, ...prev]);
      triggerToast(`${params.titleSuffix} saved! 🎙️`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/recordings/${id}`);
    }
  };

  const saveLiveRecordedAudio = async () => {
    const uri = audioRecorder.uri;
    if (!uri) {
      triggerToast('No recording captured — please try again.');
      return;
    }
    await persistRecording({
      uri,
      durationSec: capturedDurationRef.current,
      verseTimestamps: buildVerseTimestamps(
        recordingChapterVerses.map((v) => v.verse),
        verseTapTimestamps,
        capturedDurationRef.current
      ),
      titleSuffix: 'Full Chapter Recitation',
      sourceType: 'recorded',
    });
  };

  const saveImportedRecording = async () => {
    if (!importedAudioUri) {
      triggerToast('No imported audio to save — please choose a file first.');
      return;
    }
    const durationSec = Math.round(importPlayerStatus.duration || 0) || 1;
    await persistRecording({
      uri: importedAudioUri,
      durationSec,
      verseTimestamps: buildVerseTimestamps(recordingChapterVerses.map((v) => v.verse), importTapTimestamps, durationSec),
      titleSuffix: 'Imported Recitation',
      sourceType: 'imported',
    });
    clearImportedAudio();
  };

  // Single entry point the Save dialog calls on "Confirm & Save" — routes to
  // whichever flow opened it (see pendingRecordingSource).
  const saveRecordedAudio = async () => {
    setSaveRecordingDialog(false);
    if (pendingRecordingSource === 'import') {
      await saveImportedRecording();
    } else {
      await saveLiveRecordedAudio();
    }
  };

  // Opens the same Save dialog the live-record flow uses, routed to the
  // import path. Requires at least one verse tagged, since an imported
  // recitation with zero tags has no reason to go through this screen at
  // all (a plain upload with no per-verse sync isn't this feature's job).
  const handleFinishImportTagging = () => {
    if (!importedAudioUri) return;
    if (Object.keys(importTapTimestamps).length === 0) {
      triggerToast('Tap at least one verse while listening back before finishing.');
      return;
    }
    try {
      importPlayer.pause();
    } catch {
      // already released — nothing to pause
    }
    setPendingRecordingSource('import');
    setPickedRecordingVisibility(defaultRecordingVisibility || 'private');
    setSaveRecordingDialog(true);
  };

  const deleteRecording = async (recording: Recording) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await deleteDoc(doc(db, 'users', uid, 'recordings', recording.id));
      if (recording.audioPath) {
        await deleteObject(storageRef(storage, recording.audioPath));
      }
      setUserRecordings((prev) => prev.filter((r) => r.id !== recording.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${uid}/recordings/${recording.id}`);
    }
  };

  // Persists edits made in the verse-sync timeline editor. Takes the
  // computed ranges directly (the screen builds them from its draft marker
  // positions via buildVerseTimestamps) rather than reading from any
  // useAppState-owned draft state -- the editing session itself is local to
  // RecordingDetailScreen.
  const saveVerseSyncOffsets = async (verseTimestamps: VerseTimestamp[]) => {
    const uid = auth.currentUser?.uid;
    if (!uid || !selectedRecording) return;

    try {
      await updateDoc(doc(db, 'users', uid, 'recordings', selectedRecording.id), { verseTimestamps });
      const updated = { ...selectedRecording, verseTimestamps };
      setSelectedRecording(updated);
      setUserRecordings((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      triggerToast('Verse sync offsets updated! 🔄');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/recordings/${selectedRecording.id}`);
    }
  };

  // Real "Save to My Library": creates a lightweight reference doc in the
  // saver's own recordings pointing at the SAME audioUrl/audioPath — no
  // re-upload/duplicate audio, matching how this app already stores audio
  // (one Storage object per recording, everything just references it).
  const saveSharedRecordingToLibrary = async (rec: Recording) => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      triggerToast('Sign in to save recordings.');
      return;
    }
    if (userRecordings.some((r) => r.savedFromRecordingId === rec.id) || rec.userId === uid) {
      triggerToast('Already in your library!');
      return;
    }
    const id = `saved_${Date.now()}`;
    const savedRec: Recording = {
      ...rec,
      id,
      userId: uid,
      savedFromUid: rec.userId,
      savedFromRecordingId: rec.id,
      sharedVisibility: 'private',
    };
    try {
      await setDoc(doc(db, 'users', uid, 'recordings', id), { ...savedRec, createdAt: serverTimestamp() });
      setUserRecordings((prev) => [savedRec, ...prev]);
      triggerToast(`Saved to My Library! Added to your ${rec.book} ${rec.chapter} options. 📚`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `users/${uid}/recordings/${id}`);
    }
  };

  return {
    // static reference data
    BOOKS,

    // core state
    verses, setVerses,
    memoryQueue, setMemoryQueue, updateMemoryQueue,
    primingLookahead, setPrimingLookahead,
    cognitiveLoadSensitivity, setCognitiveLoadSensitivity,
    showAddQueueItemModal, setShowAddQueueItemModal,
    selectedAddBook, setSelectedAddBook,
    selectedAddChapter, setSelectedAddChapter,
    selectedAddVerse, setSelectedAddVerse,
    selectedAddEndVerse, setSelectedAddEndVerse,
    selectedAddOrigin, setSelectedAddOrigin,
    user, setUser,
    loadingAuth,
    currentTab, setCurrentTab,
    currentScreen, setCurrentScreen,
    selectedBook, setSelectedBook,
    selectedChapter, setSelectedChapter,
    backHistory, setBackHistory,
    selectedVerseNumbers, setSelectedVerseNumbers,
    chapterViewMode, setChapterViewMode,
    highlightedVerses, toggleVerseHighlight,
    verseDoodles, saveVerseDoodle,
    memoryGridColumns, setMemoryGridColumns,
    isEditingSync, setIsEditingSync,
    preset, setPreset,
    learningDays, setLearningDays,
    newVersesPace, setNewVersesPace,
    maxReviewCap, setMaxReviewCap,
    retentionRigor, setRetentionRigor,
    dailyPhaseWeeks, setDailyPhaseWeeks,
    weeklyPhaseMonths, setWeeklyPhaseMonths,
    monthlyPhaseYears, setMonthlyPhaseYears,
    activeModal, setActiveModal,
    modalVerses, setModalVerses,
    isRecording, setIsRecording,
    isRecordingPaused,
    recordingSeconds, setRecordingSeconds,
    lastRecordingDuration,
    verseTapTimestamps,
    recordingBook, setRecordingBook,
    recordingChapter, setRecordingChapter,
    recordingTranslation, setRecordingTranslation,
    recordingChapterVerses,
    selectedRecordingChapterTextData,
    userRecordings, setUserRecordings,
    saveRecordingDialog, setSaveRecordingDialog,
    pendingRecordingSource,
    defaultRecordingVisibility,
    updateDefaultRecordingVisibility,
    pickedRecordingVisibility, setPickedRecordingVisibility,
    typedRecordingName, setTypedRecordingName,
    // import-audio tagging flow
    importedAudioUri,
    importedAudioName,
    importTapTimestamps,
    importPlayerStatus,
    pickImportAudio,
    clearImportedAudio,
    toggleImportPlayback,
    seekImportAudioBy,
    handleMarkImportTap,
    resetImportTaps,
    handleFinishImportTagging,
    feedRecordings, setFeedRecordings, loadingFeedRecordings, loadSharedRecordings, saveSharedRecordingToLibrary,
    audioSearchQuery, setAudioSearchQuery,
    activeFeedFilter, setActiveFeedFilter,
    feedBookFilter, setFeedBookFilter,
    feedChapterFilter, setFeedChapterFilter,
    selectedChapterAudios, setSelectedChapterAudios,
    showAudioSelector, setShowAudioSelector,
    toastMessage, setToastMessage,
    masteryTouches, setMasteryTouches,
    reviewsRequired, setReviewsRequired,
    sabbathEnabled, setSabbathEnabled,
    sabbathDay, setSabbathDay,
    dayStartHour, setDayStartHour,
    joinedStudyPlanMemberships,
    joinedStudyPlanDetails,
    viewingStudyPlan, setViewingStudyPlan,
    viewingGroupDetail, setViewingGroupDetail,
    myCircles, loadingMyCircles,
    publicCircles, loadingPublicCircles,
    activeCircle, activeCircleMembers, activeCircleStudyPlans, loadingActiveCircle,
    circleFriends, loadCircleFriends,
    activityEvents, loadingActivityEvents, loadActivityFeed,
    friends, loadingFriends, loadFriends,
    incomingFriendRequests, outgoingFriendRequests, loadFriendRequests,
    userSearchQuery, setUserSearchQuery, userSearchResults, searchingUsers, searchUsers,
    sendFriendRequest, acceptFriendRequest, declineFriendRequest, cancelFriendRequest, removeFriend,
    accountabilityDailyCap, updateAccountabilityDailyCap,
    receivedAccountabilityNudges, loadingAccountabilityNudges, loadReceivedAccountabilityNudges,
    canSendAccountabilityNudge, sendAccountabilityNudge, markAccountabilityNudgeRead, dismissAccountabilityNudge,
    dmThreads, loadingDmThreads, activeDMThread, activeDMMessages, loadingActiveDMMessages, activeDMThreadActive,
    openDMThread, closeDMThread, sendDMMessage,
    activeCircleChatId, activeCircleMessages, loadingActiveCircleMessages,
    openCircleChat, closeCircleChat, sendCircleMessage,
    selectedRecording, setSelectedRecording,
    communitySubView, setCommunitySubView,
    activeGroupId,
    isEditingCircleSettings, setIsEditingCircleSettings,
    showCreatePlanForm, setShowCreatePlanForm,
    newPlanName, setNewPlanName,
    newPlanDesc, setNewPlanDesc,
    findSearchQuery, setFindSearchQuery,
    inviteCodeInput, setInviteCodeInput,
    createGroupName, setCreateGroupName,
    createGroupDesc, setCreateGroupDesc,
    createGroupPrivacy, setCreateGroupPrivacy,
    showProgressModal, setShowProgressModal,
    playingRecordingId, setPlayingRecordingId,
    playingRecProgress, setPlayingRecProgress,
    nowPlayingRecording,
    seekRecordingBy,
    seekRecordingToTime,
    selectedUserProfile, setSelectedUserProfile,
    sharedPlans, setSharedPlans,
    loadingSharedPlans, setLoadingSharedPlans,
    customPlanName, setCustomPlanName,
    shareWithCommunity, setShareWithCommunity,
    savedPlans, setSavedPlans,
    editingPlanId, setEditingPlanId,

    // navigation
    navigateTo,
    handleBack,
    selectTab,
    viewMemberProfileById,

    // auth
    signOut,
    updateDisplayName,
    deleteAccount,

    // first-run onboarding
    showOnboarding, setShowOnboarding,
    dismissOnboarding,
    onboardingStepInProgress,
    onboardingStepComplete,
    startOnboardingStep,
    returnToOnboardingGuide,

    // toast
    triggerToast,

    // scripture circles
    loadMyCircles,
    loadPublicCircles,
    loadActiveCircleData,
    openCircle,
    createCircle,
    joinCircle,
    joinCircleByCode,
    leaveCircle,
    disbandCircle,
    removeCircleMember,
    updateCircleSettings,
    createStudyPlan,
    updateStudyPlan,
    addVersesToStudyPlan,
    deleteStudyPlan,
    joinStudyPlan,
    leaveStudyPlan,
    setStudyPlanPriority,
    clearStudyPlanMembershipsForCircle,

    // shared plan handlers (personal-settings templates, separate concept from Study Plans)
    loadSharedPlans,
    joinSharedPlan,
    handleActivatePlan,
    handleDeletePlan,
    handleEditPlan,
    handleCreateNewPlan,
    handleSavePlan,
    saveActivePlanRhythm,
    publishSharedPlan,
    loadUserData,

    // formatting helpers
    formatTime,
    getTodayDateString,
    getGreeting,

    // 7-6-5 retention engine
    getTodayAbbreviation,
    isTodayLearningDay,
    validateTouch,
    getEstimatedReviewTime,
    getMemoryLoadForecast,
    isReviewDue,
    triggerDailyPull,
    promoteToLearning,
    addVersesToQueue,
    overrideVerseMemoryStatus,
    handleReviewCompleted,
    triggerMockDueReviews,
    handleUpdateVerseStatus,
    startPractice,
    startReviewSession,
    advanceReviewSession,
    abortReviewSession,
    reviewSessionPosition,
    reviewSessionTotal,

    // computed metrics
    totalVersesCount,
    memorizedCount,
    learningCount,
    untouchedCount,
    memorizedPercent,
    activityLast15Days,
    activityLast90Days,
    memoryStreak,
    totalStudySeconds,
    activeChapterVerses,
    activeChapterTextLoading,
    activeChapterTextError,
    selectedTranslationId, setSelectedTranslationId,
    isVerseSelected,
    toggleVerseSelection,
    toggleSelectAll,

    // voice recorder flow
    handleStartRecording,
    handleStopRecording,
    handlePauseRecording,
    handleResumeRecording,
    handleResetRecording,
    handleMarkVerseTap,
    saveRecordedAudio,
    deleteRecording,
    saveVerseSyncOffsets,
    buildVerseTimestamps,
  };
}

export type AppState = ReturnType<typeof useAppState>;
