import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { hasPlayableAudio, resolvePlaybackUrl } from '../lib/studioAudio';
import { onAuthStateChanged } from 'firebase/auth';
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';

import { auth, db, storage, handleFirestoreError, OperationType } from '../firebase';
import { pendingSignUpDisplayName } from './useEmailAuth';
import {
  BOOKS,
  BUILT_IN_PLAN_ID,
  DEFAULT_PLANS,
  DEFAULT_RHYTHM,
  DEFAULT_TRANSLATION_ID,
  getBookByName,
  pickerTranslationsFor,
  SUGGESTED_FEED_RECORDINGS,
} from '../data';
import { useChapterText } from './useScripture';
import {
  GroupChallengeMembership,
  MemoryPlan,
  QueueItem,
  Recording,
  Rhythm,
  GroupPlanMembership,
  ReviewLog,
  VerseState,
  VerseTimestamp,
} from '../types';
import { getMemoryCalendarProjection } from '../lib/reviewCalendar';
import { formatDuration } from '../lib/format';
import { useSocial } from './useSocial';
import { useLocalPrefs } from './useLocalPrefs';
import { useChapterPhotos } from './useChapterPhotos';
import { useChapterSections } from './useChapterSections';
import { useTakeaways } from './useTakeaways';
import { useVerseLinks } from './useVerseLinks';
import { useMapLayout } from './useMapLayout';
import { useCircleTakeaways } from './useCircleTakeaways';
import { useCircleTotals } from './useCircleTotals';
import { isStop, nextAsk, sectionStatuses, takeawayId } from '../lib/takeaways';
import type { TakeawayDraft } from '../lib/sectionDrills';
import { useAudioDownloads } from './useAudioDownloads';
import { useAccountabilityNudges } from './useAccountabilityNudges';
import { useRecorder } from './useRecorder';
import { useImportAudio } from './useImportAudio';
import { useChatCards } from './useChatCards';
import { useFriends } from './useFriends';
import { useMessaging } from './useMessaging';
import { useChallenges } from './useChallenges';
import { useCircles } from './useCircles';
import { useGroupPlans } from './useGroupPlans';
import { useAccount } from './useAccount';
import { useReviewEngine } from './useReviewEngine';
import { usePracticeSession } from './usePracticeSession';
import { usePlanSettings } from './usePlanSettings';
import { countRangeProgress } from '../lib/verseRange';
import { buildVerseTimestamps } from '../lib/verseTimestamps';
import { cacheLoadingVerses } from '../lib/loadingVerses';
import { showToast } from '../lib/toastStore';
import { PushTarget, ReminderDay, usePushNotifications } from './usePushNotifications';
import * as Linking from 'expo-linking';
import { parseInviteCode } from '../lib/invites';
import {
  buildVerseId,
  JOINED_GROUP_PLANS_FIELD,
  mapQueueItemsToVerseStates,
  normalizeAdoptedPlan,
  resolveChapterAudio,
  stripUndefined,
} from '../lib/appData';
import { getLogicalDate, localDayKey } from '../lib/logicalDate';
import { isReviewLog } from '../lib/circleTotals';
import { computeMissedCycles } from '../lib/missPolicy';
import { isReviewDue } from '../lib/retention';

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
  | 'mixedReview'
  | 'takeaways'
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
  'mixedReview',
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
  'takeaways',
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
  // Whose queue has finished loading from Firestore (circle stats wait for it).
  const [queueLoadedUid, setQueueLoadedUid] = useState<string | null>(null);
  const [primingLookahead, setPrimingLookahead] = useState<number>(30);
  // Review Settings (retention plan) and Rhythm (your pace) -- see usePlanSettings.
  const plan = usePlanSettings({
    navigateTo: (...args) => navigateTo(...args),
    triggerToast: (...args) => triggerToast(...args),
  });
  const {
    cognitiveLoadSensitivity,
    setCognitiveLoadSensitivity,
    learningDays,
    setLearningDays,
    newVersesPace,
    setNewVersesPace,
    maxReviewCap,
    setMaxReviewCap,
    retentionRigor,
    setRetentionRigor,
    dailyPhaseWeeks,
    setDailyPhaseWeeks,
    weeklyPhaseMonths,
    setWeeklyPhaseMonths,
    monthlyPhaseYears,
    setMonthlyPhaseYears,
    masteryTouches,
    setMasteryTouches,
    reviewsRequired,
    setReviewsRequired,
    sabbathEnabled,
    setSabbathEnabled,
    sabbathDay,
    setSabbathDay,
    dayStartHour,
    setDayStartHour,
    missPolicy,
    setMissPolicy,
    missPolicyAskEveryTime,
    setMissPolicyAskEveryTime,
    graceCount,
    setGraceCount,
    refresherDailyDays,
    setRefresherDailyDays,
    refresherWeeklyWeeks,
    setRefresherWeeklyWeeks,
    pausedAt,
    setPausedAt,
    pausedUntil,
    setPausedUntil,
    reviewsPaused,
    customPlanName,
    setCustomPlanName,
    savedPlans,
    setSavedPlans,
    editingPlanId,
    setEditingPlanId,
    syncDesignerFromPlan,
    planTopLevelFields,
    updateRhythm,
    handleActivatePlan,
    handleDeletePlan,
    handleEditPlan,
    openActivePlanDesigner,
    handleCreateNewPlan,
    isEditingBuiltInPlan,
    handleSavePlan,
    pauseReviews,
    resumeReviews,
  } = plan;

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
    listenPlaylists,
    saveListenPlaylist,
    deleteListenPlaylist,
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

  // The user's own sections per chapter (see useChapterSections).
  const { chapterSections, loadChapterSections, sectionsForChapter, saveChapterSections, saveOutlineExtra } = useChapterSections({ user });

  // The user's takeaways, one per section (see useTakeaways), and the ask that is due now.
  const {
    takeaways,
    loadTakeaways,
    saveTakeaway,
    deleteTakeaway,
    lastShareChoice,
    setLastShareChoice,
    unshareFromCircle,
    removeAllSharedTakeaways,
  } = useTakeaways({ user });
  // The constellation map: the user's own lines between verses, and where the
  // stars settled (see useVerseLinks / useMapLayout, CONSTELLATION_PLAN.md).
  const { verseLinks, loadVerseLinks, addVerseLink, relabelVerseLink, deleteVerseLink } = useVerseLinks({ user });
  const { mapLayout, loadMapLayout, saveMapLayout } = useMapLayout({ user });
  // Takeaways shared with the user's circles, and their replies (see useCircleTakeaways).
  const {
    circleTakeaways,
    takeawayReplies,
    loadCircleTakeaways,
    watchTakeawayReplies,
    postTakeawayReply,
    deleteTakeawayReply,
    seedCircleTakeaways,
  } = useCircleTakeaways({ user, triggerToast: (message) => triggerToast(message) });
  // Teach-It's "Save as takeaway draft": a draft fills in the ask when the section is ready.
  // A section that already has a takeaway or a "Later" stop keeps it (false).
  const saveTakeawayDraft = (d: TakeawayDraft): boolean => {
    const existing = takeaways[takeawayId(d.book, d.chapter, d.sectionStart)];
    if (existing && isStop(existing)) return false;
    void saveTakeaway({ book: d.book, chapter: d.chapter, sectionStart: d.sectionStart, sectionEnd: d.sectionEnd, label: d.label }, { text: d.text, status: 'draft' });
    return true;
  };
  const nextTakeawayAsk = useMemo(
    () => nextAsk(sectionStatuses(memoryQueue, sectionsForChapter), takeaways),
    // sectionsForChapter is remade each render; chapterSections is what it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memoryQueue, chapterSections, takeaways]
  );

  // Whether RecordingDetailScreen's verse-sync timeline is in edit mode.
  // The draft marker positions themselves live as local component state in
  // that screen (derived fresh from selectedRecording.verseTimestamps each
  // time it's opened) rather than here, since they're pure editing-session
  // scratch state with no reason to survive a navigation away and back.
  const [isEditingSync, setIsEditingSync] = useState<boolean>(false);

  // The practice overlay, chained review sessions and study time (see usePracticeSession).
  const {
    activeModal,
    setActiveModal,
    modalVerses,
    setModalVerses,
    listenSource,
    practiceLearnTab,
    threadDrillPreset,
    setThreadDrillPreset,
    guidedPassageKey,
    setGuidedPassageKey,
    totalStudySeconds,
    setTotalStudySeconds,
    studySessionStartRef,
    reviewSessionPosition,
    reviewSessionTotal,
    openThreadDrill,
    openGuided,
    openMixedReview,
    startPractice,
    startReviewSession,
    advanceReviewSession,
    abortReviewSession,
  } = usePracticeSession({
    navigateTo: (...args) => navigateTo(...args),
  });

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

  // The optional tour, reachable from Settings at any time and never started
  // automatically. Deliberately separate from setup: setup configures, the
  // tour explains. true runs the tour cards over the real app; 'questions' opens Common
  // questions, which the tour's last card and Settings both link to.
  const [showTour, setShowTour] = useState<boolean | 'questions'>(false);

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

  // Group plans: the open circle's and the ones I've joined (see useGroupPlans).
  const {
    joinedGroupPlanMemberships,
    joinedGroupPlanDetails,
    viewingGroupPlan,
    setViewingGroupPlan,
    activeCircleGroupPlans,
    applyCircleGroupPlans,
    loadJoinedGroupPlans,
    resetGroupPlans,
    createGroupPlan,
    updateGroupPlan,
    addVersesToGroupPlan,
    deleteGroupPlan,
    joinGroupPlan,
    leaveGroupPlan,
    setGroupPlanPriority,
    clearGroupPlanMembershipsForCircle,
  } = useGroupPlans({
    user,
    getQueue: () => memoryQueueRef.current,
    updateMemoryQueue: (updater) => updateMemoryQueue(updater),
    removeQueueItems: (verseIds) => removeQueueItems(verseIds),
    triggerToast: (message) => triggerToast(message),
  });

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

  // Circles, the activity feed and the Community tab's navigation (see useCircles).
  const {
    myCircles,
    loadingMyCircles,
    publicCircles,
    loadingPublicCircles,
    activeCircle,
    activeCircleMembers,
    loadingActiveCircle,
    circleFriends,
    activityEvents,
    loadingActivityEvents,
    viewingGroupDetail,
    setViewingGroupDetail,
    communitySubView,
    setCommunitySubView,
    activeGroupId,
    previewCircle,
    openCirclePreview,
    closeCirclePreview,
    inviteCodeInput,
    setInviteCodeInput,
    loadMyCircles,
    loadCircleFriends,
    loadActivityFeed,
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
    resetActiveCircle,
    resetMyCircles,
  } = useCircles({
    user,
    friends,
    applyCircleGroupPlans,
    setActiveCircleChallenges: (value) => setActiveCircleChallenges(value),
    setLoadingActiveCircleChallenges: (loading) => setLoadingActiveCircleChallenges(loading),
    triggerToast: (message) => triggerToast(message),
  });

  // Whether this user's queue has come back from Firestore yet. The loading
  // screen waits on it too, so Home never opens empty and then fills in.
  const queueReady = !!user?.uid && queueLoadedUid === user.uid;

  // This week's reviews and verses held, written into each of the user's
  // circles and added up on the circle page (see useCircleTotals).
  const { circleStats, loadCircleStats, removeMyCircleStats, seedCircleStats } = useCircleTotals({
    user,
    memoryQueue,
    queueReady,
    circleIds: myCircles.map((c) => c.id),
    dayStartHour,
  });

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
  // Each verse as it was last written to (or read from) Firestore, as JSON.
  // The auto-sync writes only the verses that differ from it: it used to
  // rewrite every verse on every change, so one review on a 700-verse list
  // uploaded all 700. Reset alongside prevSyncedQueueIdsRef.
  const syncedQueueJsonRef = useRef<Map<string, string>>(new Map());
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
  // The message lives in its own small store (lib/toastStore), so showing
  // one redraws only the toast, not the whole open screen.
  const triggerToast = (msg: string) => showToast(msg);

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
      // The four reads opening the app waits on go out together: each one
      // waiting for the last made a slow network four round trips slower.
      // They're still handled in the same order below. A failed read comes
      // back undefined, as before, so it never stops the others.
      const profileRef = doc(db, 'profiles', currentUser.uid);
      const planRef = doc(db, 'memoryPlans', currentUser.uid);
      const versesCol = collection(db, 'users', currentUser.uid, 'verses');
      const queueCol = collection(db, 'users', currentUser.uid, 'memoryQueue');
      const settle = <T,>(p: Promise<T>, path: string) =>
        p.catch((e) => {
          handleFirestoreError(e, OperationType.GET, path);
          return undefined;
        });
      const [profileSnap, planSnap, vSnap, qSnap] = await Promise.all([
        settle(getDoc(profileRef), `profiles/${currentUser.uid}`),
        settle(getDoc(planRef), `memoryPlans/${currentUser.uid}`),
        settle(getDocs(versesCol), `users/${currentUser.uid}/verses`),
        settle(getDocs(queueCol), `users/${currentUser.uid}/memoryQueue`),
      ]);
      console.log('User data fetched. Verses:', vSnap?.size, 'Queue:', qSnap?.size);

      // 1. Profile

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
        // Re-checked inside a transaction (which always reads the server)
        // before writing: right after an install the first read has come
        // back "missing" for a profile that exists, and the old plain
        // setDoc then wiped it -- circleIds, settings, study time and all.
        console.log('Creating new profile...');
        try {
          const created = await runTransaction(db, async (tx) => {
            const fresh = await tx.get(profileRef);
            if (fresh.exists()) return false;
            tx.set(profileRef, newProfile);
            return true;
          });
          console.log(created ? 'Profile created successfully.' : 'Profile already existed; left untouched.');
          // Brand-new account, never seen the Getting Started checklist.
          if (created) setShowOnboarding(true);
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, `profiles/${currentUser.uid}`);
        }
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
      let groupPlansLoad: Promise<void> = Promise.resolve();

      // 2. Memory Plan
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
        // Not waited on here: the verses below don't need the plans, and
        // the loading screen shouldn't wait on another round trip for them.
        const memberships: GroupPlanMembership[] = planData[JOINED_GROUP_PLANS_FIELD] || [];
        groupPlansLoad = loadJoinedGroupPlans(memberships);

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
      if (qSnap) setQueueLoadedUid(currentUser.uid);

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
        syncedQueueJsonRef.current = new Map();
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
            ...(data.guidedShakyJoin === true ? { guidedShakyJoin: true as const } : {}),
          });
        });
        loadedQueue.sort((a, b) => a.orderIndex - b.orderIndex);
        updateMemoryQueue(() => loadedQueue);
        cacheLoadingVerses(loadedQueue);
        // Baseline for the auto-sync's deletion diffing: what's in Firestore
        // right now is by definition already synced.
        prevSyncedQueueIdsRef.current = new Set(loadedQueue.map((i) => i.verseId));
        syncedQueueJsonRef.current = new Map(loadedQueue.map((i) => [i.verseId, JSON.stringify(i)]));

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

      // 4-7. Saved recordings, Bible page photos, chapter sections and
      // takeaways (all private to this user), fetched together. Each catches
      // its own errors.
      const loadRecordings = async () => {
        try {
          const recordingsSnap = await getDocs(
            query(collection(db, 'users', currentUser.uid, 'recordings'), orderBy('createdAt', 'desc'))
          );
          setUserRecordings(recordingsSnap.docs.map((docSnap) => docSnap.data() as Recording));
        } catch (e) {
          handleFirestoreError(e, OperationType.GET, `users/${currentUser.uid}/recordings`);
        }
      };
      await Promise.all([
        groupPlansLoad,
        loadRecordings(),
        loadChapterPhotos(currentUser.uid),
        loadChapterSections(currentUser.uid),
        loadTakeaways(currentUser.uid),
        loadVerseLinks(currentUser.uid),
        loadMapLayout(currentUser.uid),
      ]);

      triggerToast('Cloud profile and scripture data synchronized!');
    } catch (err) {
      console.error('Error in loadUserData master catch block:', err);
      triggerToast('Could not sync with Cloud storage.');
    }
  };

  // The saved translation choices are restored before sign-in is known, so
  // they accept any registry translation. Once the account is known, one it
  // isn't offered (an unreleased translation, outside the testers) falls back
  // to the default. Saved verses in it are untouched.
  useEffect(() => {
    if (loadingAuth) return;
    const allowed = pickerTranslationsFor(user?.uid);
    if (!allowed.some((t) => t.id === selectedTranslationId)) setSelectedTranslationId(DEFAULT_TRANSLATION_ID);
    if (!allowed.some((t) => t.id === recordingTranslation)) setRecordingTranslation(DEFAULT_TRANSLATION_ID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingAuth, user?.uid, selectedTranslationId, recordingTranslation]);

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
      resetActiveCircle();
      resetGroupPlans();
      resetGroupChallenges();

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
      syncedQueueJsonRef.current = new Map();
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
        resetMyCircles();
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

  // Profile settings, sign-out and account deletion (see useAccount).
  const {
    defaultRecordingVisibility,
    setDefaultRecordingVisibility,
    memoryQueueVisibility,
    setMemoryQueueVisibility,
    showOnboarding,
    setShowOnboarding,
    signOut,
    updateDisplayName,
    updateDefaultRecordingVisibility,
    writeSharedQueueSnapshot,
    updateMemoryQueueVisibility,
    dismissOnboarding,
    deleteAccount,
  } = useAccount({
    setUser,
    myCircles,
    memoryQueueRef,
    wipeAudioCache,
    wipeLocalPhotos,
    unregisterPushToken: () => push.unregisterPushToken(),
    // The circle stats docs ride along with the shared takeaways (both need membership to clean up).
    removeAllSharedTakeaways: async () => {
      await Promise.all(myCircles.map((c) => removeMyCircleStats(c.id)));
      await removeAllSharedTakeaways();
    },
    triggerToast,
  });

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

      // Only the verses that changed since they were last written or read.
      // A verse whose write fails keeps its old JSON here, so the next sync
      // tries it again.
      const changed = memoryQueue
        .map((item) => ({ item, json: JSON.stringify(item) }))
        .filter(({ item, json }) => syncedQueueJsonRef.current.get(item.verseId) !== json);

      try {
        // Batches of 400 writes, well inside Firestore's per-request limits
        // even when every verse changed at once (a bulk status change).
        const ops = [
          ...changed.map(({ item }) => (b: ReturnType<typeof writeBatch>) =>
            b.set(doc(db, 'users', uid, 'memoryQueue', item.verseId), item)
          ),
          ...removedIds.map((id) => (b: ReturnType<typeof writeBatch>) => b.delete(doc(db, 'users', uid, 'memoryQueue', id))),
        ];
        for (let start = 0; start < ops.length; start += 400) {
          const batch = writeBatch(db);
          ops.slice(start, start + 400).forEach((op) => op(batch));
          await batch.commit();
        }
        changed.forEach(({ item, json }) => syncedQueueJsonRef.current.set(item.verseId, json));
        removedIds.forEach((id) => syncedQueueJsonRef.current.delete(id));
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

  // The review engine: scheduling, the daily pull, adding verses, grading (see useReviewEngine).
  const {
    missedReviewQueue,
    setMissedReviewQueue,
    showMissedReviewPrompt,
    setShowMissedReviewPrompt,
    getTodayAbbreviation,
    isTodayLearningDay,
    resolveMissedReviewChoice,
    validateTouch,
    getEstimatedReviewTime,
    getMemoryLoadForecast,
    triggerDailyPull,
    removeQueueItems,
    getNextPullPreview,
    promoteToLearning,
    fetchRangeVerses,
    addVersesToQueue,
    addVerseRangeToQueue,
    overrideVerseMemoryStatus,
    handleReviewCompleted,
    triggerMockDueReviews,
    handleUpdateVerseStatus,
    setGuidedSetAside,
    setGuidedShakyJoins,
    pullVerseIntoLearning,
    creditGuided,
  } = useReviewEngine({
    plan,
    memoryQueue,
    memoryQueueRef,
    updateMemoryQueue,
    pendingQueueDeletionsRef,
    joinedGroupPlanMemberships,
    joinedGroupPlanDetails,
    syncChallengeProgress,
    selectedTranslationId,
    verses,
    setVerses,
    triggerToast,
  });

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

  // Spaced reviews per day, for the heatmap and the streak. They come from
  // reviewLogs (isReviewLog skips Learning entries, which touchLogs already
  // counts), kept apart from activityByDay so the heatmap can show each.
  const reviewsByDay = new Map<string, number>();
  memoryQueue.forEach((item) => {
    (item.reviewLogs || []).forEach((log) => {
      if (!isReviewLog(log)) return;
      const at = new Date(log.at);
      if (Number.isNaN(at.getTime())) return;
      const day = localDayKey(getLogicalDate(dayStartHour, at));
      reviewsByDay.set(day, (reviewsByDay.get(day) || 0) + 1);
    });
  });

  // Shared by the 15-day grid (ProfileScreen) and the Dashboard's bigger
  // 90-day heatmap -- same window construction, just a different length.
  // `count` is everything the heatmap shades: Learning practice plus reviews.
  const buildActivityWindow = (days: number) =>
    Array.from({ length: days }, (_, i) => {
      const d = getLogicalDate(dayStartHour);
      d.setDate(d.getDate() - (days - 1 - i));
      const key = localDayKey(d);
      const practice = activityByDay.get(key) || 0;
      const reviews = reviewsByDay.get(key) || 0;
      return {
        day: d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
        weekday: d.getDay(),
        month: d.getMonth(),
        practice,
        reviews,
        count: practice + reviews,
      };
    });

  const activityLast15Days = buildActivityWindow(15);
  const activityLast90Days = buildActivityWindow(90);

  // Consecutive days of practice or spaced review counting back from today;
  // 0 for a new/idle account.
  const memoryStreak = (() => {
    let streak = 0;
    const d = getLogicalDate(dayStartHour);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const key = localDayKey(d);
      if ((activityByDay.get(key) || 0) + (reviewsByDay.get(key) || 0) > 0) {
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
    isChatRecordingSaved,
    saveChatRecording,
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
    setRecordingPassage: (book, chapter, startVerse, endVerse, translationId) => {
      setRecordingBook(book);
      setRecordingChapter(chapter);
      setRecordingRangeStart(startVerse);
      setRecordingRangeEnd(endVerse);
      if (translationId && pickerTranslationsFor(user?.uid).some((t) => t.id === translationId)) setRecordingTranslation(translationId);
    },
    saveSharedRecordingToLibrary: (rec) => saveSharedRecordingToLibrary(rec),
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
    // A "Save to My Library" copy points at the original owner's files and
    // shared copy — deleting it only drops the saver's own doc.
    const ownsAudio = !recording.savedFromRecordingId && (recording.audioPath ?? '').startsWith(`recordings/${uid}/`);
    try {
      if (ownsAudio) {
        // The shared copy is what circles, chats and the Community feed read;
        // leaving it meant a deleted recording stayed public forever.
        // Best-effort: private recordings have none (the delete is denied).
        await deleteDoc(doc(db, 'sharedRecordings', recording.id)).catch(() => {});
      }
      await deleteDoc(doc(db, 'users', uid, 'recordings', recording.id));
      // Files are best-effort too: the cleanUpDeletedRecording function
      // removes anything left under this id once the doc is gone, including a
      // studio render that landed after this recording was loaded.
      if (ownsAudio && recording.audioPath) {
        await deleteObject(storageRef(storage, recording.audioPath)).catch((err) =>
          console.error('Failed to delete audio file:', err)
        );
      }
      if (ownsAudio && recording.studioAudioPath) {
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
    isChatRecordingSaved,
    saveChatRecording,
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
    queueReady,
    currentTab, setCurrentTab,
    currentScreen, setCurrentScreen,
    selectedBook, setSelectedBook,
    selectedChapter, setSelectedChapter,
    backHistory, setBackHistory,
    selectedVerseNumbers, setSelectedVerseNumbers,
    chapterViewMode, setChapterViewMode,
    highlightedVerses, toggleVerseHighlight,
    verseDoodles, saveVerseDoodle,
    listenPlaylists, saveListenPlaylist, deleteListenPlaylist,
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
    modalVerses, setModalVerses, listenSource, practiceLearnTab,
    threadDrillPreset, setThreadDrillPreset,
    openThreadDrill,
    guidedPassageKey, setGuidedPassageKey,
    openGuided,
    openMixedReview,
    setGuidedSetAside,
    setGuidedShakyJoins,
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
    // Takes the user's shared takeaways and weekly stats out of the circle
    // first, while still a member (see useTakeaways.unshareFromCircle).
    leaveCircle: async (circleId: string) => {
      await unshareFromCircle(circleId);
      await removeMyCircleStats(circleId);
      await leaveCircle(circleId);
    },
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
    chapterSections,
    sectionsForChapter,
    saveChapterSections,
    saveOutlineExtra,
    takeaways,
    saveTakeaway,
    deleteTakeaway,
    saveTakeawayDraft,
    nextTakeawayAsk,
    lastShareChoice,
    setLastShareChoice,
    circleTakeaways,
    takeawayReplies,
    loadCircleTakeaways,
    watchTakeawayReplies,
    postTakeawayReply,
    deleteTakeawayReply,
    seedCircleTakeaways,
    circleStats,
    loadCircleStats,
    seedCircleStats,
    buildVerseTimestamps,
    verseLinks,
    addVerseLink,
    relabelVerseLink,
    deleteVerseLink,
    mapLayout,
    saveMapLayout,
  };
}

export type AppState = ReturnType<typeof useAppState>;
