import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
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
  DUMMY_PROFILES,
  getBookByName,
  getProfileForName,
  INITIAL_RECORDINGS,
  INITIAL_VERSES,
  SUGGESTED_FEED_RECORDINGS,
} from '../data';
import { fetchChapterText, useChapterText } from './useScripture';
import {
  ActivityEvent,
  Circle,
  CircleMember,
  Friend,
  FriendRequest,
  GroupPlan,
  MemorizationGoal,
  MemoryPlan,
  QueueItem,
  Recording,
  TouchLog,
  VerseState,
  VerseTimestamp,
} from '../types';

export type ScreenName =
  | 'home'
  | 'books'
  | 'chapters'
  | 'chapterLanding'
  | 'audioFeed'
  | 'planDesigner'
  | 'activePlan'
  | 'savedPlans'
  | 'memberProfile'
  | 'analyzePlan'
  | 'fullHistory'
  | 'recordingDetail'
  | 'findFriends';

// Screens App.tsx's router only renders while currentTab === 'home' (see
// Screens() in App.tsx). navigateTo() needs this list so it can switch tabs
// itself — otherwise navigating to e.g. 'activePlan' from the Profile tab
// silently no-ops, since the router keeps showing the current tab's screen.
const HOME_TAB_SCREENS: ScreenName[] = ['home', 'books', 'chapters', 'chapterLanding', 'audioFeed', 'planDesigner', 'activePlan', 'savedPlans'];

export type TabName = 'home' | 'community' | 'record' | 'profile';

const generateInitialQueue = (verses: VerseState[]): QueueItem[] => {
  return verses.map((v, index) => {
    const verseId = `${v.book.substring(0, 3).toUpperCase()}_${v.chapter}_${v.verse}`;
    const origin = v.book === 'John' ? 'group' : 'individual';

    // Seed some specific verses into interesting states to match the dynamic requirements
    if (v.book === 'John' && v.chapter === 15 && v.verse === 1) {
      return {
        verseId,
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

const advancePastSabbath = (date: Date, sabbathEnabled: boolean, sabbathDay: string): Date => {
  if (!sabbathEnabled) return date;
  const result = new Date(date);
  while (DAY_ABBREVS[result.getDay()] === sabbathDay) {
    result.setDate(result.getDate() + 1);
  }
  return result;
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

// Goal planning day-math: shared by both directions of the pace <-> target
// date recalculation, so "8 verses/day finishes March 1" and "March 1 needs
// 8 verses/day" are always consistent with each other and with the plan's
// real learningDays + Sabbath.
const isRealLearningDay = (date: Date, learningDaysList: string[], sabbathEnabled: boolean, sabbathDay: string): boolean => {
  const abbrev = DAY_ABBREVS[date.getDay()];
  if (sabbathEnabled && abbrev === sabbathDay) return false;
  return learningDaysList.includes(abbrev);
};

// Counts real learning days from `from` through `to`, inclusive of both ends.
const countLearningDaysBetween = (
  from: Date,
  to: Date,
  learningDaysList: string[],
  sabbathEnabled: boolean,
  sabbathDay: string
): number => {
  let count = 0;
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  let scanned = 0;
  while (cursor <= end && scanned < MAX_LEARNING_DAY_SCAN) {
    if (isRealLearningDay(cursor, learningDaysList, sabbathEnabled, sabbathDay)) count++;
    cursor.setDate(cursor.getDate() + 1);
    scanned++;
  }
  return count;
};

// Finds the date of the Nth real learning day starting from (and including)
// `from`. Returns null (rather than looping forever) if no day of the week
// is ever a real learning day -- e.g. every learningDay coincides with the
// Sabbath, or learningDays was toggled down to empty -- since in that case
// no future date would ever satisfy the search.
const dateAfterNLearningDays = (
  from: Date,
  n: number,
  learningDaysList: string[],
  sabbathEnabled: boolean,
  sabbathDay: string
): Date | null => {
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  if (n <= 0) return cursor;
  const hasAnyValidLearningDay = DAY_ABBREVS.some(
    (abbrev) => !(sabbathEnabled && abbrev === sabbathDay) && learningDaysList.includes(abbrev)
  );
  if (!hasAnyValidLearningDay) return null;
  let count = 0;
  while (true) {
    if (isRealLearningDay(cursor, learningDaysList, sabbathEnabled, sabbathDay)) {
      count++;
      if (count >= n) return cursor;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
};

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
  const [backHistory, setBackHistory] = useState<
    Array<{ screen: ScreenName; book: string | null; chapter: number | null }>
  >([]);

  // Selection state for Chapter Landing
  const [selectedVerseNumbers, setSelectedVerseNumbers] = useState<number[]>([]);
  const [chapterViewMode, setChapterViewMode] = useState<'list' | 'grid'>('list');

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

  // 3-Touch Mastery & Group Plan States
  const [masteryTouches, setMasteryTouches] = useState<number>(3);
  const [reviewsRequired, setReviewsRequired] = useState<number>(1);
  // Sabbath: an optional single weekday, off by default, free from both
  // learning and reviewing -- the engine treats it as not existing at all.
  const [sabbathEnabled, setSabbathEnabled] = useState<boolean>(false);
  const [sabbathDay, setSabbathDay] = useState<string>('Su');
  const [activeGroupPlan, setActiveGroupPlan] = useState<GroupPlan | null>(null);
  const [viewingGroupDetail, setViewingGroupDetail] = useState<boolean>(false);
  // Single active deadline-driven goal (e.g. "memorize Romans by March 1").
  // Loaded/saved alongside the memory plan doc rather than its own collection.
  const [memorizationGoal, setMemorizationGoal] = useState<MemorizationGoal | null>(null);
  const [isCalculatingGoal, setIsCalculatingGoal] = useState(false);

  // Scripture Circles (real Firestore-backed community groups — see circles/{id}
  // in firestore.rules). myCircles/publicCircles/activeCircle* replace the old
  // local-only joinedGroups/groupMembersMap/groupAnnouncements/groupPlansList mocks.
  const [myCircles, setMyCircles] = useState<Circle[]>([]);
  const [loadingMyCircles, setLoadingMyCircles] = useState(false);
  const [publicCircles, setPublicCircles] = useState<Circle[]>([]);
  const [loadingPublicCircles, setLoadingPublicCircles] = useState(false);

  const [activeCircle, setActiveCircle] = useState<Circle | null>(null);
  const [activeCircleMembers, setActiveCircleMembers] = useState<CircleMember[]>([]);
  const [activeCircleGroupPlans, setActiveCircleGroupPlans] = useState<GroupPlan[]>([]);
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

  // Selected Recording for Chapter Recording Landing Page
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);

  // Community Sub-views and Custom Search/Join state
  const [communitySubView, setCommunitySubView] = useState<'home' | 'find' | 'create'>('home');
  const [activeGroupId, setActiveGroupId] = useState<string>('');

  const [showAppStorePreview, setShowAppStorePreview] = useState<boolean>(false);

  const [isEditingCircleSettings, setIsEditingCircleSettings] = useState<boolean>(false);
  const [showCreatePlanForm, setShowCreatePlanForm] = useState<boolean>(false);
  const [newPlanName, setNewPlanName] = useState<string>('');
  const [newPlanDesc, setNewPlanDesc] = useState<string>('');
  const [newPlanBook, setNewPlanBook] = useState<string>('Romans');
  const [newPlanPacing, setNewPlanPacing] = useState<number>(3);
  const [newPlanStartVerse, setNewPlanStartVerse] = useState<string>('');
  const [newPlanEndVerse, setNewPlanEndVerse] = useState<string>('');

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
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set by seekRecordingToTime when asked to jump to a segment of a recording
  // that wasn't already playing — consumed once playback actually starts.
  const pendingSeekSecondsRef = useRef<number | null>(null);

  // Real audio recorder (mic capture) for the Record tab
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
      currentScreen === 'analyzePlan' ||
      currentScreen === 'fullHistory' ||
      currentScreen === 'recordingDetail'
    ) {
      setCurrentScreen('home');
      setBackHistory([]);
    }

    if (tab === 'home') {
      setCurrentScreen('home');
      setBackHistory([]);
    }
  };

  const viewMemberProfile = (name: string) => {
    const profile = getProfileForName(name);
    if (profile) {
      setSelectedUserProfile(profile);
      navigateTo('memberProfile');
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
      setActiveCircleGroupPlans(plansSnap.docs.map((d) => ({ planId: d.id, ...d.data() }) as GroupPlan));
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
    const newCircle: Circle = {
      id: circleRef.id,
      name: trimmedName,
      description: description.trim() || 'A new Scripture Circle — pacing to be set by shared plans.',
      isPublic,
      ownerId: uid,
      ownerName: user?.displayName || 'Anonymous Disciple',
      inviteCode: generateInviteCode(),
      pinnedAnnouncement: null,
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

  const pinCircleAnnouncement = async (circleId: string, text: string) => {
    const trimmed = text.trim();
    try {
      await updateDoc(doc(db, 'circles', circleId), { pinnedAnnouncement: trimmed, updatedAt: new Date().toISOString() });
      setActiveCircle((prev) => (prev ? { ...prev, pinnedAnnouncement: trimmed } : prev));
      triggerToast('Sponsor announcement pinned! 📣');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}`);
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

  const deployGroupPlan = async (
    circleId: string,
    planInput: { name: string; book: string; pacingPerWeek: number; description: string }
  ) => {
    if (!auth.currentUser) return;
    const trimmedName = planInput.name.trim();
    if (!trimmedName) {
      triggerToast('Please specify a plan title! 🏷️');
      return;
    }
    const bookId = getBookByName(planInput.book)?.id;
    if (!bookId) {
      triggerToast(`Unrecognized book: ${planInput.book}`);
      return;
    }

    // Real scripture range: the book's first chapter, first 10 verses (with
    // real ESV text) — a simple, always-available starting range for a newly
    // deployed circle plan.
    const chapterData = await fetchChapterText(DEFAULT_TRANSLATION_ID, bookId, 1);
    if (!chapterData) {
      triggerToast(`Couldn't find ${planInput.book} 1 in the scripture library yet.`);
      return;
    }
    const verseNumbers = Object.keys(chapterData.verses)
      .map(Number)
      .sort((a, b) => a - b)
      .slice(0, 10);
    const scriptureRange = verseNumbers.map((v) => `${bookId}_1_${v}`);

    const planRef = doc(collection(db, 'circles', circleId, 'groupPlans'));
    const newPlan: GroupPlan = {
      planId: planRef.id,
      circleId,
      name: trimmedName,
      managerId: auth.currentUser.uid,
      managerName: user?.displayName || 'Anonymous Disciple',
      scriptureRange,
      startDate: new Date().toISOString(),
      pacingPerWeek: planInput.pacingPerWeek,
      learningDays: ['Mon', 'Wed', 'Fri'],
      currentGroupVerseIndex: 0,
      description:
        planInput.description.trim() ||
        `Memorizing together through ${planInput.book} at a pace of ${planInput.pacingPerWeek} verses per week.`,
    };

    try {
      await setDoc(planRef, newPlan);
      setActiveCircleGroupPlans((prev) => [...prev, newPlan]);
      triggerToast(`Deployed "${trimmedName}"! All circle members synchronized. 🛡️`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/groupPlans/${planRef.id}`);
    }
  };

  const advanceGroupPlanPointer = async (circleId: string, planId: string, nextIndex: number) => {
    try {
      await updateDoc(doc(db, 'circles', circleId, 'groupPlans', planId), { currentGroupVerseIndex: nextIndex });
      setActiveCircleGroupPlans((prev) =>
        prev.map((p) => (p.planId === planId ? { ...p, currentGroupVerseIndex: nextIndex } : p))
      );
      setActiveGroupPlan((prev) => (prev && prev.planId === planId ? { ...prev, currentGroupVerseIndex: nextIndex } : prev));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/groupPlans/${planId}`);
    }
  };

  const deleteGroupPlan = async (circleId: string, planId: string) => {
    try {
      await deleteDoc(doc(db, 'circles', circleId, 'groupPlans', planId));
      setActiveCircleGroupPlans((prev) => prev.filter((p) => p.planId !== planId));
      setActiveGroupPlan((prev) => (prev && prev.planId === planId ? null : prev));
      triggerToast('Deleted group plan. 🗑️');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/groupPlans/${planId}`);
    }
  };

  // Real-user member profile lookup (by uid), separate from the legacy
  // viewMemberProfile(name) below which still serves the illustrative
  // DUMMY_PROFILES-backed content (e.g. the Recent Group Feed placeholders).
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
      console.error('Error loading shared plans, falling back to beautiful presets:', err);
      setSharedPlans([
        {
          id: 'mock-1',
          name: 'The 30-Day Scripture Sprint',
          preset: 'sprint',
          learningDays: ['M', 'T', 'W', 'Th', 'F'],
          newVersesPace: 5,
          maxReviewCap: 20,
          creatorName: 'Pastor David',
          creatorId: 'mock-creator-1',
          createdAt: new Date(),
          downloadsCount: 142,
        },
        {
          id: 'mock-2',
          name: 'Gentle Word Drip',
          preset: 'drip',
          learningDays: ['M', 'Th'],
          newVersesPace: 1,
          maxReviewCap: 10,
          creatorName: 'Esther Vance',
          creatorId: 'mock-creator-2',
          createdAt: new Date(),
          downloadsCount: 89,
        },
        {
          id: 'mock-3',
          name: 'Warrior Pacing Routine',
          preset: 'warrior',
          learningDays: ['M', 'W', 'F', 'S'],
          newVersesPace: 3,
          maxReviewCap: 15,
          creatorName: 'Sarah Miller',
          creatorId: 'mock-creator-3',
          createdAt: new Date(),
          downloadsCount: 64,
        },
      ]);
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
        cognitiveLoadSensitivity: plan.cognitiveLoadSensitivity || 'medium',
        isActive: true,
        updatedAt: new Date().toISOString(),
      };
      syncDesignerFromPlan(adopted);

      if (auth.currentUser) {
        const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
        // merge: true — this doc also holds savedPlans, memorizationGoal and
        // activeGroupPlanId; a plain setDoc here silently erased all of them.
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

  const joinGroupPlan = async (groupPlan: GroupPlan) => {
    try {
      const currentQueueIds = memoryQueueRef.current.map((item) => item.verseId);
      const missingVerseIds = groupPlan.scriptureRange.filter((id) => !currentQueueIds.includes(id));

      // Group missing verseIds (e.g. "GEN_1_3") by book+chapter so each real
      // chapter is only fetched once, regardless of how many of its verses
      // are in this plan's range.
      const byChapter = new Map<string, { bookId: string; chapter: number; verseNumbers: number[] }>();
      missingVerseIds.forEach((vId) => {
        const [bookId, chapterStr, verseStr] = vId.split('_');
        const chapter = parseInt(chapterStr, 10);
        const key = `${bookId}_${chapter}`;
        if (!byChapter.has(key)) byChapter.set(key, { bookId, chapter, verseNumbers: [] });
        byChapter.get(key)!.verseNumbers.push(parseInt(verseStr, 10));
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
            verseId: `${bookId}_${chapter}_${verseNumber}`,
            book: bookMeta.name,
            chapter,
            verseNumber,
            text,
            orderIndex: memoryQueueRef.current.length + newItems.length,
            status: 'queued',
            origin: 'group',
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

      // No manual Firestore batch write here — the memoryQueue auto-sync
      // effect (added last session) picks up this queue update and
      // persists it (including deletion-diffing), debounced.
      updateMemoryQueue((prev) => [...prev, ...newItems]);

      setActiveGroupPlan(groupPlan);

      if (auth.currentUser) {
        try {
          const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
          await setDoc(
            planRef,
            {
              activeGroupPlanId: groupPlan.planId,
              updatedAt: new Date(),
            },
            { merge: true }
          );
        } catch (err) {
          console.error('Failed to update active group plan:', err);
        }
      }

      triggerToast(`Successfully joined "${groupPlan.name}"! Group verses appended. 🎯`);
    } catch (err) {
      console.error('Error joining group plan:', err);
    }
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
          // merge: true — preserve memorizationGoal/activeGroupPlanId, which
          // live on this same doc but aren't part of this write.
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
        // merge: true — a plain setDoc here erased memorizationGoal and
        // activeGroupPlanId every time a plan was saved. The full
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

  // Sets (or replaces) the single active memorization goal: fetches real
  // verse text for the whole chapter range once (so pace/date recalculation
  // afterward is pure arithmetic, no re-fetching), then front-of-queues
  // whichever of those verses aren't already learning/reviewing/retained.
  // Verses already in progress are left untouched -- a goal doesn't reset
  // work already underway. setMemoryQueue triggers the existing debounced
  // auto-sync effect, so no manual queue write is needed here.
  const setMemorizationGoalRange = async (
    book: string,
    startChapter: number,
    endChapter: number,
    startVerse: number,
    endVerse: number,
    targetDate: string
  ) => {
    const bookMeta = getBookByName(book);
    if (!bookMeta) {
      triggerToast(`Unrecognized book: ${book}`);
      return;
    }
    if (endChapter < startChapter) {
      triggerToast('End chapter must be on or after the start chapter.');
      return;
    }
    setIsCalculatingGoal(true);
    try {
      const verseIds: string[] = [];
      const candidateItems: { verseId: string; chapter: number; verseNumber: number; text: string }[] = [];
      let skippedChapters = 0;
      // Verse bounds only restrict a single-chapter goal (e.g. "Romans 8:1-10")
      // -- multi-chapter goals still use every verse in each chapter, since
      // "verse 5 of every chapter" isn't a meaningful range.
      const singleChapter = startChapter === endChapter;
      for (let ch = startChapter; ch <= endChapter; ch++) {
        const chapterData = await fetchChapterText(DEFAULT_TRANSLATION_ID, bookMeta.id, ch);
        if (!chapterData) {
          skippedChapters++;
          continue;
        }
        let verseNumbers = Object.keys(chapterData.verses)
          .map(Number)
          .sort((a, b) => a - b);
        if (singleChapter) {
          verseNumbers = verseNumbers.filter((v) => v >= startVerse && v <= endVerse);
        }
        verseNumbers.forEach((v) => {
          const verseId = `${bookMeta.id}_${ch}_${v}`;
          verseIds.push(verseId);
          candidateItems.push({ verseId, chapter: ch, verseNumber: v, text: chapterData.verses[String(v)] });
        });
      }

      if (verseIds.length === 0) {
        triggerToast(`Couldn't find any verses for ${book} ${startChapter}${singleChapter ? `:${startVerse}-${endVerse}` : `-${endChapter}`} in the scripture library yet.`);
        return;
      }

      const goalIdSet = new Set(verseIds);
      const existingByVerseId = new Map(memoryQueueRef.current.map((q) => [q.verseId, q]));
      const frontOfQueue: QueueItem[] = verseIds
        .map((vid) => {
          const existing = existingByVerseId.get(vid);
          if (existing) return existing.status === 'queued' ? existing : null;
          const candidate = candidateItems.find((c) => c.verseId === vid)!;
          return {
            verseId: vid,
            book,
            chapter: candidate.chapter,
            verseNumber: candidate.verseNumber,
            text: candidate.text,
            orderIndex: 0,
            status: 'queued' as const,
            origin: 'individual' as const,
            retentionPhase: 'none' as const,
            dateStarted: null,
            lastReviewDate: null,
            nextReviewDueDate: null,
            currentStreakCount: 0,
            totalSuccessfulReviews: 0,
            gracePeriodUsedToday: false,
          };
        })
        .filter((q): q is QueueItem => !!q);

      const rest = memoryQueueRef.current.filter((q) => !(goalIdSet.has(q.verseId) && q.status === 'queued'));
      const reordered = [...frontOfQueue, ...rest].map((q, i) => ({ ...q, orderIndex: i }));
      updateMemoryQueue(() => reordered);

      const goal: MemorizationGoal = {
        book,
        startChapter,
        endChapter,
        startVerse: singleChapter ? startVerse : verseIds.length ? candidateItems[0].verseNumber : 1,
        endVerse: singleChapter ? endVerse : candidateItems[candidateItems.length - 1]?.verseNumber || 1,
        targetDate,
        totalVerses: verseIds.length,
        verseIds,
        createdAt: new Date().toISOString(),
      };
      setMemorizationGoal(goal);

      if (auth.currentUser) {
        try {
          const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
          await setDoc(planRef, { memorizationGoal: goal }, { merge: true });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `memoryPlans/${auth.currentUser.uid}`);
        }
      }

      const skippedNote =
        skippedChapters > 0
          ? ` (${skippedChapters} chapter${skippedChapters > 1 ? 's' : ''} not yet available were skipped)`
          : '';
      const rangeLabel = singleChapter
        ? `${startChapter}:${startVerse}-${endVerse}`
        : `${startChapter}-${endChapter}`;
      triggerToast(`Goal set: ${book} ${rangeLabel} — ${verseIds.length} verses${skippedNote}. 🎯`);
    } finally {
      setIsCalculatingGoal(false);
    }
  };

  const clearMemorizationGoal = async () => {
    setMemorizationGoal(null);
    if (auth.currentUser) {
      try {
        const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
        await setDoc(planRef, { memorizationGoal: null }, { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `memoryPlans/${auth.currentUser.uid}`);
      }
    }
    triggerToast('Memorization goal cleared.');
  };

  // Updates just the target date on the active goal -- unlike
  // setMemorizationGoalRange, this doesn't re-fetch scripture text or touch
  // the queue, since the verse range itself hasn't changed.
  const updateGoalTargetDate = async (newTargetDate: string) => {
    if (!memorizationGoal) return;
    const updated = { ...memorizationGoal, targetDate: newTargetDate };
    setMemorizationGoal(updated);
    if (auth.currentUser) {
      try {
        const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
        await setDoc(planRef, { memorizationGoal: updated }, { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `memoryPlans/${auth.currentUser.uid}`);
      }
    }
  };

  // Adopts an externally-sourced pacing configuration (e.g. copying another
  // member's plan from AnalyzePlanScreen) as a brand-new saved plan, active
  // immediately. Builds the plan from the passed-in values directly rather
  // than reading learningDays/newVersesPace/etc. from hook state, since the
  // setLearningDays()-style setters called alongside this haven't flushed yet
  // when this runs (React state updates aren't synchronous).
  const adoptPlanFromProfile = async (profile: {
    planName?: string;
    preset?: 'drip' | 'warrior' | 'custom';
    learningDays?: string[];
    newVersesPace?: number;
    maxReviewCap?: number;
    retentionRigor?: 'light' | 'standard' | 'deep' | 'custom';
    dailyPhaseWeeks?: number;
    weeklyPhaseMonths?: number;
    monthlyPhaseYears?: number;
    masteryTouches?: number;
    reviewsRequired?: number;
    sabbathEnabled?: boolean;
    sabbathDay?: string;
    cognitiveLoadSensitivity?: 'low' | 'medium' | 'high';
  }) => {
    const newPlan: MemoryPlan = {
      id: 'plan-' + Date.now(),
      name: profile.planName || 'Adopted Plan',
      preset: profile.preset || 'custom',
      learningDays: profile.learningDays || ['M', 'W', 'F'],
      newVersesPace: profile.newVersesPace ?? 3,
      maxReviewCap: profile.maxReviewCap ?? 15,
      retentionRigor: profile.retentionRigor || 'standard',
      dailyPhaseWeeks: profile.dailyPhaseWeeks ?? 7,
      weeklyPhaseMonths: profile.weeklyPhaseMonths ?? 6,
      monthlyPhaseYears: profile.monthlyPhaseYears ?? 5,
      masteryTouches: profile.masteryTouches ?? 3,
      reviewsRequired: profile.reviewsRequired ?? 1,
      sabbathEnabled: profile.sabbathEnabled ?? false,
      sabbathDay: profile.sabbathDay || 'Su',
      cognitiveLoadSensitivity: profile.cognitiveLoadSensitivity || 'medium',
      isActive: true,
      updatedAt: new Date().toISOString(),
    };

    const updatedPlans = [...savedPlans.map((p) => ({ ...p, isActive: false })), newPlan];
    setSavedPlans(updatedPlans);

    syncDesignerFromPlan(newPlan);
    setEditingPlanId(newPlan.id);

    if (auth.currentUser) {
      try {
        const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
        await setDoc(
          planRef,
          {
            savedPlans: updatedPlans,
            ...planTopLevelFields(newPlan),
            updatedAt: new Date(),
          },
          { merge: true }
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `memoryPlans/${auth.currentUser.uid}`);
      }
    }

    triggerToast(`Successfully copied and joined the plan: "${newPlan.name}"! 📖`);

    // Navigate directly instead of via navigateTo('activePlan'): that helper
    // re-syncs learningDays/preset/etc from savedPlans.find(p => p.isActive),
    // but the setSavedPlans() call above hasn't flushed into this closure yet
    // (state updates aren't synchronous), so it would read the OLD active
    // plan and clobber the newPlan fields just set above.
    setBackHistory((prev) => [...prev, { screen: currentScreen, book: selectedBook, chapter: selectedChapter }]);
    setCurrentTab('home');
    setCurrentScreen('activePlan');
    setSelectedVerseNumbers([]);
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
      }

      if (profileSnap && !profileSnap.exists()) {
        const newProfile = {
          displayName: currentUser.displayName || 'Anonymous',
          // Lowercased once at creation for prefix-match user search (Find
          // Friends) — this app has no backend/search service, so this is
          // the standard Firestore-only trick (range query on a normalized
          // field). Doesn't need to stay in sync with displayName since
          // there's no rename feature yet.
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
            id: 'genesis-foundations',
            name: planData.name || 'Genesis — Foundations Track',
            preset: planData.preset || 'custom',
            learningDays: planData.learningDays || ['M', 'T', 'W', 'Th', 'F'],
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
          cognitiveLoadSensitivity: p.cognitiveLoadSensitivity || 'medium',
        }));

        setSavedPlans(plansList);

        // Find the active plan and sync current state
        const active = plansList.find((p) => p.isActive) || plansList[0];
        if (active) {
          syncDesignerFromPlan(active);
        }

        setMemorizationGoal(planData.memorizationGoal || null);
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
      setActiveCircleGroupPlans([]);
      setActiveGroupPlan(null);
      setViewingGroupDetail(false);
      setActiveGroupId('');
      setCommunitySubView('home');

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

  useEffect(() => {
    if (playingRecordingId && !nowPlayingRecording?.audioUrl) {
      const totalSec = nowPlayingRecording ? nowPlayingRecording.duration : 20;
      recTimerRef.current = setInterval(() => {
        setPlayingRecProgress((prev) => {
          if (prev >= 100) {
            setPlayingRecordingId(null);
            triggerToast('Recording playback completed.');
            return 0;
          }
          return prev + 100 / totalSec;
        });
      }, 1000);
    } else {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    }
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    };
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

  // ==========================================
  // 7-6-5 DETERMINISTIC RETENTION ENGINE & HELPERS
  // ==========================================
  const getTodayAbbreviation = () => DAY_ABBREVS[new Date().getDay()];

  const isTodayLearningDay = () => {
    const todayAbbr = getTodayAbbreviation();
    if (sabbathEnabled && todayAbbr === sabbathDay) return false;
    return learningDays.includes(todayAbbr);
  };

  // Wraps setDate + sabbath-adjustment + toISOString for the many places
  // handleReviewCompleted schedules a next-due date, so a sabbath day never
  // ends up as a scheduled due date.
  const nextDueDateISO = (days: number) => {
    const d = new Date();
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

  // Shared by getEstimatedReviewTime (today only) and getMemoryLoadForecast
  // (today + future days), so both always price a "due review" the same
  // way and never quietly disagree. For today, a missing due date or one
  // in the past both count as due (matches the original today-only
  // behavior); for a future day, only an exact due-date match counts.
  const computeDayReviewLoad = (queue: QueueItem[], date: Date, isToday: boolean) => {
    let seconds = 0;
    let count = 0;
    queue.forEach((item) => {
      if (item.status !== 'reviewing') return;
      const due = item.nextReviewDueDate ? new Date(item.nextReviewDueDate) : null;
      const isDue = isToday ? !due || due <= date : !!due && due.toDateString() === date.toDateString();
      if (!isDue) return;
      count += 1;
      if (item.retentionPhase === 'daily') seconds += 30;
      else if (item.retentionPhase === 'weekly') seconds += 45;
      else if (item.retentionPhase === 'monthly') seconds += 60;
    });
    return { seconds, count };
  };

  const getEstimatedReviewTime = (queue: QueueItem[], sensitivity: 'low' | 'medium' | 'high') => {
    const learningSeconds = queue.filter((item) => item.status === 'learning').length * 120;
    const { seconds: reviewSeconds } = computeDayReviewLoad(queue, new Date(), true);
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
      const date = new Date();
      date.setDate(date.getDate() + i);
      const isLearnDay = learningDaysList.includes(DAY_ABBREVS[date.getDay()]);
      // Today's own pull, if any, is already reflected in the real queue
      // (baseLearningCount) -- only project pulls for days after today.
      if (i > 0 && isLearnDay) cumulativeNewVerses += pace;

      const { seconds: reviewSeconds, count: dueReviewCount } = computeDayReviewLoad(queue, date, i === 0);
      const learningCount = baseLearningCount + cumulativeNewVerses;
      const loadMins = Math.ceil(((reviewSeconds + learningCount * 120) * multiplier) / 60);

      return { date, isLearnDay, loadMins, versesCount: learningCount + dueReviewCount };
    });
  };

  const triggerDailyPull = async () => {
    if (!isTodayLearningDay()) {
      triggerToast(`Today (${getTodayAbbreviation()}) is a non-learning day. Focus on reviews! 📅`);
      return;
    }

    const estTime = getEstimatedReviewTime(memoryQueue, cognitiveLoadSensitivity);
    if (estTime >= maxReviewCap) {
      triggerToast(`Review Shield is Active! Review time (${estTime}m) >= limit (${maxReviewCap}m). No new verses pulled today. 🛡️`);
      return;
    }

    const queuedItems = memoryQueue.filter((item) => item.status === 'queued');
    if (queuedItems.length === 0) {
      triggerToast('No more queued verses to pull! 🎉');
      return;
    }

    let actualPace = newVersesPace;
    let catchUpMessage = '';

    if (activeGroupPlan) {
      // Pacing days checks: use group plan's active learning days mapping if specified, or default to general learningDays
      // Find how many of the group plan's verses have been started (status !== 'queued')
      const groupPlanVerses = memoryQueue.filter((item) => activeGroupPlan.scriptureRange.includes(item.verseId));
      const userPlanIndex = groupPlanVerses.filter((item) => item.status !== 'queued').length;

      const isBehind = userPlanIndex < activeGroupPlan.currentGroupVerseIndex;
      if (isBehind) {
        actualPace = newVersesPace * 2;
        catchUpMessage = ` (Catch-Up Active! Pace doubled from ${newVersesPace} to ${actualPace} to catch up to group verse pointer ${activeGroupPlan.currentGroupVerseIndex}) 🏃‍♂️`;
      }
    }

    const toPullCount = Math.min(actualPace, queuedItems.length);
    const itemsToPull = queuedItems.slice(0, toPullCount);

    const updatedQueue = memoryQueueRef.current.map((item) => {
      const isTarget = itemsToPull.some((p) => p.verseId === item.verseId);
      if (isTarget) {
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
      }
      return item;
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

    triggerToast(
      `Successfully pulled ${toPullCount} new ${toPullCount === 1 ? 'verse' : 'verses'} into your learning queue!${catchUpMessage} 🚀`
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
  const addVersesToQueue = (versesToAdd: VerseState[]) => {
    const existingIds = new Set(memoryQueueRef.current.map((q) => q.verseId));
    const newItems: QueueItem[] = [];
    let skipped = 0;
    versesToAdd.forEach((v) => {
      const bookMeta = getBookByName(v.book);
      if (!bookMeta) {
        skipped++;
        return;
      }
      const verseId = `${bookMeta.id}_${v.chapter}_${v.verse}`;
      if (existingIds.has(verseId)) {
        skipped++;
        return;
      }
      existingIds.add(verseId); // guards against duplicate verses within versesToAdd itself
      newItems.push({
        verseId,
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
      const now = new Date();
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
                (!q.nextReviewDueDate || new Date(q.nextReviewDueDate) <= new Date())
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
        const isSameDay = lastReviewDateStr && new Date(lastReviewDateStr).toDateString() === new Date().toDateString();
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
              updatedItem.nextReviewDueDate = nextDueDateISO(returnPhase === 'monthly' ? 30 : 7);
              triggerToast(
                `Refresher complete! Back to ${returnPhase === 'monthly' ? 'Monthly' : 'Weekly'} review, resuming right where you left off. 🌟`
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
              updatedItem.nextReviewDueDate = nextDueDateISO(7);
              triggerToast('Graduated to Weekly Review phase! 🌟');
            } else {
              updatedItem.nextReviewDueDate = nextDueDateISO(1);
              triggerToast('Daily reviews complete! Spaced date advanced. 📅');
            }
          } else if (updatedItem.retentionPhase === 'weekly') {
            if (updatedItem.currentStreakCount >= weeklyGraduationReviews) {
              updatedItem.retentionPhase = 'monthly';
              updatedItem.currentStreakCount = 1;
              updatedItem.nextReviewDueDate = nextDueDateISO(30);
              triggerToast('Graduated to Monthly Review phase! 🌟');
            } else {
              updatedItem.nextReviewDueDate = nextDueDateISO(7);
              triggerToast('Weekly review complete! Spaced date advanced. 📅');
            }
          } else if (updatedItem.retentionPhase === 'monthly') {
            if (updatedItem.currentStreakCount >= monthlyGraduationReviews) {
              updatedItem.status = 'retained';
              updatedItem.retentionPhase = 'none';
              updatedItem.nextReviewDueDate = null;
              triggerToast('Successfully RETAINED forever! 🏆🎉');
            } else {
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
          (q) => q.status === 'reviewing' && (!q.nextReviewDueDate || new Date(q.nextReviewDueDate) <= new Date())
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

    const updatedQueue = memoryQueueRef.current.map((item, idx) => {
      if (idx < 3) {
        return {
          ...item,
          status: 'reviewing' as const,
          retentionPhase: 'daily' as const,
          nextReviewDueDate: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), // due yesterday
          lastReviewDate: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
          currentStreakCount: item.currentStreakCount || 1,
          totalSuccessfulReviews: item.totalSuccessfulReviews || 1,
        };
      }
      return item;
    });

    updateMemoryQueue(() => updatedQueue);

    if (auth.currentUser) {
      try {
        const batch = writeBatch(db);
        updatedQueue.slice(0, 3).forEach((item) => {
          const docRef = doc(db, 'users', auth.currentUser!.uid, 'memoryQueue', item.verseId);
          batch.set(docRef, item);
        });
        await batch.commit();
      } catch (err) {
        console.error('Failed to sync mock queue items:', err);
      }
    }
    triggerToast('🧪 3 verses are now set to DUE for Spaced Repetition reviews!');
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
  const localDayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const activityByDay = new Map<string, number>();
  memoryQueue.forEach((item) => {
    (item.touchLogs || []).forEach((log) => {
      const day = localDayKey(new Date(log.timestamp));
      activityByDay.set(day, (activityByDay.get(day) || 0) + 1);
    });
  });

  const activityLast15Days = Array.from({ length: 15 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (14 - i));
    const key = localDayKey(d);
    return {
      day: d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
      count: activityByDay.get(key) || 0,
    };
  });

  // Consecutive days of practice counting back from today; 0 for a new/idle account.
  const memoryStreak = (() => {
    let streak = 0;
    const d = new Date();
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
  } = useChapterText(DEFAULT_TRANSLATION_ID, activeBookId, selectedChapter);

  // Merge real verse text with this user's personal progress (tracked in memoryQueue)
  // to build the VerseState list the Chapter Landing screen renders.
  const activeChapterVerses: VerseState[] = activeChapterTextData
    ? Object.keys(activeChapterTextData.verses)
        .map(Number)
        .sort((a, b) => a - b)
        .map((verseNum) => {
          const queueItem = memoryQueue.find(
            (q) => q.book === selectedBook && q.chapter === selectedChapter && q.verseNumber === verseNum
          );
          let status: VerseState['status'] = 'untouched';
          let dueDate: string | undefined;
          if (queueItem) {
            if (queueItem.status === 'retained') {
              status = 'memorized';
              dueDate = 'Completed';
            } else if (queueItem.status === 'reviewing') {
              status = 'memorized';
              const isDue = !queueItem.nextReviewDueDate || new Date(queueItem.nextReviewDueDate) <= new Date();
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
      // in exactly the same place, just later). uploadBytesResumable() uses
      // a completely different wire protocol -- metadata goes in its own
      // request, and each binary chunk is sent as a raw request body
      // (FbsBlob.uploadData(), no Blob concatenation at all) -- so it never
      // hits this restriction, on any platform. Confirmed via reading
      // @firebase/storage's own source (node_modules/@firebase/storage/dist/
      // index.cjs.js): multipartUpload() -> FbsBlob.getBlob() -> new Blob(...)
      // vs. continueResumableUpload() -> blob.slice(...).uploadData() -> the
      // raw bytes, untouched.
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
    DUMMY_PROFILES,

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
    activeGroupPlan, setActiveGroupPlan,
    viewingGroupDetail, setViewingGroupDetail,
    memorizationGoal, isCalculatingGoal,
    setMemorizationGoalRange, clearMemorizationGoal, updateGoalTargetDate,
    countLearningDaysBetween, dateAfterNLearningDays,
    myCircles, loadingMyCircles,
    publicCircles, loadingPublicCircles,
    activeCircle, activeCircleMembers, activeCircleGroupPlans, loadingActiveCircle,
    circleFriends, loadCircleFriends,
    activityEvents, loadingActivityEvents, loadActivityFeed,
    friends, loadingFriends, loadFriends,
    incomingFriendRequests, outgoingFriendRequests, loadFriendRequests,
    userSearchQuery, setUserSearchQuery, userSearchResults, searchingUsers, searchUsers,
    sendFriendRequest, acceptFriendRequest, declineFriendRequest, cancelFriendRequest, removeFriend,
    selectedRecording, setSelectedRecording,
    communitySubView, setCommunitySubView,
    activeGroupId,
    showAppStorePreview, setShowAppStorePreview,
    isEditingCircleSettings, setIsEditingCircleSettings,
    showCreatePlanForm, setShowCreatePlanForm,
    newPlanName, setNewPlanName,
    newPlanDesc, setNewPlanDesc,
    newPlanBook, setNewPlanBook,
    newPlanPacing, setNewPlanPacing,
    newPlanStartVerse, setNewPlanStartVerse,
    newPlanEndVerse, setNewPlanEndVerse,
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
    viewMemberProfile,
    viewMemberProfileById,

    // auth
    signOut,

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
    pinCircleAnnouncement,
    updateCircleSettings,
    deployGroupPlan,
    advanceGroupPlanPointer,
    deleteGroupPlan,

    // shared/group plan handlers
    loadSharedPlans,
    joinSharedPlan,
    joinGroupPlan,
    handleActivatePlan,
    handleDeletePlan,
    handleEditPlan,
    handleCreateNewPlan,
    handleSavePlan,
    saveActivePlanRhythm,
    adoptPlanFromProfile,
    publishSharedPlan,
    loadUserData,

    // formatting helpers
    formatTime,
    getTodayDateString,

    // 7-6-5 retention engine
    getTodayAbbreviation,
    isTodayLearningDay,
    validateTouch,
    getEstimatedReviewTime,
    getMemoryLoadForecast,
    triggerDailyPull,
    promoteToLearning,
    addVersesToQueue,
    handleReviewCompleted,
    triggerMockDueReviews,
    handleUpdateVerseStatus,
    startPractice,

    // computed metrics
    totalVersesCount,
    memorizedCount,
    learningCount,
    untouchedCount,
    memorizedPercent,
    activityLast15Days,
    memoryStreak,
    activeChapterVerses,
    activeChapterTextLoading,
    activeChapterTextError,
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
