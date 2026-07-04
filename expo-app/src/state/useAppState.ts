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
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
} from 'expo-audio';

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
  Circle,
  CircleMember,
  GroupPlan,
  MemoryPlan,
  QueueItem,
  Recording,
  TouchLog,
  VerseState,
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
  | 'recordingDetail';

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

  // Verse audio-sync offset editor states
  const [isEditingSync, setIsEditingSync] = useState<boolean>(false);
  const [recSyncOffsets, setRecSyncOffsets] = useState<Array<{ verse: number; start: string; end: string }>>([
    { verse: 1, start: '0:00', end: '0:08' },
    { verse: 2, start: '0:08', end: '0:15' },
    { verse: 3, start: '0:15', end: '0:22' },
    { verse: 4, start: '0:22', end: '0:30' },
    { verse: 5, start: '0:30', end: '0:38' },
  ]);

  // Memory Plan Designer States
  const [preset, setPreset] = useState<'drip' | 'warrior' | 'custom'>('custom');
  const [learningDays, setLearningDays] = useState<string[]>(['M', 'W', 'F']);
  const [reviewingDays, setReviewingDays] = useState<string[]>(['M', 'T', 'W', 'Th', 'F', 'S', 'Su']);
  const [primingDays, setPrimingDays] = useState<string[]>(['T', 'Th', 'S']);
  const [newVersesPace, setNewVersesPace] = useState<number>(3);
  const [maxReviewCap, setMaxReviewCap] = useState<number>(15);

  // Practice Overlays
  const [activeModal, setActiveModal] = useState<'listen' | 'type' | 'reveal' | null>(null);
  const [modalVerses, setModalVerses] = useState<VerseState[]>([]);

  // Teleprompter / Recording State (fully simulated — no real microphone capture in the web original)
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingBook, setRecordingBook] = useState('Romans');
  const [recordingChapter, setRecordingChapter] = useState(8);
  const [recordingTranslation, setRecordingTranslation] = useState('ESV');
  const [userRecordings, setUserRecordings] = useState<Recording[]>(INITIAL_RECORDINGS);
  const [saveRecordingDialog, setSaveRecordingDialog] = useState(false);
  const [typedRecordingName, setTypedRecordingName] = useState('');

  // Suggested Feed Recordings, Search & Filters
  const [feedRecordings, setFeedRecordings] = useState<Recording[]>(SUGGESTED_FEED_RECORDINGS);
  const [audioSearchQuery, setAudioSearchQuery] = useState('');
  const [activeFeedFilter, setActiveFeedFilter] = useState<'global' | 'group' | 'friends'>('global');
  const [feedBookFilter, setFeedBookFilter] = useState<string>('');
  const [feedChapterFilter, setFeedChapterFilter] = useState<string>('');

  // Audio Selection mapping for specific chapters
  const [selectedChapterAudios, setSelectedChapterAudios] = useState<Record<string, Recording | null>>({});
  const [showAudioSelector, setShowAudioSelector] = useState(false);

  // Audio Playback Simulation in Chapter Landing Card
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioPlaybackProgress, setAudioPlaybackProgress] = useState(0);
  const audioTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // General App Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // 3-Touch Mastery & Group Plan States
  const [masteryTouches, setMasteryTouches] = useState<number>(3);
  const [reviewsRequired, setReviewsRequired] = useState<number>(1);
  const [activeGroupPlan, setActiveGroupPlan] = useState<GroupPlan | null>(null);
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

  // Real audio recorder (mic capture) for the Record tab
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // Real audio player for saved recordings that have a Storage-backed audioUrl.
  // Recordings without one (e.g. the illustrative community feed placeholders)
  // fall back to the simulated progress timer below.
  const nowPlayingRecording = [...userRecordings, ...feedRecordings].find((r) => r.id === playingRecordingId) || null;
  const recordingPlayer = useAudioPlayer(nowPlayingRecording?.audioUrl ?? undefined);
  const recordingPlayerStatus = useAudioPlayerStatus(recordingPlayer);

  // Memory Queue auto-sync bookkeeping (debounce timer + last-synced verseIds, for deletion diffing)
  const queueSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSyncedQueueIdsRef = useRef<Set<string>>(new Set());

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
        setPreset(active.preset);
        setLearningDays(active.learningDays);
        setReviewingDays(active.reviewingDays);
        setPrimingDays(active.primingDays);
        setNewVersesPace(active.newVersesPace);
        setMaxReviewCap(active.maxReviewCap);
        setCustomPlanName(active.name);
      }
    }

    setCurrentScreen(screen);
    // Reset selections on screen change
    setSelectedVerseNumbers([]);
    setAudioPlaying(false);
    setAudioPlaybackProgress(0);
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
    setAudioPlaying(false);
    setAudioPlaybackProgress(0);
  };

  // Tab controller
  const selectTab = (tab: TabName) => {
    setCurrentTab(tab);
    setAudioPlaying(false);
    setAudioPlaybackProgress(0);
    setPlayingRecordingId(null);

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
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
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
          reviewingDays: ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'],
          primingDays: ['S', 'Su'],
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
          reviewingDays: ['M', 'W', 'F'],
          primingDays: ['S'],
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
          reviewingDays: ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'],
          primingDays: ['T', 'Th', 'Su'],
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
      setPreset(plan.preset);
      setLearningDays(plan.learningDays);
      setReviewingDays(plan.reviewingDays);
      setPrimingDays(plan.primingDays);
      setNewVersesPace(plan.newVersesPace);
      setMaxReviewCap(plan.maxReviewCap);
      setCustomPlanName(plan.name || 'Custom Plan');

      if (auth.currentUser) {
        const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
        await setDoc(planRef, {
          preset: plan.preset,
          learningDays: plan.learningDays,
          reviewingDays: plan.reviewingDays,
          primingDays: plan.primingDays,
          newVersesPace: plan.newVersesPace,
          maxReviewCap: plan.maxReviewCap,
          name: plan.name || 'Custom Plan',
          updatedAt: new Date(),
        });

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
      const currentQueueIds = memoryQueue.map((item) => item.verseId);
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
            orderIndex: memoryQueue.length + newItems.length,
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
      // effect (added last session) picks up this setMemoryQueue and
      // persists it (including deletion-diffing), debounced.
      setMemoryQueue((prev) => [...prev, ...newItems]);

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
      setPreset(activePlan.preset);
      setLearningDays(activePlan.learningDays);
      setReviewingDays(activePlan.reviewingDays);
      setPrimingDays(activePlan.primingDays);
      setNewVersesPace(activePlan.newVersesPace);
      setMaxReviewCap(activePlan.maxReviewCap);
      setCustomPlanName(activePlan.name);

      triggerToast(`Activated plan: "${activePlan.name}" ⚡`);

      if (auth.currentUser) {
        try {
          const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
          await setDoc(planRef, {
            savedPlans: updatedPlans,
            preset: activePlan.preset,
            learningDays: activePlan.learningDays,
            reviewingDays: activePlan.reviewingDays,
            primingDays: activePlan.primingDays,
            newVersesPace: activePlan.newVersesPace,
            maxReviewCap: activePlan.maxReviewCap,
            name: activePlan.name,
            updatedAt: new Date(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `memoryPlans/${auth.currentUser.uid}`);
        }
      }
    }
  };

  const handleEditPlan = (plan: MemoryPlan) => {
    setEditingPlanId(plan.id);
    setPreset(plan.preset);
    setLearningDays(plan.learningDays);
    setReviewingDays(plan.reviewingDays);
    setPrimingDays(plan.primingDays);
    setNewVersesPace(plan.newVersesPace);
    setMaxReviewCap(plan.maxReviewCap);
    setCustomPlanName(plan.name);
    navigateTo('planDesigner');
  };

  const handleCreateNewPlan = () => {
    setEditingPlanId(null);
    setPreset('custom');
    setLearningDays(['M', 'W', 'F']);
    setReviewingDays(['M', 'T', 'W', 'Th', 'F', 'S', 'Su']);
    setPrimingDays(['T', 'Th']);
    setNewVersesPace(3);
    setMaxReviewCap(15);
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
            reviewingDays,
            primingDays,
            newVersesPace,
            maxReviewCap,
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
        reviewingDays,
        primingDays,
        newVersesPace,
        maxReviewCap,
        isActive: true,
        updatedAt: new Date().toISOString(),
      };

      updatedPlans = updatedPlans.map((p) => ({ ...p, isActive: false }));
      updatedPlans.push(newPlan);
      triggerToast(`New plan "${customPlanName}" saved and activated! 🎯`);
    }

    const activePlan = updatedPlans.find((p) => p.isActive) || updatedPlans[0];
    if (activePlan) {
      setPreset(activePlan.preset);
      setLearningDays(activePlan.learningDays);
      setReviewingDays(activePlan.reviewingDays);
      setPrimingDays(activePlan.primingDays);
      setNewVersesPace(activePlan.newVersesPace);
      setMaxReviewCap(activePlan.maxReviewCap);
      setCustomPlanName(activePlan.name);
    }

    setSavedPlans(updatedPlans);
    setEditingPlanId(null);

    if (auth.currentUser) {
      try {
        const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
        await setDoc(planRef, {
          savedPlans: updatedPlans,
          preset: activePlan.preset,
          learningDays: activePlan.learningDays,
          reviewingDays: activePlan.reviewingDays,
          primingDays: activePlan.primingDays,
          newVersesPace: activePlan.newVersesPace,
          maxReviewCap: activePlan.maxReviewCap,
          name: activePlan.name,
          updatedAt: new Date(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `memoryPlans/${auth.currentUser.uid}`);
      }
    }

    navigateTo('savedPlans');
  };

  // Persists just the Memory Rhythm fields (learning/reviewing/priming days,
  // pace, and review cap) to whichever plan is currently selected, in place —
  // unlike handleSavePlan, this doesn't navigate away or clear editingPlanId,
  // since it's used inline on the Memory Plan & Queue screen.
  const saveActivePlanRhythm = async () => {
    const targetId = editingPlanId || savedPlans.find((p) => p.isActive)?.id || savedPlans[0]?.id;
    if (!targetId) {
      triggerToast('No memory plan found to save to.');
      return;
    }

    const updatedPlans = savedPlans.map((p) =>
      p.id === targetId
        ? { ...p, learningDays, reviewingDays, primingDays, newVersesPace, maxReviewCap, preset, updatedAt: new Date().toISOString() }
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
            reviewingDays: targetPlan.reviewingDays,
            primingDays: targetPlan.primingDays,
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
    reviewingDays?: string[];
    primingDays?: string[];
    newVersesPace?: number;
    maxReviewCap?: number;
  }) => {
    const newPlan: MemoryPlan = {
      id: 'plan-' + Date.now(),
      name: profile.planName || 'Adopted Plan',
      preset: profile.preset || 'custom',
      learningDays: profile.learningDays || ['M', 'W', 'F'],
      reviewingDays: profile.reviewingDays || ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'],
      primingDays: profile.primingDays || ['T', 'Th'],
      newVersesPace: profile.newVersesPace ?? 3,
      maxReviewCap: profile.maxReviewCap ?? 15,
      isActive: true,
      updatedAt: new Date().toISOString(),
    };

    const updatedPlans = [...savedPlans.map((p) => ({ ...p, isActive: false })), newPlan];
    setSavedPlans(updatedPlans);

    setCustomPlanName(newPlan.name);
    setPreset(newPlan.preset);
    setLearningDays(newPlan.learningDays);
    setReviewingDays(newPlan.reviewingDays);
    setPrimingDays(newPlan.primingDays);
    setNewVersesPace(newPlan.newVersesPace);
    setMaxReviewCap(newPlan.maxReviewCap);
    setEditingPlanId(newPlan.id);

    if (auth.currentUser) {
      try {
        const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
        await setDoc(planRef, {
          savedPlans: updatedPlans,
          preset: newPlan.preset,
          learningDays: newPlan.learningDays,
          reviewingDays: newPlan.reviewingDays,
          primingDays: newPlan.primingDays,
          newVersesPace: newPlan.newVersesPace,
          maxReviewCap: newPlan.maxReviewCap,
          name: newPlan.name,
          updatedAt: new Date(),
        });
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
    setAudioPlaying(false);
    setAudioPlaybackProgress(0);
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
        reviewingDays,
        primingDays,
        newVersesPace,
        maxReviewCap,
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
                reviewingDays,
                primingDays,
                newVersesPace,
                maxReviewCap,
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
            reviewingDays,
            primingDays,
            newVersesPace,
            maxReviewCap,
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
        await setDoc(planRef, {
          savedPlans: updatedPlans,
          preset: activePlan.preset,
          learningDays: activePlan.learningDays,
          reviewingDays: activePlan.reviewingDays,
          primingDays: activePlan.primingDays,
          newVersesPace: activePlan.newVersesPace,
          maxReviewCap: activePlan.maxReviewCap,
          name: activePlan.name,
          updatedAt: new Date(),
        });

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

      if (profileSnap && !profileSnap.exists()) {
        const newProfile = {
          displayName: currentUser.displayName || 'Anonymous',
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
            reviewingDays: planData.reviewingDays || ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'],
            primingDays: planData.primingDays || ['W', 'F'],
            newVersesPace: planData.newVersesPace || 3,
            maxReviewCap: planData.maxReviewCap || 15,
            isActive: true,
            updatedAt: new Date().toISOString(),
          };
          plansList = [activePlan];
        }

        setSavedPlans(plansList);

        // Find the active plan and sync current state
        const active = plansList.find((p) => p.isActive) || plansList[0];
        if (active) {
          setPreset(active.preset);
          setLearningDays(active.learningDays);
          setReviewingDays(active.reviewingDays);
          setPrimingDays(active.primingDays);
          setNewVersesPace(active.newVersesPace);
          setMaxReviewCap(active.maxReviewCap);
          setCustomPlanName(active.name);
        }
      } else {
        console.log('Creating new memory plan...');
        setSavedPlans(DEFAULT_PLANS);
        try {
          await setDoc(planRef, {
            savedPlans: DEFAULT_PLANS,
            preset: DEFAULT_PLANS[0].preset,
            learningDays: DEFAULT_PLANS[0].learningDays,
            reviewingDays: DEFAULT_PLANS[0].reviewingDays,
            primingDays: DEFAULT_PLANS[0].primingDays,
            newVersesPace: DEFAULT_PLANS[0].newVersesPace,
            maxReviewCap: DEFAULT_PLANS[0].maxReviewCap,
            name: DEFAULT_PLANS[0].name,
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
        setMemoryQueue([]);
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
          });
        });
        loadedQueue.sort((a, b) => a.orderIndex - b.orderIndex);
        setMemoryQueue(loadedQueue);
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
      setVerses([]);
      setMemoryQueue([]);
      // Same reasoning applies to saved recordings — clear synchronously so a
      // just-signed-out or just-switched-to account never briefly shows the
      // previous user's "Recorded Chapters" list.
      setUserRecordings([]);

      if (currentUser) {
        await loadUserData(currentUser);
        await loadMyCircles();
      } else {
        // Reset state to initial local data
        setVerses(INITIAL_VERSES);
        setMemoryQueue(generateInitialQueue(INITIAL_VERSES));
        setPreset('custom');
        setLearningDays(['M', 'W', 'F']);
        setReviewingDays(['M', 'T', 'W', 'Th', 'F', 'S', 'Su']);
        setPrimingDays(['T', 'Th', 'S']);
        setNewVersesPace(3);
        setMaxReviewCap(15);
        setMyCircles([]);
        setCircleFriends([]);
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

  // Recording Timer
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setRecordingSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  // Audio Playback Simulation (Chapter Landing)
  useEffect(() => {
    if (audioPlaying) {
      audioTimerRef.current = setInterval(() => {
        setAudioPlaybackProgress((prev) => {
          if (prev >= 100) {
            setAudioPlaying(false);
            triggerToast('Audio playback completed.');
            return 0;
          }
          return prev + 1.5;
        });
      }, 150);
    } else {
      if (audioTimerRef.current) clearInterval(audioTimerRef.current);
    }
    return () => {
      if (audioTimerRef.current) clearInterval(audioTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioPlaying]);

  // Saved Recording Playback — real audio (via expo-audio) for recordings with
  // a Storage-backed audioUrl; falls back to a simulated progress timer for
  // mock entries that don't have one (e.g. the illustrative community feed).
  useEffect(() => {
    if (!playingRecordingId || !nowPlayingRecording?.audioUrl) return;
    recordingPlayer.play();
    return () => {
      recordingPlayer.pause();
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

  // Memory Queue Auto-Sync: several actions (reordering, adding verses, deleting)
  // only mutate memoryQueue locally without their own explicit Firestore write.
  // Rather than remembering to add a batch write to every future mutation site,
  // mirror the queue to Firestore automatically whenever it changes (debounced),
  // including deleting documents for verses that were removed from the queue.
  useEffect(() => {
    if (!auth.currentUser) return;
    if (queueSyncTimerRef.current) clearTimeout(queueSyncTimerRef.current);

    queueSyncTimerRef.current = setTimeout(async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

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
  const getTodayAbbreviation = () => {
    const days = ['Su', 'M', 'T', 'W', 'Th', 'F', 'S'];
    return days[new Date().getDay()];
  };

  const isTodayLearningDay = () => {
    const todayAbbr = getTodayAbbreviation();
    return learningDays.includes(todayAbbr);
  };

  const validateTouch = (item: QueueItem, _type: 'speak' | 'type' | 'reveal'): boolean => {
    if (!item.touchLogs || item.touchLogs.length === 0) return true;
    const lastTouch = item.touchLogs[item.touchLogs.length - 1];
    const lastTime = new Date(lastTouch.timestamp).getTime();
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    return now - lastTime >= ONE_HOUR;
  };

  const getEstimatedReviewTime = (queue: QueueItem[], sensitivity: 'low' | 'medium' | 'high') => {
    let totalSeconds = 0;
    queue.forEach((item) => {
      const isDue = item.status === 'reviewing' && (!item.nextReviewDueDate || new Date(item.nextReviewDueDate) <= new Date());
      const isLearning = item.status === 'learning';

      if (isLearning) {
        totalSeconds += 120; // 2 minutes
      } else if (isDue) {
        if (item.retentionPhase === 'daily') totalSeconds += 30;
        else if (item.retentionPhase === 'weekly') totalSeconds += 45;
        else if (item.retentionPhase === 'monthly') totalSeconds += 60;
      }
    });

    const multiplier = sensitivity === 'low' ? 0.75 : sensitivity === 'high' ? 1.5 : 1.0;
    return Math.ceil((totalSeconds * multiplier) / 60);
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

    const updatedQueue = memoryQueue.map((item) => {
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

    setMemoryQueue(updatedQueue);

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

  const handleReviewCompleted = async (item: QueueItem, success: boolean, drillType?: 'speak' | 'type' | 'reveal') => {
    let updatedItem = { ...item };
    updatedItem.lastReviewDate = new Date().toISOString();

    if (success) {
      if (item.status === 'learning') {
        // 3-Touch Mastery Gate checks
        const inferredType = drillType || (activeModal === 'type' ? 'type' : activeModal === 'reveal' ? 'reveal' : 'speak');
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
            updatedItem.status = 'reviewing';
            updatedItem.retentionPhase = 'daily';
            updatedItem.dateStarted = new Date().toISOString();
            updatedItem.currentStreakCount = 1;
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            updatedItem.nextReviewDueDate = tomorrow.toISOString();
            updatedItem.reviewsToday = 0;
            triggerToast('Passage mastered! Transitioned to 7-6-5 spaced review. 🎉');
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
        updatedItem.currentStreakCount += 1;
        updatedItem.gracePeriodUsedToday = false;

        if (currentReviewsToday >= reviewsRequired) {
          if (item.retentionPhase === 'daily') {
            const daysInPhase = Math.floor((Date.now() - new Date(item.dateStarted!).getTime()) / (24 * 3600 * 1000));
            if (daysInPhase >= 49 || updatedItem.currentStreakCount >= 49) {
              updatedItem.retentionPhase = 'weekly';
              updatedItem.currentStreakCount = 1;
              const nextDue = new Date();
              nextDue.setDate(nextDue.getDate() + 7);
              updatedItem.nextReviewDueDate = nextDue.toISOString();
              triggerToast('Graduated to Weekly Review phase! 🌟');
            } else {
              const nextDue = new Date();
              nextDue.setDate(nextDue.getDate() + 1);
              updatedItem.nextReviewDueDate = nextDue.toISOString();
              triggerToast('Daily reviews complete! Spaced date advanced. 📅');
            }
          } else if (item.retentionPhase === 'weekly') {
            if (updatedItem.currentStreakCount >= 26) {
              updatedItem.retentionPhase = 'monthly';
              updatedItem.currentStreakCount = 1;
              const nextDue = new Date();
              nextDue.setDate(nextDue.getDate() + 30);
              updatedItem.nextReviewDueDate = nextDue.toISOString();
              triggerToast('Graduated to Monthly Review phase! 🌟');
            } else {
              const nextDue = new Date();
              nextDue.setDate(nextDue.getDate() + 7);
              updatedItem.nextReviewDueDate = nextDue.toISOString();
              triggerToast('Weekly review complete! Spaced date advanced. 📅');
            }
          } else if (item.retentionPhase === 'monthly') {
            if (updatedItem.currentStreakCount >= 60) {
              updatedItem.status = 'retained';
              updatedItem.retentionPhase = 'none';
              updatedItem.nextReviewDueDate = null;
              triggerToast('Successfully RETAINED forever! 🏆🎉');
            } else {
              const nextDue = new Date();
              nextDue.setDate(nextDue.getDate() + 30);
              updatedItem.nextReviewDueDate = nextDue.toISOString();
              triggerToast('Monthly review complete! Spaced date advanced. 📅');
            }
          }
          updatedItem.reviewsToday = 0; // Reset for next review cycle
        } else {
          triggerToast(`Review logged! (${currentReviewsToday}/${reviewsRequired} required for today) 📅`);
        }
      }
    } else {
      // FAILED REVIEW
      if (!item.gracePeriodUsedToday && item.status === 'reviewing') {
        updatedItem.gracePeriodUsedToday = true;
        triggerToast('Grace Period applied! Complete review successfully tomorrow to avoid demotion. 🛡️');
      } else {
        updatedItem.currentStreakCount = 0;
        updatedItem.gracePeriodUsedToday = false;

        if (item.status === 'reviewing') {
          if (item.retentionPhase === 'monthly') {
            updatedItem.retentionPhase = 'weekly';
            const nextDue = new Date();
            nextDue.setDate(nextDue.getDate() + 7);
            updatedItem.nextReviewDueDate = nextDue.toISOString();
            updatedItem.reviewsToday = 0;
            triggerToast('Incorrect. Demoted from Monthly to Weekly phase. 🔄');
          } else if (item.retentionPhase === 'weekly') {
            updatedItem.retentionPhase = 'daily';
            const nextDue = new Date();
            nextDue.setDate(nextDue.getDate() + 1);
            updatedItem.nextReviewDueDate = nextDue.toISOString();
            updatedItem.reviewsToday = 0;
            triggerToast('Incorrect. Demoted from Weekly to Daily phase. 🔄');
          } else if (item.retentionPhase === 'daily') {
            updatedItem.status = 'learning';
            updatedItem.retentionPhase = 'none';
            updatedItem.nextReviewDueDate = null;
            updatedItem.touchLogs = []; // Reset touch logs on demotion
            updatedItem.reviewsToday = 0;
            triggerToast('Incorrect. Demoted from Daily to Learning status (3-Touch Mastery reset). 🔄');
          }
        } else {
          triggerToast('Incorrect. Keep practicing! 🔄');
        }
      }
    }

    setMemoryQueue((prev) => prev.map((q) => (q.verseId === item.verseId ? updatedItem : q)));

    if (auth.currentUser) {
      try {
        const docRef = doc(db, 'users', auth.currentUser.uid, 'memoryQueue', item.verseId);
        await setDoc(docRef, updatedItem);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${auth.currentUser.uid}/memoryQueue/${item.verseId}`);
      }
    }
  };

  const triggerMockDueReviews = async () => {
    if (memoryQueue.length === 0) {
      triggerToast('Your memory queue is empty! Please add some verses first.');
      return;
    }

    const updatedQueue = memoryQueue.map((item, idx) => {
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

    setMemoryQueue(updatedQueue);

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
    customDrillType?: 'speak' | 'type' | 'reveal'
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
    const drillType = customDrillType || (activeModal === 'type' ? 'type' : activeModal === 'reveal' ? 'reveal' : 'speak');
    for (const v of versesToUpdate) {
      const itemInQueue = memoryQueue.find((q) => q.book === v.book && q.chapter === v.chapter && q.verseNumber === v.verse);
      if (itemInQueue) {
        await handleReviewCompleted(itemInQueue, success, drillType);
      }
    }

    const refStr =
      versesToUpdate.length === 1
        ? `${versesToUpdate[0].book} ${versesToUpdate[0].chapter}:${versesToUpdate[0].verse}`
        : `${versesToUpdate[0].book} ${versesToUpdate[0].chapter}:${versesToUpdate[0].verse}-${versesToUpdate[versesToUpdate.length - 1].verse}`;

    triggerToast(`Completed practice for ${refStr}!`);
  };

  // Launch practice session
  const startPractice = (mode: 'listen' | 'type' | 'reveal', passageVerses: VerseState[]) => {
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
  const activityByDay = new Map<string, number>();
  memoryQueue.forEach((item) => {
    (item.touchLogs || []).forEach((log) => {
      const day = log.timestamp.slice(0, 10); // 'YYYY-MM-DD'
      activityByDay.set(day, (activityByDay.get(day) || 0) + 1);
    });
  });

  const activityLast15Days = Array.from({ length: 15 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (14 - i));
    const key = d.toISOString().slice(0, 10);
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
      const key = d.toISOString().slice(0, 10);
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
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setIsRecording(true);
      setRecordingSeconds(0);
      triggerToast('Recording started... Speak clearly.');
    } catch (err) {
      console.error('Failed to start recording:', err);
      triggerToast('Could not start recording — check microphone permissions.');
    }
  };

  const handleStopRecording = async () => {
    try {
      await audioRecorder.stop();
    } catch (err) {
      console.error('Failed to stop recording:', err);
    }
    setIsRecording(false);
    setSaveRecordingDialog(true);
  };

  const saveRecordedAudio = async () => {
    const uid = auth.currentUser?.uid;
    const uri = audioRecorder.uri;
    setSaveRecordingDialog(false);

    if (!uid) {
      triggerToast('Sign in to save recordings.');
      return;
    }
    if (!uri) {
      triggerToast('No recording captured — please try again.');
      return;
    }

    const id = `rec_${Date.now()}`;
    // On web, expo-audio's HIGH_QUALITY preset records to audio/webm regardless
    // of the .m4a extension used natively — match the actual encoded format.
    const ext = Platform.OS === 'web' ? 'webm' : 'm4a';
    const contentType = Platform.OS === 'web' ? 'audio/webm' : 'audio/m4a';
    const audioPath = `recordings/${uid}/${id}.${ext}`;

    triggerToast('Uploading recitation...');
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const fileRef = storageRef(storage, audioPath);
      await uploadBytes(fileRef, blob, { contentType });
      const audioUrl = await getDownloadURL(fileRef);

      const newRec: Recording = {
        id,
        title: `${recordingBook} ${recordingChapter} Full Chapter Recitation`,
        book: recordingBook,
        chapter: recordingChapter,
        translation: recordingTranslation,
        duration: recordingSeconds || Math.round(audioRecorder.currentTime) || 1,
        date: new Date().toISOString().split('T')[0],
        userId: uid,
        user: auth.currentUser?.displayName || 'Me',
        avatar: (auth.currentUser?.displayName || 'M').charAt(0).toUpperCase(),
        audioUrl,
        audioPath,
        versesStr: 'Full Chapter',
        verseTimestamps: [],
      };

      await setDoc(doc(db, 'users', uid, 'recordings', id), { ...newRec, createdAt: serverTimestamp() });
      setUserRecordings((prev) => [newRec, ...prev]);
      triggerToast('Chapter recitation saved! 🎙️');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/recordings/${id}`);
    }
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

  return {
    // static reference data
    BOOKS,
    DUMMY_PROFILES,

    // core state
    verses, setVerses,
    memoryQueue, setMemoryQueue,
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
    recSyncOffsets, setRecSyncOffsets,
    preset, setPreset,
    learningDays, setLearningDays,
    reviewingDays, setReviewingDays,
    primingDays, setPrimingDays,
    newVersesPace, setNewVersesPace,
    maxReviewCap, setMaxReviewCap,
    activeModal, setActiveModal,
    modalVerses, setModalVerses,
    isRecording, setIsRecording,
    recordingSeconds, setRecordingSeconds,
    recordingBook, setRecordingBook,
    recordingChapter, setRecordingChapter,
    recordingTranslation, setRecordingTranslation,
    userRecordings, setUserRecordings,
    saveRecordingDialog, setSaveRecordingDialog,
    typedRecordingName, setTypedRecordingName,
    feedRecordings, setFeedRecordings,
    audioSearchQuery, setAudioSearchQuery,
    activeFeedFilter, setActiveFeedFilter,
    feedBookFilter, setFeedBookFilter,
    feedChapterFilter, setFeedChapterFilter,
    selectedChapterAudios, setSelectedChapterAudios,
    showAudioSelector, setShowAudioSelector,
    audioPlaying, setAudioPlaying,
    audioPlaybackProgress, setAudioPlaybackProgress,
    toastMessage, setToastMessage,
    masteryTouches, setMasteryTouches,
    reviewsRequired, setReviewsRequired,
    activeGroupPlan, setActiveGroupPlan,
    viewingGroupDetail, setViewingGroupDetail,
    myCircles, loadingMyCircles,
    publicCircles, loadingPublicCircles,
    activeCircle, activeCircleMembers, activeCircleGroupPlans, loadingActiveCircle,
    circleFriends, loadCircleFriends,
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
    seekRecordingBy,
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
    triggerDailyPull,
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
    saveRecordedAudio,
    deleteRecording,
  };
}

export type AppState = ReturnType<typeof useAppState>;
