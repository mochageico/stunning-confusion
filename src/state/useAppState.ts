import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
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
import { hasPlayableAudio, resolvePlaybackUrl } from '../lib/studioAudio';
import { appendReviewLog } from '../lib/reviewLog';
import {
  deleteUser,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth';
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';

import { auth, db, storage, handleFirestoreError, OperationType } from '../firebase';
import { pendingSignUpDisplayName } from './useEmailAuth';
import {
  ALL_BIBLE_BOOKS,
  BOOKS,
  BUILT_IN_PLAN_ID,
  DEFAULT_PLANS,
  DEFAULT_RHYTHM,
  DEFAULT_TRANSLATION_ID,
  getBookByName,
  SUGGESTED_FEED_RECORDINGS,
} from '../data';
import { fetchChapterText, useChapterText } from './useScripture';
import {
  ActivityEvent,
  Circle,
  CircleMember,
  GroupChallenge,
  GroupChallengeMembership,
  MemoryPlan,
  QueueItem,
  Recording,
  Rhythm,
  GroupPlan,
  GroupPlanMembership,
  ReviewLog,
  TouchLog,
  VerseState,
  VerseTimestamp,
} from '../types';
import { computeDailyPull, PersonalPacingSettings } from '../lib/groupPlanScheduler';
import { getMemoryCalendarProjection, isPauseInEffect } from '../lib/reviewCalendar';
import { formatDate, formatDuration } from '../lib/format';
import { useSocial } from './useSocial';
import { useLocalPrefs } from './useLocalPrefs';
import { useChapterPhotos } from './useChapterPhotos';
import { useAudioDownloads } from './useAudioDownloads';
import { useAccountabilityNudges } from './useAccountabilityNudges';
import { useRecorder } from './useRecorder';
import { useImportAudio } from './useImportAudio';
import { useChatCards } from './useChatCards';
import { useFriends } from './useFriends';
import { useMessaging } from './useMessaging';
import { useChallenges } from './useChallenges';
import { countRangeProgress, VerseRange } from '../lib/verseRange';
import { buildVerseTimestamps } from '../lib/verseTimestamps';
import { PushTarget, ReminderDay, usePushNotifications } from './usePushNotifications';
import * as Linking from 'expo-linking';
import { parseInviteCode } from '../lib/invites';
import {
  buildVerseId,
  JOINED_GROUP_PLANS_FIELD,
  mapQueueItemsToVerseStates,
  normalizeAdoptedPlan,
  normalizeGroupPlan,
  resolveChapterAudio,
  stripUndefined,
} from '../lib/appData';
import {
  DAY_ABBREVS,
  DAY_FULL_NAMES,
  getLogicalDate,
  localDayKey,
  nextOccurrenceOfWeekday,
  nthOccurrenceOfWeekday,
} from '../lib/logicalDate';
import { applyMissToItem, computeMissedCycles, describeMissOutcome, resolveMissedCycles } from '../lib/missPolicy';
import {
  computeNextDueDate,
  estimateReviewMinutes,
  findChapterReviewAnchor,
  forecastMemoryLoad,
  isReviewDue,
  isTouchSpaced,
  nextDueDateISO as nextDueDateISOFor,
} from '../lib/retention';

// Pure helpers that used to live in this file; re-exported so the screens
// and components that import them from here keep working unchanged.
export { buildVerseId, isReviewDue, mapQueueItemsToVerseStates, resolveChapterAudio };

export type ScreenName =
  | 'home'
  | 'books'
  | 'chapters'
  | 'chapterLanding'
  | 'audioFeed'
  | 'planDesigner'
  | 'activePlan'
  | 'addVerses'
  | 'mySchedule'
  | 'verseSources'
  | 'savedPlans'
  | 'memoryCalendar'
  | 'verseRoad'
  | 'versePage'
  | 'referenceDrill'
  | 'threadDrill'
  | 'guided'
  | 'memberProfile'
  | 'groupPlanDetail'
  | 'fullHistory'
  | 'dashboard'
  | 'settings'
  | 'recordingDetail'
  | 'myRecordings'
  | 'findFriends'
  | 'messages'
  | 'dmThread'
  | 'circleChat'
  | 'quiz';

// Screens App.tsx's router only renders while their tab is current (see
// Screens() in App.tsx). navigateTo() needs these lists so it can switch tabs
// itself — otherwise navigating to e.g. 'activePlan' from the Profile tab
// silently no-ops, since the router keeps showing the current tab's screen.
const HOME_TAB_SCREENS: ScreenName[] = [
  'home',
  'books',
  'chapters',
  'chapterLanding',
  'audioFeed',
  'referenceDrill',
  'threadDrill',
  'guided',
];

// The Verses tab replaced the My Memory Work menu (2026-10-10): My Verses is
// its root, and everything that used to hang off that menu lives under it.
// 'addVerses' is deliberately in neither list -- it opens over whichever tab
// you're on (Today's Coming up next card, or My Verses), so Back returns there.
const VERSES_TAB_SCREENS: ScreenName[] = [
  'activePlan',
  'mySchedule',
  'verseSources',
  'memoryCalendar',
  'verseRoad',
  'versePage',
  'savedPlans',
  'planDesigner',
];

/**
 * Which verse the verse page shows: a single verse, or a run of neighbouring
 * verses that sit at the same point on the road (one row on My Verses). The
 * page's translation dropdown switches `translationId`.
 */
export interface VersePageRef {
  book: string;
  chapter: number;
  verses: number[];
  translationId: string;
}

export type TabName = 'home' | 'verses' | 'community' | 'record' | 'profile';

const tabForScreen = (screen: ScreenName): TabName | null =>
  HOME_TAB_SCREENS.includes(screen) ? 'home' : VERSES_TAB_SCREENS.includes(screen) ? 'verses' : null;

/**
 * Options for logging a review. `quiet` skips the toasts, for callers that
 * show their own results; `via` records which practice produced it in the
 * verse's review history.
 */
export type ReviewCompletedOpts = { perfect?: boolean; quiet?: boolean; via?: ReviewLog['via'] };

/** Where Pick up the thread opens: the verse to recite through, from a Recall that just passed. */
export type ThreadDrillPreset = { book: string; chapter: number; verse: number; translationId?: string };

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
  const [verses, setVerses] = useState<VerseState[]>([]);
  const [memoryQueue, setMemoryQueue] = useState<QueueItem[]>([]);
  const [primingLookahead, setPrimingLookahead] = useState<number>(30);
  const [cognitiveLoadSensitivity, setCognitiveLoadSensitivity] = useState<'low' | 'medium' | 'high'>('medium');

  // Add verses screen: the book and chapter it opens on (kept between visits).
  const [selectedAddBook, setSelectedAddBook] = useState('Romans');
  const [selectedAddChapter, setSelectedAddChapter] = useState(8);

  // Firebase Auth & Sync states
  const [user, setUser] = useState<any>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [currentTab, setCurrentTab] = useState<TabName>('home');
  const [currentScreen, setCurrentScreen] = useState<ScreenName>('home');

  // Navigation stack helpers
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  // Device-only preferences: translation, Memory Grid highlights/doodles/
  // columns, Studio playback (see useLocalPrefs).
  const {
    selectedTranslationId,
    setSelectedTranslationId,
    highlightedVerses,
    toggleVerseHighlight,
    verseDoodles,
    saveVerseDoodle,
    memoryGridColumns,
    setMemoryGridColumns,
    studioPlaybackEnabled,
    setStudioPlaybackEnabled,
    studioAbOverride,
    setStudioAbOverride,
    studioPlaybackActive,
  } = useLocalPrefs();
  const [backHistory, setBackHistory] = useState<
    Array<{ screen: ScreenName; book: string | null; chapter: number | null; tab?: TabName }>
  >([]);

  // Selection state for Chapter Landing
  const [selectedVerseNumbers, setSelectedVerseNumbers] = useState<number[]>([]);
  const [chapterViewMode, setChapterViewMode] = useState<'list' | 'grid' | 'memoryGrid'>('list');

  // Bible page photos (see useChapterPhotos).
  const {
    chapterPhotos,
    photoCache,
    loadChapterPhotos,
    wipeLocalPhotos,
    photosForChapter,
    cacheChapterPhoto,
    addChapterPhoto,
    deleteChapterPhoto,
    setChapterPhotoVerseRange,
    reorderChapterPhotos,
  } = useChapterPhotos({ user, triggerToast: (message) => triggerToast(message) });

  // Whether RecordingDetailScreen's verse-sync timeline is in edit mode.
  // The draft marker positions themselves live as local component state in
  // that screen (derived fresh from selectedRecording.verseTimestamps each
  // time it's opened) rather than here, since they're pure editing-session
  // scratch state with no reason to survive a navigation away and back.
  const [isEditingSync, setIsEditingSync] = useState<boolean>(false);

  // Rhythm: your personal cadence, user-level and independent of any plan.
  // The `preset` field ('drip'/'warrior'/'custom') was deleted with the
  // plan/rhythm split -- it only ever labelled a combination of the three
  // dials below, and every manual change slammed it straight back to
  // 'custom', so it carried no information the dials don't already hold.
  const [learningDays, setLearningDays] = useState<string[]>(DEFAULT_RHYTHM.learningDays);
  const [newVersesPace, setNewVersesPace] = useState<number>(DEFAULT_RHYTHM.newVersesPace);
  const [maxReviewCap, setMaxReviewCap] = useState<number>(DEFAULT_RHYTHM.maxReviewCap);
  // Retention rigor: how long a verse stays in each review phase before
  // graduating (default 7-6-5 == today's previously-hardcoded behavior).
  const [retentionRigor, setRetentionRigor] = useState<'light' | 'standard' | 'deep' | 'custom'>('standard');
  const [dailyPhaseWeeks, setDailyPhaseWeeks] = useState<number>(7);
  const [weeklyPhaseMonths, setWeeklyPhaseMonths] = useState<number>(6);
  const [monthlyPhaseYears, setMonthlyPhaseYears] = useState<number>(5);

  // Practice Overlays
  const [activeModal, setActiveModal] = useState<'listen' | 'learn' | null>(null);
  const [modalVerses, setModalVerses] = useState<VerseState[]>([]);
  // Set just before opening Pick up the thread from a passing Recall, so its
  // setup starts on that chapter and verse. The screen clears it once read.
  const [threadDrillPreset, setThreadDrillPreset] = useState<ThreadDrillPreset | null>(null);
  // The passage Guided learning opens on (Passage.key in lib/guided.ts), or
  // null to let the screen pick the most recent one.
  const [guidedPassageKey, setGuidedPassageKey] = useState<string | null>(null);

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

  // The Record tab's passage and live mic capture (see useRecorder).
  const {
    isRecording,
    setIsRecording,
    isRecordingPaused,
    recordingSeconds,
    setRecordingSeconds,
    lastRecordingDuration,
    verseTapTimestamps,
    recordingBook,
    setRecordingBook,
    recordingChapter,
    setRecordingChapter,
    recordingTranslation,
    setRecordingTranslation,
    recordingRangeStart,
    setRecordingRangeStart,
    recordingRangeEnd,
    setRecordingRangeEnd,
    audioRecorder,
    capturedDurationRef,
    handleStartRecording,
    handleStopRecording,
    handlePauseRecording,
    handleResumeRecording,
    handleResetRecording,
    handleMarkVerseTap,
  } = useRecorder({
    triggerToast: (message) => triggerToast(message),
    getFirstVerse: () => recordingSelectedVerses[0]?.verse,
    onStopped: () => openSaveRecordingDialog('live'),
  });
  const [userRecordings, setUserRecordings] = useState<Recording[]>([]);

  // Imported audio being tagged verse by verse (see useImportAudio).
  const {
    importedAudioUri,
    importedAudioName,
    importTapTimestamps,
    importPlayer,
    importPlayerStatus,
    pickImportAudio,
    clearImportedAudio,
    toggleImportPlayback,
    seekImportAudioBy,
    handleMarkImportTap,
    resetImportTaps,
  } = useImportAudio({ triggerToast: (message) => triggerToast(message) });
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
  // Opens the Save dialog for a finished take, pre-picking your usual visibility.
  const openSaveRecordingDialog = (source: 'live' | 'import') => {
    setPendingRecordingSource(source);
    setPickedRecordingVisibility(defaultRecordingVisibility || 'private');
    setSaveRecordingDialog(true);
  };

  // Profile-sharing visibility: whether this user's verse list is shown to
  // friends on their member profile. Defaults to 'private' (only you). When
  // set to 'friends', a denormalized snapshot is written to
  // profiles/{uid}/shared/memoryQueue (friends-only per the rules) so friends
  // can read it without access to this user's private memoryQueue — kept
  // fresh by the debounced profile sync effect below, and deleted when
  // flipped to 'private'.
  //
  // There is deliberately no equivalent for Review Settings: sharing your
  // retention method was removed outright (see the note above the group-plan
  // handlers), so `memoryPlanVisibility` and its snapshot are gone.
  const [memoryQueueVisibility, setMemoryQueueVisibility] = useState<'private' | 'friends'>('private');

  // First-run SETUP overlay -- shown automatically whenever the loaded/created
  // profile's onboardingCompleted field isn't true (loadUserData sets this),
  // and re-openable anytime from Settings.
  //
  // This replaced a four-step "Getting Started" checklist that walked the user
  // out to real screens one at a time, locking each step behind the previous
  // one and swapping the tab bar for a "Back to Guide" bar so they couldn't
  // wander off. Three things were wrong with it: it taught NAVIGATION rather
  // than the idea (never once explaining what the app actually does), its
  // first stop was the retention editor -- the single most jargon-dense screen
  // in the app -- and it was a tour, so finishing it left the user with a
  // still-empty app and nothing configured.
  //
  // The replacement asks three questions and ACTS on the answers, so a user
  // who finishes it has verses queued and a schedule set. Nothing is locked
  // and every card is skippable.
  const [showOnboarding, setShowOnboarding] = useState(false);
  // The optional "Show me around" tour, reachable from Settings at any time.
  // Deliberately separate from setup: setup configures, the tour explains.
  const [showTour, setShowTour] = useState(false);

  // Real shared-recordings feed, seeded with illustrative sample entries
  // (other people's recordings, e.g. "Sarah Miller") until the real feed loads.
  const [feedRecordings, setFeedRecordings] = useState<Recording[]>(SUGGESTED_FEED_RECORDINGS);
  const [loadingFeedRecordings, setLoadingFeedRecordings] = useState(false);
  const [audioSearchQuery, setAudioSearchQuery] = useState('');
  const [activeFeedFilter, setActiveFeedFilter] = useState<'global' | 'group' | 'friends'>('global');
  const [feedBookFilter, setFeedBookFilter] = useState<string>('');
  const [feedChapterFilter, setFeedChapterFilter] = useState<string>('');
  // A BIBLE_TRANSLATIONS id ('BSB'/'WEB'/'KJV'/'ESV'), or '' for all. Matched
  // case-insensitively against Recording.translation, which older recordings
  // may hold as a display name rather than an id -- see AudioFeedScreen.
  const [feedTranslationFilter, setFeedTranslationFilter] = useState<string>('');

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
  // See MemoryPlan.dayStartHour in types.ts -- 0/1/2, defaults to real midnight.
  const [dayStartHour, setDayStartHour] = useState<number>(0);
  // Missed-review handling -- see MemoryPlan.missPolicy in types.ts.
  const [missPolicy, setMissPolicy] = useState<'lenient' | 'standard' | 'graceDiscretion' | 'custom'>('standard');
  const [missPolicyAskEveryTime, setMissPolicyAskEveryTime] = useState<boolean>(false);
  const [graceCount, setGraceCount] = useState<number>(1);
  const [refresherDailyDays, setRefresherDailyDays] = useState<number>(7);
  const [refresherWeeklyWeeks, setRefresherWeeklyWeeks] = useState<number>(4);
  // Pause -- see MemoryPlan.pausedAt/pausedUntil in types.ts.
  const [pausedAt, setPausedAt] = useState<string | null>(null);
  const [pausedUntil, setPausedUntil] = useState<string | null>(null);
  // Paused right now? While it is, nothing reads as due anywhere -- Home,
  // the time estimate, the calendar and Listen all go through this.
  const reviewsPaused = isPauseInEffect(pausedAt, pausedUntil);
  // Missed-review popup: items found overdue on this app-open, awaiting the
  // user's choice (see resolveMissedReviewChoice). Populated once, in
  // loadUserData, when the active plan's missPolicyAskEveryTime is on --
  // never re-scanned mid-session, so it can't re-open itself as normal
  // review activity changes items' due dates.
  const [missedReviewQueue, setMissedReviewQueue] = useState<{ item: QueueItem; missedCycles: number }[]>([]);
  const [showMissedReviewPrompt, setShowMissedReviewPrompt] = useState(false);
  // Every GroupPlan this member has joined (possibly more than one, each with
  // its own priority setting -- see src/lib/groupPlanScheduler.ts) plus the
  // resolved GroupPlan docs themselves (versesPerWeek, verseIds, etc.), kept
  // in sync so the scheduler always has real, current data to work from.
  const [joinedGroupPlanMemberships, setJoinedGroupPlanMemberships] = useState<GroupPlanMembership[]>([]);
  const [joinedGroupPlanDetails, setJoinedGroupPlanDetails] = useState<GroupPlan[]>([]);
  const [viewingGroupPlan, setViewingGroupPlan] = useState<GroupPlan | null>(null);
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
  const [activeCircleGroupPlans, setActiveCircleGroupPlans] = useState<GroupPlan[]>([]);
  const [loadingActiveCircle, setLoadingActiveCircle] = useState(false);

  // "Friends" = real co-members across every circle the user belongs to
  // (deduped, self excluded) — there's no separate friend-request system.
  const [circleFriends, setCircleFriends] = useState<CircleMember[]>([]);

  // Real memorization-milestone activity feed (Community) — events from the
  // signed-in user and their real circleFriends.
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [loadingActivityEvents, setLoadingActivityEvents] = useState(false);

  // Friends: list, requests, search (see useFriends).
  const {
    friends,
    loadingFriends,
    incomingFriendRequests,
    outgoingFriendRequests,
    userSearchQuery,
    setUserSearchQuery,
    userSearchResults,
    searchingUsers,
    loadFriends,
    loadFriendRequests,
    searchUsers,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    cancelFriendRequest,
    removeFriend,
  } = useFriends({ triggerToast: (message) => triggerToast(message) });

  // Accountability nudges between friends (see useAccountabilityNudges).
  const {
    accountabilityDailyCap,
    receivedAccountabilityNudges,
    loadingAccountabilityNudges,
    loadAccountabilitySentLog,
    loadReceivedAccountabilityNudges,
    canSendAccountabilityNudge,
    sendAccountabilityNudge,
    markAccountabilityNudgeRead,
    dismissAccountabilityNudge,
    updateAccountabilityDailyCap,
    applyAccountabilityDailyCap,
    resetAccountabilityNudges,
  } = useAccountabilityNudges({ friends, dayStartHour, triggerToast: (message) => triggerToast(message) });

  // DMs, circle chat and reactions (see useMessaging).
  const {
    dmThreads,
    loadingDmThreads,
    activeDMThread,
    activeDMMessages,
    loadingActiveDMMessages,
    activeCircleChatId,
    activeCircleMessages,
    loadingActiveCircleMessages,
    reactionsByMessageId,
    activeDMThreadActive,
    findSharedCircleIds,
    openDMThread,
    closeDMThread,
    postChatMessage,
    sendDMMessage,
    toggleReaction,
    openCircleChat,
    closeCircleChat,
    sendCircleMessage,
  } = useMessaging({
    user,
    friends,
    myCircles,
    navigateTo: (screen) => navigateTo(screen),
    triggerToast: (message) => triggerToast(message),
  });

  // 1:1 and group challenges (see useChallenges).
  const {
    activeChallenges,
    loadingActiveChallenges,
    myChallengeBadges,
    activeCircleChallenges,
    setActiveCircleChallenges,
    loadingActiveCircleChallenges,
    setLoadingActiveCircleChallenges,
    openChallengeLeaderboardId,
    openChallengeLeaderboard,
    loadingChallengeLeaderboard,
    joinedGroupChallenges,
    applyJoinedGroupChallenges,
    resetGroupChallenges,
    sendChallenge,
    acceptChallenge,
    declineChallenge,
    deleteChallenge,
    joinGroupChallenge,
    createGroupChallenge,
    endGroupChallenge,
    deleteGroupChallenge,
    leaveGroupChallenge,
    openChallengeLeaderboardModal,
    closeChallengeLeaderboard,
    clearGroupChallengeMembershipsForCircle,
    syncChallengeProgress,
  } = useChallenges({
    user,
    friends,
    activeDMThread,
    selectedTranslationId,
    findSharedCircleIds,
    fetchRangeVerses: (translationId, range) => fetchRangeVerses(translationId, range),
    addVersesToQueue: (versesToAdd, translationId) => addVersesToQueue(versesToAdd, translationId),
    getQueue: () => memoryQueueRef.current,
    triggerToast: (message) => triggerToast(message),
  });

  // Selected Recording for Chapter Recording Landing Page
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);

  // Community Sub-views and Custom Search/Join state
  const [communitySubView, setCommunitySubView] = useState<'home' | 'find' | 'create' | 'preview'>('home');
  const [activeGroupId, setActiveGroupId] = useState<string>('');

  // Read-only public preview of a circle (name/description/owner only) --
  // reachable by tapping a card on the Find Circles screen without joining
  // or loading the full members/study-plans dashboard.
  const [previewCircle, setPreviewCircle] = useState<Circle | null>(null);
  const openCirclePreview = (circle: Circle) => {
    setPreviewCircle(circle);
    setCommunitySubView('preview');
  };
  const closeCirclePreview = () => {
    setPreviewCircle(null);
    setCommunitySubView('find');
  };

  const [isEditingCircleSettings, setIsEditingCircleSettings] = useState<boolean>(false);
  // Group Plan creation only asks for a title + description -- pacing and
  // the verse queue itself are set/built from the plan's own landing page
  // (GroupPlanDetailScreen), using local ephemeral form state there instead
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

  // Active playing of saved rec
  const [playingRecordingId, setPlayingRecordingId] = useState<string | null>(null);
  const [playingRecProgress, setPlayingRecProgress] = useState(0);
  // Set by seekRecordingToTime when asked to jump to a segment of a recording
  // that wasn't already playing — consumed once playback actually starts.
  const pendingSeekSecondsRef = useRef<number | null>(null);

  // Real audio player for saved recordings that have a Storage-backed audioUrl.
  // Recordings without one (e.g. the illustrative community feed placeholders)
  // fall back to the simulated progress timer below.
  //
  // resolvePlaybackUrl picks the studio render when one is ready and studio
  // mode is on, and the raw upload otherwise — so playback works unchanged
  // for legacy recordings, recordings still being processed, and recordings
  // whose render was rejected.
  const nowPlayingRecording = [...userRecordings, ...feedRecordings].find((r) => r.id === playingRecordingId) || null;
  // Recording audio on this device: cache-on-play and Save offline (see
  // useAudioDownloads). Called here because nowPlayingUrl below reads the cache.
  const {
    audioCache,
    wipeAudioCache,
    setListenModePlaying,
    cacheRecordingAudio,
    dropCachedAudio,
    downloadingRecordingIds,
    saveRecordingOffline,
    removeRecordingDownload,
    saveChapterOffline,
    setAudioCacheCap,
    clearAudioDownloads,
  } = useAudioDownloads({
    user,
    playingRecordingId,
    nowPlayingRecording,
    studioPlaybackEnabled,
    triggerToast: (message) => triggerToast(message),
  });
  // Hoisted rather than inlined because the playback effects below key off it:
  // flipping the Studio/Original switch changes this string, which is what
  // makes the player reload with the other version mid-listen.
  const nowPlayingUrl = resolvePlaybackUrl(nowPlayingRecording, studioPlaybackActive, audioCache.map);
  const recordingPlayer = useAudioPlayer(nowPlayingUrl);
  const recordingPlayerStatus = useAudioPlayerStatus(recordingPlayer);

  // Memory Queue auto-sync bookkeeping (debounce timer + last-synced verseIds, for deletion diffing)
  const queueSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSyncedQueueIdsRef = useRef<Set<string>>(new Set());
  // Guards the auto-sync until this user's real queue has been loaded from
  // Firestore. Without it, the sign-in/account-switch transition (which
  // clears memoryQueue synchronously) could commit an empty/stale queue —
  // including deletions — into the NEW account before loadUserData finishes.
  const queueHydratedRef = useRef(false);

  // Verse ids the user has ACTUALLY asked to remove. The auto-sync will only
  // delete documents named here.
  //
  // This exists because inferring deletion from state shrinkage is unsafe: any
  // bug that drops items from `memoryQueue` silently becomes permanent data
  // loss on the next debounce tick. That is exactly what happened -- the queue
  // screen's reorder buttons rebuilt the queue from a filtered view
  // (queued/learning only), so one tap on an arrow dropped every reviewing and
  // retained verse from state, and the sync dutifully deleted all of them from
  // Firestore. Deletion is now an explicit act, not something derived.
  const pendingQueueDeletionsRef = useRef<Set<string>>(new Set());

  // Tracks the uid the auth listener last processed a full transition for.
  // updateProfile() (e.g. display name edits) re-fires onAuthStateChanged
  // for the SAME signed-in user -- without this guard, that re-fire is
  // indistinguishable from a real sign-in/account-switch and wipes/reloads
  // verses, memoryQueue, recordings, etc. for no reason.
  const prevAuthUidRef = useRef<string | null | undefined>(undefined);

  // Profile public-stats auto-sync debounce timer (memorizedCount/learningCount)
  const profileStatsSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // View Interactive Other Profiles
  const [selectedUserProfile, setSelectedUserProfile] = useState<any | null>(null);

  // The name of the Review Settings currently open in the editor. Naming is
  // what forks a built-in preset into your own copy -- see handleSavePlan.
  const [customPlanName, setCustomPlanName] = useState('My Review Settings');

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
  // Single source of truth for "load a plan's settings into the live designer
  // state" and "flatten a plan into the memoryPlans/{uid} doc's top-level
  // fields".
  //
  // Post plan/rhythm split these touch ONLY retention fields. Rhythm
  // (learningDays, pace, review cap, sabbath, dayStartHour, load sensitivity,
  // pause) is user-level and is never read from or written to a plan --
  // that's the whole point of the split, and it's why activating another
  // plan can no longer change your pacing or silently un-pause you.
  const syncDesignerFromPlan = (plan: MemoryPlan) => {
    setRetentionRigor(plan.retentionRigor || 'standard');
    setDailyPhaseWeeks(plan.dailyPhaseWeeks ?? 7);
    setWeeklyPhaseMonths(plan.weeklyPhaseMonths ?? 6);
    setMonthlyPhaseYears(plan.monthlyPhaseYears ?? 5);
    setMasteryTouches(plan.masteryTouches ?? 3);
    setReviewsRequired(plan.reviewsRequired ?? 1);
    setMissPolicy(plan.missPolicy || 'standard');
    setMissPolicyAskEveryTime(plan.missPolicyAskEveryTime ?? false);
    setGraceCount(plan.graceCount ?? 1);
    setRefresherDailyDays(plan.refresherDailyDays ?? 7);
    setRefresherWeeklyWeeks(plan.refresherWeeklyWeeks ?? 4);
    setCustomPlanName(plan.name);
  };

  const planTopLevelFields = (plan: MemoryPlan) => ({
    retentionRigor: plan.retentionRigor,
    dailyPhaseWeeks: plan.dailyPhaseWeeks,
    weeklyPhaseMonths: plan.weeklyPhaseMonths,
    monthlyPhaseYears: plan.monthlyPhaseYears,
    masteryTouches: plan.masteryTouches,
    reviewsRequired: plan.reviewsRequired,
    missPolicy: plan.missPolicy,
    missPolicyAskEveryTime: plan.missPolicyAskEveryTime,
    graceCount: plan.graceCount,
    refresherDailyDays: plan.refresherDailyDays,
    refresherWeeklyWeeks: plan.refresherWeeklyWeeks,
    name: plan.name,
  });

  // The live Rhythm, flattened for the memoryPlans/{uid} doc root. These
  // field names are unchanged from before the split -- pre-split docs already
  // mirrored the active plan's pacing to exactly these root keys, so existing
  // documents migrate by simply being read from the root instead of from the
  // active plan (see the load path), with no destructive rewrite needed.
  const rhythmFields = (): Rhythm => ({
    learningDays,
    newVersesPace,
    maxReviewCap,
    sabbathEnabled,
    sabbathDay,
    dayStartHour,
    cognitiveLoadSensitivity,
    pausedAt,
    pausedUntil,
  });

  // Rhythm commits LIVE -- every dial on the queue page calls this straight
  // away. There is no dirty state and no Save button, because the engine
  // already reads these values from live state the moment they change; the
  // old "Save Rhythm" button only ever controlled whether the change survived
  // a reload, while pretending to control whether it applied at all.
  const persistRhythm = async (overrides: Partial<Rhythm> = {}) => {
    if (!auth.currentUser) return;
    try {
      await setDoc(
        doc(db, 'memoryPlans', auth.currentUser.uid),
        { ...rhythmFields(), ...overrides, updatedAt: new Date() },
        { merge: true }
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `memoryPlans/${auth.currentUser.uid}`);
    }
  };

  // The single entry point every Rhythm control uses. `patch` is passed
  // through to the write as an override because the setState calls below
  // won't have landed yet when persistRhythm reads rhythmFields() in this
  // same tick.
  const updateRhythm = (patch: Partial<Rhythm>) => {
    if (patch.learningDays !== undefined) setLearningDays(patch.learningDays);
    if (patch.newVersesPace !== undefined) setNewVersesPace(patch.newVersesPace);
    if (patch.maxReviewCap !== undefined) setMaxReviewCap(patch.maxReviewCap);
    if (patch.sabbathEnabled !== undefined) setSabbathEnabled(patch.sabbathEnabled);
    if (patch.sabbathDay !== undefined) setSabbathDay(patch.sabbathDay);
    if (patch.dayStartHour !== undefined) setDayStartHour(patch.dayStartHour);
    if (patch.cognitiveLoadSensitivity !== undefined) setCognitiveLoadSensitivity(patch.cognitiveLoadSensitivity);
    if (patch.pausedAt !== undefined) setPausedAt(patch.pausedAt);
    if (patch.pausedUntil !== undefined) setPausedUntil(patch.pausedUntil);
    void persistRhythm(patch);
  };

  // ==========================================
  // NAVIGATION HANDLERS
  // ==========================================
  const [versePageRef, setVersePageRef] = useState<VersePageRef | null>(null);
  const openVersePage = (ref: VersePageRef) => {
    setVersePageRef(ref);
    navigateTo('versePage');
  };

  const navigateTo = (
    screen: ScreenName,
    book: string | null = null,
    chapter: number | null = null,
    // Keep the way back when this crosses into another tab: My Verses' By
    // book view and the verse page open a chapter page (a Today-tab screen),
    // and Back should return to them, not to Today.
    options: { keepBack?: boolean } = {}
  ) => {
    // Record history for seamless back navigation (cleared again below when
    // this switches tabs, unless keepBack). The tab is recorded so Back can
    // cross back into it.
    setBackHistory((prev) => [...prev, { screen: currentScreen, book: selectedBook, chapter: selectedChapter, tab: currentTab }]);

    if (book) setSelectedBook(book);
    if (chapter) setSelectedChapter(chapter);

    // Crossing into another tab starts that tab's history fresh: Back never
    // leads out of the tab you're looking at.
    const targetTab = tabForScreen(screen);
    if (targetTab && targetTab !== currentTab) {
      setCurrentTab(targetTab);
      if (!options.keepBack) setBackHistory([]);
    }

    // NOTE: navigateTo deliberately has no per-screen plan side effects any
    // more. It used to set editingPlanId + sync the designer on
    // navigateTo('activePlan'), which is what made the queue screen an
    // implicit plan editor. The queue screen now edits only Rhythm, which is
    // user-level, and the designer is targeted explicitly by its openers
    // (openActivePlanDesigner / handleEditPlan / handleCreateNewPlan) --
    // doing it here would clobber their setEditingPlanId, since theirs runs
    // before navigateTo and React would apply this one last.

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
      if (prev.tab && prev.tab !== currentTab) setCurrentTab(prev.tab);
      setCurrentScreen(prev.screen);
    } else {
      // Default fallback: the current tab's own first screen.
      setCurrentScreen(currentTab === 'verses' ? 'activePlan' : 'home');
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
      currentScreen === 'groupPlanDetail' ||
      currentScreen === 'fullHistory' ||
      currentScreen === 'dashboard' ||
      currentScreen === 'settings' ||
      currentScreen === 'recordingDetail' ||
      currentScreen === 'myRecordings' ||
      currentScreen === 'messages' ||
      currentScreen === 'dmThread' ||
      currentScreen === 'circleChat' ||
      currentScreen === 'addVerses'
    ) {
      setCurrentScreen('home');
      setBackHistory([]);
    }

    if (tab === 'home') {
      setCurrentScreen('home');
      setBackHistory([]);
    }
    if (tab === 'verses') {
      setCurrentScreen('activePlan');
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
  // theoretically land on the same code. Retries against the circleInvites
  // lookup (the same one joinCircleByCode reads) before accepting one; if
  // genuinely unlucky enough to collide every attempt, appends a timestamp
  // fragment rather than ever failing circle creation.
  const generateUniqueInviteCode = async (): Promise<string> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateInviteCode();
      const snap = await getDoc(doc(db, 'circleInvites', code));
      if (!snap.exists()) return code;
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
          // Member doc first: once kicked from a PRIVATE circle, its doc is
          // no longer readable at all (permission-denied, not "missing").
          const memberSnap = await getDoc(doc(db, 'circles', id, 'members', uid));
          // Self-heal: a circle may have been disbanded, or this user kicked
          // from it, since circleIds was last written — neither of those can
          // update this user's OTHER-side data (disbanding can't touch every
          // member's profile; kicking can't either), so prune stale ids here.
          if (!memberSnap.exists()) return null;
          const circleSnap = await getDoc(doc(db, 'circles', id));
          if (!circleSnap.exists()) return null;
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
        // 'direct' copies exist only so a recording sent in a chat can play
        // there (see shareRecordingInto) -- they're not posts for the feed.
        if (d.data().visibility === 'direct') return;
        byId.set(d.id, { id: d.id, ...d.data() } as Recording);
      });
      setFeedRecordings(Array.from(byId.values()));
    } catch (err) {
      console.error('Failed to load shared recordings feed:', err);
    } finally {
      setLoadingFeedRecordings(false);
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
    setLoadingActiveCircleChallenges(true);
    try {
      const [circleSnap, membersSnap, plansSnap, challengesSnap] = await Promise.all([
        getDoc(doc(db, 'circles', circleId)),
        getDocs(collection(db, 'circles', circleId, 'members')),
        getDocs(collection(db, 'circles', circleId, 'groupPlans')),
        getDocs(collection(db, 'circles', circleId, 'challenges')),
      ]);
      const circle = circleSnap.exists() ? ({ id: circleSnap.id, ...circleSnap.data() } as Circle) : null;
      setActiveCircle(circle);
      setActiveCircleMembers(membersSnap.docs.map((d) => d.data() as CircleMember));
      // Circles made before join-by-code moved to circleInvites/{code} have
      // no lookup doc yet, so their code wouldn't work. Any member opening
      // the circle backfills it (firestore.rules only accepts the circle's
      // real code). Best effort -- never blocks loading the circle.
      const myUid = auth.currentUser?.uid;
      if (circle?.inviteCode && myUid && membersSnap.docs.some((d) => d.id === myUid)) {
        const inviteRef = doc(db, 'circleInvites', circle.inviteCode);
        getDoc(inviteRef)
          .then((s) => (s.exists() ? undefined : setDoc(inviteRef, { circleId: circle.id })))
          .catch((err) => console.error('Failed to backfill circle invite code:', err));
      }
      setActiveCircleGroupPlans(plansSnap.docs.map((d) => normalizeGroupPlan(d.id, d.data())));
      setActiveCircleChallenges(challengesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as GroupChallenge));
    } catch (err) {
      console.error('Failed to load circle detail:', err);
    } finally {
      setLoadingActiveCircle(false);
      setLoadingActiveCircleChallenges(false);
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
      triggerToast('Sign in to create a circle.');
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      triggerToast('Give the circle a name first.');
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
      batch.set(doc(db, 'circleInvites', inviteCode), { circleId: circleRef.id });
      batch.set(doc(db, 'profiles', uid), { circleIds: arrayUnion(circleRef.id) }, { merge: true });
      await batch.commit();
      setMyCircles((prev) => [...prev, newCircle]);
      openCircle(circleRef.id);
      triggerToast(`Created "${trimmedName}".`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleRef.id}`);
    }
  };

  // inviteCode is required for a PRIVATE circle (firestore.rules checks it
  // against the circle's real code) and ignored for a public one.
  const joinCircle = async (circleId: string, circleName?: string, inviteCode?: string) => {
    if (!auth.currentUser) {
      triggerToast('Sign in to join a circle.');
      return;
    }
    const uid = auth.currentUser.uid;
    const memberRef = doc(db, 'circles', circleId, 'members', uid);
    try {
      const [existing, bannedSnap] = await Promise.all([
        getDoc(memberRef),
        getDoc(doc(db, 'circles', circleId, 'banned', uid)),
      ]);
      if (existing.exists()) {
        openCircle(circleId);
        triggerToast("You're already in this circle.");
        return;
      }
      if (bannedSnap.exists()) {
        triggerToast("The circle's leader removed you, so you can't rejoin this one.");
        return;
      }

      const now = new Date().toISOString();
      const newMember: CircleMember = {
        uid,
        displayName: user?.displayName || 'Anonymous Disciple',
        avatarUrl: user?.photoURL || '',
        role: 'member',
        joinedAt: now,
        ...(inviteCode ? { inviteCode } : {}),
      };

      const batch = writeBatch(db);
      batch.set(memberRef, newMember);
      batch.set(doc(db, 'profiles', uid), { circleIds: arrayUnion(circleId) }, { merge: true });
      await batch.commit();

      // A private circle's doc only becomes readable once we're a member,
      // so the name comes from here when the caller couldn't know it.
      let name = circleName;
      if (!name) {
        const circleSnap = await getDoc(doc(db, 'circles', circleId)).catch(() => null);
        name = (circleSnap?.data() as Circle | undefined)?.name;
      }

      await loadMyCircles();
      openCircle(circleId);
      triggerToast(`Joined "${name || 'the circle'}".`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/members/${uid}`);
    }
  };

  // Codes resolve through circleInvites/{code} -> circleId. Circles made
  // before that lookup existed get one the first time any member opens them
  // (see loadActiveCircleData); until then, a public one is still found by
  // the old query on the circle doc itself, which only works for public
  // circles now that private circle docs are members-only.
  const joinCircleByCode = async (codeInput: string) => {
    const code = codeInput.trim().toUpperCase();
    if (!code) {
      triggerToast('Enter an invite code first.');
      return;
    }
    try {
      let circleId: string | null = null;
      let circleName: string | undefined;
      const inviteSnap = /^[A-Z0-9]+$/.test(code) ? await getDoc(doc(db, 'circleInvites', code)) : null;
      if (inviteSnap?.exists()) {
        circleId = inviteSnap.data().circleId as string;
      } else {
        const snap = await getDocs(
          query(collection(db, 'circles'), where('isPublic', '==', true), where('inviteCode', '==', code), limit(1))
        );
        if (!snap.empty) {
          circleId = snap.docs[0].id;
          circleName = (snap.docs[0].data() as Circle).name;
        }
      }
      if (!circleId) {
        triggerToast(`No circle found for code "${code}".`);
        return;
      }
      await joinCircle(circleId, circleName, code);
      setInviteCodeInput('');
    } catch (err) {
      console.error('Failed to join by code:', err);
      triggerToast("Couldn't join with that code. Please try again.");
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
      triggerToast('You left the circle.');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/members`);
    }
  };

  const disbandCircle = async (circleId: string) => {
    if (!auth.currentUser) return;
    try {
      // Firestore has no cascading delete, so every subcollection has to be
      // cleared by hand or it lingers forever, unreachable. Everything is
      // READ first, while we're still a member (most of these are
      // members-only), then deleted.
      const circleRef = doc(db, 'circles', circleId);
      const [circleSnap, membersSnap, plansSnap, messagesSnap, reactionsSnap, challengesSnap, bannedSnap, responsesSnap] =
        await Promise.all([
          getDoc(circleRef),
          getDocs(collection(db, 'circles', circleId, 'members')),
          getDocs(collection(db, 'circles', circleId, 'groupPlans')),
          getDocs(collection(db, 'circles', circleId, 'messages')),
          getDocs(collection(db, 'circles', circleId, 'reactions')),
          getDocs(collection(db, 'circles', circleId, 'challenges')),
          getDocs(collection(db, 'circles', circleId, 'banned')),
          getDocs(collection(db, 'circles', circleId, 'responses')),
        ]);
      const participantSnaps = await Promise.all(
        challengesSnap.docs.map((c) => getDocs(collection(c.ref, 'participants')))
      );
      const inviteCode = (circleSnap.data() as Circle | undefined)?.inviteCode;
      const inviteSnap = inviteCode ? await getDoc(doc(db, 'circleInvites', inviteCode)) : null;

      // Order matters: participants before their challenge (their delete
      // rule reads the challenge), and the member docs + circle doc go in
      // the very last batch, because every delete rule here checks the
      // circle's ownerId.
      const refs = [
        ...participantSnaps.flatMap((s) => s.docs.map((d) => d.ref)),
        ...challengesSnap.docs.map((d) => d.ref),
        ...reactionsSnap.docs.map((d) => d.ref),
        ...responsesSnap.docs.map((d) => d.ref),
        ...messagesSnap.docs.map((d) => d.ref),
        ...plansSnap.docs.map((d) => d.ref),
        ...bannedSnap.docs.map((d) => d.ref),
        ...(inviteSnap?.exists() && inviteSnap.data().circleId === circleId ? [inviteSnap.ref] : []),
        ...membersSnap.docs.map((d) => d.ref),
        circleRef,
      ];
      const BATCH_LIMIT = 450; // Firestore caps a batch at 500 writes
      for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        refs.slice(i, i + BATCH_LIMIT).forEach((r) => batch.delete(r));
        await batch.commit();
      }

      // Other members' profiles/{uid}.circleIds still reference this circle —
      // we can't write their profile docs (owner-only), so loadMyCircles()
      // self-heals for them next time they load. We can clean up our own.
      await updateDoc(doc(db, 'profiles', auth.currentUser.uid), { circleIds: arrayRemove(circleId) });

      setMyCircles((prev) => prev.filter((c) => c.id !== circleId));
      setViewingGroupDetail(false);
      triggerToast('Circle disbanded.');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}`);
    }
  };

  // The ban doc rides in the same batch: without it the removed member
  // could simply rejoin (firestore.rules' join rule checks banned/{uid}).
  const removeCircleMember = async (circleId: string, memberUid: string) => {
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'circles', circleId, 'members', memberUid));
      batch.set(doc(db, 'circles', circleId, 'banned', memberUid), {
        uid: memberUid,
        bannedAt: new Date().toISOString(),
      });
      await batch.commit();
      setActiveCircleMembers((prev) => prev.filter((m) => m.uid !== memberUid));
      triggerToast('Member removed.');
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
  // from the plan's own landing page (addVersesToGroupPlan below), and its
  // pace (versesPerWeek) is set/edited there too, not at creation time.
  const createGroupPlan = async (circleId: string, input: { name: string; description: string }) => {
    if (!auth.currentUser) return;
    const trimmedName = input.name.trim();
    if (!trimmedName) {
      triggerToast('Give the plan a name first.');
      return;
    }
    const planRef = doc(collection(db, 'circles', circleId, 'groupPlans'));
    const now = new Date().toISOString();
    const newPlan: GroupPlan = {
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
      setActiveCircleGroupPlans((prev) => [...prev, newPlan]);
      triggerToast(`Created "${trimmedName}". Add verses and set a pace from its page.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/groupPlans/${planRef.id}`);
    }
  };

  const updateGroupPlan = async (
    circleId: string,
    planId: string,
    fields: Partial<Pick<GroupPlan, 'name' | 'description' | 'versesPerWeek'>>
  ) => {
    try {
      const updatedAt = new Date().toISOString();
      await updateDoc(doc(db, 'circles', circleId, 'groupPlans', planId), { ...fields, updatedAt });
      const apply = (p: GroupPlan) => (p.planId === planId ? { ...p, ...fields, updatedAt } : p);
      setActiveCircleGroupPlans((prev) => prev.map(apply));
      setJoinedGroupPlanDetails((prev) => prev.map(apply));
      setViewingGroupPlan((prev) => (prev && prev.planId === planId ? apply(prev) : prev));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/groupPlans/${planId}`);
    }
  };

  // Manager builds a plan's verse queue incrementally, a handful of verses
  // at a time, from real scripture text -- rather than committing a whole
  // book/chapter up front like the old "Deploy New Circle Plan" form did.
  const addVersesToGroupPlan = async (
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

    const existingPlan = activeCircleGroupPlans.find((p) => p.planId === planId);
    const mergedVerseIds = Array.from(new Set([...(existingPlan?.verseIds || []), ...newVerseIds]));

    try {
      const updatedAt = new Date().toISOString();
      await updateDoc(doc(db, 'circles', circleId, 'groupPlans', planId), { verseIds: mergedVerseIds, updatedAt });
      const apply = (p: GroupPlan) => (p.planId === planId ? { ...p, verseIds: mergedVerseIds, updatedAt } : p);
      setActiveCircleGroupPlans((prev) => prev.map(apply));
      setJoinedGroupPlanDetails((prev) => prev.map(apply));
      setViewingGroupPlan((prev) => (prev && prev.planId === planId ? apply(prev) : prev));

      // Self-heal the manager's OWN queue immediately if they're also a
      // member -- other members' queues pick up the new verses the next
      // time their own session loads (see loadUserData), since a client
      // can't write into another user's private memoryQueue.
      if (joinedGroupPlanMemberships.some((m) => m.planId === planId)) {
        await addGroupPlanVersesToOwnQueue(planId, newVerseIds);
      }

      triggerToast(`Added ${newVerseIds.length} verse${newVerseIds.length === 1 ? '' : 's'} to the plan.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/groupPlans/${planId}`);
    }
  };

  const deleteGroupPlan = async (circleId: string, planId: string) => {
    try {
      await deleteDoc(doc(db, 'circles', circleId, 'groupPlans', planId));
      setActiveCircleGroupPlans((prev) => prev.filter((p) => p.planId !== planId));
      setJoinedGroupPlanDetails((prev) => prev.filter((p) => p.planId !== planId));
      setViewingGroupPlan((prev) => (prev && prev.planId === planId ? null : prev));
      triggerToast('Plan deleted.');
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
      const memoryQueueVisibility = data.memoryQueueVisibility === 'friends' ? 'friends' : 'private';
      // The snapshot lives in profiles/{uid}/shared/memoryQueue, readable
      // only by real friends -- only ask for it when we are one, since
      // anyone else just gets permission-denied.
      let sharedMemoryQueue = null;
      if (memoryQueueVisibility === 'friends' && friends.some((f) => f.uid === uid)) {
        const sharedSnap = await getDoc(doc(db, 'profiles', uid, 'shared', 'memoryQueue')).catch((err) => {
          console.error("Failed to load member's shared verses:", err);
          return null;
        });
        sharedMemoryQueue = sharedSnap?.exists() ? sharedSnap.data().items || null : null;
      }
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
        // Friend-visible sharing (surfaced in MemberProfileScreen only when the
        // viewer is actually a friend). The snapshot is null unless the owner
        // set this visibility to 'friends' in Settings.
        memoryQueueVisibility,
        sharedMemoryQueue,
      });
      navigateTo('memberProfile');
    } catch (err) {
      console.error('Failed to load member profile:', err);
      triggerToast("Couldn't load that member's profile.");
    }
  };

  // ==========================================
  // GROUP PLAN HANDLERS
  // ==========================================
  // Review Settings are deliberately NOT shareable. There used to be two ways
  // to hand your retention method to someone else -- a public `sharedPlans`
  // collection (browse/join/publish) and a friends-only snapshot on your
  // profile -- and both were removed on purpose: a set of phase lengths and
  // miss rules is a personal calibration, not content worth a distribution
  // system, and every surface it touched (Community browse, profile
  // visibility settings, adoption toasts) cost a new user more confusion than
  // the feature was ever worth. Anyone who wants to compare notes with a
  // friend can screenshot the screen.
  //
  // GroupPlan (below) is a different thing entirely and stays: it's a circle's
  // curated LIST OF VERSES plus a target pace, not a retention method.

  // Fetches real verse text for whichever of `verseIds` aren't already in
  // the member's own queue and appends them as 'queued', tagged to this
  // plan -- shared by joinGroupPlan (the plan's full current range) and
  // addVersesToGroupPlan's self-heal path (just the newly-added verses).
  const addGroupPlanVersesToOwnQueue = async (planId: string, verseIds: string[]) => {
    // GroupPlan.verseIds are translation-less ("GEN_1_3") -- group plans
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

  const persistJoinedGroupPlans = async (memberships: GroupPlanMembership[]) => {
    if (!auth.currentUser) return;
    try {
      const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
      // merge: true — this doc also holds savedPlans and other top-level
      // plan fields; a plain setDoc here would silently erase them.
      //
      // The constant, not a literal: this key still carries the pre-rename
      // wording on every existing document. See its definition.
      await setDoc(planRef, { [JOINED_GROUP_PLANS_FIELD]: memberships, updatedAt: new Date() }, { merge: true });
    } catch (err) {
      console.error('Failed to persist joined group plans:', err);
    }
  };

  const joinGroupPlan = async (plan: GroupPlan, priority: GroupPlanMembership['priority'] = 'group') => {
    try {
      await addGroupPlanVersesToOwnQueue(plan.planId, plan.verseIds);

      const membership: GroupPlanMembership = {
        planId: plan.planId,
        circleId: plan.circleId,
        priority,
        joinedAt: new Date().toISOString(),
      };
      const updatedMemberships = [...joinedGroupPlanMemberships.filter((m) => m.planId !== plan.planId), membership];
      setJoinedGroupPlanMemberships(updatedMemberships);
      setJoinedGroupPlanDetails((prev) => [...prev.filter((p) => p.planId !== plan.planId), plan]);
      await persistJoinedGroupPlans(updatedMemberships);

      triggerToast(`Joined "${plan.name}". Its verses are in your queue.`);
    } catch (err) {
      console.error('Error joining group plan:', err);
      triggerToast("Couldn't join this plan. Please try again.");
    }
  };

  // Only strips verses that are still 'queued' (never actually started) --
  // anything already being learned/reviewed/retained is left alone, since
  // leaving a plan shouldn't erase real progress already made on it.
  const leaveGroupPlan = async (planId: string) => {
    const updatedMemberships = joinedGroupPlanMemberships.filter((m) => m.planId !== planId);
    setJoinedGroupPlanMemberships(updatedMemberships);
    setJoinedGroupPlanDetails((prev) => prev.filter((p) => p.planId !== planId));
    removeQueueItems(
      memoryQueueRef.current
        .filter((item) => item.originPlanId === planId && item.status === 'queued')
        .map((item) => item.verseId)
    );
    await persistJoinedGroupPlans(updatedMemberships);
    triggerToast('You left the plan.');
  };

  const setGroupPlanPriority = async (planId: string, priority: GroupPlanMembership['priority']) => {
    const updatedMemberships = joinedGroupPlanMemberships.map((m) => (m.planId === planId ? { ...m, priority } : m));
    setJoinedGroupPlanMemberships(updatedMemberships);
    await persistJoinedGroupPlans(updatedMemberships);
  };

  // Leaving/disbanding an entire circle should also drop membership in
  // whatever Group Plans belonged to it -- mirrors the old single-plan
  // code's setActiveGroupPlan(null) on the same actions, just generalized
  // to however many plans of that circle this member had joined.
  const clearGroupPlanMembershipsForCircle = (circleId: string) => {
    const updatedMemberships = joinedGroupPlanMemberships.filter((m) => m.circleId !== circleId);
    setJoinedGroupPlanMemberships(updatedMemberships);
    setJoinedGroupPlanDetails((prev) => prev.filter((p) => p.circleId !== circleId));
    persistJoinedGroupPlans(updatedMemberships);
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

      triggerToast(`Now using "${activePlan.name}".`);

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
      triggerToast("You need at least one set of review settings. Make another first.");
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

  // "Plan & Pacing" from the Memory Desk: edit whichever plan is actually
  // active. Explicit rather than a navigateTo side effect -- see the note
  // there.
  const openActivePlanDesigner = () => {
    const active = savedPlans.find((p) => p.isActive) || savedPlans[0];
    if (active) {
      setEditingPlanId(active.id);
      syncDesignerFromPlan(active);
    } else {
      setEditingPlanId(null);
    }
    navigateTo('planDesigner');
  };

  const handleCreateNewPlan = () => {
    setEditingPlanId(null);
    setRetentionRigor('standard');
    setDailyPhaseWeeks(7);
    setWeeklyPhaseMonths(6);
    setMonthlyPhaseYears(5);
    setMasteryTouches(3);
    setReviewsRequired(1);
    setMissPolicy('standard');
    setMissPolicyAskEveryTime(false);
    setGraceCount(1);
    setRefresherDailyDays(7);
    setRefresherWeeklyWeeks(4);
    setCustomPlanName('My settings');
    navigateTo('planDesigner');
  };

  // Is the designer currently pointed at the shipped, immutable plan?
  // PlanDesignerScreen uses this to require a new name before saving.
  const isEditingBuiltInPlan = savedPlans.some((p) => p.id === editingPlanId && p.isBuiltIn);

  const handleSavePlan = async () => {
    let updatedPlans = [...savedPlans];

    // Retention fields only -- pacing lives in Rhythm now and is never
    // written to a plan.
    const editedFields = {
      retentionRigor,
      dailyPhaseWeeks,
      weeklyPhaseMonths,
      monthlyPhaseYears,
      masteryTouches,
      reviewsRequired,
      missPolicy,
      missPolicyAskEveryTime,
      graceCount,
      refresherDailyDays,
      refresherWeeklyWeeks,
    };

    const targetPlan = savedPlans.find((p) => p.id === editingPlanId);
    // Copy-on-write: the shipped plan is the baseline every account starts
    // from, so editing it forks a renamed copy instead of mutating it. The
    // screen requires a changed name before it will call this, so reaching
    // here with the built-in's own name would mean a UI bug, not a user
    // choice -- fall back to a suffixed name rather than silently
    // overwriting the baseline.
    const isForkingBuiltIn = !!targetPlan?.isBuiltIn;

    if (targetPlan && !isForkingBuiltIn) {
      updatedPlans = updatedPlans.map((p) =>
        p.id === editingPlanId
          ? { ...p, name: customPlanName || 'My settings', ...editedFields, updatedAt: new Date().toISOString() }
          : p
      );
      triggerToast(`Saved "${customPlanName}".`);
    } else {
      const forkedName =
        isForkingBuiltIn && customPlanName.trim() === targetPlan?.name
          ? `${targetPlan.name} (Custom)`
          : customPlanName || 'My settings';

      const newPlan: MemoryPlan = {
        id: 'plan-' + Date.now(),
        name: forkedName,
        ...editedFields,
        isActive: true,
        updatedAt: new Date().toISOString(),
      };

      updatedPlans = updatedPlans.map((p) => ({ ...p, isActive: false }));
      updatedPlans.push(newPlan);
      triggerToast(
        isForkingBuiltIn
          ? `Saved "${forkedName}" as your own copy and switched to it.`
          : `Saved "${forkedName}" and switched to it.`
      );
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

  // Persists pausedAt/pausedUntil to whichever plan is currently active, and
  // mirrors a plain isPaused flag onto the public profile doc so a friend's
  // accountability-nudge flow (sendAccountabilityNudge below) can check
  // pause status without needing read access to this private plan doc.
  // Immediate, not gated behind Plan Designer's Save button -- pausing is a
  // "I'm leaving right now" action, same urgency as the rest of Settings.
  // Pause is part of Rhythm, so it targets the user, not a plan. Before the
  // split it was written into whichever plan was active, which meant
  // activating a different plan reloaded that plan's (null) pause fields and
  // silently un-paused you mid-vacation.
  const setPauseState = async (newPausedAt: string | null, newPausedUntil: string | null) => {
    updateRhythm({ pausedAt: newPausedAt, pausedUntil: newPausedUntil });

    if (auth.currentUser) {
      try {
        await setDoc(doc(db, 'profiles', auth.currentUser.uid), { isPaused: !!newPausedAt }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `profiles/${auth.currentUser.uid}`);
      }
    }
  };

  const pauseReviews = (untilISO: string | null) => {
    setPauseState(new Date().toISOString(), untilISO);
    triggerToast(
      untilISO
        ? `Paused until ${new Date(untilISO).toLocaleDateString()} -- nothing will be due while you're away. 🌴`
        : "Paused -- nothing will be due until you resume. 🌴"
    );
  };

  const resumeReviews = () => {
    setPauseState(null, null);
    triggerToast('Welcome back! Reviews have resumed.');
  };

  // saveActivePlanRhythm was deleted here. It existed to persist the queue
  // screen's rhythm edits into a plan, which is exactly the coupling the
  // plan/rhythm split removes -- rhythm now commits live via updateRhythm and
  // targets the user, so there is nothing to "save to a plan" any more.

  // publishSharedPlan was deleted here along with the rest of the
  // retention-sharing surface -- see the note above the group-plan handlers.
  // handleSavePlan is the only way a set of Review Settings is written now,
  // and it writes to your own savedPlans and nowhere else.

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
        setMemoryQueueVisibility(profileSnap.data().memoryQueueVisibility === 'friends' ? 'friends' : 'private');
        setTotalStudySeconds(profileSnap.data().totalStudySeconds || 0);
        applyAccountabilityDailyCap(profileSnap.data().accountabilityDailyCap);
        // Covers both a brand-new profile (never set, so !== true) and
        // anyone who dismissed the app mid-onboarding without finishing it.
        setShowOnboarding(profileSnap.data().onboardingCompleted !== true);
      }

      if (profileSnap && !profileSnap.exists()) {
        // Email sign-up requires a display name (enforced in AuthGateScreen),
        // but this listener can win the race against that flow's own
        // updateProfile() call and see it not landed yet on `currentUser` --
        // pendingSignUpDisplayName closes that gap (see useEmailAuth.ts).
        // Google sign-in always has a name by this point. Either way, a
        // fake "Anonymous" default is never actually needed here.
        const resolvedDisplayName = pendingSignUpDisplayName.current || currentUser.displayName || '';
        const newProfile = {
          displayName: resolvedDisplayName,
          // Lowercased once at creation for prefix-match user search (Find
          // Friends) — this app has no backend/search service, so this is
          // the standard Firestore-only trick (range query on a normalized
          // field). updateDisplayName keeps this in sync on rename.
          displayNameLower: resolvedDisplayName.toLowerCase(),
          // No email here: profiles are listable by every signed-in user.
          // Exact-email search goes through emailLookup (written below).
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

      // Exact-email friend search (see searchUsers). Profiles written before
      // emailLookup existed still carry `email`, readable by anyone, so it
      // is stripped here too. Best effort -- never blocks sign-in.
      const myEmail = (currentUser.email || '').toLowerCase();
      if (myEmail && !myEmail.includes('/')) {
        setDoc(doc(db, 'emailLookup', myEmail), { uid: currentUser.uid }).catch((err) =>
          console.error('Failed to write email lookup:', err)
        );
      }
      if (profileSnap?.exists() && 'email' in profileSnap.data()) {
        updateDoc(profileRef, { email: deleteField() }).catch((err) =>
          console.error('Failed to strip email from profile:', err)
        );
      }
      // Same for the friends-only verse snapshot, which used to sit on the
      // (listable) profile too. If sharing is on, the profile-sync effect
      // rewrites it to profiles/{uid}/shared/memoryQueue shortly after.
      if (profileSnap?.exists() && 'sharedMemoryQueue' in profileSnap.data()) {
        updateDoc(profileRef, { sharedMemoryQueue: deleteField() }).catch((err) =>
          console.error('Failed to strip shared verses from profile:', err)
        );
      }

      // Tracks whichever plan ends up active, whether from an existing doc
      // or the freshly-created DEFAULT_PLANS[0] -- used after step 3 below
      // to run the missed-review popup scan against the real settings that
      // were just loaded, instead of racing React state that may not have
      // flushed yet.
      let resolvedActivePlan: MemoryPlan = DEFAULT_PLANS[0];
      // Same reason as resolvedActivePlan: the missed-review scan below runs
      // before React has flushed the rhythm setters, so it reads this rather
      // than the live state.
      let resolvedRhythm: Rhythm = DEFAULT_RHYTHM;

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

        // ---- RHYTHM ----
        // Read from the doc ROOT, which is where pacing has always been
        // mirrored (pre-split, planTopLevelFields wrote the active plan's
        // pacing to exactly these keys on every save). So a pre-split account
        // migrates by simply being read from here: the values it lands on are
        // the ones its active plan carried. No destructive rewrite, and stale
        // per-plan copies inside savedPlans are just ignored from now on.
        //
        // The active plan is the second fallback for an account whose root
        // keys somehow never got written.
        const rootActive: any = (planData.savedPlans || []).find((p: any) => p.isActive) || {};
        const loadedRhythm: Rhythm = {
          learningDays: planData.learningDays || rootActive.learningDays || DEFAULT_RHYTHM.learningDays,
          newVersesPace: planData.newVersesPace ?? rootActive.newVersesPace ?? DEFAULT_RHYTHM.newVersesPace,
          maxReviewCap: planData.maxReviewCap ?? rootActive.maxReviewCap ?? DEFAULT_RHYTHM.maxReviewCap,
          sabbathEnabled: planData.sabbathEnabled ?? rootActive.sabbathEnabled ?? DEFAULT_RHYTHM.sabbathEnabled,
          sabbathDay: planData.sabbathDay || rootActive.sabbathDay || DEFAULT_RHYTHM.sabbathDay,
          dayStartHour: planData.dayStartHour ?? rootActive.dayStartHour ?? DEFAULT_RHYTHM.dayStartHour,
          cognitiveLoadSensitivity:
            planData.cognitiveLoadSensitivity || rootActive.cognitiveLoadSensitivity || DEFAULT_RHYTHM.cognitiveLoadSensitivity,
          pausedAt: planData.pausedAt ?? rootActive.pausedAt ?? null,
          pausedUntil: planData.pausedUntil ?? rootActive.pausedUntil ?? null,
        };
        setLearningDays(loadedRhythm.learningDays);
        setNewVersesPace(loadedRhythm.newVersesPace);
        setMaxReviewCap(loadedRhythm.maxReviewCap);
        setSabbathEnabled(loadedRhythm.sabbathEnabled);
        setSabbathDay(loadedRhythm.sabbathDay);
        setDayStartHour(loadedRhythm.dayStartHour);
        setCognitiveLoadSensitivity(loadedRhythm.cognitiveLoadSensitivity);
        setPausedAt(loadedRhythm.pausedAt);
        setPausedUntil(loadedRhythm.pausedUntil);
        resolvedRhythm = loadedRhythm;

        // ---- PLANS ----
        // An account with no savedPlans array at all (or one emptied by an
        // older migration) starts from the shipped plan rather than
        // reconstructing a pseudo-plan out of the root keys -- those keys are
        // Rhythm now, and carry nothing about retention that DEFAULT_PLANS
        // doesn't already say.
        if (plansList.length === 0) {
          plansList = [{ ...DEFAULT_PLANS[0], ...normalizeAdoptedPlan(planData), id: BUILT_IN_PLAN_ID, isBuiltIn: true }];
        }

        // Back-compat: plans saved before retention-rigor/mastery-touches/
        // missPolicy existed won't have these fields in Firestore — default
        // them to prior hardcoded behavior so existing plans don't change
        // silently. Pacing fields that pre-split plans still carry are left
        // untouched in the stored object and simply never read.
        plansList = plansList.map((p) => ({
          ...p,
          retentionRigor: p.retentionRigor || 'standard',
          dailyPhaseWeeks: p.dailyPhaseWeeks ?? 7,
          weeklyPhaseMonths: p.weeklyPhaseMonths ?? 6,
          monthlyPhaseYears: p.monthlyPhaseYears ?? 5,
          masteryTouches: p.masteryTouches ?? 3,
          reviewsRequired: p.reviewsRequired ?? 1,
          missPolicy: p.missPolicy || 'standard',
          missPolicyAskEveryTime: p.missPolicyAskEveryTime ?? false,
          graceCount: p.graceCount ?? 1,
          refresherDailyDays: p.refresherDailyDays ?? 7,
          refresherWeeklyWeeks: p.refresherWeeklyWeeks ?? 4,
        }));

        setSavedPlans(plansList);

        // Joined Group Plans: resolve membership records into the real
        // GroupPlan docs they point to. This also fixes a pre-existing bug
        // where the old singular activeGroupPlan was written to Firestore on
        // join but never actually read back on load -- it silently reset to
        // null every reload even though the user was still really a member.
        const memberships: GroupPlanMembership[] = planData[JOINED_GROUP_PLANS_FIELD] || [];
        setJoinedGroupPlanMemberships(memberships);
        if (memberships.length > 0) {
          try {
            const planDocs = await Promise.all(
              memberships.map((m) => getDoc(doc(db, 'circles', m.circleId, 'groupPlans', m.planId)))
            );
            const resolvedPlans = planDocs
              .filter((snap) => snap.exists())
              .map((snap) => normalizeGroupPlan(snap.id, snap.data()));
            setJoinedGroupPlanDetails(resolvedPlans);
          } catch (e) {
            console.error('Failed to resolve joined group plans:', e);
          }
        } else {
          setJoinedGroupPlanDetails([]);
        }

        applyJoinedGroupChallenges((planData.joinedGroupChallenges as GroupChallengeMembership[]) || []);

        // Find the active plan and sync current state
        const active = plansList.find((p) => p.isActive) || plansList[0];
        if (active) {
          syncDesignerFromPlan(active);
          resolvedActivePlan = active;
        }
      } else {
        console.log('Creating new memory plan...');
        setSavedPlans(DEFAULT_PLANS);
        try {
          await setDoc(planRef, {
            savedPlans: DEFAULT_PLANS,
            ...planTopLevelFields(DEFAULT_PLANS[0]),
            ...DEFAULT_RHYTHM,
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
      // pre-seeded demo progress.
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
      // or joining a circle's group plan, both backed by real imported text.
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
            graceMissesUsed: data.graceMissesUsed || 0,
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
            ...(data.originPlanId !== undefined ? { originPlanId: data.originPlanId } : {}),
            ...(data.chapterReviewAnchorDay !== undefined ? { chapterReviewAnchorDay: data.chapterReviewAnchorDay } : {}),
            ...(Array.isArray(data.reviewLogs) ? { reviewLogs: data.reviewLogs } : {}),
            ...(data.refresherReturnPhase !== undefined ? { refresherReturnPhase: data.refresherReturnPhase } : {}),
            ...(data.refresherReturnProgress !== undefined ? { refresherReturnProgress: data.refresherReturnProgress } : {}),
            ...(data.refresherTargetUnits !== undefined ? { refresherTargetUnits: data.refresherTargetUnits } : {}),
            ...(data.guidedSetAside === true ? { guidedSetAside: true as const } : {}),
          });
        });
        loadedQueue.sort((a, b) => a.orderIndex - b.orderIndex);
        updateMemoryQueue(() => loadedQueue);
        // Baseline for the auto-sync's deletion diffing: what's in Firestore
        // right now is by definition already synced.
        prevSyncedQueueIdsRef.current = new Set(loadedQueue.map((i) => i.verseId));

        // Missed-review popup scan: uses resolvedActivePlan directly (not
        // React state, which may not have flushed from syncDesignerFromPlan
        // yet) so this can't race the plan settings it depends on. Only
        // runs once, right here at load -- not on every later memoryQueue
        // change from normal review activity.
        if (resolvedActivePlan.missPolicyAskEveryTime) {
          const overdue = loadedQueue
            .map((qItem) => ({
              item: qItem,
              missedCycles: computeMissedCycles(
                qItem,
                resolvedRhythm.dayStartHour,
                resolvedRhythm.sabbathEnabled,
                resolvedRhythm.sabbathDay,
                resolvedRhythm.pausedAt,
                resolvedRhythm.pausedUntil
              ),
            }))
            .filter((entry) => entry.missedCycles > 0);
          if (overdue.length > 0) {
            setMissedReviewQueue(overdue);
            setShowMissedReviewPrompt(true);
          }
        }
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

      // 5. Bible page photos (private to this user)
      await loadChapterPhotos(currentUser.uid);

      triggerToast('Cloud profile and scripture data synchronized!');
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

      // updateProfile() (display name, photo) mutates auth.currentUser and
      // re-fires this listener for the SAME uid -- not a sign-in or account
      // switch. Skip the whole reset/reload path in that case; setUser above
      // already refreshes anything UI-visible (e.g. the shown display name).
      const newUid = currentUser?.uid ?? null;
      if (newUid === prevAuthUidRef.current) {
        return;
      }
      prevAuthUidRef.current = newUid;

      // Whatever circle/plan was being viewed belonged to whichever user (or
      // signed-out guest) was active before this auth transition — showing
      // it to a newly-signed-in different user would be stale and incorrect
      // (e.g. an old "Active" plan badge that doesn't reflect their real
      // membership). Reset on every auth transition, not just sign-out.
      setActiveCircle(null);
      setActiveCircleMembers([]);
      setActiveCircleGroupPlans([]);
      setJoinedGroupPlanMemberships([]);
      setJoinedGroupPlanDetails([]);
      resetGroupChallenges();
      setViewingGroupPlan(null);
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
        // Signed out: clear everything back to a blank slate. The app is
        // gated behind sign-in (see AuthGateScreen in App.tsx), so this only
        // runs transiently between sign-out and the auth gate re-appearing.
        setVerses([]);
        updateMemoryQueue(() => []);
        queueHydratedRef.current = true;
        setLearningDays(DEFAULT_RHYTHM.learningDays);
        setNewVersesPace(DEFAULT_RHYTHM.newVersesPace);
        setMaxReviewCap(DEFAULT_RHYTHM.maxReviewCap);
        setSabbathEnabled(DEFAULT_RHYTHM.sabbathEnabled);
        setSabbathDay(DEFAULT_RHYTHM.sabbathDay);
        setCognitiveLoadSensitivity(DEFAULT_RHYTHM.cognitiveLoadSensitivity);
        setPausedAt(null);
        setPausedUntil(null);
        setMyCircles([]);
        setCircleFriends([]);
        setDefaultRecordingVisibility(null);
        setMemoryQueueVisibility('private');
        resetAccountabilityNudges();
        closeDMThread();
        closeCircleChat();
        setUserRecordings([]);
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    // Before signing out, while we still may: this phone shouldn't keep
    // getting the old account's messages.
    await push.unregisterPushToken();
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
      triggerToast('Display name updated!');
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
      triggerToast('Default recording visibility updated!');
    } catch (err) {
      console.error('Failed to update default recording visibility:', err);
      triggerToast('Failed to update default recording visibility.');
    }
  };

  // Compact, friend-readable snapshot of the memory queue -- just enough for a
  // friend's profile to show what references someone is working on and their
  // status, without exposing full verse text or private scheduling state.
  const buildSharedQueueSnapshot = () =>
    memoryQueueRef.current.map((item) => ({
      book: item.book,
      chapter: item.chapter,
      verseNumber: item.verseNumber,
      // Lets a friend's quiz (src/lib/chatAttachments.ts) name the exact
      // translation this verse is being learned in.
      translationId: item.translationId,
      status: item.status,
      orderIndex: item.orderIndex,
    }));

  // The snapshot lives in its own friends-only doc, not on the profile
  // (which anyone signed in can list) -- see firestore.rules.
  const sharedQueueDocRef = (uid: string) => doc(db, 'profiles', uid, 'shared', 'memoryQueue');
  const writeSharedQueueSnapshot = (uid: string) =>
    setDoc(sharedQueueDocRef(uid), { items: buildSharedQueueSnapshot(), updatedAt: new Date().toISOString() });

  // Settings toggle: show/hide this user's verse list on their member profile
  // for friends. Writes the visibility flag + (when 'friends') a fresh
  // snapshot; deletes the snapshot doc when set to 'private'. The debounced
  // profile-sync effect keeps the snapshot current afterward.
  const updateMemoryQueueVisibility = async (vis: 'private' | 'friends') => {
    setMemoryQueueVisibility(vis);
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    try {
      if (vis === 'friends') await writeSharedQueueSnapshot(uid);
      else await deleteDoc(sharedQueueDocRef(uid));
      await setDoc(
        doc(db, 'profiles', uid),
        // Also clears the old on-profile copy, in case it's still there.
        { memoryQueueVisibility: vis, sharedMemoryQueue: deleteField() },
        { merge: true }
      );
      triggerToast(vis === 'friends' ? 'Your verses are now visible to friends.' : 'Your verses are now private.');
    } catch (err) {
      console.error('Failed to update memory queue visibility:', err);
      triggerToast('Failed to update memory queue visibility.');
    }
  };

  // Closes setup and records that it's been seen, so it doesn't reappear on
  // the next launch. Called both by "Skip" and by finishing the last card --
  // there is no partial-completion state to track, because each card commits
  // its own answer as it's answered rather than at the end.
  const dismissOnboarding = async () => {
    setShowOnboarding(false);
    if (!auth.currentUser) return;
    try {
      await setDoc(doc(db, 'profiles', auth.currentUser.uid), { onboardingCompleted: true }, { merge: true });
    } catch (err) {
      console.error('Failed to persist onboarding completion:', err);
    }
  };

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
      const myEmail = (auth.currentUser.email || '').toLowerCase();
      const [queueSnap, versesSnap, recordingsSnap, emailLookupSnap] = await Promise.all([
        getDocs(collection(db, 'users', uid, 'memoryQueue')),
        getDocs(collection(db, 'users', uid, 'verses')),
        getDocs(collection(db, 'users', uid, 'recordings')),
        myEmail && !myEmail.includes('/') ? getDoc(doc(db, 'emailLookup', myEmail)) : Promise.resolve(null),
      ]);

      const batch = writeBatch(db);
      queueSnap.docs.forEach((d) => batch.delete(d.ref));
      versesSnap.docs.forEach((d) => batch.delete(d.ref));
      recordingsSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(db, 'memoryPlans', uid));
      batch.delete(sharedQueueDocRef(uid));
      // Only if it's really ours -- the rule reads the existing doc's uid,
      // so deleting a missing one would fail the whole batch.
      if (emailLookupSnap?.exists() && emailLookupSnap.data().uid === uid) batch.delete(emailLookupSnap.ref);
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
        recordingsSnap.docs.flatMap((d) => {
          // Both the raw upload and its studio render have to go — see
          // deleteRecording for the same pairing.
          const paths = [d.data().audioPath, d.data().studioAudioPath].filter(Boolean) as string[];
          return paths.map(async (path) => {
            try {
              await deleteObject(storageRef(storage, path));
            } catch (err) {
              console.error('Failed to delete a recording audio file during account deletion:', err);
            }
          });
        })
      );

      // Wipe the on-device cache outright rather than letting sign-out's
      // releaseAudioCache leave the files for a next sign-in that will never
      // come. Deleting the account should not leave its recitations readable
      // on disk for whoever signs in next.
      await wipeAudioCache();
      await wipeLocalPhotos();

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

  // Saved Recording Playback — real audio (via expo-audio) for recordings with
  // a Storage-backed audioUrl; falls back to a simulated progress timer for
  // mock entries that don't have one (e.g. the illustrative community feed).
  useEffect(() => {
    if (!playingRecordingId || !nowPlayingUrl) return;
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
  }, [playingRecordingId, nowPlayingUrl]);

  useEffect(() => {
    if (!playingRecordingId || !nowPlayingUrl) return;
    if (recordingPlayerStatus.didJustFinish) {
      setPlayingRecordingId(null);
      setPlayingRecProgress(0);
      triggerToast('Recording playback completed.');
      return;
    }
    const totalSec = recordingPlayerStatus.duration || nowPlayingRecording?.duration || 1;
    setPlayingRecProgress(Math.min(100, (recordingPlayerStatus.currentTime / totalSec) * 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingPlayerStatus, playingRecordingId, nowPlayingUrl]);

  // No fake playback: a recording with no real Storage-backed audio (e.g.
  // an illustrative guest-preview entry) can't actually play, so say so
  // honestly instead of running a simulated progress bar to a fake
  // "completed" toast. Checks for ANY playable version rather than the
  // resolved one — a recording is still perfectly playable while its studio
  // render is pending.
  useEffect(() => {
    if (playingRecordingId && !hasPlayableAudio(nowPlayingRecording)) {
      setPlayingRecordingId(null);
      setPlayingRecProgress(0);
      triggerToast('No audio available for this recording.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingRecordingId, nowPlayingRecording]);

  // Seek the currently-playing real recording by a relative number of seconds
  // (used by RecordingDetailScreen's -5s/+5s buttons).
  const seekRecordingBy = async (deltaSeconds: number) => {
    if (!playingRecordingId || !nowPlayingUrl) return;
    const totalSec = recordingPlayerStatus.duration || nowPlayingRecording?.duration || 0;
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
      const vanishedIds = [...prevSyncedQueueIdsRef.current].filter((id) => !currentIds.has(id));

      // Only delete what the user actually asked to remove. Anything that
      // vanished from state without a matching intent is a BUG, not an
      // instruction -- leave those documents alone and say so loudly. The
      // stale ids stay in the baseline so a later legitimate delete still
      // works, and the verses come back on the next reload.
      const removedIds = vanishedIds.filter((id) => pendingQueueDeletionsRef.current.has(id));
      const unexplained = vanishedIds.filter((id) => !pendingQueueDeletionsRef.current.has(id));
      if (unexplained.length > 0) {
        console.error(
          `[queue-sync] ${unexplained.length} verse(s) disappeared from memoryQueue with no delete intent. ` +
            'Refusing to delete them from Firestore. This is a bug -- please report it.',
          unexplained.slice(0, 20)
        );
      }

      try {
        const batch = writeBatch(db);
        memoryQueue.forEach((item) => {
          batch.set(doc(db, 'users', uid, 'memoryQueue', item.verseId), item);
        });
        removedIds.forEach((id) => {
          batch.delete(doc(db, 'users', uid, 'memoryQueue', id));
        });
        await batch.commit();
        removedIds.forEach((id) => pendingQueueDeletionsRef.current.delete(id));
        // Keep unexplained ids in the baseline: they still exist in Firestore,
        // so dropping them here would let a later shrink delete them silently.
        prevSyncedQueueIdsRef.current = new Set([...currentIds, ...unexplained]);
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
  const formatTime = (totalSec: number) => formatDuration(totalSec, 'clock');

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

  // The scheduling math itself lives in src/lib/retention.ts; these bind it
  // to the active plan's settings.
  const reviewClock = { dayStartHour, sabbathEnabled, sabbathDay, pausedAt, pausedUntil };

  // Next-due date `days` from today, nudged off the Sabbath.
  const nextDueDateISO = (days: number) => nextDueDateISOFor(days, reviewClock);

  // "Starting fresh from now" due date after a missed-review catch-up.
  const computeNextDueDateForItem = (item: QueueItem): string => computeNextDueDate(item, reviewClock);

  // Applies the user's missed-review popup choice. `choice` is the bulk
  // default; `overrides` (verseId -> choice) lets "Customize per verse"
  // pick something different for specific items. Every affected item's due
  // date moves to "starting fresh from now" regardless of choice -- even
  // 'grace' leaves the old (past) due date behind otherwise.
  const resolveMissedReviewChoice = (
    choice: 'grace' | 'escalate' | 'reset',
    overrides?: Record<string, 'grace' | 'escalate' | 'reset'>
  ) => {
    const outcomeFor = (verseId: string) => overrides?.[verseId] || choice;
    const resolvedById = new Map(
      missedReviewQueue.map(({ item, missedCycles }) => {
        const { updatedItem, tag } = resolveMissedCycles(item, missedCycles, missPolicy, {
          graceCount,
          refresherDailyDays,
          refresherWeeklyWeeks,
        }, outcomeFor(item.verseId));
        appendReviewLog(updatedItem, item, 'skipped', {
          cycles: missedCycles,
          ...(tag === 'frozen' || tag === 'grace' ? { forgiven: true as const } : {}),
        });
        if (tag !== 'grace' && tag !== 'frozen' && tag !== 'none') {
          updatedItem.reviewsToday = 0;
        }
        updatedItem.nextReviewDueDate = computeNextDueDateForItem(updatedItem);
        return [item.verseId, updatedItem];
      })
    );

    updateMemoryQueue((prev) => prev.map((q) => resolvedById.get(q.verseId) || q));
    setShowMissedReviewPrompt(false);
    setMissedReviewQueue([]);
    triggerToast(
      `Caught up on ${resolvedById.size} verse${resolvedById.size === 1 ? '' : 's'} with missed reviews. 🎯`
    );
  };

  const validateTouch = (item: QueueItem, _type: 'speak' | 'type' | 'reveal'): boolean => isTouchSpaced(item);

  const getEstimatedReviewTime = (queue: QueueItem[], sensitivity: 'low' | 'medium' | 'high') =>
    estimateReviewMinutes(queue, sensitivity, reviewClock);

  const getMemoryLoadForecast = (
    queue: QueueItem[],
    sensitivity: 'low' | 'medium' | 'high',
    learningDaysList: string[],
    pace: number,
    days: number
  ) => forecastMemoryLoad(queue, sensitivity, learningDaysList, pace, days, reviewClock);

  // `bypassShield`: the caller (HomeScreen) already showed an "are you
  // sure?" confirm card explaining the shield is active and re-invokes with
  // this set once the user confirms they want to pull anyway -- see the
  // Pull New Verses button. Every other guard (non-learning-day, nothing
  // left queued) still applies unconditionally; only the review-time shield
  // itself is bypassable, since that's the one guarding a real but
  // reversible choice ("I know reviews are already full today, pull more
  // anyway"), not a hard constraint.
  const triggerDailyPull = async (opts?: { bypassShield?: boolean }) => {
    if (reviewsPaused) {
      triggerToast('Reviews are paused -- resume from Settings to pull new verses.');
      return;
    }
    if (!isTodayLearningDay()) {
      triggerToast(`Today (${getTodayAbbreviation()}) is a non-learning day. Focus on reviews!`);
      return;
    }

    const estTime = getEstimatedReviewTime(memoryQueue, cognitiveLoadSensitivity);
    const shieldActive = estTime >= maxReviewCap && !opts?.bypassShield;

    // An 'additive' plan is defined as deliberately going over your daily
    // limits -- BOTH the new-verse pace and the review-time cap. So the
    // Review Shield holds back your own queue and your capped plans, but
    // never an additive one; otherwise "additive" would quietly mean
    // "additive until you get busy", which is the opposite of why someone
    // picks it. With the shield up we re-run the pull with a zero personal
    // budget and only the additive memberships, so exactly that plan's own
    // weekly share comes through.
    const additiveMemberships = joinedGroupPlanMemberships.filter((m) => m.priority === 'additive');
    if (shieldActive && additiveMemberships.length === 0) {
      triggerToast(`Review Shield is Active! Review time (${estTime}m) >= limit (${maxReviewCap}m). No new verses pulled today.`);
      return;
    }

    if (!memoryQueue.some((item) => item.status === 'queued')) {
      triggerToast('No more queued verses to pull!');
      return;
    }

    // Blends the personal queue with however many GroupPlans this member has
    // joined, at whatever pace/priority each calls for -- see
    // src/lib/groupPlanScheduler.ts for the full resolution rules (additive
    // plans first and uncapped, then group-priority > individual >
    // individual-priority within the personal daily budget).
    const personal: PersonalPacingSettings = {
      newVersesPace: shieldActive ? 0 : newVersesPace,
      learningDays,
    };
    const { verseIds: pulledVerseIds, fromIndividual, fromPlans } = computeDailyPull(
      memoryQueue,
      personal,
      joinedGroupPlanDetails,
      shieldActive ? additiveMemberships : joinedGroupPlanMemberships,
      new Date()
    );

    if (shieldActive && pulledVerseIds.length > 0) {
      triggerToast(
        `Review Shield held back your own queue (${estTime}m >= ${maxReviewCap}m), but your additive plan still pulled. 🛡️`
      );
    }

    if (pulledVerseIds.length === 0) {
      triggerToast('No more queued verses to pull!');
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
        const planName = joinedGroupPlanDetails.find((p) => p.planId === planId)?.name || 'a group plan';
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

  // The ONLY supported way to remove verses from the queue. Records the
  // intent first, so the auto-sync is allowed to delete these specific
  // documents; anything that leaves `memoryQueue` by any other route is
  // treated as a bug and left alone in Firestore.
  const removeQueueItems = (verseIds: string[]) => {
    if (verseIds.length === 0) return;
    verseIds.forEach((id) => pendingQueueDeletionsRef.current.add(id));
    const doomed = new Set(verseIds);
    updateMemoryQueue((prev) => prev.filter((item) => !doomed.has(item.verseId)));
  };

  // Read-only preview of what the next learning day's pull would promote,
  // for the "Where verses come from" block on the queue screen. Runs the
  // exact same pure function the real pull runs, so the preview can't drift
  // from the behaviour it describes -- which is the whole point of showing
  // it, since the priority setting was previously impossible to observe.
  const getNextPullPreview = () =>
    computeDailyPull(
      memoryQueue,
      { newVersesPace, learningDays },
      joinedGroupPlanDetails,
      joinedGroupPlanMemberships,
      new Date()
    );

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
      triggerToast(`Moved ${promotedCount === 1 ? 'that verse' : `${promotedCount} verses`} into Learning!`);
      syncChallengeProgress();
    }
  };

  // Fetches every verse in `range` (looping fetchChapterText per chapter) as
  // VerseState[] ready for addVersesToQueue, plus the total count -- shared
  // by challenge creation/accept/join.
  const fetchRangeVerses = async (
    translationId: string,
    range: VerseRange
  ): Promise<{ verses: VerseState[]; totalVerses: number }> => {
    const bookMeta = getBookByName(range.book);
    if (!bookMeta) return { verses: [], totalVerses: 0 };
    const verses: VerseState[] = [];
    for (let chapter = range.startChapter; chapter <= range.endChapter; chapter++) {
      const chapterText = await fetchChapterText(translationId, bookMeta.id, chapter);
      if (!chapterText) continue;
      Object.entries(chapterText.verses).forEach(([verseNumStr, text]) => {
        const verseNum = Number(verseNumStr);
        if (range.startChapter === range.endChapter && chapter === range.startChapter) {
          if (range.startVerse != null && verseNum < range.startVerse) return;
          if (range.endVerse != null && verseNum > range.endVerse) return;
        }
        verses.push({ book: range.book, chapter, verse: verseNum, text, status: 'untouched' });
      });
    }
    return { verses, totalVerses: verses.length };
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
      triggerToast(skipped > 0 ? "Those verses are already on your list." : 'No verses to add.');
      return;
    }

    updateMemoryQueue((prev) => [...prev, ...newItems]);
    const skippedNote = skipped > 0 ? ` (${skipped} already on your list, skipped)` : '';
    triggerToast(
      `Added ${newItems.length} ${newItems.length === 1 ? 'verse' : 'verses'} to your list!${skippedNote} 📖`
    );
  };

  // Adds a book/chapter/verse RANGE, fetching the real chapter text first.
  // Differs from addVersesToQueue above, which takes verses whose text the
  // caller already has (a chapter the user is looking at); this one is for
  // callers that only know a reference -- the setup flow and the Add verses
  // screen. The translation defaults to your usual one (selectedTranslationId);
  // Add verses passes the one picked on it explicitly.
  //
  // Returns a result rather than toasting, because its two callers report
  // differently: the form shows a toast, setup shows an inline confirmation
  // on the card itself.
  const addVerseRangeToQueue = async (
    book: string,
    chapter: number,
    startVerse: number,
    endVerse: number,
    translationId: string = selectedTranslationId
  ): Promise<{ added: number; alreadyThere: number; missingText: number; error?: string }> => {
    const empty = { added: 0, alreadyThere: 0, missingText: 0 };
    const bookId = getBookByName(book)?.id;
    if (!bookId) return { ...empty, error: `Unrecognized book: ${book}` };

    const start = Math.min(startVerse, endVerse);
    const end = Math.max(startVerse, endVerse);
    const targets = Array.from({ length: end - start + 1 }, (_, i) => start + i);

    // Read through the ref, not the render-time `memoryQueue` snapshot --
    // same reason every other queue mutation does (see updateMemoryQueue).
    const existingIds = new Set(memoryQueueRef.current.map((q) => q.verseId));
    const toAdd = targets.filter(
      (v) => !existingIds.has(buildVerseId(translationId, bookId, chapter, v))
    );
    const alreadyThere = targets.length - toAdd.length;
    if (toAdd.length === 0) return { ...empty, alreadyThere };

    const chapterData = await fetchChapterText(translationId, bookId, chapter);
    if (!chapterData) {
      return { ...empty, alreadyThere, error: `Couldn't find ${book} ${chapter} in the scripture library yet.` };
    }

    const found = toAdd.filter((v) => chapterData.verses[String(v)]);
    if (found.length === 0) {
      return { ...empty, alreadyThere, missingText: toAdd.length, error: `No verse text found for ${book} ${chapter}.` };
    }

    const newItems: QueueItem[] = found.map((v, i) => ({
      verseId: buildVerseId(translationId, bookId, chapter, v),
      translationId: translationId,
      book,
      chapter,
      verseNumber: v,
      text: chapterData.verses[String(v)],
      orderIndex: memoryQueueRef.current.length + i,
      status: 'queued',
      origin: 'individual',
      retentionPhase: 'none',
      dateStarted: null,
      lastReviewDate: null,
      nextReviewDueDate: null,
      currentStreakCount: 0,
      totalSuccessfulReviews: 0,
      gracePeriodUsedToday: false,
    }));

    updateMemoryQueue((prev) => [...prev, ...newItems]);
    return { added: newItems.length, alreadyThere, missingText: toAdd.length - found.length };
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
    targetWeekday?: string,
    // How far into the phase's graduation cycle to start (1 = just began,
    // same as the old hardcoded behavior). Only meaningful for
    // daily/weekly/monthly -- ignored for learning/retained, which have no
    // partial-progress concept. Callers should clamp this to
    // [1, graduation threshold for targetPhase] themselves (the UI reads
    // dailyPhaseWeeks/weeklyPhaseMonths/monthlyPhaseYears to compute that
    // same threshold handleReviewCompleted graduates on).
    progressCount?: number
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
      delete base.guidedSetAside;

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
        base.currentStreakCount = Math.max(1, progressCount ?? 1);
        base.nextReviewDueDate = dueDateISO;
      }
      // Everything above is a deliberate reset, but the history stays --
      // those reviews really happened. Note the move itself.
      appendReviewLog(base, base, 'placed');

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
    syncChallengeProgress();

    const phaseLabel =
      targetPhase === 'learning'
        ? 'Learning'
        : targetPhase === 'retained'
          ? 'Retained'
          : `${targetPhase[0].toUpperCase()}${targetPhase.slice(1)} Review`;
    const dueNote = dueDateISO
      ? ` Next due ${new Date(dueDateISO).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}.`
      : '';
    triggerToast(`Set ${total} ${total === 1 ? 'verse' : 'verses'} to ${phaseLabel}.${dueNote}`);
  };

  // `opts.perfect` — accuracy tier of the practice run behind this result
  // (graded in src/lib/recitation.ts). A success with perfect === false was
  // "close enough" (>= 90% word accuracy): it still counts as a completed
  // spaced-repetition review, but does NOT bank a mastery touch for a
  // learning verse — touches require a perfect run. Omitted (undefined)
  // means nothing measured the accuracy (the manual-log action's "Perfect"
  // option, where the user reviewed off-app) and is treated as the user
  // claiming a perfect run.
  const handleReviewCompleted = async (
    item: QueueItem,
    success: boolean,
    drillType?: 'speak' | 'type' | 'reveal',
    opts?: ReviewCompletedOpts
  ): Promise<'early' | void> => {
    // A quiet caller (Pick up the thread) shows its own per-verse results, so
    // one toast per verse would just stack up over them.
    const toast = opts?.quiet ? (_message: string) => {} : triggerToast;
    // Which practice produced this review, kept in the review history.
    const via = opts?.via ? { via: opts.via } : {};

    // Practicing ahead: a verse on a review schedule that isn't due yet is
    // practice, pass or miss (the user's call, 2026-10-10). Before this, an
    // early pass counted as a whole cycle -- Recalling a monthly verse a week
    // early moved it on a month -- and an early miss demoted it for
    // practicing ahead. Nothing changes, lastReviewDate included: "Reset
    // today's reviews" reads that date and would pull the verse back to due
    // today. Same due test as Home's review list.
    if (item.status === 'reviewing' && !isReviewDue(item.nextReviewDueDate)) return 'early';

    let updatedItem = { ...item };
    updatedItem.lastReviewDate = new Date().toISOString();

    // Catch up on any full review cycles silently missed while the app
    // wasn't opened -- being late is the same kind of "miss" as an active
    // failed attempt, just detected from elapsed time instead of a tap.
    // Being less than one full cycle late isn't a miss at all, which is
    // also what gives due dates their day-or-two of natural flexibility.
    // Any sabbath days or paused days in the elapsed span don't count as
    // elapsed time -- the engine treats them as though they didn't happen.
    // This is the reactive fallback path: it always auto-resolves per the
    // plan's missPolicy (no forcedOutcome), same as before the missed-review
    // popup existed. Items the popup already resolved on this app-open won't
    // still be overdue by the time they're reviewed, since resolving there
    // moves nextReviewDueDate forward too -- see resolveMissedReviewChoice.
    if (item.status === 'reviewing' && updatedItem.nextReviewDueDate) {
      const missedCycles = computeMissedCycles(updatedItem, dayStartHour, sabbathEnabled, sabbathDay, pausedAt, pausedUntil);
      if (missedCycles > 0) {
        const { updatedItem: resolvedItem, tag } = resolveMissedCycles(updatedItem, missedCycles, missPolicy, {
          graceCount,
          refresherDailyDays,
          refresherWeeklyWeeks,
        });
        updatedItem = resolvedItem;
        appendReviewLog(updatedItem, item, 'skipped', {
          cycles: missedCycles,
          ...(tag === 'frozen' || tag === 'grace' ? { forgiven: true as const } : {}),
        });
        if (tag !== 'grace' && tag !== 'frozen' && tag !== 'none') {
          updatedItem.reviewsToday = 0;
        }
        const dailyGraduationDaysTotal = dailyPhaseWeeks * 7 + (updatedItem.dailyPhaseExtensionDays || 0);
        const message = describeMissOutcome(tag, updatedItem, dailyGraduationDaysTotal);
        if (message) {
          toast(`${missedCycles} review cycle${missedCycles > 1 ? 's' : ''} passed unattempted. ${message}`);
        }
      }
    }

    if (success) {
      if (item.status === 'learning') {
        // Perfection gate: a run with any missed words never banks a touch,
        // no matter how close — "close enough" only exists for reviews.
        if (opts?.perfect === false) {
          toast('Good recall! A run must be perfect (no missed words) to bank a mastery touch.');
          return;
        }
        // 3-Touch Mastery Gate checks. PracticeModals' Recall mode and the
        // manual-log action always pass an explicit drillType now; 'speak'
        // only remains as a fallback for any caller that doesn't.
        const inferredType = drillType || 'speak';
        const isValid = validateTouch(item, inferredType);

        if (isValid) {
          const newTouch: TouchLog = {
            timestamp: new Date().toISOString(),
            drillType: inferredType,
          };
          const updatedLogs = [...(item.touchLogs || []), newTouch];
          updatedItem.touchLogs = updatedLogs;
          appendReviewLog(updatedItem, item, 'pass', { drillType: inferredType, ...via });
          updatedItem.totalSuccessfulReviews += 1;
          updatedItem.currentStreakCount += 1;

          if (updatedLogs.length >= masteryTouches) {
            // Retention beats new learning: a verse can bank all its touches,
            // but doesn't actually graduate to spaced review while other
            // verses still have reviews due today. It releases automatically
            // the moment the last due review clears (see the sweep at the
            // end of this function).
            // While paused nothing is due, so there's nothing to wait for --
            // holding the verse back would strand it behind reviews Home
            // isn't even showing.
            const dueReviewsPending = !reviewsPaused && memoryQueueRef.current.some(
              (q) =>
                q.verseId !== item.verseId &&
                q.status === 'reviewing' &&
                isReviewDue(q.nextReviewDueDate, getLogicalDate(dayStartHour))
            );
            if (dueReviewsPending) {
              toast(`Mastery touches complete (${updatedLogs.length}/${masteryTouches})! Finish today's reviews to lock this verse in.`);
            } else {
              updatedItem.status = 'reviewing';
              updatedItem.retentionPhase = 'daily';
              updatedItem.dateStarted = new Date().toISOString();
              updatedItem.currentStreakCount = 1;
              updatedItem.nextReviewDueDate = nextDueDateISO(1);
              updatedItem.reviewsToday = 0;
              toast('Learned! It moves up to Daily review.');
            }
          } else {
            toast(`Recall logged! Mastery progress: ${updatedLogs.length}/${masteryTouches} touches.`);
          }
        } else {
          toast('Touch logged, but within 1-hour constraint. Only 1 touch per hour counts toward Mastery!');
        }
      } else if (item.status === 'reviewing') {
        // Logged against the stage as it stands before this review moves it on.
        appendReviewLog(updatedItem, updatedItem, 'pass', { ...(drillType ? { drillType } : {}), ...via });
        // Check reviewsRequired per day constraint
        const lastReviewDateStr = item.lastReviewDate;
        const isSameDay =
          lastReviewDateStr &&
          getLogicalDate(dayStartHour, new Date(lastReviewDateStr)).toDateString() === getLogicalDate(dayStartHour).toDateString();
        const currentReviewsToday = isSameDay ? (item.reviewsToday || 0) + 1 : 1;
        updatedItem.reviewsToday = currentReviewsToday;
        updatedItem.totalSuccessfulReviews += 1;
        updatedItem.gracePeriodUsedToday = false;
        updatedItem.graceMissesUsed = 0;

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
              toast(
                `Refresher complete! Back to ${returnPhase === 'monthly' ? 'Monthly' : 'Weekly'} review, resuming right where you left off, aligned to ${DAY_FULL_NAMES[returnAnchor]}. 🌟`
              );
            } else {
              updatedItem.nextReviewDueDate = nextDueDateISO(updatedItem.retentionPhase === 'weekly' ? 7 : 1);
              toast(`Refresher review complete! (${updatedItem.currentStreakCount}/${updatedItem.refresherTargetUnits})`);
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
              toast(`Moved up to Weekly! It's reviewed on ${DAY_FULL_NAMES[anchor]} with the rest of ${updatedItem.book} ${updatedItem.chapter}.`);
            } else {
              updatedItem.nextReviewDueDate = nextDueDateISO(1);
              toast('Daily reviews complete! Spaced date advanced.');
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
              toast(`Moved up to Monthly! Still reviewed on ${DAY_FULL_NAMES[anchor]}.`);
            } else if (updatedItem.chapterReviewAnchorDay) {
              updatedItem.nextReviewDueDate = nthOccurrenceOfWeekday(
                tomorrow,
                updatedItem.chapterReviewAnchorDay,
                1,
                sabbathEnabled,
                sabbathDay
              ).toISOString();
              toast('Weekly review complete! Spaced date advanced.');
            } else {
              // Not retroactive -- a legacy weekly item with no anchor yet
              // keeps the old unanchored math until it actually transitions.
              updatedItem.nextReviewDueDate = nextDueDateISO(7);
              toast('Weekly review complete! Spaced date advanced.');
            }
          } else if (updatedItem.retentionPhase === 'monthly') {
            if (updatedItem.currentStreakCount >= monthlyGraduationReviews) {
              updatedItem.status = 'retained';
              updatedItem.retentionPhase = 'none';
              updatedItem.nextReviewDueDate = null;
              toast('Complete! No more scheduled reviews for this one.');
            } else if (updatedItem.chapterReviewAnchorDay) {
              updatedItem.nextReviewDueDate = nthOccurrenceOfWeekday(
                tomorrow,
                updatedItem.chapterReviewAnchorDay,
                4,
                sabbathEnabled,
                sabbathDay
              ).toISOString();
              toast('Monthly review complete! Spaced date advanced.');
            } else {
              // Not retroactive -- see the Weekly same-phase branch above.
              updatedItem.nextReviewDueDate = nextDueDateISO(30);
              toast('Monthly review complete! Spaced date advanced.');
            }
          }
          updatedItem.reviewsToday = 0; // Reset for next review cycle
        } else {
          toast(`Review logged! (${currentReviewsToday}/${reviewsRequired} required for today)`);
        }
      }
    } else {
      // FAILED REVIEW (today's actual attempt, on top of any catch-up above)
      if (item.status === 'reviewing') {
        const beforeMiss = { ...updatedItem };
        const tag = applyMissToItem(updatedItem, { graceCount, refresherDailyDays, refresherWeeklyWeeks });
        appendReviewLog(updatedItem, beforeMiss, tag === 'grace' ? 'grace' : 'miss', drillType ? { drillType } : {});
        if (tag !== 'grace' && tag !== 'none') {
          updatedItem.reviewsToday = 0;
        }
        const dailyGraduationDaysTotal = dailyPhaseWeeks * 7 + (updatedItem.dailyPhaseExtensionDays || 0);
        const message = describeMissOutcome(tag, updatedItem, dailyGraduationDaysTotal);
        if (message) toast(message);
      } else {
        toast('Incorrect. Keep practicing!');
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
      toast(
        `All reviews done! ${releasedCount} verse${releasedCount > 1 ? 's' : ''} locked in and moved to spaced review. 🔓`
      );
    }
    syncChallengeProgress();

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
    triggerToast(` ${reviewedToday.length} verse${reviewedToday.length === 1 ? '' : 's'} reviewed today reset back to due.`);
  };

  const handleUpdateVerseStatus = async (
    versesToUpdate: VerseState[],
    newStatus: 'memorized' | 'learning',
    customDrillType?: 'speak' | 'type' | 'reveal',
    opts?: ReviewCompletedOpts
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
    // PracticeModals' Recall mode and the manual-log action always pass an
    // explicit customDrillType now; 'speak' only remains as a fallback.
    const drillType = customDrillType || 'speak';
    // Verses that weren't due yet, so nothing was logged for them.
    const early: QueueItem[] = [];
    for (const v of versesToUpdate) {
      // Read through the ref, not the render-time snapshot — each loop
      // iteration must see the queue updates the previous iteration made.
      // Matched by translation too when the verse says which: Psalm 23:1 in
      // the BSB and in Hebrew are independent items, and grading a Hebrew
      // recall must not credit the BSB one. ('ESV' is the same legacy
      // default for translation-less items used everywhere else here.)
      const itemInQueue = memoryQueueRef.current.find(
        (q) =>
          q.book === v.book &&
          q.chapter === v.chapter &&
          q.verseNumber === v.verse &&
          (!v.translationId || (q.translationId || 'ESV') === v.translationId)
      );
      if (itemInQueue) {
        const outcome = await handleReviewCompleted(itemInQueue, success, drillType, opts);
        if (outcome === 'early') early.push(itemInQueue);
      }
    }

    const refStr =
      versesToUpdate.length === 1
        ? `${versesToUpdate[0].book} ${versesToUpdate[0].chapter}:${versesToUpdate[0].verse}`
        : `${versesToUpdate[0].book} ${versesToUpdate[0].chapter}:${versesToUpdate[0].verse}-${versesToUpdate[versesToUpdate.length - 1].verse}`;

    if (opts?.quiet) return;
    if (early.length > 0) {
      const soonest = early.map((i) => i.nextReviewDueDate || '').filter(Boolean).sort()[0];
      const day = soonest ? formatDate(soonest, 'relative') : '';
      const when = day === 'Tomorrow' ? 'tomorrow' : day;
      if (early.length === versesToUpdate.length) {
        triggerToast(`Not due until ${when}, so this was practice. Your schedule hasn't changed.`);
      } else {
        const list = early.map((i) => `v${i.verseNumber}`).join(', ');
        triggerToast(`Logged. ${list} ${early.length === 1 ? "isn't" : "aren't"} due until ${when}, so ${early.length === 1 ? 'it was' : 'they were'} practice.`);
      }
      return;
    }
    triggerToast(`Completed practice for ${refStr}!`);
  };

  // Pick up the thread, opened on a given verse. Closes any practice overlay
  // first: the drill is a screen, and the overlay would sit on top of it.
  const openThreadDrill = (preset: ThreadDrillPreset | null) => {
    abortReviewSession();
    setThreadDrillPreset(preset);
    navigateTo('threadDrill');
  };

  // Guided learning, optionally on one passage. Closes any practice overlay
  // first, for the same reason as openThreadDrill.
  const openGuided = (passageKey?: string) => {
    abortReviewSession();
    setGuidedPassageKey(passageKey ?? null);
    navigateTo('guided');
  };

  // Marks a verse Guided learning set aside after repeated misses, or clears
  // the mark. The key is deleted to clear it -- never written as false or
  // undefined (Firestore rejects undefined). The auto-sync saves it.
  const setGuidedSetAside = (verseId: string, on: boolean) => {
    updateMemoryQueue((prev) =>
      prev.map((item) => {
        if (item.verseId !== verseId) return item;
        if (on) return item.guidedSetAside ? item : { ...item, guidedSetAside: true as const };
        if (!item.guidedSetAside) return item;
        const next = { ...item };
        delete next.guidedSetAside;
        return next;
      })
    );
  };

  // Guided learning's "Add verse N to Learning": moves exactly one queued
  // verse into Learning, with the same field resets as triggerDailyPull. It
  // ignores the daily pace and the learning-day check (the user asked for
  // this verse), but still refuses while reviews are paused, matching
  // triggerDailyPull. Returns whether the verse moved.
  const pullVerseIntoLearning = (verseId: string): boolean => {
    if (reviewsPaused) {
      triggerToast('Reviews are paused -- resume from Settings to add new verses.');
      return false;
    }
    const item = memoryQueueRef.current.find((q) => q.verseId === verseId);
    if (!item || item.status !== 'queued') return false;
    updateMemoryQueue((prev) =>
      prev.map((q) =>
        q.verseId !== verseId
          ? q
          : {
              ...q,
              status: 'learning' as const,
              dateStarted: new Date().toISOString(),
              lastReviewDate: null,
              nextReviewDueDate: null,
              currentStreakCount: 0,
              totalSuccessfulReviews: 0,
              gracePeriodUsedToday: false,
            }
      )
    );
    return true;
  };

  // Guided learning's credit path, the same calls Pick up the thread makes
  // (finishRound in ThreadDrillScreen): 'touch' banks a Learning run
  // (perfect), 'review' counts a due review. Every verse carries its
  // translationId, so Psalm 23:1 in BSB and in Hebrew stay separate items.
  // Resolves to the credited items as they stand afterwards, read from the
  // live queue, so the caller can tell whether a third run graduated the
  // verse or graduation is being held for due reviews.
  const creditGuided = async (items: QueueItem[], kind: 'touch' | 'review', drill: 'speak' | 'type'): Promise<QueueItem[]> => {
    if (items.length > 0) {
      const states: VerseState[] = items.map((i) => ({
        book: i.book,
        chapter: i.chapter,
        verse: i.verseNumber,
        text: i.text,
        status: 'memorized',
        translationId: i.translationId,
      }));
      await handleUpdateVerseStatus(states, 'memorized', drill, { perfect: kind === 'touch', quiet: true, via: 'guided' });
    }
    const ids = new Set(items.map((i) => i.verseId));
    return memoryQueueRef.current.filter((q) => ids.has(q.verseId));
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

  // Public "memorized" figure synced below -- graduated out of Learning into
  // spaced review (Daily/Weekly/Monthly) or fully retained, same definition
  // ProfileScreen's own card uses for itself (versesLearnedCount). The plain
  // `memorizedCount` above is deliberately narrower (retained-only, for
  // Dashboard's per-phase retention breakdown) and would understate this.
  const publicMemorizedCount = memoryQueue.filter(
    (item) => item.status === 'reviewing' || item.status === 'retained'
  ).length;

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
      // Keep the friend-visible snapshot fresh alongside the public stats.
      // Only written while visibility is 'friends' -- flipping to 'private'
      // deletes it in updateMemoryQueueVisibility, and this effect doesn't
      // re-add it.
      updateDoc(doc(db, 'profiles', uid), {
        memorizedCount: publicMemorizedCount,
        learningCount,
        streakDays: memoryStreak,
      }).catch((err) => console.error('Failed to sync profile stats:', err));
      if (memoryQueueVisibility === 'friends') {
        writeSharedQueueSnapshot(uid).catch((err) => console.error('Failed to sync shared verses:', err));
      }
    }, 800);

    return () => {
      if (profileStatsSyncTimerRef.current) clearTimeout(profileStatsSyncTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicMemorizedCount, learningCount, memoryStreak, user, memoryQueue, savedPlans, memoryQueueVisibility]);

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
              if (isDue && !reviewsPaused) dueDate = 'Due: Today';
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
            translationId: selectedTranslationId,
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

  // Picked verse range for partial-chapter recording — null bounds fall back
  // to the full chapter. The passage sheet sets book, chapter and range
  // together and clears the range itself when the book or chapter changes,
  // so a range from one chapter can't carry over to another. (An effect
  // used to reset it here, which would also wipe a range restored on launch.)
  const recordingRangeStartClamped = recordingRangeStart ?? 1;
  const recordingRangeEndClamped = recordingRangeEnd ?? recordingChapterVerses.length;
  const recordingSelectedVerses = recordingChapterVerses.filter(
    (v) => v.verse >= recordingRangeStartClamped && v.verse <= recordingRangeEndClamped
  );
  const isRecordingFullChapterRange =
    recordingRangeStartClamped === 1 && recordingRangeEndClamped === recordingChapterVerses.length;

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

  // Shared upload + Firestore write for a finished recitation, used by both
  // the live-record flow and the import-audio flow below — so visibility
  // defaults, the sharedRecordings ACL snapshot, and the profile
  // default-visibility bookkeeping can't drift between the two.
  // Studio renders are produced asynchronously by the processStudioAudio
  // Cloud Function, normally a few seconds after the upload finishes. But
  // recordings are fetched exactly once per session with getDocs (see
  // loadUserData), so nothing would notice the render landing until the next
  // app launch — the user would save a recitation, see "Polishing audio…"
  // forever, and conclude the feature is broken.
  //
  // Rather than converting the whole recordings collection to a live listener
  // (a much larger change, and a permanent read cost for a one-off event),
  // this attaches to the ONE doc just saved and detaches the moment the
  // render resolves. The timeout is the backstop: if the function errors in a
  // way that never writes studioStatus at all, the listener still goes away
  // instead of leaking for the rest of the session.
  const STUDIO_WATCH_TIMEOUT_MS = 3 * 60 * 1000;
  const studioWatchersRef = useRef<Map<string, () => void>>(new Map());

  const watchStudioRender = (uid: string, recordingId: string) => {
    // A re-save of the same id would otherwise strand the previous listener.
    studioWatchersRef.current.get(recordingId)?.();
    studioWatchersRef.current.delete(recordingId);

    let unsubscribe: (() => void) | null = null;
    let settled = false;

    const detach = () => {
      settled = true;
      clearTimeout(timeoutId);
      unsubscribe?.();
      studioWatchersRef.current.delete(recordingId);
    };

    const timeoutId = setTimeout(detach, STUDIO_WATCH_TIMEOUT_MS);

    unsubscribe = onSnapshot(
      doc(db, 'users', uid, 'recordings', recordingId),
      (snap) => {
        const data = snap.data() as Recording | undefined;
        // Still processing — keep waiting.
        if (!data || data.studioStatus === 'pending') return;
        setUserRecordings((prev) =>
          prev.map((r) =>
            r.id === recordingId
              ? {
                  ...r,
                  studioAudioUrl: data.studioAudioUrl,
                  studioAudioPath: data.studioAudioPath,
                  studioStatus: data.studioStatus,
                }
              : r
          )
        );
        // A render landing switches the playback target from the raw take to
        // the studio version. Normally nothing is cached yet (cacheableTarget
        // refuses to cache while 'pending'), but a legacy recording whose raw
        // file was cached before a backfill produced a render would otherwise
        // keep that now-unreachable file on disk forever.
        //
        // Reads the snapshot rather than the merged state above: a state
        // updater is not guaranteed to have run by the time this line
        // executes, and the doc already carries every path this needs.
        void dropCachedAudio(data, 'stale');
        detach();
      },
      (err) => {
        console.error('Studio render watcher failed:', err);
        detach();
      }
    );

    // onSnapshot resolves asynchronously in practice, but if it ever settled
    // before this assignment the detach() above would have had a null
    // unsubscribe to call and the listener would survive. Cheap to be sure.
    if (settled) unsubscribe();
    else studioWatchersRef.current.set(recordingId, unsubscribe);
  };

  // Signing out or unmounting mid-render must not leave listeners attached to
  // the previous user's documents.
  useEffect(() => {
    const watchers = studioWatchersRef.current;
    return () => {
      watchers.forEach((unsubscribe) => unsubscribe());
      watchers.clear();
    };
  }, []);

  const persistRecording = async (params: {
    uri: string;
    durationSec: number;
    verseTimestamps: VerseTimestamp[];
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

    // Range label reflects whatever was actually recorded/tagged (the
    // verse-range picker on the Record tab), not always "Full Chapter" —
    // used for both the display title and versesStr.
    const rangeLabel = isRecordingFullChapterRange
      ? 'Full Chapter'
      : recordingRangeStartClamped === recordingRangeEndClamped
        ? `Verse ${recordingRangeStartClamped}`
        : `Verses ${recordingRangeStartClamped}-${recordingRangeEndClamped}`;
    const titleSuffix =
      params.sourceType === 'imported' ? `${rangeLabel} Imported Recitation` : `${rangeLabel} Recitation`;

    // New recordings default to the BOTTOM of this chapter's priority order
    // (whatever the user already had as their top pick for this chapter
    // stays the default) — the user can drag it up from ChapterLandingScreen.
    const samechapterPriorities = userRecordings
      .filter((r) => r.book.toLowerCase() === recordingBook.toLowerCase() && r.chapter === recordingChapter)
      .map((r) => r.priority ?? 0);
    const nextPriority = samechapterPriorities.length > 0 ? Math.max(...samechapterPriorities) + 1 : 0;

    // audioUrl is deliberately absent here — it doesn't exist until the
    // upload below finishes, and is patched in afterwards.
    const newRec: Recording = {
      id,
      title: `${recordingBook} ${recordingChapter} ${titleSuffix}`,
      book: recordingBook,
      chapter: recordingChapter,
      translation: recordingTranslation,
      duration: params.durationSec,
      date: new Date().toISOString().split('T')[0],
      userId: uid,
      user: auth.currentUser?.displayName || 'Me',
      avatar: (auth.currentUser?.displayName || 'M').charAt(0).toUpperCase(),
      audioPath,
      versesStr: rangeLabel,
      // OMITTED, not set to undefined, for a full chapter. Firestore rejects
      // an explicit `undefined` field value outright ("Unsupported field
      // value: undefined (found in field startVerse)") because this app's
      // initializeFirestore call doesn't enable ignoreUndefinedProperties —
      // so `startVerse: undefined` threw and the whole save failed. Leaving
      // the keys off entirely is also exactly what the type documents:
      // absent start+end == full chapter (see types.ts).
      ...(isRecordingFullChapterRange
        ? {}
        : { startVerse: recordingRangeStartClamped, endVerse: recordingRangeEndClamped }),
      priority: nextPriority,
      verseTimestamps: params.verseTimestamps,
      sharedVisibility: pickedRecordingVisibility,
      sourceType: params.sourceType,
      // Claimed up front so the UI can show "Polishing audio…" immediately;
      // the processStudioAudio Cloud Function flips this to 'ready'/'failed'.
      studioStatus: 'pending',
    };

    const recordingDocRef = doc(db, 'users', uid, 'recordings', id);

    triggerToast('Uploading recitation...');
    try {
      // WRITE ORDER IS LOAD-BEARING: the Firestore doc goes in BEFORE the
      // audio upload, because uploading is what fires the processStudioAudio
      // Storage trigger. With the old order (upload, then setDoc) the
      // function could finish and write studioAudioUrl into the doc while
      // this save was still in flight, and the non-merging setDoc below would
      // silently wipe it — an intermittent "studio mode just doesn't work
      // sometimes" bug that would only reproduce on fast connections.
      //
      // Writing first also means every later write to this doc can be a
      // merging updateDoc, so the client and the function can never clobber
      // each other regardless of who lands first.
      await setDoc(recordingDocRef, stripUndefined({ ...newRec, createdAt: serverTimestamp() }));

      let audioUrl: string;
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
        audioUrl = await getDownloadURL(fileRef);
      } catch (uploadErr) {
        // The doc was written first (see above), so a failed upload would
        // otherwise strand a recording row pointing at audio that does not
        // exist. Roll it back before rethrowing into the outer handler.
        await deleteDoc(recordingDocRef).catch((rollbackErr) =>
          console.error('Failed to roll back recording doc after upload error:', rollbackErr)
        );
        throw uploadErr;
      }

      // updateDoc, NOT setDoc — the studio render may already have landed on
      // this doc by now, and a whole-document write would erase it.
      await updateDoc(recordingDocRef, { audioUrl });

      const savedRec: Recording = { ...newRec, audioUrl };

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
          await setDoc(
            doc(db, 'sharedRecordings', id),
            stripUndefined({
              ...savedRec,
              ownerId: uid,
              visibility: pickedRecordingVisibility,
              sharedWithUids,
              createdAt: serverTimestamp(),
            })
          );
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

      setUserRecordings((prev) => [savedRec, ...prev]);
      // Recordings are loaded once via getDocs (see loadUserData), so without
      // this the studio render wouldn't appear until the next app launch.
      watchStudioRender(uid, id);
      triggerToast(`${titleSuffix} saved!`);
      // Made for someone's request? Deliver it back into that chat.
      void fulfillRecordingRequest(savedRec);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/recordings/${id}`);
    }
  };

  // Chat cards: recordings shared into a chat, recording requests, quizzes
  // (see useChatCards).
  const {
    sendRecordingToChat,
    playChatRecording,
    activeRecordingRequest,
    startRecordingForRequest,
    cancelRecordingRequest,
    fulfillRecordingRequest,
    loadFriendQuizVerses,
    activeQuiz,
    openQuiz,
    finishQuiz,
    closeQuiz,
  } = useChatCards({
    userRecordings,
    feedRecordings,
    setFeedRecordings,
    setSelectedRecording,
    navigateTo,
    selectTab,
    postChatMessage,
    respondToCard: (...args) => social.respondToCard(...args),
    closeDMThread,
    closeCircleChat,
    setRecordingPassage: (book, chapter, startVerse, endVerse) => {
      setRecordingBook(book);
      setRecordingChapter(chapter);
      setRecordingRangeStart(startVerse);
      setRecordingRangeEnd(endVerse);
    },
    triggerToast: (message) => triggerToast(message),
  });

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
        recordingSelectedVerses.map((v) => v.verse),
        verseTapTimestamps,
        capturedDurationRef.current
      ),
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
      verseTimestamps: buildVerseTimestamps(recordingSelectedVerses.map((v) => v.verse), importTapTimestamps, durationSec),
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
    openSaveRecordingDialog('import');
  };

  const deleteRecording = async (recording: Recording) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await deleteDoc(doc(db, 'users', uid, 'recordings', recording.id));
      if (recording.audioPath) {
        await deleteObject(storageRef(storage, recording.audioPath));
      }
      // The studio render is a second blob under the same prefix — deleting
      // only audioPath silently leaks it on every delete. Best-effort: it may
      // legitimately not exist yet (still processing) or ever ('failed').
      if (recording.studioAudioPath) {
        await deleteObject(storageRef(storage, recording.studioAudioPath)).catch((err) =>
          console.error('Failed to delete studio audio file:', err)
        );
      }
      // Third copy: the on-device cache. Without this the local file outlives
      // the recording entirely — invisible in the app, and only reclaimed
      // whenever the LRU cap happens to evict it.
      await dropCachedAudio(recording, 'all');
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
      triggerToast('Verse sync offsets updated!');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/recordings/${selectedRecording.id}`);
    }
  };

  // Lets the recording owner rename the "Speaker" shown everywhere this
  // recording surfaces (RecordingDetailScreen, ChapterLandingScreen's audio
  // card/selector, the community feed) — same single-field update-and-sync
  // shape as saveVerseSyncOffsets above.
  const updateRecordingSpeaker = async (recording: Recording, newSpeaker: string) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const trimmed = newSpeaker.trim() || 'Me';
    try {
      await updateDoc(doc(db, 'users', uid, 'recordings', recording.id), { user: trimmed });
      const updated = { ...recording, user: trimmed };
      if (selectedRecording?.id === recording.id) setSelectedRecording(updated);
      setUserRecordings((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      triggerToast('Speaker updated!');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/recordings/${recording.id}`);
    }
  };

  // Persists a new drag-to-reorder priority order for one chapter's
  // recordings (the "Change" list on ChapterLandingScreen) — lower priority
  // number sorts first, see resolveChapterAudio. Optimistic local update
  // first for a snappy drag, then only the rows whose priority actually
  // changed get written to Firestore.
  const reorderChapterRecordings = async (orderedIds: string[]) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const updates = orderedIds
      .map((id, idx) => ({ id, priority: idx }))
      .filter(({ id, priority }) => userRecordings.find((r) => r.id === id)?.priority !== priority);
    if (updates.length === 0) return;
    setUserRecordings((prev) =>
      prev.map((r) => {
        const u = updates.find((x) => x.id === r.id);
        return u ? { ...r, priority: u.priority } : r;
      })
    );
    await Promise.all(
      updates.map(({ id, priority }) =>
        updateDoc(doc(db, 'users', uid, 'recordings', id), { priority }).catch((err) =>
          handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/recordings/${id}`)
        )
      )
    );
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
      // ...rec can carry undefined optional fields straight off an in-memory
      // feed object (savedFromUid: rec.userId is the obvious one), which
      // would fail the write the same way full-chapter recordings did.
      await setDoc(doc(db, 'users', uid, 'recordings', id), stripUndefined({ ...savedRec, createdAt: serverTimestamp() }));
      setUserRecordings((prev) => [savedRec, ...prev]);
      triggerToast(`Saved to My Library! Added to your ${rec.book} ${rec.chapter} options.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `users/${uid}/recordings/${id}`);
    }
  };

  const social = useSocial({
    user,
    friends,
    myCircles,
    dmThreads,
    activeDMThread,
    activeDMMessages,
    activeCircleChatId,
    activeCircleMessages,
    triggerToast,
    reloadFriends: () => {
      loadFriends();
      loadFriendRequests();
    },
  });
  // Review reminders: the next week from the review engine's own calendar
  // projection (the same one My Verses' calendar draws), so a reminder never
  // promises reviews the app won't actually show. Today uses the live queue
  // instead, so finishing today's reviews cancels today's reminder.
  const reminderDays: ReminderDay[] = useMemo(() => {
    if (!user || memoryQueue.length === 0) return [];
    try {
      const days = getMemoryCalendarProjection(
        memoryQueue,
        {
          dailyPhaseWeeks,
          weeklyPhaseMonths,
          monthlyPhaseYears,
          learningDays,
          newVersesPace,
          sabbathEnabled,
          sabbathDay,
          joinedPlans: joinedGroupPlanDetails,
          memberships: joinedGroupPlanMemberships,
          pausedAt,
          pausedUntil,
        },
        7
      );
      const logicalToday = getLogicalDate(dayStartHour);
      const dueNow = reviewsPaused
        ? 0
        : memoryQueue.filter((q) => q.status === 'reviewing' && isReviewDue(q.nextReviewDueDate, logicalToday)).length;
      return days.map((d, i) =>
        i === 0
          ? { date: d.date, reviews: dueNow, learning: dueNow > 0 ? d.learningCount : 0 }
          : { date: d.date, reviews: d.dueReviews.length, learning: d.learningCount + d.newVersesPulled }
      );
    } catch (err) {
      console.error('Failed to project review reminders:', err);
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, memoryQueue, dailyPhaseWeeks, weeklyPhaseMonths, monthlyPhaseYears, learningDays, newVersesPace, sabbathEnabled, sabbathDay, joinedGroupPlanDetails, joinedGroupPlanMemberships, pausedAt, pausedUntil, dayStartHour, reviewsPaused]);

  const openPushTarget = (target: PushTarget) => {
    switch (target.type) {
      case 'dm':
        void openDMThread(target.otherUid, target.otherName, '');
        break;
      case 'circle':
        selectTab('community');
        openCircle(target.circleId);
        openCircleChat(target.circleId);
        break;
      case 'friendRequest':
        navigateTo('findFriends');
        break;
      case 'nudge':
        selectTab('profile');
        break;
      case 'reviewReminder':
        selectTab('home');
        break;
    }
  };

  const push = usePushNotifications({
    user,
    onScreenChatKey:
      currentScreen === 'dmThread' && activeDMThread
        ? `dm_${activeDMThread.id}`
        : currentScreen === 'circleChat' && activeCircleChatId
          ? `circle_${activeCircleChatId}`
          : null,
    reminderDays,
    onOpenTarget: openPushTarget,
    triggerToast,
  });

  // Circle invite links (src/lib/invites.ts). A link that opens the app is
  // acted on as soon as someone is signed in; before that (a brand-new
  // person signing up from the invite), the code is kept on the device so
  // the join still happens once their account exists.
  const PENDING_INVITE_KEY = 'pendingCircleInvite';
  const [pendingInviteCode, setPendingInviteCode] = useState<string | null>(null);
  useEffect(() => {
    const take = (url: string | null) => {
      const code = parseInviteCode(url);
      if (!code) return;
      setPendingInviteCode(code);
      AsyncStorage.setItem(PENDING_INVITE_KEY, code).catch(() => undefined);
    };
    Linking.getInitialURL().then(take).catch(() => undefined);
    AsyncStorage.getItem(PENDING_INVITE_KEY)
      .then((code) => code && setPendingInviteCode((cur) => cur ?? code))
      .catch(() => undefined);
    const sub = Linking.addEventListener('url', (e) => take(e.url));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!user || !pendingInviteCode || showOnboarding) return;
    const code = pendingInviteCode;
    setPendingInviteCode(null);
    AsyncStorage.removeItem(PENDING_INVITE_KEY).catch(() => undefined);
    selectTab('community');
    void joinCircleByCode(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, pendingInviteCode, showOnboarding]);

  // Blocked people vanish from every list on my own screens. (The rules
  // separately stop them reaching me 1:1; in a circle's shared spaces this
  // hiding is all a block can do.)
  const { blockedUids } = social;
  const visibleDmThreads = dmThreads.filter((t) => !blockedUids.has(t.otherUid));
  const visibleActivityEvents = activityEvents.filter((e) => !blockedUids.has(e.uid));
  const visibleFeedRecordings = feedRecordings.filter((r) => {
    const owner = r.userId || (r as Recording & { ownerId?: string }).ownerId;
    return !owner || !blockedUids.has(owner);
  });
  const visibleIncomingFriendRequests = incomingFriendRequests.filter((r) => !blockedUids.has(r.fromUid));
  const visibleUserSearchResults = userSearchResults.filter((r) => !blockedUids.has(r.uid));
  const visibleCircleMessages = activeCircleMessages.filter((m) => !blockedUids.has(m.fromUid));

  return {
    ...social,
    ...push,
    // chat cards
    sendRecordingToChat,
    playChatRecording,
    activeRecordingRequest,
    startRecordingForRequest,
    cancelRecordingRequest,
    loadFriendQuizVerses,
    activeQuiz,
    openQuiz,
    finishQuiz,
    closeQuiz,
    // static reference data
    BOOKS,

    // core state
    verses, setVerses,
    memoryQueue, memoryQueueRef, setMemoryQueue, updateMemoryQueue, countRangeProgress,
    primingLookahead, setPrimingLookahead,
    cognitiveLoadSensitivity, setCognitiveLoadSensitivity,
    selectedAddBook, setSelectedAddBook,
    selectedAddChapter, setSelectedAddChapter,
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
    studioPlaybackEnabled, setStudioPlaybackEnabled,
    studioAbOverride, setStudioAbOverride,
    audioCache, cacheRecordingAudio, setListenModePlaying,
    downloadingRecordingIds, saveRecordingOffline, removeRecordingDownload, saveChapterOffline,
    setAudioCacheCap, clearAudioDownloads,
    isEditingSync, setIsEditingSync,
    // Rhythm: read these freely, but write through updateRhythm so the
    // change persists. The raw setters stay exported for the load path and
    // the layout lab's mock state only.
    updateRhythm,
    learningDays, setLearningDays,
    newVersesPace, setNewVersesPace,
    maxReviewCap, setMaxReviewCap,
    retentionRigor, setRetentionRigor,
    dailyPhaseWeeks, setDailyPhaseWeeks,
    weeklyPhaseMonths, setWeeklyPhaseMonths,
    monthlyPhaseYears, setMonthlyPhaseYears,
    activeModal, setActiveModal,
    modalVerses, setModalVerses,
    threadDrillPreset, setThreadDrillPreset,
    openThreadDrill,
    guidedPassageKey, setGuidedPassageKey,
    openGuided,
    setGuidedSetAside,
    pullVerseIntoLearning,
    creditGuided,
    isRecording, setIsRecording,
    isRecordingPaused,
    recordingSeconds, setRecordingSeconds,
    lastRecordingDuration,
    verseTapTimestamps,
    recordingBook, setRecordingBook,
    recordingChapter, setRecordingChapter,
    recordingTranslation, setRecordingTranslation,
    recordingChapterVerses,
    recordingRangeStart, setRecordingRangeStart,
    recordingRangeEnd, setRecordingRangeEnd,
    recordingSelectedVerses,
    isRecordingFullChapterRange,
    selectedRecordingChapterTextData,
    userRecordings, setUserRecordings,
    chapterPhotos,
    photoCache,
    photosForChapter,
    saveRecordingDialog, setSaveRecordingDialog,
    pendingRecordingSource,
    defaultRecordingVisibility,
    updateDefaultRecordingVisibility,
    memoryQueueVisibility,
    updateMemoryQueueVisibility,
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
    feedRecordings: visibleFeedRecordings, setFeedRecordings, loadingFeedRecordings, loadSharedRecordings, saveSharedRecordingToLibrary,
    audioSearchQuery, setAudioSearchQuery,
    activeFeedFilter, setActiveFeedFilter,
    feedBookFilter, setFeedBookFilter,
    feedChapterFilter, setFeedChapterFilter,
    feedTranslationFilter, setFeedTranslationFilter,
    selectedChapterAudios, setSelectedChapterAudios,
    showAudioSelector, setShowAudioSelector,
    toastMessage, setToastMessage,
    masteryTouches, setMasteryTouches,
    reviewsRequired, setReviewsRequired,
    sabbathEnabled, setSabbathEnabled,
    sabbathDay, setSabbathDay,
    dayStartHour, setDayStartHour,
    missPolicy, setMissPolicy,
    missPolicyAskEveryTime, setMissPolicyAskEveryTime,
    graceCount, setGraceCount,
    refresherDailyDays, setRefresherDailyDays,
    refresherWeeklyWeeks, setRefresherWeeklyWeeks,
    pausedAt, setPausedAt,
    pausedUntil, setPausedUntil,
    reviewsPaused,
    pauseReviews, resumeReviews,
    missedReviewQueue,
    showMissedReviewPrompt, setShowMissedReviewPrompt,
    resolveMissedReviewChoice,
    joinedGroupPlanMemberships,
    joinedGroupPlanDetails,
    viewingGroupPlan, setViewingGroupPlan,
    viewingGroupDetail, setViewingGroupDetail,
    myCircles, loadingMyCircles,
    publicCircles, loadingPublicCircles,
    activeCircle, activeCircleMembers, activeCircleGroupPlans, loadingActiveCircle,
    circleFriends, loadCircleFriends,
    activityEvents: visibleActivityEvents, loadingActivityEvents, loadActivityFeed,
    friends, loadingFriends, loadFriends,
    incomingFriendRequests: visibleIncomingFriendRequests, outgoingFriendRequests, loadFriendRequests,
    userSearchQuery, setUserSearchQuery, userSearchResults: visibleUserSearchResults, searchingUsers, searchUsers,
    sendFriendRequest, acceptFriendRequest, declineFriendRequest, cancelFriendRequest, removeFriend,
    accountabilityDailyCap, updateAccountabilityDailyCap,
    receivedAccountabilityNudges, loadingAccountabilityNudges, loadReceivedAccountabilityNudges,
    canSendAccountabilityNudge, sendAccountabilityNudge, markAccountabilityNudgeRead, dismissAccountabilityNudge,
    dmThreads: visibleDmThreads, loadingDmThreads, activeDMThread, activeDMMessages, loadingActiveDMMessages,
    activeDMThreadActive: activeDMThreadActive && !blockedUids.has(activeDMThread?.otherUid ?? ''),
    openDMThread, closeDMThread, sendDMMessage, postChatMessage,
    activeCircleChatId, activeCircleMessages: visibleCircleMessages, loadingActiveCircleMessages,
    openCircleChat, closeCircleChat, sendCircleMessage,
    reactionsByMessageId, toggleReaction,
    activeChallenges, loadingActiveChallenges, myChallengeBadges,
    sendChallenge, acceptChallenge, declineChallenge, deleteChallenge,
    activeCircleChallenges, loadingActiveCircleChallenges, joinedGroupChallenges,
    createGroupChallenge, joinGroupChallenge, endGroupChallenge,
    deleteGroupChallenge, leaveGroupChallenge,
    openChallengeLeaderboardId, openChallengeLeaderboard, loadingChallengeLeaderboard,
    openChallengeLeaderboardModal, closeChallengeLeaderboard, clearGroupChallengeMembershipsForCircle,
    selectedRecording, setSelectedRecording,
    communitySubView, setCommunitySubView,
    activeGroupId,
    previewCircle, openCirclePreview, closeCirclePreview,
    isEditingCircleSettings, setIsEditingCircleSettings,
    showCreatePlanForm, setShowCreatePlanForm,
    newPlanName, setNewPlanName,
    newPlanDesc, setNewPlanDesc,
    findSearchQuery, setFindSearchQuery,
    inviteCodeInput, setInviteCodeInput,
    createGroupName, setCreateGroupName,
    createGroupDesc, setCreateGroupDesc,
    createGroupPrivacy, setCreateGroupPrivacy,
    playingRecordingId, setPlayingRecordingId,
    playingRecProgress, setPlayingRecProgress,
    nowPlayingRecording,
    seekRecordingBy,
    seekRecordingToTime,
    selectedUserProfile, setSelectedUserProfile,
    customPlanName, setCustomPlanName,
    savedPlans, setSavedPlans,
    editingPlanId, setEditingPlanId,

    // navigation
    navigateTo,
    handleBack,
    versePageRef, setVersePageRef,
    openVersePage,
    selectTab,
    viewMemberProfileById,

    // auth
    signOut,
    updateDisplayName,
    deleteAccount,

    // first-run onboarding
    showOnboarding, setShowOnboarding,
    showTour, setShowTour,
    dismissOnboarding,

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
    createGroupPlan,
    updateGroupPlan,
    addVersesToGroupPlan,
    deleteGroupPlan,
    joinGroupPlan,
    getNextPullPreview,
    removeQueueItems,
    leaveGroupPlan,
    setGroupPlanPriority,
    clearGroupPlanMembershipsForCircle,

    // Review Settings handlers (your own saved presets -- not shareable, and a
    // separate concept from Group Plans)
    handleActivatePlan,
    handleDeletePlan,
    handleEditPlan,
    openActivePlanDesigner,
    isEditingBuiltInPlan,
    handleCreateNewPlan,
    handleSavePlan,
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
    addVerseRangeToQueue,
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
    updateRecordingSpeaker,
    reorderChapterRecordings,
    addChapterPhoto,
    deleteChapterPhoto,
    setChapterPhotoVerseRange,
    reorderChapterPhotos,
    cacheChapterPhoto,
    buildVerseTimestamps,
  };
}

export type AppState = ReturnType<typeof useAppState>;
