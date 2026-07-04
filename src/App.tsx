import React, { useState, useEffect, useRef } from 'react';
import {
  BookOpen,
  Mic,
  Play,
  Pause,
  ArrowLeft,
  Check,
  ChevronRight,
  Sparkles,
  Volume2,
  User,
  Users,
  Home as HomeIcon,
  Plus,
  RefreshCw,
  Sliders,
  Award,
  List as ListIcon,
  Grid as GridIcon,
  TrendingUp,
  Search,
  X,
  BookMarked,
  Info,
  Calendar,
  Share2,
  ChevronDown,
  Trash2,
  ArrowUp,
  ArrowDown,
  Link,
  Megaphone,
  Globe,
  Lock
} from 'lucide-react';

import { VerseState, Recording, QueueItem, GroupedQueueItem, GroupPlan, TouchLog, MemoryPlan } from './types';
import { BOOKS, INITIAL_VERSES, INITIAL_RECORDINGS, SUGGESTED_FEED_RECORDINGS, DEFAULT_PLANS, MOCK_GROUP_PLANS, DUMMY_PROFILES, getProfileForName } from './data';
import PracticeModals from './components/PracticeModals';

// Firebase Integrations
import { auth, db, googleProvider, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, getDocs, collection, serverTimestamp, writeBatch, query, orderBy, addDoc } from 'firebase/firestore';

// ==========================================
// REUSABLE HELP TOOLTIP COMPONENT
// ==========================================
const HelpTooltip = ({ text, position = 'top' }: { text: string; position?: 'top' | 'bottom' | 'left' | 'right' }) => {
  const [show, setShow] = useState(false);
  return (
    <div 
      className="relative inline-block ml-1.5 select-none shrink-0"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={(e) => {
        e.stopPropagation();
        setShow(!show);
      }}
    >
      <span className="w-4 h-4 rounded-full border border-neutral-300 flex items-center justify-center text-[9px] font-sans font-black text-neutral-400 hover:text-neutral-900 hover:border-neutral-800 transition cursor-help bg-white/95 shadow-3xs">
        ?
      </span>
      {show && (
        <div 
          className={`absolute z-50 w-52 p-2.5 text-[10px] leading-relaxed font-sans font-normal text-neutral-800 bg-white border border-neutral-300 rounded-xl shadow-lg transition-opacity duration-150 text-left pointer-events-none ${
            position === 'top' ? 'bottom-full left-1/2 -translate-x-1/2 mb-2' :
            position === 'bottom' ? 'top-full left-1/2 -translate-x-1/2 mt-2' :
            position === 'left' ? 'right-full top-1/2 -translate-y-1/2 mr-2' :
            'left-full top-1/2 -translate-y-1/2 ml-2'
          }`}
        >
          {text}
          {/* Arrow */}
          <div 
            className={`absolute w-1.5 h-1.5 bg-white border-neutral-300 transform rotate-45 ${
              position === 'top' ? 'top-full left-1/2 -translate-x-1/2 -translate-y-1/2 border-r border-b' :
              position === 'bottom' ? 'bottom-full left-1/2 -translate-x-1/2 translate-y-1/2 border-l border-t' :
              position === 'left' ? 'left-full top-1/2 -translate-y-1/2 -translate-x-1/2 border-l border-b' :
              'right-full top-1/2 -translate-y-1/2 translate-x-1/2 border-r border-t'
            }`}
          />
        </div>
      )}
    </div>
  );
};



const generateInitialQueue = (verses: VerseState[]): QueueItem[] => {
  return verses.map((v, index) => {
    const verseId = `${v.book.substring(0, 3).toUpperCase()}_${v.chapter}_${v.verse}`;
    const origin = (v.book === 'John') ? 'group' : 'individual';
    
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
        gracePeriodUsedToday: false
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
        gracePeriodUsedToday: false
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
        gracePeriodUsedToday: false
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
        gracePeriodUsedToday: false
      };
    }
    if (v.book === 'Genesis' && v.chapter === 1 && (v.verse === 3 || v.verse === 4 || v.verse === 5 || v.verse === 6)) {
      return {
        verseId,
        book: v.book,
        chapter: v.chapter,
        verseNumber: v.verse,
        text: v.text,
        orderIndex: index,
        status: 'learning',
        origin: origin,
        retentionPhase: 'none',
        dateStarted: new Date().toISOString(),
        lastReviewDate: null,
        nextReviewDueDate: null,
        currentStreakCount: 0,
        totalSuccessfulReviews: 0,
        gracePeriodUsedToday: false
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
      origin: origin,
      retentionPhase: 'none',
      dateStarted: null,
      lastReviewDate: null,
      nextReviewDueDate: null,
      currentStreakCount: 0,
      totalSuccessfulReviews: 0,
      gracePeriodUsedToday: false
    };
  });
};

const groupQueueItems = (items: QueueItem[]): GroupedQueueItem[] => {
  if (items.length === 0) return [];
  const groups: GroupedQueueItem[] = [];
  let currentGroup: GroupedQueueItem = {
    id: `${items[0].book}_${items[0].chapter}_${items[0].verseNumber}`,
    book: items[0].book,
    chapter: items[0].chapter,
    verses: [items[0].verseNumber],
    status: items[0].status,
    origin: (items[0].origin || 'individual') as 'individual' | 'group',
    items: [items[0]]
  };

  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const curr = items[i];
    const isConsecutive = curr.book === prev.book && 
                          curr.chapter === prev.chapter && 
                          curr.verseNumber === prev.verseNumber + 1 &&
                          curr.status === prev.status &&
                          curr.origin === prev.origin;
                          
    if (isConsecutive) {
      currentGroup.verses.push(curr.verseNumber);
      currentGroup.items.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = {
        id: `${curr.book}_${curr.chapter}_${curr.verseNumber}`,
        book: curr.book,
        chapter: curr.chapter,
        verses: [curr.verseNumber],
        status: curr.status,
        origin: (curr.origin || 'individual') as 'individual' | 'group',
        items: [curr]
      };
    }
  }
  groups.push(currentGroup);
  return groups;
};

export default function App() {
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
  const [customAddVerseText, setCustomAddVerseText] = useState('If the Spirit of him who raised Jesus from the dead dwells in you, he who raised Christ Jesus from the dead will also give life to your mortal bodies through his Spirit who dwells in you.');
  const [selectedAddOrigin, setSelectedAddOrigin] = useState<'individual' | 'group'>('individual');
  
  // Firebase Auth & Sync states
  const [user, setUser] = useState<any>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [currentTab, setCurrentTab] = useState<'home' | 'community' | 'record' | 'profile'>('home');
  const [currentScreen, setCurrentScreen] = useState<'home' | 'books' | 'chapters' | 'chapterLanding' | 'audioFeed' | 'planDesigner' | 'activePlan' | 'savedPlans' | 'memberProfile' | 'analyzePlan' | 'fullHistory' | 'recordingDetail'>('home');
  
  // Navigation stack helpers
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [backHistory, setBackHistory] = useState<Array<{ screen: 'home' | 'books' | 'chapters' | 'chapterLanding' | 'audioFeed' | 'planDesigner' | 'activePlan' | 'savedPlans' | 'memberProfile' | 'analyzePlan' | 'fullHistory' | 'recordingDetail', book: string | null, chapter: number | null }>>([]);

  // Selection state for Chapter Landing
  const [selectedVerseNumbers, setSelectedVerseNumbers] = useState<number[]>([]);
  const [chapterViewMode, setChapterViewMode] = useState<'list' | 'grid'>('list');

  // Verse audio-sync offset editor states
  const [isEditingSync, setIsEditingSync] = useState<boolean>(false);
  const [recSyncOffsets, setRecSyncOffsets] = useState<Array<{ verse: number; start: string; end: string }>>([
    { verse: 1, start: "0:00", end: "0:08" },
    { verse: 2, start: "0:08", end: "0:15" },
    { verse: 3, start: "0:15", end: "0:22" },
    { verse: 4, start: "0:22", end: "0:30" },
    { verse: 5, start: "0:30", end: "0:38" },
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

  // Teleprompter / Recording State
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
  const audioTimerRef = useRef<NodeJS.Timeout | null>(null);

  // General App Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // 3-Touch Mastery & Group Plan States
  const [masteryTouches, setMasteryTouches] = useState<number>(3);
  const [reviewsRequired, setReviewsRequired] = useState<number>(1);
  const [activeGroupPlan, setActiveGroupPlan] = useState<GroupPlan | null>(null);
  const [viewingGroupDetail, setViewingGroupDetail] = useState<boolean>(false);
  
  const [groupMembersMap, setGroupMembersMap] = useState<Record<string, string[]>>({
    'adult-bible-study': ["Sarah Miller", "Elizabeth K.", "Brother Thomas", "Mark Davis", "Pastor Robert", "Grace Thompson", "Kenneth Carter", "Kenneth (Me)"],
    'youth-sprints': ["Timothy Carter", "Chloe Adams", "David Kim", "Hannah Wu", "Nathan Ross", "Grace Thompson", "Kenneth (Me)"],
    'early-bird': ["Dr. Marcus", "Evelyn Reed", "Kenneth (Me)"]
  });

  const [groupPlansList, setGroupPlansList] = useState<GroupPlan[]>(MOCK_GROUP_PLANS);

  // Selected Recording for Chapter Recording Landing Page
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);

  // Community Sub-views and Custom Search/Join state
  const [communitySubView, setCommunitySubView] = useState<'home' | 'find' | 'create'>('home');
  const [activeGroupName, setActiveGroupName] = useState<string>("Adult Bible Study Group");
  const [activeGroupDesc, setActiveGroupDesc] = useState<string>("A vibrant community focused on memorizing the Epistles of Paul and foundational Old Testament scriptures.");
  const [activeGroupId, setActiveGroupId] = useState<string>("adult-bible-study");
  const [activeGroupIsPublic, setActiveGroupIsPublic] = useState<boolean>(true);
  const [activeGroupOwner, setActiveGroupOwner] = useState<string>("Pastor Robert");

  const [joinedGroups, setJoinedGroups] = useState<Array<{ id: string; name: string; desc: string; role: string; membersCount: number; isPublic: boolean; focus: string; code: string }>>([
    { id: 'adult-bible-study', name: 'Adult Bible Study Group', desc: 'A vibrant community focused on memorizing the Epistles of Paul and foundational Old Testament scriptures.', role: 'Leader', membersCount: 8, isPublic: true, focus: 'Romans', code: 'adult-bible-study' },
    { id: 'youth-sprints', name: 'Youth Scripture Sprints', desc: '12 teenagers pacing through Genesis.', role: 'Mentor', membersCount: 12, isPublic: true, focus: 'Genesis', code: 'youth-sprints' },
    { id: 'early-bird', name: 'Early Bird Romans Study', desc: '5 early risers memorizing Romans.', role: 'Member', membersCount: 5, isPublic: true, focus: 'Romans', code: 'early-bird' }
  ]);

  const [groupAnnouncements, setGroupAnnouncements] = useState<Record<string, string>>({
    'adult-bible-study': "Don't forget: We are having a group check-in on Tuesday at 7 PM to recite Romans 8:1-4! 📖",
    'youth-sprints': "Sprinting through Genesis 1 this week! Keep pacing! ⚡",
    'early-bird': "Early birds, let's focus on Romans 1 today. 🌅"
  });

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
  const [findBookFilter, setFindBookFilter] = useState<string>('All');
  const [findPrivacyFilter, setFindPrivacyFilter] = useState<string>('All');
  const [inviteCodeInput, setInviteCodeInput] = useState<string>('');

  const [createGroupName, setCreateGroupName] = useState<string>('');
  const [createGroupBook, setCreateGroupBook] = useState<string>('Romans');
  const [createGroupDesc, setCreateGroupDesc] = useState<string>('');
  const [createGroupPrivacy, setCreateGroupPrivacy] = useState<'public' | 'private'>('public');
  const [createGroupCapacity, setCreateGroupCapacity] = useState<number>(15);

  // Dashboard Metrics popover / progress modal helper
  const [showProgressModal, setShowProgressModal] = useState(false);

  // Active playing of saved rec
  const [playingRecordingId, setPlayingRecordingId] = useState<string | null>(null);
  const [playingRecProgress, setPlayingRecProgress] = useState(0);
  const recTimerRef = useRef<NodeJS.Timeout | null>(null);

  // View Interactive Other Profiles
  const [selectedUserProfile, setSelectedUserProfile] = useState<any | null>(null);



  const viewMemberProfile = (name: string) => {
    const profile = getProfileForName(name);
    if (profile) {
      setSelectedUserProfile(profile);
      navigateTo('memberProfile');
    }
  };

  // Shared Community Plans States
  const [sharedPlans, setSharedPlans] = useState<any[]>([]);
  const [loadingSharedPlans, setLoadingSharedPlans] = useState(false);
  const [customPlanName, setCustomPlanName] = useState('My Custom Plan');
  const [shareWithCommunity, setShareWithCommunity] = useState(false);

  // Multi-Plan States
  const [savedPlans, setSavedPlans] = useState<MemoryPlan[]>(DEFAULT_PLANS);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);

  const loadSharedPlans = async () => {
    setLoadingSharedPlans(true);
    try {
      const q = query(collection(db, 'sharedPlans'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      const plans: any[] = [];
      querySnapshot.forEach((doc) => {
        plans.push({ id: doc.id, ...doc.data() });
      });
      setSharedPlans(plans);
    } catch (err) {
      console.error("Error loading shared plans, falling back to beautiful presets:", err);
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
          downloadsCount: 142
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
          downloadsCount: 89
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
          downloadsCount: 64
        }
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
          updatedAt: new Date()
        });
        
        if (plan.id && !plan.id.startsWith('mock-')) {
          try {
            const planDocRef = doc(db, 'sharedPlans', plan.id);
            await setDoc(planDocRef, {
              ...plan,
              downloadsCount: (plan.downloadsCount || 0) + 1
            }, { merge: true });
          } catch (e) {
            console.warn("Could not update downloads count:", e);
          }
        }
      }

      triggerToast(`Successfully joined "${plan.name}"! 🎯`);
      loadSharedPlans();
    } catch (err) {
      console.error("Error joining shared plan:", err);
      triggerToast("Failed to join this memory plan.");
    }
  };

  const joinGroupPlan = async (groupPlan: GroupPlan) => {
    try {
      const currentQueueIds = memoryQueue.map(item => item.verseId);
      const missingVerseIds = groupPlan.scriptureRange.filter(id => !currentQueueIds.includes(id));
      
      const newItems: QueueItem[] = [];
      missingVerseIds.forEach(vId => {
        const parts = vId.split('_');
        const bookPrefix = parts[0];
        const chapter = parseInt(parts[1], 10);
        const verseNumber = parseInt(parts[2], 10);
        
        const bookName = bookPrefix === 'ROM' ? 'Romans' : bookPrefix === 'GEN' ? 'Genesis' : 'Psalms';
        const originalVerse = INITIAL_VERSES.find(v => v.book === bookName && v.chapter === chapter && v.verse === verseNumber);
        
        if (originalVerse) {
          newItems.push({
            verseId: vId,
            book: originalVerse.book,
            chapter: originalVerse.chapter,
            verseNumber: originalVerse.verse,
            text: originalVerse.text,
            orderIndex: memoryQueue.length + newItems.length,
            status: 'queued',
            origin: 'group',
            retentionPhase: 'none',
            dateStarted: null,
            lastReviewDate: null,
            nextReviewDueDate: null,
            currentStreakCount: 0,
            totalSuccessfulReviews: 0,
            gracePeriodUsedToday: false
          });
        }
      });

      const updatedQueue = [...memoryQueue, ...newItems];
      setMemoryQueue(updatedQueue);

      if (auth.currentUser && newItems.length > 0) {
        try {
          const batch = writeBatch(db);
          newItems.forEach(item => {
            const docRef = doc(db, 'users', auth.currentUser!.uid, 'memoryQueue', item.verseId);
            batch.set(docRef, item);
          });
          await batch.commit();
        } catch (err) {
          console.error("Failed to commit new group verses to firestore:", err);
        }
      }

      setActiveGroupPlan(groupPlan);
      
      if (auth.currentUser) {
        try {
          const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
          await setDoc(planRef, {
            activeGroupPlanId: groupPlan.planId,
            updatedAt: new Date()
          }, { merge: true });
        } catch (err) {
          console.error("Failed to update active group plan:", err);
        }
      }

      triggerToast(`Successfully joined "${groupPlan.name}"! Group verses appended. 🎯`);
    } catch (err) {
      console.error("Error joining group plan:", err);
    }
  };

  const handleActivatePlan = async (planId: string) => {
    const updatedPlans = savedPlans.map(p => ({
      ...p,
      isActive: p.id === planId
    }));
    setSavedPlans(updatedPlans);
    
    const activePlan = updatedPlans.find(p => p.isActive);
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
            updatedAt: new Date()
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
      updatedPlans = updatedPlans.map(p => {
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
            updatedAt: new Date().toISOString()
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
        updatedAt: new Date().toISOString()
      };
      
      updatedPlans = updatedPlans.map(p => ({ ...p, isActive: false }));
      updatedPlans.push(newPlan);
      triggerToast(`New plan "${customPlanName}" saved and activated! 🎯`);
    }
    
    const activePlan = updatedPlans.find(p => p.isActive) || updatedPlans[0];
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
          updatedAt: new Date()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `memoryPlans/${auth.currentUser.uid}`);
      }
    }
    
    navigateTo('savedPlans');
  };

  const publishSharedPlan = async () => {
    if (!customPlanName.trim()) {
      triggerToast("Please provide a name for your custom plan.");
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
        downloadsCount: 0
      };

      if (auth.currentUser) {
        const sharedColRef = collection(db, 'sharedPlans');
        await addDoc(sharedColRef, planPayload);

        // Also save/update inside savedPlans array!
        let updatedPlans = [...savedPlans];
        if (editingPlanId) {
          updatedPlans = updatedPlans.map(p => {
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
                updatedAt: new Date().toISOString()
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
            updatedAt: new Date().toISOString()
          };
          updatedPlans = updatedPlans.map(p => ({ ...p, isActive: false }));
          updatedPlans.push(newPlan);
        }
        
        const activePlan = updatedPlans.find(p => p.isActive) || updatedPlans[0];
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
          updatedAt: new Date()
        });

        triggerToast(`"${customPlanName}" published to Scripture Circles! 🚀`);
      } else {
        triggerToast(`Plan "${customPlanName}" saved locally! Sign in to publish. 🎯`);
      }
      
      loadSharedPlans();
      navigateTo('savedPlans');
    } catch (e) {
      console.error("Error publishing plan:", e);
      triggerToast("Failed to publish memory plan.");
    }
  };

  // Fetch shared plans once on mount
  useEffect(() => {
    loadSharedPlans();
  }, []);

  // Firebase Auth State Listener & Data Loader
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setLoadingAuth(false);
      if (currentUser) {
        await loadUserData(currentUser);
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
      }
    });
    return unsubscribe;
  }, []);

  const loadUserData = async (currentUser: any) => {
    console.log("loadUserData started for UID:", currentUser.uid);
    try {
      // 1. Profile
      console.log("Step 1: Fetching profile...");
      const profileRef = doc(db, 'profiles', currentUser.uid);
      let profileSnap;
      try {
        profileSnap = await getDoc(profileRef);
        console.log("Profile fetched successfully. Exists:", profileSnap.exists());
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
          streakDays: 45
        };
        console.log("Creating new profile...");
        try {
          await setDoc(profileRef, newProfile);
          console.log("Profile created successfully.");
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, `profiles/${currentUser.uid}`);
        }
      }

      // 2. Memory Plan
      console.log("Step 2: Fetching memory plan...");
      const planRef = doc(db, 'memoryPlans', currentUser.uid);
      let planSnap;
      try {
        planSnap = await getDoc(planRef);
        console.log("Memory plan fetched successfully. Exists:", planSnap.exists());
      } catch (e) {
        handleFirestoreError(e, OperationType.GET, `memoryPlans/${currentUser.uid}`);
      }

      if (planSnap.exists()) {
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
            updatedAt: new Date().toISOString()
          };
          plansList = [activePlan];
        }
        
        setSavedPlans(plansList);
        
        // Find the active plan and sync current state
        const active = plansList.find(p => p.isActive) || plansList[0];
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
        console.log("Creating new memory plan...");
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
            updatedAt: new Date()
          });
          console.log("Memory plan created successfully.");
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, `memoryPlans/${currentUser.uid}`);
        }
      }

      // 3. User Verses & Deterministic Memory Queue
      console.log("Step 3: Fetching user verses and memory queue...");
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
      console.log("User data fetched. Verses:", vSnap?.size, "Queue:", qSnap?.size);

      // Sync and Load Verses
      if (vSnap && vSnap.empty) {
        console.log("Seeding user verses...");
        const batch = writeBatch(db);
        const currentVerses = verses.length > 0 ? verses : INITIAL_VERSES;
        currentVerses.forEach((v) => {
          const vId = `${v.book}_${v.chapter}_${v.verse}`;
          const docRef = doc(db, 'users', currentUser.uid, 'verses', vId);
          batch.set(docRef, {
            book: v.book,
            chapter: v.chapter,
            verse: v.verse,
            text: v.text,
            status: v.status,
            dueDate: v.dueDate || null,
            updatedAt: new Date()
          });
        });
        try {
          await batch.commit();
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, `users/${currentUser.uid}/verses`);
        }
      } else if (vSnap) {
        const loadedVerses: VerseState[] = [];
        vSnap.forEach((doc) => {
          const data = doc.data();
          loadedVerses.push({
            book: data.book,
            chapter: data.chapter,
            verse: data.verse,
            text: data.text,
            status: data.status,
            dueDate: data.dueDate || undefined
          });
        });
        loadedVerses.sort((a, b) => {
          if (a.book !== b.book) return a.book.localeCompare(b.book);
          if (a.chapter !== b.chapter) return a.chapter - b.chapter;
          return a.verse - b.verse;
        });
        setVerses(loadedVerses);
      }

      // Sync and Load memoryQueue
      if (qSnap && qSnap.empty) {
        console.log("Seeding memory queue...");
        const batch = writeBatch(db);
        const initialQueue = generateInitialQueue(INITIAL_VERSES);
        initialQueue.forEach((item) => {
          const docRef = doc(db, 'users', currentUser.uid, 'memoryQueue', item.verseId);
          batch.set(docRef, { ...item });
        });
        try {
          await batch.commit();
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, `users/${currentUser.uid}/memoryQueue`);
        }
        setMemoryQueue(initialQueue);
      } else if (qSnap) {
        const loadedQueue: QueueItem[] = [];
        qSnap.forEach((doc) => {
          const data = doc.data();
          loadedQueue.push({
            verseId: data.verseId,
            book: data.book,
            chapter: data.chapter,
            verseNumber: data.verseNumber !== undefined ? data.verseNumber : (data.verse || 1),
            text: data.text || '',
            orderIndex: data.orderIndex !== undefined ? data.orderIndex : 0,
            status: data.status || 'queued',
            retentionPhase: data.retentionPhase || 'none',
            dateStarted: data.dateStarted || null,
            lastReviewDate: data.lastReviewDate || null,
            nextReviewDueDate: data.nextReviewDueDate || null,
            currentStreakCount: data.currentStreakCount || 0,
            totalSuccessfulReviews: data.totalSuccessfulReviews || 0,
            gracePeriodUsedToday: data.gracePeriodUsedToday || false
          });
        });
        loadedQueue.sort((a, b) => a.orderIndex - b.orderIndex);
        setMemoryQueue(loadedQueue);
      }

      triggerToast("Cloud profile and scripture data synchronized! ☁️");
    } catch (err) {
      console.error("Error in loadUserData master catch block:", err);
      triggerToast("Could not sync with Cloud storage.");
    }
  };

  // ==========================================
  // TIMERS & EFFECTS
  // ==========================================
  // Custom Toast helper
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Reset scroll position on viewport when navigating
  useEffect(() => {
    const viewport = document.getElementById('phone_viewport');
    if (viewport) {
      viewport.scrollTop = 0;
    }
  }, [currentScreen, currentTab]);

  // Recording Timer
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
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
  }, [audioPlaying]);

  // Saved Recording Playback Simulation
  useEffect(() => {
    if (playingRecordingId) {
      const activeRec = [...userRecordings, ...feedRecordings].find(r => r.id === playingRecordingId);
      const totalSec = activeRec ? activeRec.duration : 20;
      recTimerRef.current = setInterval(() => {
        setPlayingRecProgress(prev => {
          if (prev >= 100) {
            setPlayingRecordingId(null);
            triggerToast('Recording playback completed.');
            return 0;
          }
          return prev + (100 / totalSec);
        });
      }, 1000);
    } else {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    }
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    };
  }, [playingRecordingId, userRecordings, feedRecordings]);

  // Auto-fill verse text from INITIAL_VERSES or existing scriptures for the Queue item adder
  useEffect(() => {
    const match = verses.find(
      v => v.book.toLowerCase() === selectedAddBook.toLowerCase() && 
           v.chapter === selectedAddChapter && 
           v.verse === selectedAddVerse
    );
    if (match) {
      setCustomAddVerseText(match.text);
    } else {
      // Find matches in the memory queue if any
      const queueMatch = memoryQueue.find(
        q => q.book.toLowerCase() === selectedAddBook.toLowerCase() &&
             q.chapter === selectedAddChapter &&
             q.verseNumber === selectedAddVerse
      );
      if (queueMatch) {
        setCustomAddVerseText(queueMatch.text);
      } else {
        setCustomAddVerseText('');
      }
    }
  }, [selectedAddBook, selectedAddChapter, selectedAddVerse, verses, memoryQueue]);

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
  // NAVIGATION HANDLERS
  // ==========================================
  const navigateTo = (screen: 'home' | 'books' | 'chapters' | 'chapterLanding' | 'audioFeed' | 'planDesigner' | 'activePlan' | 'savedPlans' | 'memberProfile' | 'analyzePlan' | 'fullHistory' | 'recordingDetail', book: string | null = null, chapter: number | null = null) => {
    // Record history for seamless back navigation
    setBackHistory((prev) => [...prev, { screen: currentScreen, book: selectedBook, chapter: selectedChapter }]);
    
    if (book) setSelectedBook(book);
    if (chapter) setSelectedChapter(chapter);
    
    if (screen === 'activePlan') {
      const active = savedPlans.find(p => p.isActive) || savedPlans[0];
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
  const selectTab = (tab: 'home' | 'community' | 'record' | 'profile') => {
    setCurrentTab(tab);
    setAudioPlaying(false);
    setAudioPlaybackProgress(0);
    setPlayingRecordingId(null);

    if (currentScreen === 'memberProfile' || currentScreen === 'analyzePlan' || currentScreen === 'fullHistory' || currentScreen === 'recordingDetail') {
      setCurrentScreen('home');
      setBackHistory([]);
    }

    if (tab === 'home') {
      setCurrentScreen('home');
      setBackHistory([]);
    }
  };

  // ==========================================
  // STATE MUTATION HANDLERS (PRACTICE INTERACTION)
  // ==========================================
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

  const validateTouch = (item: QueueItem, type: 'speak' | 'type' | 'reveal'): boolean => {
    if (!item.touchLogs || item.touchLogs.length === 0) return true;
    const lastTouch = item.touchLogs[item.touchLogs.length - 1];
    const lastTime = new Date(lastTouch.timestamp).getTime();
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    return (now - lastTime) >= ONE_HOUR;
  };

  const getEstimatedReviewTime = (queue: QueueItem[], sensitivity: 'low' | 'medium' | 'high') => {
    let totalSeconds = 0;
    queue.forEach(item => {
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
    
    const queuedItems = memoryQueue.filter(item => item.status === 'queued');
    if (queuedItems.length === 0) {
      triggerToast("No more queued verses to pull! 🎉");
      return;
    }
    
    let actualPace = newVersesPace;
    let catchUpMessage = "";
    
    if (activeGroupPlan) {
      // Pacing days checks: use group plan's active learning days mapping if specified, or default to general learningDays
      // Find how many of the group plan's verses have been started (status !== 'queued')
      const groupPlanVerses = memoryQueue.filter(item => activeGroupPlan.scriptureRange.includes(item.verseId));
      const userPlanIndex = groupPlanVerses.filter(item => item.status !== 'queued').length;
      
      const isBehind = userPlanIndex < activeGroupPlan.currentGroupVerseIndex;
      if (isBehind) {
        actualPace = newVersesPace * 2;
        catchUpMessage = ` (Catch-Up Active! Pace doubled from ${newVersesPace} to ${actualPace} to catch up to group verse pointer ${activeGroupPlan.currentGroupVerseIndex}) 🏃‍♂️`;
      }
    }
    
    const toPullCount = Math.min(actualPace, queuedItems.length);
    const itemsToPull = queuedItems.slice(0, toPullCount);
    
    const updatedQueue = memoryQueue.map(item => {
      const isTarget = itemsToPull.some(p => p.verseId === item.verseId);
      if (isTarget) {
        return {
          ...item,
          status: 'learning' as const,
          dateStarted: new Date().toISOString(),
          lastReviewDate: null,
          nextReviewDueDate: null,
          currentStreakCount: 0,
          totalSuccessfulReviews: 0,
          gracePeriodUsedToday: false
        };
      }
      return item;
    });
    
    setMemoryQueue(updatedQueue);
    
    if (auth.currentUser) {
      try {
        const batch = writeBatch(db);
        itemsToPull.forEach(item => {
          const docRef = doc(db, 'users', auth.currentUser!.uid, 'memoryQueue', item.verseId);
          batch.set(docRef, {
            ...item,
            status: 'learning',
            dateStarted: new Date().toISOString(),
            lastReviewDate: null,
            nextReviewDueDate: null,
            currentStreakCount: 0,
            totalSuccessfulReviews: 0,
            gracePeriodUsedToday: false
          });
        });
        await batch.commit();
      } catch (err) {
        console.error("Failed to commit pull batch to firestore:", err);
      }
    }
    
    triggerToast(`Successfully pulled ${toPullCount} new ${toPullCount === 1 ? 'verse' : 'verses'} into your learning queue!${catchUpMessage} 🚀`);
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
            drillType: inferredType
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
            triggerToast(`Passage mastered! Transitioned to 7-6-5 spaced review. 🎉`);
          } else {
            triggerToast(`Recall logged! Mastery progress: ${updatedLogs.length}/${masteryTouches} touches. 🌟`);
          }
        } else {
          triggerToast(`Touch logged, but within 1-hour constraint. Only 1 touch per hour counts toward Mastery! ⏳`);
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
              triggerToast(`Graduated to Weekly Review phase! 🌟`);
            } else {
              const nextDue = new Date();
              nextDue.setDate(nextDue.getDate() + 1);
              updatedItem.nextReviewDueDate = nextDue.toISOString();
              triggerToast(`Daily reviews complete! Spaced date advanced. 📅`);
            }
          } else if (item.retentionPhase === 'weekly') {
            if (updatedItem.currentStreakCount >= 26) {
              updatedItem.retentionPhase = 'monthly';
              updatedItem.currentStreakCount = 1;
              const nextDue = new Date();
              nextDue.setDate(nextDue.getDate() + 30);
              updatedItem.nextReviewDueDate = nextDue.toISOString();
              triggerToast(`Graduated to Monthly Review phase! 🌟`);
            } else {
              const nextDue = new Date();
              nextDue.setDate(nextDue.getDate() + 7);
              updatedItem.nextReviewDueDate = nextDue.toISOString();
              triggerToast(`Weekly review complete! Spaced date advanced. 📅`);
            }
          } else if (item.retentionPhase === 'monthly') {
            if (updatedItem.currentStreakCount >= 60) {
              updatedItem.status = 'retained';
              updatedItem.retentionPhase = 'none';
              updatedItem.nextReviewDueDate = null;
              triggerToast(`Successfully RETAINED forever! 🏆🎉`);
            } else {
              const nextDue = new Date();
              nextDue.setDate(nextDue.getDate() + 30);
              updatedItem.nextReviewDueDate = nextDue.toISOString();
              triggerToast(`Monthly review complete! Spaced date advanced. 📅`);
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
        triggerToast("Grace Period applied! Complete review successfully tomorrow to avoid demotion. 🛡️");
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
            triggerToast(`Incorrect. Demoted from Monthly to Weekly phase. 🔄`);
          } else if (item.retentionPhase === 'weekly') {
            updatedItem.retentionPhase = 'daily';
            const nextDue = new Date();
            nextDue.setDate(nextDue.getDate() + 1);
            updatedItem.nextReviewDueDate = nextDue.toISOString();
            updatedItem.reviewsToday = 0;
            triggerToast(`Incorrect. Demoted from Weekly to Daily phase. 🔄`);
          } else if (item.retentionPhase === 'daily') {
            updatedItem.status = 'learning';
            updatedItem.retentionPhase = 'none';
            updatedItem.nextReviewDueDate = null;
            updatedItem.touchLogs = []; // Reset touch logs on demotion
            updatedItem.reviewsToday = 0;
            triggerToast(`Incorrect. Demoted from Daily to Learning status (3-Touch Mastery reset). 🔄`);
          }
        } else {
          triggerToast(`Incorrect. Keep practicing! 🔄`);
        }
      }
    }

    setMemoryQueue(prev => prev.map(q => q.verseId === item.verseId ? updatedItem : q));
    
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
      triggerToast("Your memory queue is empty! Please add some verses first.");
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
          totalSuccessfulReviews: item.totalSuccessfulReviews || 1
        };
      }
      return item;
    });

    setMemoryQueue(updatedQueue);

    if (auth.currentUser) {
      try {
        const batch = writeBatch(db);
        updatedQueue.slice(0, 3).forEach(item => {
          const docRef = doc(db, 'users', auth.currentUser!.uid, 'memoryQueue', item.verseId);
          batch.set(docRef, item);
        });
        await batch.commit();
      } catch (err) {
        console.error("Failed to sync mock queue items:", err);
      }
    }
    triggerToast("🧪 3 verses are now set to DUE for Spaced Repetition reviews!");
  };

  const handleUpdateVerseStatus = async (versesToUpdate: VerseState[], newStatus: 'memorized' | 'learning', customDrillType?: 'speak' | 'type' | 'reveal') => {
    setVerses((prev) => {
      return prev.map((v) => {
        const isTarget = versesToUpdate.some(
          (u) => u.book === v.book && u.chapter === v.chapter && u.verse === v.verse
        );
        if (isTarget) {
          return {
            ...v,
            status: newStatus,
            dueDate: newStatus === 'memorized' ? 'Completed' : 'Due: Tomorrow'
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
            updatedAt: new Date()
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
      const itemInQueue = memoryQueue.find(
        (q) => q.book === v.book && q.chapter === v.chapter && q.verseNumber === v.verse
      );
      if (itemInQueue) {
        await handleReviewCompleted(itemInQueue, success, drillType);
      }
    }

    const refStr = versesToUpdate.length === 1
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

  // Filter helper for chapter landing
  const activeChapterVerses = verses.filter(
    (v) => v.book === selectedBook && v.chapter === selectedChapter
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
      setSelectedVerseNumbers(activeChapterVerses.map(v => v.verse));
    }
  };

  // ==========================================
  // MOCK VOICE RECORDER FLOW
  // ==========================================
  const handleStartRecording = () => {
    setIsRecording(true);
    setRecordingSeconds(0);
    triggerToast('Recording started... Speak clearly.');
  };

  const handleStopRecording = () => {
    setIsRecording(false);
    setSaveRecordingDialog(true);
  };

  const saveRecordedAudio = () => {
    const newRec: Recording = {
      id: `rec_${Date.now()}`,
      title: `${recordingBook} ${recordingChapter} Full Chapter Recitation`,
      book: recordingBook,
      chapter: recordingChapter,
      translation: recordingTranslation,
      duration: recordingSeconds || 120,
      date: new Date().toISOString().split('T')[0],
      user: 'Kenneth Carter',
      avatar: 'K',
      category: 'group',
      versesStr: 'Full Chapter'
    };
    
    setUserRecordings((prev) => [newRec, ...prev]);
    setFeedRecordings((prev) => [newRec, ...prev]);
    setSaveRecordingDialog(false);
    triggerToast(`Chapter recording successfully saved to profile and shared to group feed! 🎙️`);
  };

  return (
    <div className="min-h-screen bg-[#F3F2F1] py-6 px-4 flex items-center justify-center font-sans antialiased selection:bg-[#1A1A1A] selection:text-white text-[#1A1A1A]">
      
      {/* ==========================================
          IPHONE WRAPPER CONTAINER
          ========================================== */}
      <div className="relative w-full max-w-[390px] h-[760px] max-h-[92vh] border-[6px] border-[#1A1A1A] rounded-[48px] bg-white shadow-2xl overflow-hidden flex flex-col">
        
        {/* iPhone Status Bar Background */}
        <div className="absolute top-0 left-0 right-0 h-11 bg-white/95 backdrop-blur-xs z-40 flex items-center justify-between px-6 select-none pointer-events-none">
          {/* Time on Left */}
          <span className="font-sans font-semibold text-xs text-neutral-900 leading-none">9:41</span>
          
          {/* Empty Space for the notch */}
          <div className="w-24" />

          {/* Icons on Right */}
          <div className="flex items-center space-x-1.5 text-neutral-900">
            <div className="flex items-end space-x-0.5 h-2.5">
              <div className="w-0.5 h-1 bg-neutral-900 rounded-3xs" />
              <div className="w-0.5 h-1.5 bg-neutral-900 rounded-3xs" />
              <div className="w-0.5 h-2 bg-neutral-900 rounded-3xs" />
              <div className="w-0.5 h-2.5 bg-neutral-900 rounded-3xs" />
            </div>
            <span className="text-[9px] font-sans font-extrabold leading-none">5G</span>
            <div className="flex items-center space-x-0.5">
              <span className="text-[9px] font-sans font-bold leading-none">100%</span>
              <div className="w-5 h-2.5 border border-neutral-900 rounded-xs p-0.5 flex items-center relative">
                <div className="h-full bg-neutral-900 w-full rounded-3xs" />
                <div className="absolute -right-[2px] top-1/2 -translate-y-1/2 w-[1.5px] h-1 bg-neutral-900 rounded-r-3xs" />
              </div>
            </div>
          </div>
        </div>

        {/* Dynamic Island Notch - Sleek pill */}
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-28 h-6 bg-black rounded-full z-50 flex items-center justify-center select-none pointer-events-none shadow-inner">
          {/* Tiny camera lens reflex accent */}
          <div className="absolute right-4 w-1.5 h-1.5 bg-[#1C1C1E] rounded-full border border-[#2C2C2E] flex items-center justify-center">
            <div className="w-0.5 h-0.5 bg-blue-500/80 rounded-full" />
          </div>
        </div>

        {/* Toast Notification Layer - Subtle fade in/out */}
        {toastMessage && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-neutral-900 border border-neutral-800 text-white text-xs font-bold font-sans py-2.5 px-4 rounded-full shadow-lg z-50 flex items-center gap-2 animate-fade-in transition-all duration-350">
            <Check size={12} className="text-emerald-400" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* ==========================================
            SCROLLABLE CONTENT AREA
            ========================================== */}
        <div className="flex-1 overflow-y-auto pt-11 pb-16 bg-white flex flex-col" id="phone_viewport">
          
          {/* ======================================================== */}
          {/* DEDICATED FULL-PAGE SCREENS FOR MEMBER PROFILE, PLAN ANALYSIS, AND HISTORY */}
          {/* ======================================================== */}
          {/* ======================================================== */}
          {/* DEDICATED FULL-PAGE SCREENS FOR MEMBER PROFILE, PLAN ANALYSIS, AND HISTORY */}
          {/* ======================================================== */}
          {currentScreen === 'recordingDetail' && selectedRecording && (
            <div className="flex-1 flex flex-col p-5 animate-fade-in text-left space-y-4 pb-12">
              {/* Header / Back Button */}
              <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
                <div className="flex items-center gap-3">
                  <button 
                    onClick={handleBack}
                    className="w-8 h-8 rounded-full border border-neutral-200 hover:border-neutral-950 flex items-center justify-center text-neutral-800 transition cursor-pointer bg-white"
                  >
                    <ArrowLeft size={14} />
                  </button>
                  <div>
                    <span className="text-[9px] uppercase tracking-wider font-extrabold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-sans">
                      CHAPTER RECITATION
                    </span>
                    <h2 className="text-base font-serif font-black text-neutral-900 leading-none mt-1">
                      {selectedRecording.book} {selectedRecording.chapter}
                    </h2>
                  </div>
                </div>

                <button
                  onClick={() => {
                    const confirmDel = window.confirm(`Are you sure you want to delete the recording for ${selectedRecording.book} ${selectedRecording.chapter}?`);
                    if (confirmDel) {
                      setUserRecordings(prev => prev.filter(r => r.id !== selectedRecording.id));
                      triggerToast(`Recitation for ${selectedRecording.book} ${selectedRecording.chapter} deleted. 🗑️`);
                      handleBack();
                    }
                  }}
                  className="px-2 py-1 text-[9px] font-sans font-bold uppercase tracking-wider bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-lg transition cursor-pointer"
                >
                  Delete Rec
                </button>
              </div>

              {/* Recording Metadata Card */}
              <div className="border border-neutral-200 rounded-2xl p-4 bg-neutral-50/50 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-xs font-sans">
                  <div>
                    <span className="text-[8px] uppercase tracking-wider text-neutral-400 font-bold block">Translation</span>
                    <span className="font-extrabold text-neutral-800">{selectedRecording.translation} (English Standard Version)</span>
                  </div>
                  <div>
                    <span className="text-[8px] uppercase tracking-wider text-neutral-400 font-bold block">Duration</span>
                    <span className="font-extrabold text-neutral-800">{selectedRecording.duration} seconds</span>
                  </div>
                  <div>
                    <span className="text-[8px] uppercase tracking-wider text-neutral-400 font-bold block">Recitation Date</span>
                    <span className="font-extrabold text-neutral-800">{selectedRecording.date}</span>
                  </div>
                  <div>
                    <span className="text-[8px] uppercase tracking-wider text-neutral-400 font-bold block">Speaker</span>
                    <span className="font-extrabold text-neutral-800">Kenneth Carter (Me)</span>
                  </div>
                </div>
              </div>

              {/* Playback Simulation */}
              <div className="border border-neutral-200 rounded-2xl p-4 bg-white space-y-3 shadow-3xs">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
                    Audio Player
                  </span>
                  <span className="text-[10px] font-mono font-bold text-neutral-600">
                    {playingRecordingId === selectedRecording.id ? `${Math.floor((playingRecProgress / 100) * selectedRecording.duration)}s` : "0s"} / {selectedRecording.duration}s
                  </span>
                </div>

                {/* Animated Waveform Visualizer */}
                <div className="h-10 flex items-end gap-[3px] px-1 bg-neutral-50 rounded-xl justify-center py-2 overflow-hidden border border-neutral-100">
                  {Array.from({ length: 32 }).map((_, i) => {
                    // Highlight waveform bars as active based on progress
                    const isActive = playingRecordingId === selectedRecording.id && (i / 32) * 100 <= playingRecProgress;
                    const heightClass = [
                      'h-2', 'h-4', 'h-6', 'h-3', 'h-5', 'h-7', 'h-8', 'h-4',
                      'h-6', 'h-5', 'h-3', 'h-6', 'h-8', 'h-7', 'h-5', 'h-4',
                      'h-3', 'h-5', 'h-7', 'h-6', 'h-8', 'h-5', 'h-4', 'h-6',
                      'h-7', 'h-3', 'h-5', 'h-6', 'h-8', 'h-4', 'h-2', 'h-3'
                    ][i % 32];

                    return (
                      <div 
                        key={i} 
                        className={`w-1 rounded-full transition-all duration-300 ${
                          isActive 
                            ? 'bg-indigo-600 border border-indigo-700 animate-pulse' 
                            : 'bg-neutral-200'
                        } ${heightClass}`} 
                      />
                    );
                  })}
                </div>

                {/* Controls Bar */}
                <div className="flex justify-center items-center gap-4">
                  <button 
                    onClick={() => {
                      if (playingRecordingId === selectedRecording.id) {
                        setPlayingRecProgress(prev => Math.max(0, prev - 10));
                        triggerToast("Rewind 5s");
                      }
                    }}
                    className="w-8 h-8 rounded-full border border-neutral-200 flex items-center justify-center text-neutral-600 hover:text-neutral-900 bg-white hover:border-neutral-400 cursor-pointer transition shadow-3xs"
                    title="-5 seconds"
                  >
                    <span className="text-[10px] font-black font-sans">-5s</span>
                  </button>

                  <button
                    onClick={() => {
                      if (playingRecordingId === selectedRecording.id) {
                        setPlayingRecordingId(null);
                      } else {
                        setPlayingRecordingId(selectedRecording.id);
                        setPlayingRecProgress(0);
                        triggerToast(`Playing chapter recitation...`);
                      }
                    }}
                    className="w-11 h-11 rounded-full bg-[#1A1A1A] hover:bg-neutral-800 text-white flex items-center justify-center cursor-pointer shadow-md transition"
                  >
                    {playingRecordingId === selectedRecording.id ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
                  </button>

                  <button 
                    onClick={() => {
                      if (playingRecordingId === selectedRecording.id) {
                        setPlayingRecProgress(prev => Math.min(100, prev + 10));
                        triggerToast("Fast Forward 5s");
                      }
                    }}
                    className="w-8 h-8 rounded-full border border-neutral-200 flex items-center justify-center text-neutral-600 hover:text-neutral-900 bg-white hover:border-neutral-400 cursor-pointer transition shadow-3xs"
                    title="+5 seconds"
                  >
                    <span className="text-[10px] font-black font-sans">+5s</span>
                  </button>
                </div>
              </div>

              {/* Sync Verification Panel */}
              <div className="space-y-2.5">
                <div className="flex justify-between items-center px-1">
                  <div className="flex items-center">
                    <span className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                      VERSE AUDIO-SYNC MATRIX
                    </span>
                    <HelpTooltip text="Align your spoken recitation with individual verses. Correcting these timestamps will sync drill sessions perfectly." />
                  </div>
                  
                  {!isEditingSync ? (
                    <button
                      onClick={() => setIsEditingSync(true)}
                      className="text-[9px] bg-[#1A1A1A] text-white font-sans font-bold uppercase tracking-wider px-2 py-1 rounded transition cursor-pointer hover:bg-neutral-850"
                    >
                      Edit Sync ✎
                    </button>
                  ) : (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => {
                          setIsEditingSync(false);
                          triggerToast("Verse sync offsets updated! 🔄");
                        }}
                        className="text-[9px] bg-emerald-600 text-white font-sans font-bold uppercase tracking-wider px-2 py-1 rounded transition cursor-pointer hover:bg-emerald-700"
                      >
                        Save ✓
                      </button>
                      <button
                        onClick={() => setIsEditingSync(false)}
                        className="text-[9px] bg-neutral-200 text-neutral-700 font-sans font-bold uppercase tracking-wider px-2 py-1 rounded transition cursor-pointer hover:bg-neutral-300"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                <div className="border border-neutral-200 rounded-2xl bg-white overflow-hidden text-xs font-sans">
                  <div className="bg-neutral-50 px-3.5 py-2.5 border-b border-neutral-200 text-[10px] uppercase font-bold text-neutral-400 tracking-wider flex justify-between">
                    <span>Verse Reference</span>
                    <span>Timeline Offset Segment</span>
                  </div>

                  <div className="divide-y divide-neutral-100">
                    {recSyncOffsets.map((offset, idx) => (
                      <div key={offset.verse} className="p-3 flex justify-between items-center bg-white hover:bg-neutral-50/40 transition">
                        <div className="text-left">
                          <span className="font-extrabold text-[#1A1A1A]">Verse {offset.verse}</span>
                          <span className="text-[9px] text-neutral-400 block truncate max-w-[200px] mt-0.5">
                            {[
                              "No condemnation to those who are in Christ...",
                              "For the law of the Spirit of life has set you free...",
                              "For God has done what the law could not do...",
                              "In order that the righteous requirement might be met...",
                              "For those who live according to the flesh..."
                            ][idx % 5]}
                          </span>
                        </div>

                        {isEditingSync ? (
                          <div className="flex items-center gap-1.5 font-mono">
                            <input
                              type="text"
                              value={offset.start}
                              onChange={(e) => {
                                const val = e.target.value;
                                setRecSyncOffsets(prev => prev.map(o => o.verse === offset.verse ? { ...o, start: val } : o));
                              }}
                              className="w-11 px-1.5 py-0.5 bg-neutral-50 border border-neutral-300 rounded text-center focus:outline-indigo-500 font-bold"
                            />
                            <span className="text-neutral-400">-</span>
                            <input
                              type="text"
                              value={offset.end}
                              onChange={(e) => {
                                const val = e.target.value;
                                setRecSyncOffsets(prev => prev.map(o => o.verse === offset.verse ? { ...o, end: val } : o));
                              }}
                              className="w-11 px-1.5 py-0.5 bg-neutral-50 border border-neutral-300 rounded text-center focus:outline-indigo-500 font-bold"
                            />
                          </div>
                        ) : (
                          <button
                            onClick={() => triggerToast(`Playing segment for Verse ${offset.verse} (${offset.start} - ${offset.end})`)}
                            className="bg-neutral-100 hover:bg-indigo-50 hover:text-indigo-600 font-mono font-bold text-[#1A1A1A] px-2.5 py-1 rounded border border-neutral-200 transition cursor-pointer"
                          >
                            {offset.start} - {offset.end} 🔊
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentScreen === 'memberProfile' && selectedUserProfile && (
            <div className="flex-1 flex flex-col p-5 animate-fade-in text-left space-y-4 pb-12">
              {/* Header / Back Button */}
              <div className="flex items-center gap-3 border-b border-neutral-100 pb-3">
                <button 
                  onClick={handleBack}
                  className="w-8 h-8 rounded-full border border-neutral-200 hover:border-neutral-950 flex items-center justify-center text-neutral-800 transition cursor-pointer bg-white"
                >
                  <ArrowLeft size={14} />
                </button>
                <div>
                  <span className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">
                    MEMBER PROFILE
                  </span>
                  <h2 className="text-base font-serif font-bold text-neutral-900 leading-none mt-0.5">
                    {selectedUserProfile.name}
                  </h2>
                </div>
              </div>

              {/* User Identity Header */}
              <div className="flex items-center gap-3.5 bg-neutral-50/50 p-3 rounded-2xl border border-neutral-150">
                <div className="w-12 h-12 rounded-full border-2 border-neutral-900 bg-emerald-50 text-emerald-950 font-serif font-black text-lg flex items-center justify-center shadow-xs shrink-0">
                  {selectedUserProfile.avatar}
                </div>
                <div>
                  <h3 className="text-sm font-sans font-black text-neutral-900 leading-tight">
                    {selectedUserProfile.name}
                  </h3>
                  <p className="text-[10px] font-sans text-neutral-400 mt-0.5">
                    {selectedUserProfile.level}
                  </p>
                </div>
              </div>

              {/* Calculated Metrics cards (High Contrast) */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 text-center space-y-0.5">
                  <span className="text-xs font-bold text-neutral-900 font-mono block">
                    {selectedUserProfile.stats?.memorized || 0}
                  </span>
                  <span className="text-[7.5px] font-bold text-neutral-400 uppercase tracking-wide block">
                    MEMORIZED
                  </span>
                </div>
                
                <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 text-center space-y-0.5">
                  <span className="text-xs font-bold text-amber-600 font-mono block">
                    {selectedUserProfile.stats?.learning || 0}
                  </span>
                  <span className="text-[7.5px] font-bold text-neutral-400 uppercase tracking-wide block">
                    LEARNING
                  </span>
                </div>

                <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 text-center space-y-0.5">
                  <span className="text-xs font-bold text-emerald-600 font-mono block">
                    {selectedUserProfile.stats?.streak || 0}
                  </span>
                  <span className="text-[7.5px] font-bold text-neutral-400 uppercase tracking-wide block">
                    STREAK
                  </span>
                </div>
              </div>

              {/* Active Plan Detail Card (Clickable to analyze) */}
              <div className="space-y-1.5">
                <span className="text-[9px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                  ACTIVE PLAN (CLICK TO ANALYZE)
                </span>
                <div 
                  onClick={() => navigateTo('analyzePlan')}
                  className="border border-neutral-200 hover:border-black rounded-xl p-3 bg-white hover:bg-neutral-50/50 transition cursor-pointer space-y-2 text-left group shadow-xs"
                >
                  <div className="flex justify-between items-center">
                    <h4 className="text-xs font-sans font-black text-neutral-850 leading-tight group-hover:underline">
                      {selectedUserProfile.planName}
                    </h4>
                    <span className="text-[7px] bg-[#1A1A1A] text-white px-1.5 py-0.5 rounded font-sans font-bold uppercase tracking-wider scale-90">
                      {selectedUserProfile.preset?.toUpperCase() || 'CUSTOM'}
                    </span>
                  </div>
                  <p className="text-[10px] font-sans text-neutral-500 leading-snug">
                    Pacing at <span className="font-semibold text-neutral-850">{selectedUserProfile.newVersesPace} verses/day</span> with a {selectedUserProfile.maxReviewCap} mins max review limit.
                  </p>
                  <div className="flex gap-1 pt-1.5 border-t border-neutral-100 items-center justify-between">
                    <div className="flex gap-1">
                      {['M', 'T', 'W', 'Th', 'F', 'S', 'Su'].map((d) => {
                        const active = selectedUserProfile.learningDays?.includes(d);
                        return (
                          <span 
                            key={d} 
                            className={`text-[8px] font-sans font-bold w-4.5 h-4.5 flex items-center justify-center rounded-full ${
                              active ? 'bg-emerald-500 text-white font-black' : 'bg-neutral-200/50 text-neutral-350'
                            }`}
                          >
                            {d[0]}
                          </span>
                        );
                      })}
                    </div>
                    <span className="text-[9px] font-sans font-bold text-neutral-400 group-hover:text-black flex items-center gap-0.5">
                      Analyze Plan →
                    </span>
                  </div>
                </div>
              </div>

              {/* Friends Spot */}
              <div className="space-y-1.5">
                <span className="text-[9px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                  FRIENDS ({selectedUserProfile.friends?.length || 0})
                </span>
                <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-thin">
                  {(selectedUserProfile.friends || []).map((fName: string) => {
                    const fProfile = getProfileForName(fName);
                    return (
                      <div 
                        key={fName}
                        onClick={() => viewMemberProfile(fName)}
                        className="flex items-center gap-2 border border-neutral-200 rounded-xl p-2 bg-white hover:bg-neutral-50 transition cursor-pointer shrink-0"
                      >
                        <div className="w-6 h-6 rounded-full bg-neutral-100 border border-neutral-300 font-serif font-black text-[9px] flex items-center justify-center text-neutral-850">
                          {fProfile?.avatar || 'AD'}
                        </div>
                        <div className="text-left">
                          <h4 className="text-[10px] font-bold text-neutral-800 leading-none">{fName}</h4>
                          <span className="text-[7.5px] font-sans text-neutral-400 block mt-0.5">View Profile</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Communities Spot */}
              <div className="space-y-1.5">
                <span className="text-[9px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                  COMMUNITIES ({selectedUserProfile.communities?.length || 0})
                </span>
                <div className="grid grid-cols-1 gap-1.5">
                  {(selectedUserProfile.communities || []).map((cName: string) => (
                    <div key={cName} className="border border-neutral-200 rounded-xl p-2.5 bg-neutral-50/40 text-left">
                      <h4 className="text-xs font-sans font-bold text-neutral-850 leading-tight">{cName}</h4>
                      <p className="text-[9px] font-sans text-neutral-400 mt-0.5">Active Scripture Circle Member</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Past 15 Days Repetitions Activity Grid */}
              <div className="space-y-1.5">
                <span className="text-[9px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                  PAST 15 DAYS REPETITIONS
                </span>
                <div className="border border-neutral-200 rounded-xl p-2.5 bg-white">
                  <div className="grid grid-cols-5 gap-1.5 justify-center">
                    {(selectedUserProfile.activityGrid || []).map((item: any, index: number) => {
                      const color = item.count === 0 
                        ? 'bg-neutral-50 border-neutral-100' 
                        : item.count > 6 
                          ? 'bg-emerald-600 border-emerald-700 text-white' 
                          : 'bg-emerald-200 border-emerald-300 text-emerald-950';
                      return (
                        <div 
                          key={index} 
                          className={`h-8 border rounded flex flex-col items-center justify-center font-mono text-[8px] transition-all relative ${color}`}
                          title={`${item.day}: ${item.count} repetitions`}
                        >
                          <span className="text-[7px] font-sans block text-neutral-400 leading-none">{item.day.split(' ')[1]}</span>
                          <span className="text-[9px] font-extrabold leading-none mt-0.5">{item.count > 0 ? `+${item.count}` : '0'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Recorded Chapters list */}
              <div className="space-y-1.5">
                <span className="text-[9px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                  RECORDED CHAPTERS ({selectedUserProfile.recordings?.length || 0})
                </span>
                <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
                  {(selectedUserProfile.recordings || []).map((rec: any) => {
                    const isPlaying = playingRecordingId === rec.id;
                    return (
                      <div key={rec.id} className="border border-neutral-200 rounded-xl p-2.5 bg-white flex items-center justify-between">
                        <div className="text-left">
                          <h4 className="text-xs font-bold text-neutral-900 leading-tight">
                            {rec.book} {rec.chapter}
                          </h4>
                          <p className="text-[8.5px] font-sans text-neutral-400 mt-0.5">{rec.date} • {rec.translation} • {rec.duration} seconds</p>
                        </div>
                        <button
                          onClick={() => {
                            if (isPlaying) {
                              setPlayingRecordingId(null);
                            } else {
                              setPlayingRecordingId(rec.id);
                              triggerToast(`Playing ${selectedUserProfile.name}'s recording of ${rec.book} ${rec.chapter}... 🎙️`);
                            }
                          }}
                          className={`w-6.5 h-6.5 rounded-full flex items-center justify-center transition cursor-pointer ${
                            isPlaying ? 'bg-[#1A1A1A] text-white' : 'border border-[#1A1A1A] hover:bg-neutral-50 text-[#1A1A1A]'
                          }`}
                        >
                          {isPlaying ? <Pause size={10} /> : <Play size={10} className="ml-0.5" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {currentScreen === 'analyzePlan' && selectedUserProfile && (
            <div className="flex-1 flex flex-col p-5 animate-fade-in text-left space-y-4 pb-12">
              {/* Header */}
              <div className="flex items-center gap-3 border-b border-neutral-100 pb-3">
                <button 
                  onClick={handleBack}
                  className="w-8 h-8 rounded-full border border-neutral-200 hover:border-neutral-950 flex items-center justify-center text-neutral-800 transition cursor-pointer bg-white"
                >
                  <ArrowLeft size={14} />
                </button>
                <div>
                  <span className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">
                    ANALYZE PLAN
                  </span>
                  <h2 className="text-base font-serif font-bold text-neutral-900 leading-none mt-0.5">
                    Pacing & Rhythm Details
                  </h2>
                </div>
              </div>

              {/* Analysis Header Card */}
              <div className="border border-neutral-200 rounded-2xl p-4 bg-white space-y-3 shadow-xs">
                <div>
                  <span className="text-[8px] bg-neutral-900 text-white px-2 py-0.5 rounded font-sans font-bold uppercase tracking-wider">
                    {selectedUserProfile.preset?.toUpperCase() || 'CUSTOM'} PRESET
                  </span>
                </div>
                <h3 className="text-base font-serif font-bold text-neutral-900">
                  {selectedUserProfile.planName}
                </h3>
                <p className="text-xs text-neutral-500 font-sans leading-relaxed">
                  Analyze this pacing configuration to see if it aligns with your memorization capacity and lifestyle routine.
                </p>

                <div className="pt-2">
                  <button
                    onClick={() => {
                      setCustomPlanName(selectedUserProfile.planName);
                      setNewVersesPace(selectedUserProfile.newVersesPace);
                      setMaxReviewCap(selectedUserProfile.maxReviewCap);
                      if (selectedUserProfile.learningDays) setLearningDays(selectedUserProfile.learningDays);
                      if (selectedUserProfile.reviewingDays) setReviewingDays(selectedUserProfile.reviewingDays);
                      if (selectedUserProfile.primingDays) setPrimingDays(selectedUserProfile.primingDays);
                      if (selectedUserProfile.preset) setPreset(selectedUserProfile.preset);
                      triggerToast(`Successfully copied and joined the plan: "${selectedUserProfile.planName}"! 📖`);
                      navigateTo('activePlan');
                    }}
                    className="w-full py-2.5 bg-[#1A1A1A] hover:bg-neutral-850 text-white rounded-xl text-xs font-bold font-sans transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <span>Save & Use This Plan</span>
                  </button>
                </div>
              </div>

              {/* Weekly Schedule Row View */}
              <div className="border border-neutral-200 rounded-2xl p-4 bg-white space-y-4 text-left shadow-xs">
                <span className="text-[9px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                  WEEKLY ROUTINE RHYTHMS
                </span>

                <div className="space-y-3.5">
                  {[
                    { label: 'Learning Days', days: selectedUserProfile.learningDays || [], color: 'bg-indigo-600 text-white border-transparent' },
                    { label: 'Reviewing Days', days: selectedUserProfile.reviewingDays || [], color: 'bg-emerald-600 text-white border-transparent' },
                    { label: 'Priming Days', days: selectedUserProfile.primingDays || [], color: 'bg-amber-500 text-white border-transparent' }
                  ].map((row) => (
                    <div key={row.label} className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-sans font-bold text-neutral-800">{row.label}</span>
                        <span className="text-[10px] font-mono text-neutral-400 font-bold">{row.days.length} days/week</span>
                      </div>
                      <div className="flex gap-1.5">
                        {['M', 'T', 'W', 'Th', 'F', 'S', 'Su'].map((d) => {
                          const active = row.days.includes(d);
                          return (
                            <span 
                              key={d} 
                              className={`text-[9px] font-sans font-bold w-6 h-6 flex items-center justify-center rounded-full border transition-all ${
                                active ? row.color : 'border-neutral-200 text-neutral-300 bg-white'
                              }`}
                            >
                              {d[0]}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Plan Pacing Metrics */}
              <div className="grid grid-cols-2 gap-3">
                <div className="border border-neutral-200 rounded-2xl p-4 bg-white space-y-1.5 text-left shadow-xs">
                  <span className="text-[8.5px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                    Pacing Pace
                  </span>
                  <span className="text-2xl font-serif font-black text-neutral-900 block leading-none">
                    {selectedUserProfile.newVersesPace} <span className="text-xs font-sans font-normal text-neutral-500">v/day</span>
                  </span>
                </div>

                <div className="border border-neutral-200 rounded-2xl p-4 bg-white space-y-1.5 text-left shadow-xs">
                  <span className="text-[8.5px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                    Daily Cap
                  </span>
                  <span className="text-2xl font-serif font-black text-neutral-900 block leading-none">
                    {selectedUserProfile.maxReviewCap} <span className="text-xs font-sans font-normal text-neutral-500">mins</span>
                  </span>
                </div>
              </div>
            </div>
          )}

          {currentScreen === 'fullHistory' && (
            <div className="flex-1 flex flex-col p-5 animate-fade-in text-left space-y-4 pb-12">
              {/* Header */}
              <div className="flex items-center gap-3 border-b border-neutral-100 pb-3">
                <button 
                  onClick={handleBack}
                  className="w-8 h-8 rounded-full border border-neutral-200 hover:border-neutral-950 flex items-center justify-center text-neutral-800 transition cursor-pointer bg-white"
                >
                  <ArrowLeft size={14} />
                </button>
                <div>
                  <span className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">
                    HISTORY LOGS
                  </span>
                  <h2 className="text-base font-serif font-bold text-neutral-900 leading-none mt-0.5">
                    Full Memorization History
                  </h2>
                </div>
              </div>

              {/* Filters Box */}
              <div className="border border-neutral-200 rounded-2xl p-3 bg-neutral-50/50 grid grid-cols-2 gap-2 text-left">
                <div>
                  <label className="text-[8.5px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                    Filter by Scripture
                  </label>
                  <select 
                    id="history_book_filter"
                    defaultValue="all"
                    className="w-full bg-white border border-neutral-200 rounded-lg p-1.5 text-xs font-sans text-neutral-800 focus:outline-none focus:border-black"
                    onChange={(e) => {
                      triggerToast(`Filtered history by: ${e.target.value.toUpperCase()}`);
                    }}
                  >
                    <option value="all">All Books</option>
                    <option value="romans">Romans</option>
                    <option value="psalms">Psalms</option>
                    <option value="genesis">Genesis</option>
                    <option value="john">John</option>
                  </select>
                </div>

                <div>
                  <label className="text-[8.5px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                    Filter by Date Range
                  </label>
                  <select 
                    id="history_date_filter"
                    defaultValue="all"
                    className="w-full bg-white border border-neutral-200 rounded-lg p-1.5 text-xs font-sans text-neutral-800 focus:outline-none focus:border-black"
                    onChange={(e) => {
                      triggerToast(`Filtered timeline range: ${e.target.value.toUpperCase()}`);
                    }}
                  >
                    <option value="all">All Time</option>
                    <option value="7">Last 7 Days</option>
                    <option value="30">Last 30 Days</option>
                    <option value="90">Last 90 Days</option>
                  </select>
                </div>
              </div>

              {/* Filtered Timeline List */}
              <div className="space-y-2.5">
                <span className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                  TIMELINE LOGS
                </span>

                <div className="border border-neutral-200 rounded-2xl p-4 bg-white space-y-4 shadow-xs">
                  <div className="relative pl-5 border-l border-neutral-200 space-y-4.5">
                    {[
                      { title: 'Memorized Romans 8:1–5', subtitle: 'Jun 22, 2026 • ESV • Completed with 100% typing test score.', color: 'bg-emerald-500' },
                      { title: 'Memorized Psalms 23:1–3', subtitle: 'Jun 18, 2026 • NIV • Perfect active recall rating.', color: 'bg-emerald-500' },
                      { title: 'Completed Genesis 1:1–10', subtitle: 'Jun 10, 2026 • KJV • Read aloud and recited successfully.', color: 'bg-emerald-500' },
                      { title: 'First verse: Genesis 1:1', subtitle: 'May 28, 2026 • ESV • Initial scripture memory milestone.', color: 'bg-emerald-500' },
                      { title: 'Memorized John 15:1–4', subtitle: 'May 22, 2026 • NIV • Retained in permanent mental vault.', color: 'bg-emerald-500' },
                      { title: 'Memorized John 15:5', subtitle: 'May 18, 2026 • NIV • Learned during morning devotion pacing.', color: 'bg-emerald-500' }
                    ].map((item, idx) => (
                      <div key={idx} className="relative">
                        <div className="absolute -left-[25px] top-1.5 w-2 h-2 rounded-full bg-emerald-500" />
                        <h4 className="text-xs font-sans font-bold text-neutral-800">{item.title}</h4>
                        <p className="text-[10px] text-neutral-400 leading-snug mt-0.5">{item.subtitle}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 1: HOME SCREEN (and nested Bible search screens) */}
          {/* ======================================================== */}
          {currentScreen !== 'memberProfile' && currentScreen !== 'analyzePlan' && currentScreen !== 'fullHistory' && currentScreen !== 'recordingDetail' && currentTab === 'home' && (
            <div className="flex-1 flex flex-col p-5">
              
              {/* HOME SCREEN STATE */}
              {currentScreen === 'home' && (
                <div className="flex-1 flex flex-col space-y-5 animate-fade-in">
                  
                  {/* Top Editorial Header */}
                  <div className="pb-3 border-b border-[#E5E5E5] text-left">
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#888]">
                      {getTodayDateString()}
                    </p>
                    <h1 className="text-xl font-serif font-black mt-0.5 text-[#1A1A1A]">
                      Good morning, Kenneth.
                    </h1>
                  </div>

                  {/* TODAY'S DASHBOARD */}
                  {(() => {
                    const learningItems = memoryQueue.filter(item => item.status === 'learning');
                    const dueReviewItems = memoryQueue.filter(
                      item => item.status === 'reviewing' && (!item.nextReviewDueDate || new Date(item.nextReviewDueDate) <= new Date())
                    );
                    const queuedLookahead = memoryQueue.filter(item => item.status === 'queued').slice(0, primingLookahead);

                    const estMinutes = getEstimatedReviewTime(memoryQueue, cognitiveLoadSensitivity);
                    const shieldActive = estMinutes >= maxReviewCap;
                    const isLearningDay = isTodayLearningDay();

                    const groupQueueItems = (items: QueueItem[]) => {
                      const groups: { [key: string]: QueueItem[] } = {};
                      items.forEach(item => {
                        const key = `${item.book} ${item.chapter}`;
                        if (!groups[key]) groups[key] = [];
                        groups[key].push(item);
                      });
                      return Object.entries(groups).map(([key, list]) => {
                        const book = list[0].book;
                        const chapter = list[0].chapter;
                        list.sort((a, b) => a.verseNumber - b.verseNumber);
                        const versesStr = list.length === 1 
                          ? `${list[0].verseNumber}` 
                          : `${list[0].verseNumber}-${list[list.length - 1].verseNumber}`;
                        return {
                          label: `${key}:${versesStr}`,
                          book,
                          chapter,
                          items: list
                        };
                      });
                    };

                    const groupedLearning = groupQueueItems(learningItems);
                    const dailyReviewItems = dueReviewItems.filter(item => item.retentionPhase === 'daily');
                    const weeklyReviewItems = dueReviewItems.filter(item => item.retentionPhase === 'weekly');
                    const monthlyReviewItems = dueReviewItems.filter(item => item.retentionPhase === 'monthly');

                    const groupedDailyReviewing = groupQueueItems(dailyReviewItems);
                    const groupedWeeklyReviewing = groupQueueItems(weeklyReviewItems);
                    const groupedMonthlyReviewing = groupQueueItems(monthlyReviewItems);
                    const groupedPriming = groupQueueItems(queuedLookahead);

                    const handleGroupPractice = (mode: 'listen' | 'type' | 'reveal', items: QueueItem[]) => {
                      const vStates = mapQueueToVerseStates(items);
                      startPractice(mode, vStates);
                    };

                    const mapQueueToVerseStates = (items: QueueItem[]): VerseState[] => {
                      return items.map(item => ({
                        book: item.book,
                        chapter: item.chapter,
                        verse: item.verseNumber,
                        text: item.text,
                        status: item.status === 'retained' ? 'memorized' : 'learning'
                      }));
                    };

                    return (
                      <div className="space-y-4 text-left">
                        {/* TODAY'S CORE DASHBOARD CARD */}
                        <div className="border-2 border-[#1A1A1A] rounded-2xl p-5 bg-white text-left shadow-xs space-y-4">
                          <div className="flex justify-between items-center pb-3 border-b border-neutral-100">
                            <h2 className="font-serif font-black text-lg tracking-tight text-[#1A1A1A]">
                              Today's Scripture
                            </h2>
                            <span className="bg-[#1A1A1A] text-white text-[10px] px-3 py-1 rounded-full font-mono font-bold uppercase tracking-wider">
                              est. {estMinutes} mins
                            </span>
                          </div>

                          {/* LEARNING PHASE SECTION */}
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <div className="flex items-center">
                                <span className="text-xs font-sans font-extrabold uppercase tracking-wider text-neutral-400">
                                  Learning phase...
                                </span>
                                <HelpTooltip text="Verses currently in active study phase. Requires 3 successful touches in separate hours to graduate to Spaced Repetition." />
                              </div>
                              <span className="text-[10px] font-mono text-neutral-400 font-bold">
                                {learningItems.length} verses today
                              </span>
                            </div>
                            {groupedLearning.length > 0 ? (
                              <div className="space-y-2">
                                {groupedLearning.map((group) => (
                                  <div key={group.label} className="flex flex-col bg-neutral-50 px-3 py-2.5 rounded-xl border border-neutral-100 space-y-2">
                                    <div className="flex justify-between items-center">
                                      <button
                                        onClick={() => navigateTo('chapterLanding', group.book, group.chapter)}
                                        className="text-xs font-serif font-bold text-[#1A1A1A] hover:underline"
                                      >
                                        {group.label}
                                      </button>
                                      <div className="flex gap-1">
                                        <button 
                                          onClick={() => handleGroupPractice('listen', group.items)} 
                                          className="bg-white border border-neutral-300 text-neutral-700 text-[10px] w-6 h-5 flex items-center justify-center rounded hover:bg-neutral-100 font-bold transition cursor-pointer"
                                          title="Listen"
                                        >
                                          L
                                        </button>
                                        <button 
                                          onClick={() => handleGroupPractice('type', group.items)} 
                                          className="bg-white border border-neutral-300 text-[#1A1A1A] text-[10px] w-6 h-5 flex items-center justify-center rounded hover:bg-neutral-100 font-bold transition cursor-pointer"
                                          title="Type"
                                        >
                                          T
                                        </button>
                                        <button 
                                          onClick={() => handleGroupPractice('reveal', group.items)} 
                                          className="bg-white border border-neutral-300 text-neutral-700 text-[10px] w-6 h-5 flex items-center justify-center rounded hover:bg-neutral-100 font-bold transition cursor-pointer"
                                          title="Reveal"
                                        >
                                          R
                                        </button>
                                      </div>
                                    </div>
                                    
                                    {/* Individual Verse mastery progress bars/dots */}
                                    <div className="flex flex-wrap gap-x-2 gap-y-1 pt-1.5 border-t border-neutral-100/60">
                                      {group.items.map(item => {
                                        const touchesCount = item.touchLogs ? item.touchLogs.length : 0;
                                        return (
                                          <div key={item.verseId} className="flex items-center space-x-1.5 bg-white px-2 py-0.5 rounded-md border border-neutral-100">
                                            <span className="text-[9.5px] font-sans font-bold text-neutral-500">v{item.verseNumber}</span>
                                            <div className="flex gap-0.5">
                                              {Array.from({ length: masteryTouches }).map((_, i) => (
                                                <div 
                                                  key={i} 
                                                  className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${i < touchesCount ? 'bg-emerald-500 border border-emerald-600' : 'bg-neutral-200'}`}
                                                  title={`Touch ${i + 1}/${masteryTouches}`}
                                                />
                                              ))}
                                            </div>
                                            <span className="text-[8px] font-mono font-black text-neutral-400">{touchesCount}/{masteryTouches}</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-neutral-400 italic pl-1">No verses currently in learning phase.</p>
                            )}
                          </div>

                          {/* DUE REVIEWS SECTION */}
                          <div className="space-y-2 pt-1">
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-1">
                                <span className="text-xs font-sans font-extrabold uppercase tracking-wider text-neutral-400">
                                  Due reviews...
                                </span>
                                <HelpTooltip text="Spaced Repetition system reviews. Verses are scheduled in Daily, Weekly, and Monthly intervals based on your retention performance." />
                                <button
                                  onClick={triggerMockDueReviews}
                                  className="ml-2 text-[8px] bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-sans font-extrabold px-1.5 py-0.5 rounded transition cursor-pointer flex items-center gap-0.5"
                                  title="Force 3 verses to Due now to test reviews"
                                >
                                  🧪 Test: Force Due
                                </button>
                              </div>
                              <span className="text-[10px] font-mono text-neutral-400 font-bold">
                                {dueReviewItems.length} verses today
                              </span>
                            </div>
                            
                            {dueReviewItems.length > 0 ? (
                              <div className="space-y-2">
                                {/* Daily Reviews (Green) */}
                                {groupedDailyReviewing.length > 0 && (
                                  <div className="space-y-1.5">
                                    {groupedDailyReviewing.map((group) => (
                                      <div key={group.label} className="flex justify-between items-center bg-white px-3 py-2 rounded-xl border-l-4 border-l-emerald-500 border border-neutral-200 shadow-3xs">
                                        <button
                                          onClick={() => navigateTo('chapterLanding', group.book, group.chapter)}
                                          className="text-xs font-serif font-black text-emerald-900 hover:underline"
                                        >
                                          {group.label}
                                        </button>
                                        <div className="flex gap-1">
                                          <button 
                                            onClick={() => handleGroupPractice('listen', group.items)} 
                                            className="bg-white border border-emerald-200 text-emerald-700 text-[10px] w-6 h-5 flex items-center justify-center rounded hover:bg-emerald-50 font-bold transition cursor-pointer"
                                            title="Listen"
                                          >
                                            L
                                          </button>
                                          <button 
                                            onClick={() => handleGroupPractice('type', group.items)} 
                                            className="bg-white border border-emerald-200 text-emerald-700 text-[10px] w-6 h-5 flex items-center justify-center rounded hover:bg-emerald-50 font-bold transition cursor-pointer"
                                            title="Type"
                                          >
                                            T
                                          </button>
                                          <button 
                                            onClick={() => handleGroupPractice('reveal', group.items)} 
                                            className="bg-white border border-emerald-200 text-emerald-700 text-[10px] w-6 h-5 flex items-center justify-center rounded hover:bg-emerald-50 font-bold transition cursor-pointer"
                                            title="Reveal"
                                          >
                                            R
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Weekly Reviews (Blue) */}
                                {groupedWeeklyReviewing.length > 0 && (
                                  <div className="space-y-1.5">
                                    {groupedWeeklyReviewing.map((group) => (
                                      <div key={group.label} className="flex justify-between items-center bg-white px-3 py-2 rounded-xl border-l-4 border-l-blue-500 border border-neutral-200 shadow-3xs">
                                        <button
                                          onClick={() => navigateTo('chapterLanding', group.book, group.chapter)}
                                          className="text-xs font-serif font-black text-blue-900 hover:underline"
                                        >
                                          {group.label}
                                        </button>
                                        <div className="flex gap-1">
                                          <button 
                                            onClick={() => handleGroupPractice('listen', group.items)} 
                                            className="bg-white border border-blue-200 text-blue-700 text-[10px] w-6 h-5 flex items-center justify-center rounded hover:bg-blue-50 font-bold transition cursor-pointer"
                                            title="Listen"
                                          >
                                            L
                                          </button>
                                          <button 
                                            onClick={() => handleGroupPractice('type', group.items)} 
                                            className="bg-white border border-blue-200 text-blue-700 text-[10px] w-6 h-5 flex items-center justify-center rounded hover:bg-blue-50 font-bold transition cursor-pointer"
                                            title="Type"
                                          >
                                            T
                                          </button>
                                          <button 
                                            onClick={() => handleGroupPractice('reveal', group.items)} 
                                            className="bg-white border border-blue-200 text-blue-700 text-[10px] w-6 h-5 flex items-center justify-center rounded hover:bg-blue-50 font-bold transition cursor-pointer"
                                            title="Reveal"
                                          >
                                            R
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Monthly Reviews (Orange) */}
                                {groupedMonthlyReviewing.length > 0 && (
                                  <div className="space-y-1.5">
                                    {groupedMonthlyReviewing.map((group) => (
                                      <div key={group.label} className="flex justify-between items-center bg-white px-3 py-2 rounded-xl border-l-4 border-l-amber-500 border border-neutral-200 shadow-3xs">
                                        <button
                                          onClick={() => navigateTo('chapterLanding', group.book, group.chapter)}
                                          className="text-xs font-serif font-black text-amber-900 hover:underline"
                                        >
                                          {group.label}
                                        </button>
                                        <div className="flex gap-1">
                                          <button 
                                            onClick={() => handleGroupPractice('listen', group.items)} 
                                            className="bg-white border border-amber-200 text-amber-700 text-[10px] w-6 h-5 flex items-center justify-center rounded hover:bg-amber-50 font-bold transition cursor-pointer"
                                            title="Listen"
                                          >
                                            L
                                          </button>
                                          <button 
                                            onClick={() => handleGroupPractice('type', group.items)} 
                                            className="bg-white border border-amber-200 text-amber-700 text-[10px] w-6 h-5 flex items-center justify-center rounded hover:bg-amber-50 font-bold transition cursor-pointer"
                                            title="Type"
                                          >
                                            T
                                          </button>
                                          <button 
                                            onClick={() => handleGroupPractice('reveal', group.items)} 
                                            className="bg-white border border-amber-200 text-amber-700 text-[10px] w-6 h-5 flex items-center justify-center rounded hover:bg-amber-50 font-bold transition cursor-pointer"
                                            title="Reveal"
                                          >
                                            R
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-neutral-400 italic pl-1">No reviews due today! Keeping up nicely! 🎉</p>
                            )}
                          </div>

                          {/* PRIMING SECTION */}
                          <div className="pt-3 border-t border-neutral-100 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-sans font-extrabold uppercase tracking-wider text-neutral-400">
                                Memory Priming
                              </span>
                              <div className="flex items-center gap-1.5 bg-neutral-50 border border-neutral-200 px-2 py-0.5 rounded-lg text-[10px] font-sans">
                                <span className="font-bold text-neutral-500"># of verses</span>
                                <select
                                  id="lookahead_select"
                                  value={primingLookahead}
                                  onChange={(e) => setPrimingLookahead(Number(e.target.value))}
                                  className="bg-transparent text-[#1A1A1A] font-mono font-bold focus:outline-none cursor-pointer"
                                >
                                  <option value="10">10</option>
                                  <option value="20">20</option>
                                  <option value="30">30</option>
                                  <option value="40">40</option>
                                  <option value="50">50</option>
                                </select>
                              </div>
                            </div>
                            
                            {groupedPriming.length > 0 ? (
                              <div className="space-y-1.5">
                                {groupedPriming.map((group) => (
                                  <div key={group.label} className="flex justify-between items-center bg-white px-3 py-2 rounded-xl border border-neutral-150">
                                    <button
                                      onClick={() => navigateTo('chapterLanding', group.book, group.chapter)}
                                      className="text-xs font-serif font-bold text-[#1A1A1A] hover:underline"
                                    >
                                      {group.label}
                                    </button>
                                    <button
                                      onClick={() => handleGroupPractice('listen', group.items)}
                                      className="bg-neutral-100 hover:bg-neutral-200 text-[#1A1A1A] font-sans font-bold text-[10px] px-3 py-1 rounded-lg transition cursor-pointer"
                                    >
                                      Listen
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-neutral-400 italic pl-1">No queued verses remaining to prime!</p>
                            )}
                          </div>

                          {/* CARD FOOTER BUTTONS */}
                          <div className="pt-4 border-t border-neutral-100 flex gap-3 mt-4">
                            <button
                              onClick={() => navigateTo('activePlan')}
                              className="flex-1 py-2.5 border-2 border-[#1A1A1A] text-[#1A1A1A] hover:bg-neutral-50 transition rounded-xl font-sans font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-3xs"
                            >
                              Edit Memory Plan
                            </button>
                            <button
                              onClick={() => {
                                const allDashItems = [...learningItems, ...dueReviewItems, ...queuedLookahead];
                                if (allDashItems.length > 0) {
                                  handleGroupPractice('listen', allDashItems);
                                } else {
                                  triggerToast("No items on dashboard to loop!");
                                }
                              }}
                              className="flex-1 py-2.5 bg-[#1A1A1A] hover:bg-neutral-800 text-white transition rounded-xl font-sans font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                            >
                              <Volume2 size={13} />
                              Loop Today's Scripture
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* FEATURES GRID */}
                  <div className="grid grid-cols-3 gap-3">
                    {/* Feature 1 */}
                    <button 
                      onClick={() => navigateTo('audioFeed')}
                      className="border border-[#E5E5E5] hover:border-[#1A1A1A] p-3 rounded-xl bg-white flex flex-col items-center justify-center text-center space-y-1.5 transition cursor-pointer shadow-sm group h-24"
                    >
                      <Volume2 size={18} className="text-[#1A1A1A]" />
                      <span className="text-[10px] font-bold font-sans text-[#444] leading-tight group-hover:underline">
                        Find Audio Recordings
                      </span>
                    </button>
                    
                    {/* Feature 2: Plan Designer */}
                    <button 
                      onClick={() => navigateTo('planDesigner')}
                      className="border border-[#E5E5E5] hover:border-[#1A1A1A] p-3 rounded-xl bg-white flex flex-col items-center justify-center text-center space-y-1.5 transition cursor-pointer shadow-sm group h-24"
                    >
                      <Sliders size={18} className="text-[#1A1A1A]" />
                      <span className="text-[10px] font-bold font-sans text-[#444] leading-tight group-hover:underline">
                        Memory Plan Designer
                      </span>
                    </button>

                    {/* Feature 3: Verse Search / Bible */}
                    <button 
                      onClick={() => navigateTo('books')}
                      className="border-2 border-[#1A1A1A] hover:bg-neutral-50 p-3 rounded-xl bg-white flex flex-col items-center justify-center text-center space-y-1.5 transition cursor-pointer shadow-sm group h-24"
                    >
                      <BookMarked size={18} className="text-[#1A1A1A] animate-pulse" />
                      <span className="text-[10px] font-extrabold font-sans text-[#1A1A1A] leading-tight">
                        Verse Search / Bible
                      </span>
                    </button>
                  </div>

                </div>
              )}

              {/* BOOK SELECTION SCREEN */}
              {currentScreen === 'books' && (
                <div className="flex-1 flex flex-col space-y-4 animate-fade-in text-left">
                  {/* Header Row */}
                  <div className="flex items-center gap-3">
                    <button onClick={handleBack} className="w-8 h-8 rounded-full border border-[#E5E5E5] hover:border-[#1A1A1A] flex items-center justify-center text-[#1A1A1A] transition cursor-pointer bg-white">
                      <ArrowLeft size={15} />
                    </button>
                    <div>
                      <span className="text-[9px] uppercase tracking-wider font-bold text-[#888] font-sans">BIBLE DIRECTORY</span>
                      <h2 className="text-xl font-serif font-bold text-[#1A1A1A]">Select Book</h2>
                    </div>
                  </div>

                  {/* Testament Split lists */}
                  <div className="flex-1 overflow-y-auto space-y-5 pt-2">
                    
                    {/* Old Testament */}
                    <div className="space-y-2">
                      <span className="text-[10px] font-bold text-[#888] tracking-widest font-sans border-b border-[#E5E5E5] pb-1 block">
                        OLD TESTAMENT
                      </span>
                      <div className="divide-y divide-neutral-100 border border-[#E5E5E5] rounded-xl overflow-hidden bg-white">
                        {BOOKS.ot.map((book) => (
                          <button
                            key={book.name}
                            onClick={() => navigateTo('chapters', book.name)}
                            className="w-full px-4 py-3 text-left font-serif font-medium text-base text-[#1A1A1A] hover:bg-neutral-50 transition flex items-center justify-between cursor-pointer"
                          >
                            <span>{book.name}</span>
                            <ChevronRight size={16} className="text-[#888]" />
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* New Testament */}
                    <div className="space-y-2">
                      <span className="text-[10px] font-bold text-[#888] tracking-widest font-sans border-b border-[#E5E5E5] pb-1 block">
                        NEW TESTAMENT
                      </span>
                      <div className="divide-y divide-neutral-100 border border-[#E5E5E5] rounded-xl overflow-hidden bg-white">
                        {BOOKS.nt.map((book) => (
                          <button
                            key={book.name}
                            onClick={() => navigateTo('chapters', book.name)}
                            className="w-full px-4 py-3 text-left font-serif font-medium text-base text-[#1A1A1A] hover:bg-neutral-50 transition flex items-center justify-between cursor-pointer"
                          >
                            <span>{book.name}</span>
                            <ChevronRight size={16} className="text-[#888]" />
                          </button>
                        ))}
                      </div>
                    </div>

                  </div>
                </div>
              )}

              {/* CHAPTER SELECTION SCREEN */}
              {currentScreen === 'chapters' && (
                <div className="flex-1 flex flex-col space-y-4 animate-fade-in text-left">
                  {/* Header Row */}
                  <div className="flex items-center gap-3">
                    <button onClick={handleBack} className="w-8 h-8 rounded-full border border-[#E5E5E5] hover:border-[#1A1A1A] flex items-center justify-center text-[#1A1A1A] transition cursor-pointer bg-white">
                      <ArrowLeft size={15} />
                    </button>
                    <div>
                      <span className="text-[9px] uppercase tracking-wider font-bold text-[#888] font-sans">CHAPTERS AVAILABLE</span>
                      <h2 className="text-xl font-serif font-bold text-[#1A1A1A]">{selectedBook}</h2>
                    </div>
                  </div>

                  {/* Simple Grid of Chapters */}
                  <div className="flex-1 overflow-y-auto pt-3">
                    <div className="grid grid-cols-4 gap-3">
                      {/* Pull chapters based on chosen book from BOOKS dataset */}
                      {(() => {
                        const allCombinedBooks = [...BOOKS.ot, ...BOOKS.nt];
                        const bookData = allCombinedBooks.find(b => b.name === selectedBook);
                        if (!bookData) return <p className="text-[#888] text-xs">No chapters.</p>;
                        
                        return bookData.chapters.map((chNum) => (
                          <button
                            key={chNum}
                            onClick={() => navigateTo('chapterLanding', selectedBook, chNum)}
                            className="h-16 border-2 border-[#1A1A1A] rounded-xl bg-white hover:bg-[#F3F2F1] text-[#1A1A1A] font-serif font-bold text-lg flex items-center justify-center transition cursor-pointer shadow-sm active:scale-95"
                          >
                            {chNum}
                          </button>
                        ));
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {/* CHAPTER LANDING PAGE (CORE SCREEN) */}
              {currentScreen === 'chapterLanding' && (
                <div className="flex-1 flex flex-col space-y-4 animate-fade-in text-left relative h-full">
                  
                  {/* Title Header with back */}
                  <div className="flex items-center justify-between border-b border-[#E5E5E5] pb-2">
                    <div className="flex items-center gap-2">
                      <button onClick={handleBack} className="w-7 h-7 rounded-full border border-[#E5E5E5] hover:border-[#1A1A1A] flex items-center justify-center text-[#1A1A1A] transition cursor-pointer bg-white">
                        <ArrowLeft size={14} />
                      </button>
                      <h2 className="text-lg font-serif font-extrabold text-[#1A1A1A]">
                        {selectedBook} {selectedChapter}
                      </h2>
                    </div>

                    {/* Simple Select/Deselect All Verse trigger */}
                    <button 
                      onClick={toggleSelectAll} 
                      className="text-[10px] font-bold font-sans border border-[#1A1A1A] px-2 py-0.5 rounded uppercase hover:bg-neutral-50 transition text-[#1A1A1A]"
                    >
                      {selectedVerseNumbers.length === activeChapterVerses.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>

                  {/* Segmented Progress Bar */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-[9px] font-sans font-bold text-[#888]">
                      <span>CHAPTER PROGRESS</span>
                      <div className="flex space-x-2">
                        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block" /> Memorized</span>
                        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-amber-500 rounded-full inline-block" /> Learning</span>
                        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-neutral-200 rounded-full inline-block" /> Untouched</span>
                      </div>
                    </div>
                    {/* Horizontal split colored indicator based on verses */}
                    <div className="flex h-3 w-full border border-[#1A1A1A] rounded-full overflow-hidden bg-[#F3F2F1]">
                      {activeChapterVerses.map((v, idx) => {
                        const statusColor = v.status === 'memorized' 
                          ? 'bg-emerald-500' 
                          : v.status === 'learning' 
                            ? 'bg-amber-400' 
                            : 'bg-neutral-200';
                        return (
                          <div 
                            key={v.verse} 
                            className={`${statusColor} flex-1 border-r last:border-0 border-white/50 transition-all`}
                            title={`Verse ${v.verse}: ${v.status}`}
                          />
                        );
                      })}
                    </div>
                  </div>

                  {/* Playable Custom Audio Card */}
                  <div className="border border-[#1A1A1A] rounded-xl p-3 bg-white space-y-2.5">
                    {(() => {
                      const activeChapterKey = `${selectedBook}_${selectedChapter}`;
                      const currentAudio = selectedChapterAudios[activeChapterKey] || {
                        id: 'default_narration',
                        title: `${selectedBook} ${selectedChapter} Official Audio Narration`,
                        user: 'Kenneth Carter',
                        translation: 'ESV',
                        duration: 120
                      };

                      // Filter user recordings saved in library that matches this chapter
                      const availableNarrations = userRecordings.filter(r => 
                        r.book.toLowerCase() === selectedBook.toLowerCase() && 
                        r.chapter === selectedChapter
                      );

                      // Ensure default narration is always an option
                      const optionsList = [
                        {
                          id: 'default_narration',
                          title: `${selectedBook} ${selectedChapter} Official Narration`,
                          user: 'Kenneth Carter',
                          translation: 'ESV',
                          duration: 120
                        },
                        ...availableNarrations
                      ];

                      return (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => {
                                  if (audioPlaying) {
                                    setAudioPlaying(false);
                                  } else {
                                    setAudioPlaying(true);
                                    setAudioPlaybackProgress(0);
                                  }
                                }}
                                className={`w-8 h-8 rounded-full flex items-center justify-center transition cursor-pointer ${
                                  audioPlaying ? 'bg-[#1A1A1A] text-white' : 'border border-[#1A1A1A] text-[#1A1A1A] hover:bg-neutral-50'
                                }`}
                              >
                                {audioPlaying ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}
                              </button>
                              <div className="text-left">
                                <p className="text-xs font-bold font-sans text-[#1A1A1A] truncate max-w-[170px]" title={currentAudio.title}>
                                  {currentAudio.title}
                                </p>
                                <p className="text-[10px] font-sans text-neutral-400">
                                  Narrator: {currentAudio.user} • {currentAudio.translation}
                                </p>
                              </div>
                            </div>
                            <button 
                              onClick={() => setShowAudioSelector(!showAudioSelector)}
                              className="text-[10px] font-bold font-sans underline text-neutral-600 hover:text-[#1A1A1A] flex items-center gap-0.5 cursor-pointer"
                            >
                              <span>Change</span>
                              <ChevronDown size={11} className={`transition ${showAudioSelector ? 'rotate-180' : ''}`} />
                            </button>
                          </div>

                          {/* Simulated playing progress bar */}
                          {audioPlaying && (
                            <div className="space-y-0.5">
                              <div className="w-full bg-neutral-100 h-1 rounded-full overflow-hidden">
                                <div className="bg-[#1A1A1A] h-full transition-all duration-150" style={{ width: `${audioPlaybackProgress}%` }} />
                              </div>
                              <div className="flex justify-between text-[8px] font-mono font-semibold text-neutral-400">
                                <span>{formatTime(Math.round((audioPlaybackProgress / 100) * currentAudio.duration))}</span>
                                <span>{formatTime(currentAudio.duration)}</span>
                              </div>
                            </div>
                          )}

                          {/* Dropdown Selector */}
                          {showAudioSelector && (
                            <div className="bg-[#F3F2F1] rounded-lg p-2.5 border border-[#E5E5E5] space-y-2 text-xs animate-slide-down">
                              <p className="text-[9px] font-bold uppercase text-neutral-400 tracking-wider">Select Audio Source</p>
                              <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-0.5">
                                {optionsList.map((opt) => {
                                  const isSelected = currentAudio.id === opt.id;
                                  return (
                                    <button
                                      key={opt.id}
                                      onClick={() => {
                                        setSelectedChapterAudios(prev => ({
                                          ...prev,
                                          [activeChapterKey]: opt as Recording
                                        }));
                                        setShowAudioSelector(false);
                                        setAudioPlaying(false);
                                        triggerToast(`Audio changed to ${opt.user}'s recitation`);
                                      }}
                                      className={`w-full text-left p-2 rounded-md border flex items-center justify-between transition ${
                                        isSelected 
                                          ? 'bg-white border-[#1A1A1A] text-[#1A1A1A]' 
                                          : 'bg-white/60 hover:bg-white border-[#E5E5E5]/50 text-neutral-600'
                                      }`}
                                    >
                                      <div className="truncate max-w-[190px]">
                                        <p className="font-bold text-[10px] truncate">{opt.title}</p>
                                        <p className="text-[8px] text-neutral-400 font-sans">{opt.user} • {opt.translation}</p>
                                      </div>
                                      {isSelected && <Check size={11} className="text-[#1A1A1A] flex-shrink-0" />}
                                    </button>
                                  );
                                })}
                              </div>

                              <div className="border-t border-[#E5E5E5]/60 pt-2">
                                <button
                                  onClick={() => {
                                    setFeedBookFilter(selectedBook);
                                    setFeedChapterFilter(selectedChapter.toString());
                                    setCurrentScreen('audioFeed');
                                    setShowAudioSelector(false);
                                    triggerToast(`Filtered suggested library for ${selectedBook} ${selectedChapter}`);
                                  }}
                                  className="w-full text-center py-1.5 bg-[#1A1A1A] hover:bg-neutral-850 text-white font-sans font-bold text-[10px] uppercase tracking-wider rounded-md flex items-center justify-center gap-1 transition cursor-pointer"
                                >
                                  <Search size={11} />
                                  <span>Find More Recordings</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Grid / List view Toggle */}
                  <div className="flex items-center justify-between bg-[#F3F2F1] p-1.5 border border-[#E5E5E5] rounded-xl">
                    <span className="text-xs font-sans font-bold text-neutral-600 pl-1">Verse Layout</span>
                    <div className="flex bg-white border border-[#E5E5E5] rounded-lg p-0.5 shadow-sm">
                      <button 
                        onClick={() => setChapterViewMode('list')}
                        className={`p-1.5 rounded-md flex items-center gap-1 text-xs font-bold transition cursor-pointer ${
                          chapterViewMode === 'list' ? 'bg-[#1A1A1A] text-white' : 'text-neutral-500 hover:text-[#1A1A1A]'
                        }`}
                      >
                        <ListIcon size={13} /> List View
                      </button>
                      <button 
                        onClick={() => setChapterViewMode('grid')}
                        className={`p-1.5 rounded-md flex items-center gap-1 text-xs font-bold transition cursor-pointer ${
                          chapterViewMode === 'grid' ? 'bg-[#1A1A1A] text-white' : 'text-neutral-500 hover:text-[#1A1A1A]'
                        }`}
                      >
                        <GridIcon size={13} /> Grid View
                      </button>
                    </div>
                  </div>

                  {/* Dynamic Scrollable verses area */}
                  <div className="flex-1 overflow-y-auto max-h-[300px] pr-1.5 pb-20">
                    
                    {chapterViewMode === 'list' ? (
                      /* LIST VIEW */
                      <div className="space-y-2.5">
                        {activeChapterVerses.map((v) => {
                          const isSelected = isVerseSelected(v.verse);
                          const dotColor = v.status === 'memorized' 
                            ? 'bg-emerald-500' 
                            : v.status === 'learning' 
                              ? 'bg-amber-400' 
                              : 'bg-neutral-200';
                          
                          return (
                            <div
                              key={v.verse}
                              onClick={() => toggleVerseSelection(v.verse)}
                              className={`border rounded-xl p-3 text-left transition duration-150 cursor-pointer select-none relative ${
                                isSelected 
                                  ? 'border-[#1A1A1A] bg-[#F3F2F1]/30 shadow-sm ring-1 ring-[#1A1A1A]' 
                                  : 'border-[#E5E5E5] bg-white hover:bg-neutral-50/50'
                              }`}
                            >
                              <div className="flex items-start gap-2.5">
                                {/* Dot Status indicator */}
                                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotColor}`} />
                                <div className="flex-1 pr-12">
                                  <p className="font-serif text-sm leading-relaxed text-[#1A1A1A]">
                                    <span className="font-sans text-xs font-bold text-neutral-400 mr-1.5">v{v.verse}</span>
                                    {v.text}
                                  </p>
                                </div>
                              </div>
                              {/* Due status badge */}
                              {v.dueDate && (
                                <span className="absolute top-2.5 right-2.5 text-[8px] font-sans font-bold text-neutral-400 bg-[#F3F2F1] border px-1.5 py-0.5 rounded">
                                  {v.dueDate}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      /* GRID VIEW - Compact & informative with word snippets */
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        {activeChapterVerses.map((v) => {
                          const isSelected = isVerseSelected(v.verse);
                          const statusBorder = v.status === 'memorized' 
                            ? 'border-l-3 border-l-emerald-500' 
                            : v.status === 'learning' 
                              ? 'border-l-3 border-l-amber-500' 
                              : 'border-l-3 border-l-neutral-300';
                          
                          const textSnippet = v.text 
                            ? v.text.split(/\s+/).slice(0, 4).join(' ') + '...' 
                            : 'No text...';
                          
                          return (
                            <div
                              key={v.verse}
                              onClick={() => toggleVerseSelection(v.verse)}
                              className={`h-16 rounded-xl bg-white border border-[#E5E5E5] p-2 text-left flex flex-col justify-between cursor-pointer relative transition select-none hover:bg-neutral-50/50 ${statusBorder} ${
                                isSelected ? 'ring-2 ring-[#1A1A1A] border-[#1A1A1A] scale-102 shadow-xs' : 'active:scale-95 shadow-2xs'
                              }`}
                            >
                              <div className="flex justify-between items-center leading-none">
                                <span className="text-[9px] font-sans font-extrabold text-[#1A1A1A]">
                                  v{v.verse}
                                </span>
                                {v.status === 'memorized' && (
                                  <span className="text-[7px] font-mono font-bold bg-emerald-500/10 text-emerald-700 px-1 rounded uppercase scale-90 origin-right">
                                    MEM
                                  </span>
                                )}
                                {v.status === 'learning' && (
                                  <span className="text-[7px] font-mono font-bold bg-amber-500/15 text-amber-700 px-1 rounded uppercase scale-90 origin-right">
                                    LRN
                                  </span>
                                )}
                              </div>
                              <p className="font-serif italic text-[8.5px] leading-tight text-neutral-500 line-clamp-2 mt-1">
                                {textSnippet}
                              </p>
                              {isSelected && (
                                <div className="absolute -top-1 -right-1 bg-black text-white w-3.5 h-3.5 rounded-full flex items-center justify-center border border-white text-[8px] font-black">
                                  ✓
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Floating Action Menu (Appears when 1+ verses selected) */}
                  {selectedVerseNumbers.length > 0 && (
                    <div className="absolute bottom-1 right-0 left-0 bg-white border-2 border-[#1A1A1A] rounded-xl p-3 shadow-lg flex items-center justify-between z-40 animate-slide-up">
                      <div className="text-left pl-1">
                        <span className="text-[9px] font-bold text-neutral-400 block uppercase font-sans">SELECTED</span>
                        <span className="text-xs font-extrabold font-sans text-[#1A1A1A]">{selectedVerseNumbers.length} {selectedVerseNumbers.length === 1 ? 'Verse' : 'Verses'}</span>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => startPractice('listen', activeChapterVerses.filter(v => selectedVerseNumbers.includes(v.verse)))}
                          className="py-1.5 px-3 bg-[#1A1A1A] hover:bg-neutral-850 text-white text-[10px] font-bold rounded-lg uppercase tracking-wider cursor-pointer"
                        >
                          Listen
                        </button>
                        <button
                          onClick={() => startPractice('type', activeChapterVerses.filter(v => selectedVerseNumbers.includes(v.verse)))}
                          className="py-1.5 px-3 bg-[#1A1A1A] hover:bg-neutral-850 text-white text-[10px] font-bold rounded-lg uppercase tracking-wider cursor-pointer"
                        >
                          Type
                        </button>
                        <button
                          onClick={() => startPractice('reveal', activeChapterVerses.filter(v => selectedVerseNumbers.includes(v.verse)))}
                          className="py-1.5 px-3 bg-[#1A1A1A] hover:bg-neutral-850 text-white text-[10px] font-bold rounded-lg uppercase tracking-wider cursor-pointer"
                        >
                          Reveal
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              )}

              {/* AUDIO RECORDINGS FEED / EXPLORER SCREEN */}
              {currentScreen === 'audioFeed' && (
                <div className="flex-1 flex flex-col space-y-4 animate-fade-in text-left relative h-full">
                  
                  {/* Header Row */}
                  <div className="flex items-center gap-3 border-b border-[#E5E5E5] pb-1">
                    <button onClick={handleBack} className="w-8 h-8 rounded-full border border-[#E5E5E5] hover:border-[#1A1A1A] flex items-center justify-center text-[#1A1A1A] transition cursor-pointer bg-white shadow-sm">
                      <ArrowLeft size={15} />
                    </button>
                    <div>
                      <span className="text-[9px] uppercase tracking-wider font-bold text-[#888] font-sans">SCRIPTURE AUDIO LIBRARY</span>
                      <h2 className="text-xl font-serif font-bold text-[#1A1A1A]">Suggested Recordings</h2>
                    </div>
                  </div>

                  {/* Search Bar */}
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 text-neutral-400 w-4 h-4" />
                    <input
                      type="text"
                      value={audioSearchQuery}
                      onChange={(e) => setAudioSearchQuery(e.target.value)}
                      placeholder="Search by book, verses, or reciter..."
                      className="w-full bg-[#F3F2F1] border border-[#E5E5E5] rounded-xl py-2 pl-9 pr-8 text-xs focus:outline-none focus:ring-1 focus:ring-[#1A1A1A] text-[#1A1A1A] placeholder-neutral-400"
                    />
                    {audioSearchQuery && (
                      <button 
                        onClick={() => setAudioSearchQuery('')} 
                        className="absolute right-3 top-2.5 text-neutral-400 hover:text-black cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Book and Chapter Dropdowns under Search */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[8px] font-bold uppercase text-neutral-400 font-sans tracking-wider block">Book</label>
                      <select
                        value={feedBookFilter}
                        onChange={(e) => {
                          setFeedBookFilter(e.target.value);
                          setFeedChapterFilter(''); // Reset chapter when book changes
                          setPlayingRecordingId(null);
                        }}
                        className="w-full bg-[#F3F2F1] border border-[#E5E5E5] rounded-xl py-2 px-2.5 text-xs text-[#1A1A1A] focus:outline-none focus:ring-1 focus:ring-[#1A1A1A] font-bold"
                      >
                        <option value="">All Books</option>
                        <option value="Genesis">Genesis</option>
                        <option value="Psalms">Psalms</option>
                        <option value="John">John</option>
                        <option value="Romans">Romans</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[8px] font-bold uppercase text-neutral-400 font-sans tracking-wider block">Chapter</label>
                      <select
                        value={feedChapterFilter}
                        onChange={(e) => {
                          setFeedChapterFilter(e.target.value);
                          setPlayingRecordingId(null);
                        }}
                        className="w-full bg-[#F3F2F1] border border-[#E5E5E5] rounded-xl py-2 px-2.5 text-xs text-[#1A1A1A] focus:outline-none focus:ring-1 focus:ring-[#1A1A1A] font-bold"
                      >
                        <option value="">All Chapters</option>
                        {feedBookFilter === 'Genesis' && (
                          <>
                            <option value="1">Chapter 1</option>
                            <option value="2">Chapter 2</option>
                            <option value="3">Chapter 3</option>
                          </>
                        )}
                        {feedBookFilter === 'Psalms' && (
                          <>
                            <option value="23">Chapter 23</option>
                            <option value="119">Chapter 119</option>
                          </>
                        )}
                        {feedBookFilter === 'John' && (
                          <>
                            <option value="1">Chapter 1</option>
                            <option value="15">Chapter 15</option>
                          </>
                        )}
                        {feedBookFilter === 'Romans' && (
                          <>
                            <option value="8">Chapter 8</option>
                            <option value="12">Chapter 12</option>
                          </>
                        )}
                        {!feedBookFilter && (
                          <>
                            <option value="1">Chapter 1</option>
                            <option value="2">Chapter 2</option>
                            <option value="3">Chapter 3</option>
                            <option value="8">Chapter 8</option>
                            <option value="12">Chapter 12</option>
                            <option value="15">Chapter 15</option>
                            <option value="23">Chapter 23</option>
                            <option value="119">Chapter 119</option>
                          </>
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Filter Tabs */}
                  <div className="grid grid-cols-3 gap-1 bg-[#F3F2F1] p-1 border border-[#E5E5E5] rounded-xl text-center select-none font-sans font-bold">
                    <button 
                      onClick={() => {
                        setActiveFeedFilter('global');
                        setPlayingRecordingId(null);
                      }}
                      className={`py-2 px-2 rounded-lg text-[10px] uppercase tracking-wider transition cursor-pointer ${activeFeedFilter === 'global' ? 'bg-[#1A1A1A] text-white shadow-sm' : 'text-neutral-500 hover:text-[#1A1A1A]'}`}
                    >
                      Global
                    </button>
                    <button 
                      onClick={() => {
                        setActiveFeedFilter('group');
                        setPlayingRecordingId(null);
                      }}
                      className={`py-2 px-2 rounded-lg text-[10px] uppercase tracking-wider transition cursor-pointer ${activeFeedFilter === 'group' ? 'bg-[#1A1A1A] text-white shadow-sm' : 'text-neutral-500 hover:text-[#1A1A1A]'}`}
                    >
                      My Group
                    </button>
                    <button 
                      onClick={() => {
                        setActiveFeedFilter('friends');
                        setPlayingRecordingId(null);
                      }}
                      className={`py-2 px-2 rounded-lg text-[10px] uppercase tracking-wider transition cursor-pointer ${activeFeedFilter === 'friends' ? 'bg-[#1A1A1A] text-white shadow-sm' : 'text-neutral-500 hover:text-[#1A1A1A]'}`}
                    >
                      Friends
                    </button>
                  </div>

                  {/* List of recordings */}
                  <div className="flex-1 overflow-y-auto max-h-[380px] pr-1 pb-10 space-y-3" id="audio_feed_list">
                    {(() => {
                      // 1. Filter by category
                      let filtered = feedRecordings;
                      if (activeFeedFilter === 'group') {
                        filtered = feedRecordings.filter(r => r.category === 'group' || r.user === 'Kenneth Carter');
                      } else if (activeFeedFilter === 'friends') {
                        filtered = feedRecordings.filter(r => r.category === 'friends' || r.user === 'Sarah Miller' || r.user === 'Elizabeth K.' || r.user === 'Kenneth Carter');
                      }

                      // 2. Filter by Book selection
                      if (feedBookFilter) {
                        filtered = filtered.filter(r => r.book.toLowerCase() === feedBookFilter.toLowerCase());
                      }

                      // 3. Filter by Chapter selection
                      if (feedChapterFilter) {
                        filtered = filtered.filter(r => r.chapter.toString() === feedChapterFilter);
                      }

                      // 4. Filter by search query
                      if (audioSearchQuery.trim()) {
                        const q = audioSearchQuery.toLowerCase();
                        filtered = filtered.filter(r => 
                          (r.user && r.user.toLowerCase().includes(q)) ||
                          r.title.toLowerCase().includes(q) ||
                          r.book.toLowerCase().includes(q) ||
                          r.translation.toLowerCase().includes(q)
                        );
                      }

                      if (filtered.length === 0) {
                        return (
                          <div className="text-center p-8 bg-neutral-50 rounded-xl border border-dashed border-[#E5E5E5] text-xs text-neutral-400 space-y-2">
                            <Volume2 className="w-8 h-8 text-neutral-300 mx-auto" />
                            <p className="font-sans font-bold">No recordings matched your criteria</p>
                            <p className="text-[10px] font-sans">Be the first to share! Record a recitation under the Record tab and save it to your profile feed.</p>
                          </div>
                        );
                      }

                      // Helper to assign background colors to users
                      const getAvatarStyle = (user: string = '') => {
                        switch (user) {
                          case 'Sarah Miller': return 'bg-teal-50 text-teal-700 border border-teal-200';
                          case 'Elizabeth K.': return 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200';
                          case 'Brother Thomas': return 'bg-amber-50 text-amber-700 border border-amber-200';
                          case 'Mark Davis': return 'bg-blue-50 text-blue-700 border border-blue-200';
                          case 'Pastor Robert': return 'bg-indigo-50 text-indigo-700 border border-indigo-200';
                          case 'Grace Thompson': return 'bg-rose-50 text-rose-700 border border-rose-200';
                          case 'Kenneth Carter': return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
                          default: return 'bg-neutral-100 text-[#1A1A1A] border border-[#E5E5E5]';
                        }
                      };

                      return filtered.map((rec) => {
                        const isPlaying = playingRecordingId === rec.id;
                        const avatarClass = getAvatarStyle(rec.user);
                        
                        return (
                          <div key={rec.id} className="border border-[#E5E5E5] hover:border-[#1A1A1A] rounded-xl p-3.5 bg-white space-y-3 transition shadow-xs">
                            
                            {/* Card Top: Reciter Info */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2.5">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-sans font-bold text-xs select-none ${avatarClass}`}>
                                  {rec.avatar || 'U'}
                                </div>
                                <div className="text-left">
                                  <div className="flex items-center gap-1.5">
                                    <h4 className="text-xs font-bold text-[#1A1A1A]">{rec.user || 'Anonymous'}</h4>
                                    {rec.user === 'Kenneth Carter' ? (
                                      <span className="text-[8px] bg-emerald-100 text-emerald-700 font-sans px-1.5 py-0.2 rounded font-bold uppercase tracking-wide">Me</span>
                                    ) : (rec.user === 'Sarah Miller' || rec.user === 'Elizabeth K.') ? (
                                      <span className="text-[8px] bg-indigo-50 text-indigo-600 font-sans px-1.5 py-0.2 rounded font-bold uppercase tracking-wide">Friend</span>
                                    ) : (rec.user === 'Brother Thomas' || rec.user === 'Mark Davis') ? (
                                      <span className="text-[8px] bg-amber-50 text-amber-700 font-sans px-1.5 py-0.2 rounded font-bold uppercase tracking-wide">Group</span>
                                    ) : (
                                      <span className="text-[8px] bg-neutral-100 text-neutral-500 font-sans px-1.5 py-0.2 rounded font-bold uppercase tracking-wide">Public</span>
                                    )}
                                  </div>
                                  <p className="text-[9px] font-sans text-neutral-400">{rec.date} • {rec.translation}</p>
                                </div>
                              </div>
                              <span className="text-[10px] font-mono font-bold text-neutral-500 bg-[#F3F2F1] px-2 py-0.5 rounded-md">
                                {formatTime(rec.duration)}
                              </span>
                            </div>

                            {/* Card Middle: Title & Scripture Info */}
                            <div className="text-left bg-neutral-50/50 p-2.5 border border-[#E5E5E5]/55 rounded-lg">
                              <div className="flex items-center gap-1.5 text-neutral-500">
                                <BookOpen size={11} />
                                <span className="text-[10px] font-sans font-bold uppercase tracking-wide text-neutral-700">
                                  {rec.book} {rec.chapter} • Full Chapter
                                </span>
                              </div>
                            </div>

                            {/* Card Bottom: Play / Pause & Save to Library */}
                            <div className="flex items-center justify-between pt-1 border-t border-neutral-50">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    if (isPlaying) {
                                      setPlayingRecordingId(null);
                                    } else {
                                      setPlayingRecordingId(rec.id);
                                      setPlayingRecProgress(0);
                                    }
                                  }}
                                  className={`w-7 h-7 rounded-full flex items-center justify-center transition cursor-pointer ${
                                    isPlaying ? 'bg-[#1A1A1A] text-white' : 'border border-[#1A1A1A] hover:bg-[#F3F2F1] text-[#1A1A1A]'
                                  }`}
                                >
                                  {isPlaying ? <Pause size={11} /> : <Play size={11} className="ml-0.5" />}
                                </button>
                                <span className="text-[10px] font-sans font-bold text-[#1A1A1A]">
                                  {isPlaying ? 'Playing Narration' : 'Tap to Listen'}
                                </span>
                              </div>

                              {(() => {
                                const isSaved = userRecordings.some(ur => ur.id === rec.id || (ur.book === rec.book && ur.chapter === rec.chapter && ur.user === rec.user && ur.translation === rec.translation));
                                return (
                                  <button
                                    onClick={() => {
                                      if (isSaved) {
                                        triggerToast(`"${rec.title}" is already in your library!`);
                                        return;
                                      }
                                      // Save to user's library
                                      const savedRec = {
                                        ...rec,
                                        id: `saved_${Date.now()}_${rec.id}`
                                      };
                                      setUserRecordings(prev => [savedRec, ...prev]);
                                      triggerToast(`Saved to My Library! Added to your ${rec.book} ${rec.chapter} options. 📚`);
                                    }}
                                    className={`flex items-center gap-1 py-1.5 px-3 rounded-lg text-[10px] font-sans font-bold transition cursor-pointer ${
                                      isSaved 
                                        ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' 
                                        : 'bg-neutral-50 hover:bg-[#F3F2F1] border border-[#E5E5E5] text-[#1A1A1A]'
                                    }`}
                                  >
                                    {isSaved ? <Check size={11} className="text-emerald-600" /> : <Plus size={11} className="text-neutral-500" />}
                                    <span>{isSaved ? 'Saved to Library' : 'Save to Library'}</span>
                                  </button>
                                );
                              })()}
                            </div>

                            {/* Custom Playback Progress indicator inside the active card */}
                            {isPlaying && (
                              <div className="space-y-1 pt-1">
                                <div className="w-full bg-neutral-100 h-1 rounded-full overflow-hidden">
                                  <div className="bg-[#1A1A1A] h-full" style={{ width: `${playingRecProgress}%` }} />
                                </div>
                                <div className="flex justify-between text-[8px] font-mono font-semibold text-neutral-400">
                                  <span>{formatTime(Math.round((playingRecProgress / 100) * rec.duration))}</span>
                                  <span>{formatTime(rec.duration)}</span>
                                </div>
                              </div>
                            )}

                          </div>
                        );
                      });
                    })()}
                  </div>

                </div>
              )}

              {/* SCRIPTURE MEMORY PLAN DESIGNER SCREEN */}
              {currentScreen === 'planDesigner' && (
                <div className="flex-1 flex flex-col space-y-4 animate-fade-in text-left pb-12">
                  
                  {/* Header Row */}
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={handleBack} 
                      className="w-8 h-8 rounded-full border border-[#E5E5E5] hover:border-[#1A1A1A] flex items-center justify-center text-[#1A1A1A] transition cursor-pointer bg-white"
                    >
                      <ArrowLeft size={15} />
                    </button>
                    <div>
                      <span className="text-[9px] uppercase tracking-wider font-bold text-[#888] font-sans">Settings</span>
                      <h2 className="text-xl font-serif font-bold text-[#1A1A1A]">Memory Plan Designer</h2>
                    </div>
                  </div>
                  <p className="text-xs text-neutral-500 font-sans -mt-1 leading-relaxed">
                    Customize your pacing and daily routine.
                  </p>

                  {/* Quick Presets Section */}
                  <div className="space-y-2 pt-1">
                    <span className="text-[9px] uppercase tracking-wider font-bold text-[#888] font-sans block">
                      Quick Presets
                    </span>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => {
                          setPreset('drip');
                          setLearningDays(['M', 'T', 'W', 'Th', 'F']);
                          setReviewingDays(['M', 'T', 'W', 'Th', 'F', 'S', 'Su']);
                          setPrimingDays(['M', 'T', 'W', 'Th', 'F']);
                          setNewVersesPace(2);
                          setMaxReviewCap(10);
                          triggerToast("Loaded 'The Daily Drip' preset! 💧");
                        }}
                        className={`border-2 rounded-xl p-2.5 text-left transition cursor-pointer flex flex-col justify-between h-[100px] ${
                          preset === 'drip' 
                            ? 'border-[#1A1A1A] bg-[#1A1A1A] text-white shadow-sm' 
                            : 'border-[#E5E5E5] bg-white hover:bg-neutral-50 text-[#1A1A1A]'
                        }`}
                      >
                        <div>
                          <p className={`text-[8px] font-sans font-bold uppercase tracking-wider ${preset === 'drip' ? 'text-neutral-300' : 'text-neutral-400'}`}>Pacing</p>
                          <h4 className="text-[11px] font-serif font-black leading-tight mt-0.5">The Daily Drip</h4>
                        </div>
                        <p className={`text-[8px] font-sans leading-tight ${preset === 'drip' ? 'text-neutral-200' : 'text-neutral-500'}`}>2 v/day • M-F</p>
                      </button>

                      <button
                        onClick={() => {
                          setPreset('warrior');
                          setLearningDays(['S', 'Su']);
                          setReviewingDays(['M', 'T', 'W', 'Th', 'F', 'S', 'Su']);
                          setPrimingDays(['M', 'T', 'W', 'Th', 'F']);
                          setNewVersesPace(5);
                          setMaxReviewCap(20);
                          triggerToast("Loaded 'Weekend Warrior' preset! ⚔️");
                        }}
                        className={`border-2 rounded-xl p-2.5 text-left transition cursor-pointer flex flex-col justify-between h-[100px] ${
                          preset === 'warrior' 
                            ? 'border-[#1A1A1A] bg-[#1A1A1A] text-white shadow-sm' 
                            : 'border-[#E5E5E5] bg-white hover:bg-neutral-50 text-[#1A1A1A]'
                        }`}
                      >
                        <div>
                          <p className={`text-[8px] font-sans font-bold uppercase tracking-wider ${preset === 'warrior' ? 'text-neutral-300' : 'text-neutral-400'}`}>Intense</p>
                          <h4 className="text-[11px] font-serif font-black leading-tight mt-0.5">Weekend Warrior</h4>
                        </div>
                        <p className={`text-[8px] font-sans leading-tight ${preset === 'warrior' ? 'text-neutral-200' : 'text-neutral-500'}`}>5 v/day • S-Su</p>
                      </button>

                      <button
                        onClick={() => {
                          setPreset('custom');
                          triggerToast("Switched to Custom configuration.");
                        }}
                        className={`border-2 rounded-xl p-2.5 text-left transition cursor-pointer flex flex-col justify-between h-[100px] ${
                          preset === 'custom' 
                            ? 'border-2 border-[#1A1A1A] bg-[#FBF9F6] text-[#1A1A1A] shadow-md' 
                            : 'border-[#E5E5E5] bg-white hover:bg-neutral-50 text-[#1A1A1A]'
                        }`}
                      >
                        <div>
                          <div className="flex justify-between items-center">
                            <p className="text-[8px] font-sans font-bold uppercase tracking-wider text-neutral-400">Flex</p>
                            {preset === 'custom' && <div className="w-1.5 h-1.5 bg-amber-500 rounded-full" />}
                          </div>
                          <h4 className="text-[11px] font-serif font-black leading-tight mt-0.5">Custom</h4>
                        </div>
                        <p className="text-[8px] font-sans text-neutral-500 leading-tight">Your custom rhythm</p>
                      </button>
                    </div>
                  </div>

                  {/* Weekly Rhythm section */}
                  <div className="border-2 border-[#1A1A1A] rounded-xl p-3.5 bg-white space-y-4 shadow-sm">
                    <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
                      <h3 className="text-xs font-sans font-extrabold uppercase tracking-widest text-[#1A1A1A]">Weekly Rhythm</h3>
                      <span className="text-[8px] bg-neutral-100 text-[#1A1A1A] border border-neutral-300 px-1.5 py-0.5 rounded font-mono font-bold uppercase">
                        {preset === 'drip' ? 'The Daily Drip' : preset === 'warrior' ? 'Weekend Warrior' : 'Custom'}
                      </span>
                    </div>

                    {/* Helper to toggle day in states */}
                    {(() => {
                      const toggleDay = (day: string, list: string[], setList: React.Dispatch<React.SetStateAction<string[]>>) => {
                        if (list.includes(day)) {
                          setList(list.filter(d => d !== day));
                        } else {
                          setList([...list, day]);
                        }
                        setPreset('custom');
                      };

                      const DAYS = ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'];

                      return (
                        <div className="space-y-4">
                          {/* Learning Days */}
                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-serif font-bold text-[#1A1A1A]">Learning Days</span>
                              <span className="text-[9px] font-mono font-bold text-neutral-400 bg-neutral-50 border px-1 rounded">{learningDays.length}/7 active</span>
                            </div>
                            <div className="flex justify-between">
                              {DAYS.map((day) => {
                                const isActive = learningDays.includes(day);
                                return (
                                  <button
                                    key={`learn-${day}`}
                                    onClick={() => toggleDay(day, learningDays, setLearningDays)}
                                    className={`w-7 h-7 rounded-full font-sans font-bold text-[10px] border transition cursor-pointer flex items-center justify-center select-none ${
                                      isActive 
                                        ? 'bg-[#1A1A1A] text-white border-[#1A1A1A] shadow-sm' 
                                        : 'bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400'
                                    }`}
                                  >
                                    {day}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Reviewing Days */}
                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-serif font-bold text-[#1A1A1A]">Reviewing Days</span>
                              <span className="text-[9px] font-mono font-bold text-neutral-400 bg-neutral-50 border px-1 rounded">{reviewingDays.length}/7 active</span>
                            </div>
                            <div className="flex justify-between">
                              {DAYS.map((day) => {
                                const isActive = reviewingDays.includes(day);
                                return (
                                  <button
                                    key={`review-${day}`}
                                    onClick={() => toggleDay(day, reviewingDays, setReviewingDays)}
                                    className={`w-7 h-7 rounded-full font-sans font-bold text-[10px] border transition cursor-pointer flex items-center justify-center select-none ${
                                      isActive 
                                        ? 'bg-[#1A1A1A] text-white border-[#1A1A1A] shadow-sm' 
                                        : 'bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400'
                                    }`}
                                  >
                                    {day}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Priming Days */}
                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-serif font-bold text-[#1A1A1A]">Priming Days</span>
                              <span className="text-[9px] font-mono font-bold text-neutral-400 bg-neutral-50 border px-1 rounded">{primingDays.length}/7 active</span>
                            </div>
                            <div className="flex justify-between">
                              {DAYS.map((day) => {
                                const isActive = primingDays.includes(day);
                                return (
                                  <button
                                    key={`prime-${day}`}
                                    onClick={() => toggleDay(day, primingDays, setPrimingDays)}
                                    className={`w-7 h-7 rounded-full font-sans font-bold text-[10px] border transition cursor-pointer flex items-center justify-center select-none ${
                                      isActive 
                                        ? 'bg-[#1A1A1A] text-white border-[#1A1A1A] shadow-sm' 
                                        : 'bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400'
                                    }`}
                                  >
                                    {day}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Pacing & Limits */}
                  <div className="border-2 border-[#1A1A1A] rounded-xl p-3.5 bg-white space-y-4 shadow-sm text-left">
                    {/* New Verses Slider */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-xs font-sans font-bold">
                        <span className="text-[#1A1A1A]">New Verses per Learning Day</span>
                        <span className="bg-[#F3F2F1] border border-neutral-300 px-2 py-0.5 rounded font-mono text-xs text-[#1A1A1A]">{newVersesPace}</span>
                      </div>
                      <input 
                        type="range" 
                        min="1" 
                        max="10" 
                        value={newVersesPace} 
                        onChange={(e) => {
                          setNewVersesPace(Number(e.target.value));
                          setPreset('custom');
                        }}
                        className="w-full accent-[#1A1A1A] h-1.5 bg-[#F3F2F1] rounded-lg cursor-pointer border border-[#E5E5E5]"
                      />
                      <div className="flex justify-between text-[8px] text-neutral-400 font-mono">
                        <span>1 verse (Gentle)</span>
                        <span>10 verses (Extreme)</span>
                      </div>
                    </div>

                    {/* Review Cap Slider */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-xs font-sans font-bold">
                        <span className="text-[#1A1A1A]">Daily Review Time Limit</span>
                        <span className="bg-[#F3F2F1] border border-neutral-300 px-2 py-0.5 rounded font-mono text-xs text-[#1A1A1A]">{maxReviewCap} mins</span>
                      </div>
                      <input 
                        type="range" 
                        min="5" 
                        max="30" 
                        value={maxReviewCap} 
                        onChange={(e) => {
                          setMaxReviewCap(Number(e.target.value));
                          setPreset('custom');
                        }}
                        className="w-full accent-[#1A1A1A] h-1.5 bg-[#F3F2F1] rounded-lg cursor-pointer border border-[#E5E5E5]"
                      />
                      <div className="flex justify-between text-[8px] text-neutral-400 font-mono">
                        <span>5 mins (Sprint)</span>
                        <span>30 mins (Marathon)</span>
                      </div>
                      <p className="text-[10px] text-neutral-500 font-sans leading-normal pt-2 border-t border-[#F3F2F1]">
                        If your queue exceeds this, easier verses will defer to tomorrow.
                      </p>
                    </div>

                    {/* 3-Touch Mastery Gate setting */}
                    <div className="space-y-1.5 pt-4 border-t border-[#F3F2F1]">
                      <div className="flex justify-between items-center text-xs font-sans font-bold">
                        <span className="text-[#1A1A1A]">Mastery Touch Gate Requirement</span>
                        <span className="bg-[#F3F2F1] border border-neutral-300 px-2 py-0.5 rounded font-mono text-xs text-[#1A1A1A]">{masteryTouches} touches</span>
                      </div>
                      <input 
                        type="range" 
                        min="3" 
                        max="10" 
                        value={masteryTouches} 
                        onChange={(e) => {
                          setMasteryTouches(Number(e.target.value));
                        }}
                        className="w-full accent-[#1A1A1A] h-1.5 bg-[#F3F2F1] rounded-lg cursor-pointer border border-[#E5E5E5]"
                      />
                      <div className="flex justify-between text-[8px] text-neutral-400 font-mono">
                        <span>3 touches</span>
                        <span>10 touches</span>
                      </div>
                    </div>

                    {/* Standard Reviews Required setting */}
                    <div className="space-y-1.5 pt-4 border-t border-[#F3F2F1]">
                      <div className="flex justify-between items-center text-xs font-sans font-bold">
                        <span className="text-[#1A1A1A]">Standard Reviews Required per Day</span>
                        <span className="bg-[#F3F2F1] border border-neutral-300 px-2 py-0.5 rounded font-mono text-xs text-[#1A1A1A]">{reviewsRequired} reps</span>
                      </div>
                      <input 
                        type="range" 
                        min="1" 
                        max="3" 
                        value={reviewsRequired} 
                        onChange={(e) => {
                          setReviewsRequired(Number(e.target.value));
                        }}
                        className="w-full accent-[#1A1A1A] h-1.5 bg-[#F3F2F1] rounded-lg cursor-pointer border border-[#E5E5E5]"
                      />
                      <div className="flex justify-between text-[8px] text-neutral-400 font-mono">
                        <span>1 review</span>
                        <span>3 reviews</span>
                      </div>
                    </div>
                  </div>

                  {/* Custom naming & community sharing options */}
                  <div className="border border-neutral-200 rounded-xl p-4 bg-white space-y-3 shadow-sm mt-1">
                    <span className="text-[9px] uppercase tracking-wider font-bold text-[#888] font-sans block">
                      Custom Plan & Sharing Options
                    </span>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-sans font-bold text-neutral-600">Custom Memory Plan Name</label>
                      <input
                        type="text"
                        placeholder="My Custom Scripture Plan"
                        value={customPlanName}
                        onChange={(e) => setCustomPlanName(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-neutral-300 rounded-lg focus:outline-none focus:border-[#1A1A1A] font-sans bg-white text-[#1A1A1A]"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-neutral-100">
                      <div className="space-y-0.5">
                        <label className="text-[10px] font-sans font-bold text-neutral-800 flex items-center gap-1.5 cursor-pointer">
                          <Share2 size={12} className="text-neutral-500" />
                          <span>Publish to Community Circles</span>
                        </label>
                        <p className="text-[9px] text-neutral-400 font-sans leading-tight">
                          Make this pacing pattern joinable for others.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={shareWithCommunity}
                        onChange={(e) => setShareWithCommunity(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-[#1A1A1A] focus:ring-[#1A1A1A] accent-[#1A1A1A] cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Workload Forecast Sticky Bottom Card */}
                  <div className="bg-[#FBF9F6] border-2 border-[#1A1A1A] rounded-xl p-3.5 shadow-md space-y-3">
                    <div className="flex items-center justify-between pb-1.5 border-b border-neutral-200">
                      <div className="flex items-center gap-1.5">
                        <TrendingUp size={14} className="text-[#1A1A1A]" />
                        <h4 className="text-[11px] font-sans font-bold uppercase tracking-wider text-[#1A1A1A]">Weekly Forecast</h4>
                      </div>
                      <span className="text-[8px] font-mono text-neutral-400 font-bold uppercase">Projections</span>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between py-1 border-b border-dashed border-neutral-200">
                        <span className="text-neutral-500 font-sans">Total New Verses This Week:</span>
                        <span className="font-mono font-bold text-[#1A1A1A]">{newVersesPace * learningDays.length}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-neutral-500 font-sans">Estimated Max Daily Time:</span>
                        <span className="font-mono font-bold text-[#1A1A1A]">{maxReviewCap} mins</span>
                      </div>
                    </div>

                    <button
                      onClick={async () => {
                        if (shareWithCommunity) {
                          await publishSharedPlan();
                        } else {
                          await handleSavePlan();
                        }
                      }}
                      className="w-full py-3 bg-[#1A1A1A] hover:bg-neutral-850 text-white font-sans font-bold text-xs uppercase tracking-widest rounded-xl transition cursor-pointer text-center shadow-sm flex items-center justify-center gap-1.5 mt-1 animate-pulse"
                    >
                      <Check size={14} />
                      <span>{shareWithCommunity ? 'Save & Share with Community' : 'Save Plan'}</span>
                    </button>
                  </div>

                </div>
              )}

              {currentScreen === 'activePlan' && (
                <div className="flex-1 flex flex-col space-y-6 animate-fade-in text-left pb-12">
                  
                  {/* Header Row */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={handleBack} 
                        className="w-8 h-8 rounded-full border border-neutral-200 hover:border-neutral-900 flex items-center justify-center text-neutral-800 transition cursor-pointer bg-white"
                      >
                        <ArrowLeft size={14} />
                      </button>
                      <div>
                        <span className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">
                          SCRIPTURE OVERVIEW
                        </span>
                        <h2 className="text-xl font-serif font-black text-neutral-900 mt-0.5">
                          Memory Plan & Queue
                        </h2>
                      </div>
                    </div>
                  </div>

                  {/* MEMORY RHYTHM SECTION */}
                  <div className="border-2 border-[#1A1A1A] rounded-2xl p-5 bg-white text-left shadow-xs space-y-4">
                    <div>
                      <h3 className="text-sm font-serif font-black text-[#1A1A1A]">
                        Memory Rhythm
                      </h3>
                      <p className="text-[10px] text-neutral-400 mt-0.5 font-sans">
                        Configure custom pacing, learn days, review days, and priming lookahead directly.
                      </p>
                    </div>

                    <div className="space-y-4">
                      {/* Interactive Rhythm Rows */}
                      <div className="space-y-3.5 bg-neutral-50/70 p-4 rounded-2xl border border-neutral-100">
                        {/* mem row */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-100/60 pb-3">
                          <div className="text-left">
                            <span className="text-[10px] font-sans font-extrabold uppercase tracking-widest text-[#1A1A1A] block">
                              mem
                            </span>
                            <span className="text-[9px] text-neutral-400 font-sans block -mt-0.5">
                              Active Memory Days
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {['M', 'T', 'W', 'Th', 'F', 'S', 'Su'].map((d) => {
                              const isActive = learningDays.includes(d);
                              return (
                                <button
                                  key={`mem-${d}`}
                                  onClick={() => {
                                    if (learningDays.includes(d)) {
                                      setLearningDays(learningDays.filter(day => day !== d));
                                    } else {
                                      setLearningDays([...learningDays, d]);
                                    }
                                    setPreset('custom');
                                  }}
                                  className={`w-7 h-7 rounded-full text-[10px] font-sans font-bold flex items-center justify-center transition cursor-pointer select-none border ${
                                    isActive 
                                      ? 'bg-[#1A1A1A] text-white border-[#1A1A1A] font-black shadow-sm' 
                                      : 'bg-white text-neutral-400 border-neutral-200 hover:border-neutral-400'
                                  }`}
                                >
                                  {d}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* rev row */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-100/60 pb-3">
                          <div className="text-left">
                            <span className="text-[10px] font-sans font-extrabold uppercase tracking-widest text-emerald-600 block">
                              rev
                            </span>
                            <span className="text-[9px] text-neutral-400 font-sans block -mt-0.5">
                              Secure Review Days
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {['M', 'T', 'W', 'Th', 'F', 'S', 'Su'].map((d) => {
                              const isActive = reviewingDays.includes(d);
                              return (
                                <button
                                  key={`rev-${d}`}
                                  onClick={() => {
                                    if (reviewingDays.includes(d)) {
                                      setReviewingDays(reviewingDays.filter(day => day !== d));
                                    } else {
                                      setReviewingDays([...reviewingDays, d]);
                                    }
                                    setPreset('custom');
                                  }}
                                  className={`w-7 h-7 rounded-full text-[10px] font-sans font-bold flex items-center justify-center transition cursor-pointer select-none border ${
                                    isActive 
                                      ? 'bg-emerald-600 text-white border-emerald-600 font-black shadow-sm' 
                                      : 'bg-white text-neutral-400 border-neutral-200 hover:border-neutral-400'
                                  }`}
                                >
                                  {d}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* priming row */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="text-left">
                            <span className="text-[10px] font-sans font-extrabold uppercase tracking-widest text-indigo-600 block">
                              priming
                            </span>
                            <span className="text-[9px] text-neutral-400 font-sans block -mt-0.5">
                              Paced Priming Days
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {['M', 'T', 'W', 'Th', 'F', 'S', 'Su'].map((d) => {
                              const isActive = primingDays.includes(d);
                              return (
                                <button
                                  key={`priming-${d}`}
                                  onClick={() => {
                                    if (primingDays.includes(d)) {
                                      setPrimingDays(primingDays.filter(day => day !== d));
                                    } else {
                                      setPrimingDays([...primingDays, d]);
                                    }
                                    setPreset('custom');
                                  }}
                                  className={`w-7 h-7 rounded-full text-[10px] font-sans font-bold flex items-center justify-center transition cursor-pointer select-none border ${
                                    isActive 
                                      ? 'bg-indigo-600 text-white border-indigo-600 font-black shadow-sm' 
                                      : 'bg-white text-neutral-400 border-neutral-200 hover:border-neutral-400'
                                  }`}
                                >
                                  {d}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Steppers Row */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* New Verses / Memory Day */}
                        <div className="flex flex-col justify-center items-center p-3.5 bg-neutral-50/50 rounded-2xl border border-neutral-100 space-y-1.5">
                          <span className="text-[10px] font-sans font-extrabold uppercase tracking-widest text-neutral-500">
                            New Verses / Memory Day
                          </span>
                          <div className="flex items-center gap-4">
                            <button
                              onClick={() => {
                                const nextVal = Math.max(1, newVersesPace - 1);
                                setNewVersesPace(nextVal);
                                triggerToast(`Pacing speed decreased to ${nextVal} verses per day`);
                              }}
                              className="w-8 h-8 rounded-full border-2 border-[#1A1A1A] bg-white hover:bg-neutral-50 flex items-center justify-center font-bold text-[#1A1A1A] cursor-pointer transition select-none text-base shadow-3xs"
                            >
                              -
                            </button>
                            <span className="text-2xl font-serif font-black text-[#1A1A1A] w-12 text-center">
                              {newVersesPace}
                            </span>
                            <button
                              onClick={() => {
                                const nextVal = Math.min(10, newVersesPace + 1);
                                setNewVersesPace(nextVal);
                                triggerToast(`Pacing speed increased to ${nextVal} verses per day`);
                              }}
                              className="w-8 h-8 rounded-full border-2 border-[#1A1A1A] bg-white hover:bg-neutral-50 flex items-center justify-center font-bold text-[#1A1A1A] cursor-pointer transition select-none text-base shadow-3xs"
                            >
                              +
                            </button>
                          </div>
                          <p className="text-[8px] font-sans text-neutral-400 text-center">
                            How many verses enter the learning cycle.
                          </p>
                        </div>

                        {/* Daily Review Time Limit */}
                        <div className="flex flex-col justify-center items-center p-3.5 bg-neutral-50/50 rounded-2xl border border-neutral-100 space-y-1.5">
                          <span className="text-[10px] font-sans font-extrabold uppercase tracking-widest text-neutral-500">
                            Daily Review Time Limit
                          </span>
                          <div className="flex items-center gap-4">
                            <button
                              onClick={() => {
                                const nextVal = Math.max(5, maxReviewCap - 5);
                                setMaxReviewCap(nextVal);
                                triggerToast(`Daily review time limit decreased to ${nextVal} mins`);
                              }}
                              className="w-8 h-8 rounded-full border-2 border-[#1A1A1A] bg-white hover:bg-neutral-50 flex items-center justify-center font-bold text-[#1A1A1A] cursor-pointer transition select-none text-base shadow-3xs"
                            >
                              -
                            </button>
                            <span className="text-xl font-serif font-black text-[#1A1A1A] w-16 text-center">
                              {maxReviewCap}m
                            </span>
                            <button
                              onClick={() => {
                                const nextVal = Math.min(120, maxReviewCap + 5);
                                setMaxReviewCap(nextVal);
                                triggerToast(`Daily review time limit increased to ${nextVal} mins`);
                              }}
                              className="w-8 h-8 rounded-full border-2 border-[#1A1A1A] bg-white hover:bg-neutral-50 flex items-center justify-center font-bold text-[#1A1A1A] cursor-pointer transition select-none text-base shadow-3xs"
                            >
                              +
                            </button>
                          </div>
                          <p className="text-[8px] font-sans text-neutral-400 text-center">
                            Maximum target duration for daily practice.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* MEMORY QUEUE SECTION */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="text-sm font-serif font-black text-[#1A1A1A]">
                          Memory Queue
                        </h3>
                        <p className="text-[10px] text-neutral-400 mt-0.5">
                          Reorder, customize, and add individual or group scriptures.
                        </p>
                      </div>
                      <button
                        onClick={() => setShowAddQueueItemModal(!showAddQueueItemModal)}
                        className="px-3 py-1.5 bg-[#1A1A1A] text-white hover:bg-neutral-800 rounded-xl font-sans font-bold text-xs flex items-center gap-1 cursor-pointer transition shadow-xs"
                      >
                        <Plus size={12} />
                        <span>Add Verses</span>
                      </button>
                    </div>

                    {/* Inline Verse Addition Form */}
                    {showAddQueueItemModal && (
                      <div className="border-2 border-[#1A1A1A] rounded-2xl p-4 bg-white text-left space-y-4 animate-fade-in shadow-sm">
                        <div className="flex justify-between items-center pb-2 border-b border-neutral-100">
                          <h4 className="text-xs font-sans font-black text-[#1A1A1A] uppercase tracking-wider">
                            Add Verse to Queue
                          </h4>
                          <button 
                            onClick={() => setShowAddQueueItemModal(false)}
                            className="text-neutral-400 hover:text-neutral-900 cursor-pointer"
                          >
                            <X size={14} />
                          </button>
                        </div>

                        <div className="grid grid-cols-3 gap-2.5">
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-neutral-400 uppercase">Book</label>
                            <select
                              value={selectedAddBook}
                              onChange={(e) => setSelectedAddBook(e.target.value)}
                              className="w-full p-2 border border-neutral-200 rounded-xl text-xs bg-white font-sans font-bold text-[#1A1A1A] focus:outline-hidden focus:border-[#1A1A1A] cursor-pointer"
                            >
                              <option value="Romans">Romans</option>
                              <option value="Genesis">Genesis</option>
                              <option value="Psalms">Psalms</option>
                              <option value="John">John</option>
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-neutral-400 uppercase">Chapter</label>
                            <input 
                              type="number" 
                              min="1"
                              value={selectedAddChapter}
                              onChange={(e) => setSelectedAddChapter(parseInt(e.target.value) || 1)}
                              className="w-full p-2 border border-neutral-200 rounded-xl text-xs font-mono font-bold text-[#1A1A1A]"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-neutral-400 uppercase">Verse</label>
                            <input 
                              type="number" 
                              min="1"
                              value={selectedAddVerse}
                              onChange={(e) => setSelectedAddVerse(parseInt(e.target.value) || 1)}
                              className="w-full p-2 border border-neutral-200 rounded-xl text-xs font-mono font-bold text-[#1A1A1A]"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-neutral-400 uppercase">Custom Verse Text</label>
                          <textarea
                            rows={3}
                            value={customAddVerseText}
                            onChange={(e) => setCustomAddVerseText(e.target.value)}
                            placeholder="Type verse scripture text here..."
                            className="w-full p-2.5 border border-neutral-200 rounded-xl text-xs font-sans text-neutral-800 leading-relaxed focus:outline-hidden focus:border-[#1A1A1A]"
                          />
                        </div>

                        <div className="flex gap-2 justify-end pt-2 border-t border-neutral-100">
                          <button
                            type="button"
                            onClick={() => setShowAddQueueItemModal(false)}
                            className="px-4 py-2 border border-neutral-200 hover:bg-neutral-50 text-neutral-600 font-sans font-bold text-xs rounded-xl cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const vId = `${selectedAddBook.toUpperCase()}_${selectedAddChapter}_${selectedAddVerse}`;
                              
                              if (memoryQueue.some(item => item.verseId === vId)) {
                                triggerToast(`Verse ${selectedAddBook} ${selectedAddChapter}:${selectedAddVerse} is already in your queue!`);
                                return;
                              }

                              const newItem: QueueItem = {
                                verseId: vId,
                                book: selectedAddBook,
                                chapter: selectedAddChapter,
                                verseNumber: selectedAddVerse,
                                text: customAddVerseText || 'No text content loaded.',
                                orderIndex: memoryQueue.length,
                                status: 'queued',
                                origin: 'individual',
                                retentionPhase: 'none',
                                dateStarted: null,
                                lastReviewDate: null,
                                nextReviewDueDate: null,
                                currentStreakCount: 0,
                                totalSuccessfulReviews: 0,
                                gracePeriodUsedToday: false
                              };

                              setMemoryQueue(prev => [...prev, newItem]);
                              setShowAddQueueItemModal(false);
                              triggerToast(`Added ${selectedAddBook} ${selectedAddChapter}:${selectedAddVerse} to your Memory Queue!`);
                            }}
                            className="px-4 py-2 bg-[#1A1A1A] hover:bg-neutral-800 text-white font-sans font-bold text-xs rounded-xl cursor-pointer"
                          >
                            Add to Queue
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Scrollable Queue List */}
                    <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1 border border-neutral-100 p-2 rounded-2xl bg-neutral-50/30">
                      {(() => {
                        const grouped = groupQueueItems(memoryQueue);
                        if (grouped.length === 0) {
                          return (
                            <div className="py-8 text-center text-xs text-neutral-400 font-sans italic">
                              Memory Queue is currently empty. Add verses above.
                            </div>
                          );
                        }
                        
                        return grouped.map((group, idx) => {
                          const isGroup = group.origin === 'group';
                          const hasMultiple = group.verses.length > 1;
                          const versesStr = hasMultiple 
                            ? `${group.verses[0]}-${group.verses[group.verses.length - 1]}` 
                            : `${group.verses[0]}`;
                            
                          return (
                            <div 
                              key={group.id || `${group.book}_${group.chapter}_${versesStr}`} 
                              className={`flex items-center justify-between p-4 bg-white border rounded-xl shadow-3xs transition hover:shadow-xs border-l-4 ${
                                isGroup 
                                  ? 'border-l-indigo-500 border-indigo-150 hover:border-indigo-250' 
                                  : 'border-l-orange-500 border-orange-150 hover:border-orange-250'
                              }`}
                            >
                              <div className="flex items-center gap-3.5 flex-1 min-w-0">
                                {/* Up & Down Reorder Buttons */}
                                <div className="flex flex-col gap-1 select-none">
                                  <button
                                    onClick={() => {
                                      if (idx === 0) return;
                                      const targetIndex = idx - 1;
                                      const newGroups = [...grouped];
                                      const temp = newGroups[idx];
                                      newGroups[idx] = newGroups[targetIndex];
                                      newGroups[targetIndex] = temp;

                                      const flattened: QueueItem[] = [];
                                      newGroups.forEach(g => {
                                        g.items.forEach(item => {
                                          flattened.push(item);
                                        });
                                      });
                                      
                                      const reindexed = flattened.map((q, qidx) => ({ ...q, orderIndex: qidx }));
                                      setMemoryQueue(reindexed);
                                      triggerToast("Moved consecutive group up.");
                                    }}
                                    disabled={idx === 0}
                                    className={`p-1 rounded hover:bg-neutral-100 cursor-pointer transition ${idx === 0 ? 'opacity-20 pointer-events-none' : 'text-neutral-500'}`}
                                    title="Move Up"
                                  >
                                    <ArrowUp size={12} />
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (idx === grouped.length - 1) return;
                                      const targetIndex = idx + 1;
                                      const newGroups = [...grouped];
                                      const temp = newGroups[idx];
                                      newGroups[idx] = newGroups[targetIndex];
                                      newGroups[targetIndex] = temp;

                                      const flattened: QueueItem[] = [];
                                      newGroups.forEach(g => {
                                        g.items.forEach(item => {
                                          flattened.push(item);
                                        });
                                      });
                                      
                                      const reindexed = flattened.map((q, qidx) => ({ ...q, orderIndex: qidx }));
                                      setMemoryQueue(reindexed);
                                      triggerToast("Moved consecutive group down.");
                                    }}
                                    disabled={idx === grouped.length - 1}
                                    className={`p-1 rounded hover:bg-neutral-100 cursor-pointer transition ${idx === grouped.length - 1 ? 'opacity-20 pointer-events-none' : 'text-neutral-500'}`}
                                    title="Move Down"
                                  >
                                    <ArrowDown size={12} />
                                  </button>
                                </div>

                                {/* Reference details */}
                                <div className="space-y-1 text-left flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h4 className="text-xs font-serif font-black text-[#1A1A1A]">
                                      {group.book} {group.chapter}:{versesStr}
                                    </h4>
                                    <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-sans font-bold uppercase tracking-wider ${
                                      isGroup 
                                        ? 'bg-indigo-50 text-indigo-700 border border-indigo-150' 
                                        : 'bg-orange-50 text-orange-700 border border-orange-150'
                                    }`}>
                                      {isGroup ? 'Group' : 'Individual'}
                                    </span>
                                    {hasMultiple && (
                                      <span className="text-[8px] px-1.5 py-0.5 rounded-full font-sans font-bold bg-neutral-100 text-neutral-600 border border-neutral-200">
                                        {group.verses.length} verses
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] font-sans text-neutral-500 line-clamp-1 italic pr-2">
                                    "{group.items[0].text}"{hasMultiple ? ' ...' : ''}
                                  </p>
                                </div>
                              </div>

                              {/* Right column status & delete */}
                              <div className="flex items-center gap-3">
                                <span className={`text-[9px] font-sans font-bold px-2 py-0.5 rounded-full border uppercase ${
                                  group.status === 'learning' 
                                    ? 'bg-amber-50 text-amber-600 border-amber-200' 
                                    : group.status === 'retained' 
                                      ? 'bg-emerald-50 text-emerald-600 border-emerald-200' 
                                      : 'bg-neutral-50 text-neutral-400 border-neutral-200'
                                }`}>
                                  {group.status}
                                </span>
                                <button
                                  onClick={() => {
                                    const idsToDelete = new Set(group.items.map(item => item.verseId));
                                    setMemoryQueue(prev => prev.filter(item => !idsToDelete.has(item.verseId)));
                                    triggerToast(`Removed consecutive group from Memory Queue.`);
                                  }}
                                  className="text-neutral-300 hover:text-red-600 p-1 cursor-pointer transition rounded hover:bg-red-50"
                                  title="Delete from Queue"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>

                  {/* MEMORY LOAD FORECAST SECTION */}
                  <div className="space-y-3 pt-1">
                    <div>
                      <h3 className="text-sm font-serif font-black text-[#1A1A1A]">
                        Memory Load Forecast
                      </h3>
                      <p className="text-[10px] text-neutral-400 mt-0.5">
                        Deterministic 7-day forecast representing estimated daily study time based on active queue items.
                      </p>
                    </div>

                    {/* Bento-style 7-day forecast row */}
                    <div className="grid grid-cols-7 gap-1.5">
                      {(() => {
                        const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                        const todayIndex = new Date().getDay(); // 0 is Sunday, 1 is Monday
                        // Re-align days to start from today
                        const forecastDays = Array.from({ length: 7 }, (_, i) => {
                          const targetIdx = (todayIndex + i) % 7;
                          const mappedName = daysOfWeek[targetIdx === 0 ? 6 : targetIdx - 1];
                          
                          // Determine date string offset
                          const d = new Date();
                          d.setDate(d.getDate() + i);
                          const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                          // Deterministic load calculator
                          // Learning load applies on learning scheduled days
                          const isLearnDay = i % 2 === 0; // Simulated schedule
                          const isReviewDay = true; // Review happens daily
                          
                          const lVerses = isLearnDay ? newVersesPace : 0;
                          const rVerses = Math.max(3, Math.min(20, memoryQueue.filter(q => q.status === 'learning').length + Math.round(i * 1.5)));
                          
                          // Estimate in minutes
                          const totalMinutes = Math.round((lVerses * 3) + (rVerses * 1.2) + 2);
                          // Peak factor for styling bars (cap max height representation at 30 mins)
                          const heightPercent = Math.min(100, Math.max(15, (totalMinutes / 30) * 100));

                          return {
                            dayName: mappedName,
                            dateStr: dateStr,
                            loadMins: totalMinutes,
                            versesCount: lVerses + rVerses,
                            barHeight: heightPercent,
                            isToday: i === 0
                          };
                        });

                        return forecastDays.map((fDay, idx) => (
                          <div 
                            key={idx} 
                            className={`flex flex-col items-center p-2 rounded-xl border text-center transition space-y-2 bg-white ${
                              fDay.isToday 
                                ? 'border-2 border-[#1A1A1A] shadow-xs' 
                                : 'border-neutral-200'
                            }`}
                          >
                            <span className={`text-[8px] font-sans font-extrabold uppercase ${fDay.isToday ? 'text-[#1A1A1A]' : 'text-neutral-400'}`}>
                              {fDay.dayName}
                            </span>
                            <span className="text-[7px] font-mono font-bold text-neutral-400 block -mt-1">
                              {fDay.dateStr}
                            </span>

                            {/* Relative Load Bar indicator */}
                            <div className="w-2.5 h-14 bg-neutral-50 rounded-full flex items-end overflow-hidden border border-neutral-100">
                              <div 
                                className={`w-full rounded-full transition-all duration-500 ${
                                  fDay.isToday 
                                    ? 'bg-[#1A1A1A]' 
                                    : fDay.loadMins > 18 
                                      ? 'bg-amber-500' 
                                      : 'bg-emerald-500'
                                }`} 
                                style={{ height: `${fDay.barHeight}%` }} 
                              />
                            </div>

                            <div className="space-y-0.5">
                              <span className="text-[10px] font-serif font-black text-neutral-800 leading-none block">
                                {fDay.loadMins}m
                              </span>
                              <span className="text-[7px] font-sans font-medium text-neutral-400 leading-none block">
                                {fDay.versesCount} v
                              </span>
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>

                </div>
              )}

              {currentScreen === 'savedPlans' && (
                <div className="flex-1 flex flex-col space-y-5 animate-fade-in text-left pb-12">
                  
                  {/* Header Row */}
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={handleBack} 
                      className="w-8 h-8 rounded-full border border-neutral-200 hover:border-neutral-900 flex items-center justify-center text-neutral-800 transition cursor-pointer bg-white"
                    >
                      <ArrowLeft size={14} />
                    </button>
                    <div>
                      <span className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">
                        Pacing Configurations
                      </span>
                      <h2 className="text-lg font-serif font-bold text-[#1A1A1A] mt-0.5">
                        Saved Plans
                      </h2>
                      <p className="text-[10px] text-neutral-400 leading-none mt-1">Select a plan to activate or edit.</p>
                    </div>
                  </div>

                  {/* Create New Plan Button */}
                  <button 
                    onClick={handleCreateNewPlan}
                    className="border-2 border-dashed border-neutral-300 rounded-2xl p-5 hover:border-[#1A1A1A] hover:bg-neutral-50/50 transition duration-200 cursor-pointer text-center w-full flex flex-col items-center justify-center gap-2"
                  >
                    <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-500">
                      <Plus size={16} />
                    </div>
                    <span className="text-xs font-sans font-extrabold text-neutral-800">
                      Create New Plan
                    </span>
                    <span className="text-[10px] text-neutral-400">
                      Configure custom pacing, learn days, and review caps
                    </span>
                  </button>

                  {/* List of Saved Plans */}
                  <div className="space-y-3">
                    <span className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                      MY PLANS ({savedPlans.length})
                    </span>

                    <div className="space-y-3">
                      {savedPlans.map((plan) => (
                        <div 
                          key={plan.id}
                          onClick={() => handleActivatePlan(plan.id)}
                          className={`border rounded-2xl p-4 bg-white hover:bg-neutral-50/30 transition cursor-pointer shadow-xs relative flex flex-col justify-between gap-3 ${
                            plan.isActive ? 'border-2 border-[#1A1A1A]' : 'border-neutral-200'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="space-y-1">
                              <h3 className="text-xs font-sans font-extrabold text-neutral-900 flex items-center gap-1.5 leading-tight">
                                {plan.isActive && <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shrink-0" />}
                                {plan.name}
                              </h3>
                              <p className="text-[10px] font-sans text-neutral-450">
                                {plan.learningDays.length} learning · {plan.reviewingDays.length} reviewing · {plan.primingDays.length} priming days · {plan.newVersesPace} v/day
                              </p>
                            </div>

                            {plan.isActive ? (
                              <span className="text-[8px] font-sans font-bold bg-emerald-500/10 text-emerald-700 px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0 uppercase tracking-wider border border-emerald-500/20">
                                Active
                              </span>
                            ) : (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditPlan(plan);
                                }}
                                className="text-[9px] font-sans font-extrabold text-neutral-400 hover:text-neutral-900 transition flex items-center gap-0.5 cursor-pointer"
                              >
                                <span>Edit</span>
                                <ChevronRight size={10} />
                              </button>
                            )}
                          </div>
                          
                          {plan.isActive && (
                            <div className="flex justify-end pt-2 border-t border-dashed border-neutral-100">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditPlan(plan);
                                }}
                                className="text-[9px] font-sans font-extrabold text-neutral-500 hover:text-neutral-900 transition flex items-center gap-0.5 cursor-pointer"
                              >
                                <span>Edit Settings</span>
                                <ChevronRight size={10} />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                </div>
              )}

            </div>
          )}

          {currentScreen !== 'memberProfile' && currentScreen !== 'analyzePlan' && currentScreen !== 'fullHistory' && currentScreen !== 'recordingDetail' && currentTab === 'community' && (
            <div className="flex-1 flex flex-col p-5 animate-fade-in text-left space-y-4">
              
              {viewingGroupDetail ? (
                (() => {
                  // Find the active circle dynamically
                  const activeCircle = joinedGroups.find(g => g.id === activeGroupId) || {
                    id: activeGroupId,
                    name: activeGroupName,
                    desc: activeGroupDesc,
                    role: activeGroupId === 'adult-bible-study' ? 'Leader' : (activeGroupId === 'youth-sprints' ? 'Mentor' : 'Leader'),
                    membersCount: groupMembersMap[activeGroupId]?.length || 1,
                    isPublic: activeGroupIsPublic,
                    focus: 'Romans',
                    code: activeGroupId.toUpperCase().slice(0, 5).replace(/\s/g, 'X')
                  };

                  const currentMembers = groupMembersMap[activeCircle.id] || ["Kenneth (Me)"];
                  const isLeaderOrAdmin = activeCircle.role === 'Leader' || activeCircle.role === 'Mentor' || activeGroupOwner.includes("(Me)");

                  const updateActiveCircle = (fields: Partial<typeof activeCircle>) => {
                    setJoinedGroups(prev => prev.map(g => {
                      if (g.id === activeGroupId) {
                        return { ...g, ...fields };
                      }
                      return g;
                    }));
                    if (fields.name !== undefined) setActiveGroupName(fields.name);
                    if (fields.desc !== undefined) setActiveGroupDesc(fields.desc);
                    if (fields.isPublic !== undefined) setActiveGroupIsPublic(fields.isPublic);
                  };

                  // Filter plans belonging to this specific circle
                  const circlePlans = groupPlansList.filter(plan => plan.circleId === activeCircle.id);

                  // Generate sample list of verses based on the circle's focus
                  const getSampleVersesForFocus = (focusBook: string) => {
                    if (focusBook === 'Romans') {
                      return ['ROM_8_1', 'ROM_8_2', 'ROM_8_3', 'ROM_8_4', 'ROM_8_5', 'ROM_8_6', 'ROM_8_7', 'ROM_8_8', 'ROM_8_9', 'ROM_8_10'];
                    } else if (focusBook === 'Genesis') {
                      return ['GEN_1_1', 'GEN_1_2', 'GEN_1_3', 'GEN_1_4', 'GEN_1_5', 'GEN_1_6', 'GEN_1_7', 'GEN_1_8', 'GEN_1_9', 'GEN_1_10'];
                    } else if (focusBook === 'Psalms') {
                      return ['PSA_23_1', 'PSA_23_2', 'PSA_23_3', 'PSA_23_4', 'PSA_23_5', 'PSA_23_6'];
                    } else {
                      return ['JHN_15_1', 'JHN_15_2', 'JHN_15_3', 'JHN_15_4', 'JHN_15_5'];
                    }
                  };

                  const shareUrl = `https://scripturepacing.app/join?circleId=${activeCircle.id}&code=${activeCircle.code}`;

                  return (
                    <div className="space-y-5 animate-fade-in pb-12">
                      {/* Header Row */}
                      <div className="flex items-center justify-between border-b border-[#E5E5E5] pb-3">
                        <div className="flex items-center gap-3">
                          <button 
                            onClick={() => {
                              setViewingGroupDetail(false);
                              setIsEditingCircleSettings(false);
                              setShowCreatePlanForm(false);
                              setShowAppStorePreview(false);
                            }} 
                            className="w-8 h-8 rounded-full border border-neutral-200 hover:border-neutral-900 flex items-center justify-center text-neutral-800 transition cursor-pointer bg-white"
                          >
                            <ArrowLeft size={14} />
                          </button>
                          <div>
                            <span className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans block">CIRCLE CONSOLE</span>
                            <h1 className="text-base font-serif font-bold text-[#1A1A1A]">{activeCircle.name}</h1>
                          </div>
                        </div>

                        {/* Settings Button for Leader/Admin */}
                        {isLeaderOrAdmin && (
                          <button
                            onClick={() => setIsEditingCircleSettings(!isEditingCircleSettings)}
                            className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-sans font-bold flex items-center gap-1.5 transition cursor-pointer ${
                              isEditingCircleSettings 
                                ? 'bg-neutral-900 text-white border-neutral-900 shadow-sm' 
                                : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-300'
                            }`}
                          >
                            <Sliders size={12} />
                            <span>{isEditingCircleSettings ? 'Close Settings' : 'Circle Settings'}</span>
                          </button>
                        )}
                      </div>

                      {/* EDIT CIRCLE SETTINGS PANEL */}
                      {isEditingCircleSettings && isLeaderOrAdmin && (
                        <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 shadow-3xs space-y-3 animate-fade-in">
                          <div className="flex justify-between items-center pb-2 border-b border-neutral-150">
                            <h3 className="text-xs font-black font-sans text-neutral-800 uppercase tracking-wider flex items-center gap-1.5">
                              <Sliders size={12} className="text-indigo-600" />
                              Leader Circle Customization
                            </h3>
                            <span className="text-[8px] uppercase tracking-widest font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">ADMIN</span>
                          </div>

                          <div className="space-y-3 text-left">
                            <div>
                              <label className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400 block mb-1">Circle Display Name</label>
                              <input
                                type="text"
                                defaultValue={activeCircle.name}
                                onBlur={(e) => {
                                  const val = e.target.value.trim();
                                  if (val && val !== activeCircle.name) {
                                    updateActiveCircle({ name: val });
                                    triggerToast("Updated Circle Name! 🏷️");
                                  }
                                }}
                                className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl text-xs font-bold text-neutral-800 focus:outline-neutral-900"
                                placeholder="Group Name"
                              />
                            </div>

                            <div>
                              <label className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400 block mb-1">Circle Pacing Focus Book</label>
                              <select
                                value={activeCircle.focus}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  updateActiveCircle({ focus: val });
                                  triggerToast(`Switched focus book to ${val}! 📖`);
                                }}
                                className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl text-xs font-bold text-neutral-800 focus:outline-neutral-900"
                              >
                                <option value="Romans">Romans</option>
                                <option value="Genesis">Genesis</option>
                                <option value="Psalms">Psalms</option>
                                <option value="John">John</option>
                              </select>
                            </div>

                            <div>
                              <label className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400 block mb-1">Description / Goal</label>
                              <textarea
                                defaultValue={activeCircle.desc}
                                onBlur={(e) => {
                                  const val = e.target.value.trim();
                                  if (val !== activeCircle.desc) {
                                    updateActiveCircle({ desc: val });
                                    triggerToast("Updated description goal! ✏️");
                                  }
                                }}
                                rows={2}
                                className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl text-xs text-neutral-700 font-sans focus:outline-neutral-900"
                                placeholder="E.g. A community focused on scripture memory."
                              />
                            </div>

                            <div className="flex justify-between items-center py-2 bg-white px-3 border border-neutral-200 rounded-xl">
                              <div>
                                <span className="text-[10px] font-bold text-neutral-800 block">Circle Privacy Mode</span>
                                <span className="text-[9px] text-neutral-400 font-sans">Public directory vs private invite-only code</span>
                              </div>
                              <button
                                onClick={() => {
                                  const nextPub = !activeCircle.isPublic;
                                  updateActiveCircle({ isPublic: nextPub });
                                  triggerToast(nextPub ? "Circle is now Public! 🌐" : "Circle is now Private (Invite Only)! 🔒");
                                }}
                                className={`px-3 py-1.5 rounded-lg text-[9px] font-bold font-sans uppercase tracking-wider border cursor-pointer transition ${
                                  activeCircle.isPublic 
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                    : 'bg-amber-50 text-amber-700 border-amber-200'
                                }`}
                              >
                                {activeCircle.isPublic ? '🌐 Public Directory' : '🔒 Private Code'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* About Pacing Circle Card */}
                      <div className="bg-white border border-[#E5E5E5] rounded-xl p-4 shadow-3xs space-y-3 text-left">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[8px] bg-indigo-50 text-indigo-700 border border-indigo-150 px-1.5 py-0.5 rounded-sm uppercase tracking-wide font-extrabold font-sans">
                              Focus: {activeCircle.focus}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-neutral-400 text-[10px] font-sans">
                            {activeCircle.isPublic ? <Globe size={11} /> : <Lock size={11} />}
                            <span className="capitalize">{activeCircle.isPublic ? 'Public Circle' : 'Private Circle'}</span>
                          </div>
                        </div>

                        <p className="text-xs text-neutral-700 leading-relaxed font-sans">
                          {activeCircle.desc}
                        </p>

                        <div className="pt-2.5 border-t border-neutral-100 grid grid-cols-2 gap-2 text-[10px] text-neutral-400 font-sans">
                          <div>
                            <span className="block text-[8px] text-neutral-450 uppercase">Owner / Sponsor</span>
                            <span className="font-semibold text-neutral-700">{activeCircle.id === 'adult-bible-study' ? 'Pastor Robert' : (activeCircle.id === 'youth-sprints' ? 'Esther Vance' : 'Kenneth Carter (Me)')}</span>
                          </div>
                          <div>
                            <span className="block text-[8px] text-neutral-450 uppercase">Your Circle Access</span>
                            <span className="font-bold text-neutral-800">{activeCircle.role}</span>
                          </div>
                        </div>
                      </div>

                      {/* PINNED CIRCLE ANNOUNCEMENTS BILLBOARD */}
                      <div className="bg-amber-50/75 border border-amber-200 rounded-xl p-4 shadow-3xs space-y-3 text-left">
                        <div className="flex justify-between items-center">
                          <h3 className="text-xs font-sans font-black text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
                            <Megaphone size={13} className="text-amber-600 animate-bounce" />
                            Pinned Announcement
                          </h3>
                        </div>

                        {/* Announcement Body */}
                        <p className="text-xs text-amber-900 font-sans font-medium leading-relaxed">
                          {groupAnnouncements[activeCircle.id] || "No current announcements. Encourage your members with a welcome message or meeting updates!"}
                        </p>

                        {/* Leader Edit Announcement Input */}
                        {isLeaderOrAdmin && (
                          <div className="pt-2 border-t border-amber-200/50">
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                const formData = new FormData(e.currentTarget);
                                const txt = formData.get('annText') as string;
                                if (txt !== null) {
                                  setGroupAnnouncements(prev => ({
                                    ...prev,
                                    [activeCircle.id]: txt.trim()
                                  }));
                                  triggerToast("Sponsor announcement pinned! 📣");
                                  e.currentTarget.reset();
                                }
                              }}
                              className="flex gap-1.5"
                            >
                              <input
                                name="annText"
                                type="text"
                                placeholder="Pin new leader announcement..."
                                className="flex-1 bg-white border border-amber-200 rounded-lg px-2 py-1 text-xs font-sans text-amber-900 placeholder:text-amber-300 focus:outline-none focus:border-amber-400"
                              />
                              <button
                                type="submit"
                                className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-[9px] px-2.5 py-1 rounded-lg uppercase tracking-wider transition cursor-pointer"
                              >
                                Pin
                              </button>
                            </form>
                          </div>
                        )}
                      </div>

                      {/* PORTABLE SHARE & APP STORE INVITATION GATEWAY */}
                      <div className="bg-gradient-to-br from-indigo-50/50 to-neutral-50/50 border border-neutral-250 rounded-xl p-4 shadow-3xs space-y-4 text-left">
                        <div>
                          <span className="text-[8px] bg-indigo-100 text-indigo-700 font-sans font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                            Invite & Join Gateway
                          </span>
                          <h3 className="text-xs font-black font-sans text-neutral-800 uppercase tracking-wider mt-1.5 flex items-center gap-1.5">
                            <Link size={12} className="text-indigo-600" />
                            App Store Share Links
                          </h3>
                          <p className="text-[10px] text-neutral-450 leading-relaxed font-sans mt-0.5">
                            Share this link with your congregation, friends, or small study circles to download the app and auto-join this circle.
                          </p>
                        </div>

                        {/* Code and Link Box */}
                        <div className="space-y-2">
                          <div className="grid grid-cols-3 gap-2">
                            <div className="col-span-1 bg-white border border-dashed border-neutral-300 rounded-lg p-2 text-center flex flex-col justify-center">
                              <span className="text-[7px] text-neutral-400 uppercase font-sans font-black block">Invite Code</span>
                              <span className="text-xs font-mono font-black text-neutral-800 tracking-widest uppercase">{activeCircle.code}</span>
                            </div>
                            <div className="col-span-2 bg-white border border-neutral-250 rounded-lg p-2 flex items-center">
                              <input
                                type="text"
                                value={shareUrl}
                                readOnly
                                className="w-full text-[9px] font-mono text-neutral-500 bg-transparent border-none focus:outline-none select-all"
                              />
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(shareUrl);
                                triggerToast("Share link copied to clipboard! 📋");
                              }}
                              className="flex-1 py-1.5 bg-white border border-neutral-300 hover:border-neutral-900 text-neutral-800 rounded-lg font-sans font-bold text-[10px] transition cursor-pointer flex items-center justify-center gap-1.5"
                            >
                              <Share2 size={11} />
                              Copy Share Link
                            </button>

                            <button
                              onClick={() => setShowAppStorePreview(!showAppStorePreview)}
                              className={`flex-1 py-1.5 border rounded-lg font-sans font-bold text-[10px] transition cursor-pointer flex items-center justify-center gap-1.5 ${
                                showAppStorePreview 
                                  ? 'bg-indigo-600 text-white border-indigo-600' 
                                  : 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100 text-indigo-700'
                              }`}
                            >
                              <Sparkles size={11} />
                              {showAppStorePreview ? 'Hide App Store' : 'App Store Preview'}
                            </button>
                          </div>
                        </div>

                        {/* SIMULATED APP STORE MOBILE PREVIEW */}
                        {showAppStorePreview && (
                          <div className="border border-neutral-300 rounded-3xl bg-neutral-900 p-3 shadow-md max-w-sm mx-auto animate-fade-in relative">
                            {/* Phone Speaker & Camera Notch */}
                            <div className="absolute top-4 left-1/2 -translate-x-1/2 w-20 h-4 bg-neutral-900 rounded-full flex items-center justify-center z-20">
                              <div className="w-8 h-1 bg-neutral-700 rounded-full" />
                            </div>

                            {/* Internal Screen */}
                            <div className="bg-neutral-50 rounded-2xl overflow-hidden border border-neutral-800 relative z-10 text-left flex flex-col font-sans">
                              {/* Fake Status Bar */}
                              <div className="bg-[#1A1A1A] text-white px-4 pt-3 pb-1 flex justify-between items-center text-[8px] font-mono select-none">
                                <span>9:41 AM</span>
                                <div className="flex items-center gap-1">
                                  <span>5G</span>
                                  <div className="w-3 h-1.5 border border-white rounded-xs" />
                                </div>
                              </div>

                              {/* App Store Page Header */}
                              <div className="bg-white border-b border-neutral-100 px-4 py-2.5 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className="w-10 h-10 bg-indigo-900 text-white flex items-center justify-center rounded-xl font-serif font-black text-sm shadow-xs border border-indigo-800">
                                    SP
                                  </div>
                                  <div>
                                    <h4 className="text-xs font-black text-[#1A1A1A] leading-tight">Scripture Pacing</h4>
                                    <p className="text-[8px] text-neutral-400">Memory Circles & Pacing</p>
                                  </div>
                                </div>
                                <button className="bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[9px] px-3 py-1 rounded-full uppercase tracking-wider shadow-xs">
                                  GET
                                </button>
                              </div>

                              {/* Invitation Body inside App Store view */}
                              <div className="p-4 space-y-4">
                                <div className="bg-white border border-neutral-200 rounded-xl p-3 shadow-3xs space-y-2 text-center">
                                  <div className="w-8 h-8 bg-neutral-100 rounded-full flex items-center justify-center mx-auto text-neutral-500">
                                    <Users size={14} />
                                  </div>
                                  <div>
                                    <span className="text-[7px] uppercase font-bold text-neutral-400 tracking-wider">INVITATION PASS</span>
                                    <h5 className="text-xs font-serif font-bold text-neutral-800 leading-snug">
                                      Join "{activeCircle.name}"
                                    </h5>
                                    <p className="text-[9px] text-neutral-400 mt-1 font-sans">
                                      Invited by <strong className="text-neutral-700">{activeCircle.role === 'Leader' ? 'Kenneth Carter (Me)' : 'Pastor Robert'}</strong>
                                    </p>
                                  </div>
                                  <p className="text-[9.5px] text-neutral-500 leading-normal bg-neutral-50 px-2 py-1.5 rounded-lg font-sans border border-neutral-100">
                                    "{activeCircle.desc}"
                                  </p>
                                </div>

                                <div className="space-y-1.5">
                                  <div className="flex justify-between text-[9px] font-sans">
                                    <span className="text-neutral-400">Focus Book:</span>
                                    <span className="font-bold text-neutral-800">{activeCircle.focus}</span>
                                  </div>
                                  <div className="flex justify-between text-[9px] font-sans">
                                    <span className="text-neutral-400">Active Members:</span>
                                    <span className="font-bold text-neutral-850">{currentMembers.length} Members</span>
                                  </div>
                                  <div className="flex justify-between text-[9px] font-sans">
                                    <span className="text-neutral-400">Invite Code:</span>
                                    <span className="font-mono font-bold text-indigo-600 tracking-wider uppercase">{activeCircle.code}</span>
                                  </div>
                                </div>

                                <div className="space-y-2 pt-2 border-t border-dashed border-neutral-200">
                                  <div className="text-center">
                                    <span className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest font-sans">👇 STEP 1: DOWNLOAD APP</span>
                                  </div>
                                  
                                  <button 
                                    onClick={() => triggerToast("Downloaded Scripture Pacing App! (Simulation) 📥")}
                                    className="w-full bg-[#1A1A1A] hover:bg-black text-white text-[9px] font-bold uppercase tracking-wider py-2 rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs"
                                  >
                                    <Check size={10} />
                                    Download on the App Store
                                  </button>

                                  <button 
                                    onClick={() => triggerToast("Downloaded on Google Play! (Simulation) 📥")}
                                    className="w-full bg-white border border-neutral-300 text-neutral-800 text-[9px] font-bold uppercase tracking-wider py-2 rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer hover:border-neutral-850"
                                  >
                                    Download on Google Play
                                  </button>
                                </div>
                              </div>

                              {/* Fake Home Indicator Bar */}
                              <div className="bg-white py-2 flex items-center justify-center">
                                <div className="w-20 h-1 bg-neutral-300 rounded-full" />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* ACTIVE PACING PLANS PANEL */}
                      <div className="space-y-3">
                        <div className="flex justify-between items-center px-1">
                          <h3 className="text-xs font-sans font-extrabold text-neutral-400 tracking-wider uppercase">
                            Shared Circle Plans ({circlePlans.length})
                          </h3>
                          
                          {/* Add Group Plan Button (Leaders/Mentors only) */}
                          {isLeaderOrAdmin && (
                            <button
                              onClick={() => {
                                setShowCreatePlanForm(!showCreatePlanForm);
                                setNewPlanName(`Pacing: ${activeCircle.focus}`);
                                setNewPlanBook(activeCircle.focus);
                              }}
                              className="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 px-2 py-1 rounded-lg transition cursor-pointer flex items-center gap-1"
                            >
                              <Plus size={10} />
                              <span>{showCreatePlanForm ? 'Hide Form' : 'New Plan'}</span>
                            </button>
                          )}
                        </div>

                        {/* CREATE PACING PLAN FORM */}
                        {showCreatePlanForm && isLeaderOrAdmin && (
                          <div className="bg-[#1A1A1A] text-white border border-neutral-900 rounded-xl p-4 shadow-md space-y-3 text-left animate-fade-in font-sans">
                            <div className="flex justify-between items-center border-b border-neutral-800 pb-1.5">
                              <h4 className="text-[10px] font-black uppercase tracking-wider text-neutral-300">Deploy New Circle Plan</h4>
                              <span className="text-[7px] bg-indigo-600 text-white px-2 py-0.5 rounded uppercase font-black">SPONSOR</span>
                            </div>

                            <div className="space-y-2 text-xs">
                              <div>
                                <label className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest block mb-0.5">Plan Title</label>
                                <input
                                  type="text"
                                  value={newPlanName}
                                  onChange={(e) => setNewPlanName(e.target.value)}
                                  className="w-full bg-neutral-900 border border-neutral-850 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-neutral-500 focus:outline-hidden focus:border-neutral-700 font-sans"
                                  placeholder="E.g. Romans 8 Pacing Study"
                                />
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest block mb-0.5">Focus Book</label>
                                  <select
                                    value={newPlanBook}
                                    onChange={(e) => {
                                      setNewPlanBook(e.target.value);
                                    }}
                                    className="w-full bg-neutral-900 border border-neutral-850 rounded-lg px-2 py-1 text-xs text-white focus:outline-hidden focus:border-neutral-700"
                                  >
                                    <option value="Romans">Romans</option>
                                    <option value="Genesis">Genesis</option>
                                    <option value="Psalms">Psalms</option>
                                    <option value="John">John</option>
                                  </select>
                                </div>

                                <div>
                                  <label className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest block mb-0.5">Speed (verses/wk)</label>
                                  <input
                                    type="number"
                                    min={1}
                                    max={10}
                                    value={newPlanPacing}
                                    onChange={(e) => setNewPlanPacing(Number(e.target.value))}
                                    className="w-full bg-neutral-900 border border-neutral-850 rounded-lg px-2 py-1 text-xs text-white focus:outline-hidden"
                                  />
                                </div>
                              </div>

                              <div>
                                <label className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest block mb-0.5 font-sans">Description / Study Memo</label>
                                <textarea
                                  value={newPlanDesc}
                                  onChange={(e) => setNewPlanDesc(e.target.value)}
                                  className="w-full bg-neutral-900 border border-neutral-850 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-neutral-500 focus:outline-hidden focus:border-neutral-700 font-sans"
                                  placeholder="Explain pacing goals, recital times, etc."
                                  rows={2}
                                />
                              </div>

                              {/* Actions */}
                              <div className="flex justify-end gap-2 pt-2 border-t border-neutral-800">
                                <button
                                  type="button"
                                  onClick={() => setShowCreatePlanForm(false)}
                                  className="text-neutral-400 bg-neutral-850 border border-neutral-800 px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase transition cursor-pointer"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!newPlanName.trim()) {
                                      triggerToast("Please specify a plan title! 🏷️");
                                      return;
                                    }

                                    const planVersesRange = getSampleVersesForFocus(newPlanBook);
                                    const customId = `plan-custom-${Date.now()}`;
                                    
                                    const createdPlan: GroupPlan = {
                                      planId: customId,
                                      circleId: activeCircle.id,
                                      name: newPlanName.trim(),
                                      managerId: 'me-lead',
                                      managerName: 'Kenneth Carter (Me)',
                                      scriptureRange: planVersesRange,
                                      startDate: new Date().toISOString(),
                                      pacingPerWeek: newPlanPacing,
                                      learningDays: ['Mon', 'Wed', 'Fri'],
                                      currentGroupVerseIndex: 0,
                                      description: newPlanDesc.trim() || `Memorizing together through ${newPlanBook} at a pace of ${newPlanPacing} verses per week.`
                                    };

                                    setGroupPlansList(prev => [...prev, createdPlan]);
                                    setActiveGroupPlan(createdPlan);
                                    setShowCreatePlanForm(false);
                                    triggerToast(`Deployed "${newPlanName}"! All circle members synchronized. 🛡️`);
                                    setNewPlanName('');
                                    setNewPlanDesc('');
                                  }}
                                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[9px] uppercase tracking-wider px-4 py-1.5 rounded-lg transition cursor-pointer"
                                >
                                  Deploy & Pave Plan
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* List of Circle pacing plans */}
                        <div className="space-y-3">
                          {circlePlans.length === 0 ? (
                            <div className="text-center p-6 border border-dashed border-neutral-250 rounded-2xl text-xs text-neutral-400 font-sans">
                              No active pacing plans created for this circle yet. {isLeaderOrAdmin && "Launch a new plan above!"}
                            </div>
                          ) : (
                            circlePlans.map((plan) => {
                              const isJoined = activeGroupPlan?.planId === plan.planId;
                              
                              // Compute percent complete
                              const groupPlanVersesInQueue = memoryQueue.filter(item => plan.scriptureRange.includes(item.verseId));
                              const retainedCount = groupPlanVersesInQueue.filter(item => item.status === 'retained').length;
                              const percentComplete = plan.scriptureRange.length > 0 
                                ? Math.round((retainedCount / plan.scriptureRange.length) * 100) 
                                : 0;

                              return (
                                <div key={plan.planId} className="border border-[#E5E5E5] rounded-xl p-3.5 bg-white space-y-3 text-left shadow-sm">
                                  <div className="flex justify-between items-start">
                                    <div>
                                      <h4 className="text-xs font-sans font-black text-[#1A1A1A] leading-tight">
                                        {plan.name}
                                      </h4>
                                      <p className="text-[9px] font-sans text-neutral-400 mt-0.5">
                                        Managed by <span className="font-semibold text-[#1A1A1A]">{plan.managerName || 'Leader'}</span>
                                      </p>
                                    </div>
                                    <div className="flex gap-1">
                                      <span className="text-[8px] bg-indigo-50 border border-indigo-150 text-indigo-700 font-sans font-bold px-1.5 py-0.5 rounded uppercase">
                                        Group Plan
                                      </span>
                                      {isLeaderOrAdmin && (
                                        <button
                                          onClick={() => {
                                            setGroupPlansList(prev => prev.filter(p => p.planId !== plan.planId));
                                            if (isJoined) setActiveGroupPlan(null);
                                            triggerToast("Deleted group plan. 🗑️");
                                          }}
                                          className="text-red-500 hover:text-red-700 p-0.5"
                                        >
                                          <Trash2 size={11} />
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {/* Plan details info */}
                                  {plan.description && (
                                    <p className="text-[10px] text-neutral-500 font-sans leading-normal">
                                      {plan.description}
                                    </p>
                                  )}

                                  {/* Pacing Details */}
                                  <div className="grid grid-cols-3 gap-2 py-1.5 border-y border-dashed border-neutral-100 text-[10px] font-sans">
                                    <div>
                                      <span className="text-[8px] text-neutral-400 block uppercase">Pacing</span>
                                      <span className="font-bold text-neutral-800">{plan.pacingPerWeek} verses/wk</span>
                                    </div>
                                    <div>
                                      <span className="text-[8px] text-neutral-400 block uppercase">Pacing Code</span>
                                      <span className="font-bold text-neutral-850 uppercase font-mono text-[9px]">{activeCircle.code}</span>
                                    </div>
                                    <div>
                                      <span className="text-[8px] text-neutral-400 block uppercase">Active Pointer</span>
                                      <span className="font-bold text-indigo-600 font-mono text-[9px]">{plan.scriptureRange[plan.currentGroupVerseIndex] || plan.scriptureRange[0]}</span>
                                    </div>
                                  </div>

                                  {/* PROGRESS & LEADERSHIP ACTION ROW */}
                                  <div className="flex justify-between items-center pt-1.5">
                                    <div className="space-y-1 flex-1">
                                      <div className="flex justify-between text-[8px] font-mono font-bold text-neutral-400 max-w-[120px]">
                                        <span>Personal Progress</span>
                                        <span>{percentComplete}%</span>
                                      </div>
                                      <div className="w-28 h-1 bg-neutral-100 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${percentComplete}%` }} />
                                      </div>
                                    </div>
                                    
                                    <div className="flex items-center gap-1.5">
                                      {/* ADVANCE POINTER (Only visible to Leader/Mentor) */}
                                      {isLeaderOrAdmin && (
                                        <button
                                          onClick={() => {
                                            const nextIdx = plan.currentGroupVerseIndex + 1;
                                            if (nextIdx < plan.scriptureRange.length) {
                                              setGroupPlansList(prev => prev.map(p => {
                                                if (p.planId === plan.planId) {
                                                  return { ...p, currentGroupVerseIndex: nextIdx };
                                                }
                                                return p;
                                              }));
                                              // Sync if active
                                              if (isJoined) {
                                                setActiveGroupPlan(prev => prev ? { ...prev, currentGroupVerseIndex: nextIdx } : null);
                                              }
                                              triggerToast(`Advanced pacing pointer to ${plan.scriptureRange[nextIdx]}! 🚀`);
                                            } else {
                                              triggerToast("Already reached the end of this pacing range! 🎉");
                                            }
                                          }}
                                          className="bg-[#1A1A1A] hover:bg-neutral-800 text-white text-[8px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded transition cursor-pointer flex items-center gap-1"
                                        >
                                          Advance Pacing 🚀
                                        </button>
                                      )}

                                      {isJoined ? (
                                        <span className="text-[9px] font-sans font-extrabold uppercase tracking-wide text-emerald-600 bg-emerald-50 px-2 py-1.5 rounded">
                                          Active ✓
                                        </span>
                                      ) : (
                                        <button
                                          onClick={() => {
                                            joinGroupPlan(plan);
                                          }}
                                          className="bg-[#1A1A1A] hover:bg-neutral-800 text-white text-[9px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md transition cursor-pointer"
                                        >
                                          Join Plan
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>

                      {/* MEMBERS LIST CARD (WITH REMOVE OPTION FOR ADMINS) */}
                      <div className="bg-white border border-[#E5E5E5] rounded-xl p-4 shadow-sm space-y-3 text-left">
                        <div className="flex justify-between items-center border-b border-neutral-100 pb-1.5">
                          <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Members ({currentMembers.length})</h3>
                          <span className="text-[8px] text-neutral-400 font-sans">Interactive Small Group List</span>
                        </div>
                        
                        {/* Member grid */}
                        <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
                          {currentMembers.map((member, idx) => {
                            const isSelf = member.includes("(Me)");
                            return (
                              <div key={idx} className="flex items-center justify-between bg-neutral-50 px-2.5 py-1.5 rounded-lg border border-neutral-100">
                                <div className="flex items-center gap-2 truncate">
                                  <div className={`w-5 h-5 rounded-full ${isSelf ? 'bg-indigo-600 text-white' : 'bg-[#1A1A1A] text-white'} flex items-center justify-center text-[9px] font-sans font-bold`}>
                                    {member.substring(0, 2).toUpperCase()}
                                  </div>
                                  <span className={`text-[11px] font-sans font-bold truncate ${isSelf ? 'text-indigo-800 font-extrabold' : 'text-neutral-700'}`}>{member}</span>
                                </div>

                                {/* Kick/Remove Option for Leaders */}
                                {isLeaderOrAdmin && !isSelf && (
                                  <button
                                    onClick={() => {
                                      const updatedList = currentMembers.filter(m => m !== member);
                                      setGroupMembersMap(prev => ({
                                        ...prev,
                                        [activeCircle.id]: updatedList
                                      }));
                                      // update count in active joinedGroups
                                      setJoinedGroups(prev => prev.map(g => {
                                        if (g.id === activeCircle.id) {
                                          return { ...g, membersCount: updatedList.length };
                                        }
                                        return g;
                                      }));
                                      triggerToast(`Removed ${member} from the scripture circle. 🧹`);
                                    }}
                                    className="text-red-500 hover:text-red-700 font-bold text-[10px] w-4 h-4 flex items-center justify-center rounded-full hover:bg-red-50 border border-transparent hover:border-red-100 cursor-pointer"
                                    title="Remove member"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Invite Member Inline Form */}
                        <form 
                          onSubmit={(e) => {
                            e.preventDefault();
                            const formData = new FormData(e.currentTarget);
                            const name = formData.get('inviteName') as string;
                            if (name && name.trim()) {
                              const trimmedName = name.trim();
                              if (currentMembers.includes(trimmedName)) {
                                triggerToast(`${trimmedName} is already in this group!`);
                              } else {
                                const updatedList = [...currentMembers, trimmedName];
                                setGroupMembersMap(prev => ({
                                  ...prev,
                                  [activeCircle.id]: updatedList
                                }));
                                // update count in active joinedGroups
                                setJoinedGroups(prev => prev.map(g => {
                                  if (g.id === activeCircle.id) {
                                    return { ...g, membersCount: updatedList.length };
                                  }
                                  return g;
                                }));
                                triggerToast(`Invited ${trimmedName} and automatically synchronized their calendar! ✉️`);
                                e.currentTarget.reset();
                              }
                            }
                          }}
                          className="flex gap-2 pt-2 border-t border-neutral-100"
                        >
                          <input 
                            name="inviteName"
                            type="text" 
                            placeholder="Add name (e.g. Thomas K.)" 
                            className="flex-1 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1 text-xs font-sans focus:outline-hidden focus:border-neutral-500 text-neutral-800"
                            required
                          />
                          <button 
                            type="submit"
                            className="bg-[#1A1A1A] hover:bg-neutral-800 text-white font-bold text-[10px] px-3 py-1 rounded-lg uppercase tracking-wider transition cursor-pointer"
                          >
                            Add Member
                          </button>
                        </form>
                      </div>

                      {/* LEAVE OR DISBAND ACTIONS */}
                      {activeCircle.role === 'Leader' || activeGroupOwner.includes("(Me)") ? (
                        <button
                          onClick={() => {
                            if (confirm(`Are you absolutely sure you want to permanently disband and delete the "${activeCircle.name}" Scripture Circle?`)) {
                              setJoinedGroups(prev => prev.filter(g => g.id !== activeCircle.id));
                              setActiveGroupPlan(null);
                              setViewingGroupDetail(false);
                              triggerToast(`Disbanded "${activeCircle.name}" Scripture Circle. 🌪️`);
                            }
                          }}
                          className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl font-sans font-bold text-xs transition cursor-pointer text-center block"
                        >
                          Disband & Delete Scripture Circle
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setJoinedGroups(prev => prev.filter(g => g.id !== activeCircle.id));
                            setActiveGroupPlan(null);
                            setViewingGroupDetail(false);
                            triggerToast(`You have left the "${activeCircle.name}" Scripture Circle. 🚪`);
                          }}
                          className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl font-sans font-bold text-xs transition cursor-pointer text-center block"
                        >
                          Leave Circle
                        </button>
                      )}
                    </div>
                  );
                })()
              ) : (
                // COMMUNITY HOME TAB VIEW
                (() => {
                  const DISCOVERABLE_GROUPS = [
                    { id: 'romans-sunrise', name: 'Romans Sunrise', desc: 'A morning-focused Romans study circle.', membersCount: 8, isPublic: true, focus: 'Romans', code: 'ROMANS' },
                    { id: 'psalms-refuge', name: 'Psalms of Refuge', desc: 'Daily comfort and meditation through deep-dive Psalms.', membersCount: 12, isPublic: true, focus: 'Psalms', code: 'PSALMS' },
                    { id: 'light-of-life', name: 'The Light of Life', desc: "Deep-dive study on Christ's light in the Gospel of John.", membersCount: 5, isPublic: false, focus: 'John', code: 'LIGHT' },
                    { id: 'beginning-circle', name: 'In the Beginning Circle', desc: 'Walking through the early chapters of Genesis.', membersCount: 15, isPublic: true, focus: 'Genesis', code: 'BEGIN' }
                  ];

                  const filteredGroups = DISCOVERABLE_GROUPS.filter(g => {
                    const matchesSearch = g.name.toLowerCase().includes(findSearchQuery.toLowerCase()) || g.desc.toLowerCase().includes(findSearchQuery.toLowerCase());
                    const matchesBook = findBookFilter === 'All' || g.focus === findBookFilter;
                    const matchesPrivacy = findPrivacyFilter === 'All' || (findPrivacyFilter === 'Public' ? g.isPublic : !g.isPublic);
                    return matchesSearch && matchesBook && matchesPrivacy;
                  });

                  if (communitySubView === 'find') {
                    return (
                      <div className="space-y-4 animate-fade-in text-left">
                        {/* Header with back */}
                        <div className="flex items-center gap-3 border-b border-neutral-100 pb-3">
                          <button 
                            onClick={() => setCommunitySubView('home')}
                            className="w-8 h-8 rounded-full border border-neutral-200 hover:border-neutral-950 flex items-center justify-center text-neutral-800 transition cursor-pointer bg-white"
                          >
                            <ArrowLeft size={14} />
                          </button>
                          <div>
                            <span className="text-[9px] uppercase tracking-wider font-extrabold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-sans">
                              DISCOVER CIRCLES
                            </span>
                            <h2 className="text-base font-serif font-black text-neutral-900 leading-none mt-1">
                              Find a Community
                            </h2>
                          </div>
                        </div>

                        {/* Join via Code */}
                        <div className="border border-neutral-200 rounded-2xl p-4 bg-neutral-50/50 space-y-3">
                          <div className="flex items-center">
                            <h3 className="text-xs font-sans font-extrabold text-neutral-800 uppercase tracking-wider">
                              Join Private Circle via Invite Code
                            </h3>
                            <HelpTooltip text="Enter a unique code sent by your study lead or pastor to join a private scripture pacing group." />
                          </div>

                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={inviteCodeInput}
                              onChange={(e) => setInviteCodeInput(e.target.value)}
                              placeholder="e.g. ROMANS, PSALMS, LIGHT"
                              className="flex-1 px-3 py-2 bg-white border border-neutral-300 rounded-xl text-xs font-bold uppercase tracking-wider focus:outline-neutral-900"
                            />
                            <button
                              onClick={() => {
                                const code = inviteCodeInput.trim().toUpperCase();
                                if (!code) {
                                  triggerToast("Please enter an invite code! 🔑");
                                  return;
                                }
                                
                                // Match pre-defined or dynamic
                                let matchedGroup = DISCOVERABLE_GROUPS.find(g => g.code === code);
                                if (!matchedGroup) {
                                  matchedGroup = {
                                    id: `dynamic-${Date.now()}`,
                                    name: `${code.charAt(0) + code.slice(1).toLowerCase()} Fellowship Circle`,
                                    desc: `A newly unlocked Scripture circle via invite code "${code}".`,
                                    membersCount: 4,
                                    isPublic: false,
                                    focus: 'Romans',
                                    code: code
                                  };
                                }

                                // Add to joined
                                setJoinedGroups(prev => {
                                  if (prev.some(g => g.code === code)) return prev;
                                  return [...prev, {
                                    id: matchedGroup.id,
                                    name: matchedGroup.name,
                                    desc: matchedGroup.desc,
                                    role: 'Member',
                                    membersCount: matchedGroup.membersCount + 1,
                                    isPublic: matchedGroup.isPublic,
                                    focus: matchedGroup.focus,
                                    code: code
                                  }];
                                });

                                setGroupMembersMap(prev => {
                                  if (prev[matchedGroup.id]) return prev;
                                  return {
                                    ...prev,
                                    [matchedGroup.id]: ["Pastor Robert", "Sarah Miller", "Brother Thomas", "Mark Davis", "Kenneth (Me)"]
                                  };
                                });

                                setActiveGroupName(matchedGroup.name);
                                setActiveGroupDesc(matchedGroup.desc);
                                setActiveGroupId(matchedGroup.id);
                                setActiveGroupIsPublic(matchedGroup.isPublic);
                                setActiveGroupOwner("Pastor Robert");
                                setCommunitySubView('home');
                                setViewingGroupDetail(true);
                                triggerToast(`Success! Joined "${matchedGroup.name}" 🛡️`);
                                setInviteCodeInput('');
                              }}
                              className="px-4 py-2 bg-[#1A1A1A] hover:bg-neutral-850 text-white rounded-xl text-xs font-bold transition cursor-pointer"
                            >
                              Join Circle
                            </button>
                          </div>
                        </div>

                        {/* Search & Filters matrix */}
                        <div className="space-y-3">
                          <span className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                            SEARCH PUBLIC DIRECTORY
                          </span>

                          <div className="space-y-2">
                            {/* Text query */}
                            <input
                              type="text"
                              value={findSearchQuery}
                              onChange={(e) => setFindSearchQuery(e.target.value)}
                              placeholder="Search by circle name or description..."
                              className="w-full px-3 py-2 border border-neutral-300 rounded-xl text-xs focus:outline-neutral-900"
                            />

                            {/* Dropdown tags */}
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <label className="text-[8px] font-bold text-neutral-400 uppercase block mb-1">Focus Scripture</label>
                                <select
                                  value={findBookFilter}
                                  onChange={(e) => setFindBookFilter(e.target.value)}
                                  className="w-full px-2 py-1.5 bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-neutral-900 text-xs font-medium"
                                >
                                  <option value="All">All Books</option>
                                  <option value="Romans">Romans</option>
                                  <option value="Psalms">Psalms</option>
                                  <option value="Genesis">Genesis</option>
                                  <option value="John">John</option>
                                </select>
                              </div>

                              <div>
                                <label className="text-[8px] font-bold text-neutral-400 uppercase block mb-1">Privacy Filter</label>
                                <select
                                  value={findPrivacyFilter}
                                  onChange={(e) => setFindPrivacyFilter(e.target.value)}
                                  className="w-full px-2 py-1.5 bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-neutral-900 text-xs font-medium"
                                >
                                  <option value="All">All Types</option>
                                  <option value="Public">Public Only</option>
                                  <option value="Private">Private Only</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Live Filter Results */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center px-1">
                            <span className="text-[9px] font-black text-neutral-400 uppercase">
                              FOUND {filteredGroups.length} COMMUNITIES
                            </span>
                          </div>

                          <div className="space-y-2">
                            {filteredGroups.length === 0 ? (
                              <div className="text-center p-6 border border-dashed border-neutral-200 rounded-2xl text-xs text-neutral-400">
                                No matching scripture circles found. Try clearing filters!
                              </div>
                            ) : (
                              filteredGroups.map(g => {
                                const isAlreadyJoined = joinedGroups.some(jg => jg.id === g.id);
                                return (
                                  <div key={g.id} className="border border-neutral-200 rounded-2xl p-4 bg-white hover:border-neutral-900 transition flex flex-col justify-between text-left space-y-3">
                                    <div className="flex justify-between items-start">
                                      <div>
                                        <div className="flex items-center gap-1.5">
                                          <h4 className="text-xs font-sans font-black text-neutral-900 leading-none">{g.name}</h4>
                                          <span className={`text-[7px] font-bold px-1.5 py-0.2 rounded font-sans uppercase ${g.isPublic ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-amber-50 text-amber-700 border border-amber-100'}`}>
                                            {g.isPublic ? 'Public' : 'Private'}
                                          </span>
                                        </div>
                                        <p className="text-[10px] font-sans text-neutral-400 mt-1 leading-snug">{g.desc}</p>
                                      </div>
                                    </div>

                                    <div className="flex justify-between items-center pt-2 border-t border-neutral-100 text-[10px] font-sans">
                                      <div className="flex gap-3 text-neutral-500">
                                        <span>Focus: <strong className="text-neutral-800">{g.focus}</strong></span>
                                        <span>•</span>
                                        <span>{g.membersCount} Members</span>
                                      </div>

                                      <button
                                        onClick={() => {
                                          if (isAlreadyJoined) {
                                            setGroupMembersMap(prev => {
                                              if (prev[g.id]) return prev;
                                              return {
                                                ...prev,
                                                [g.id]: ["Pastor Robert", "Sarah Miller", "Brother Thomas", "Mark Davis", "Kenneth (Me)"]
                                              };
                                            });
                                            setActiveGroupName(g.name);
                                            setActiveGroupDesc(g.desc);
                                            setActiveGroupId(g.id);
                                            setActiveGroupIsPublic(g.isPublic);
                                            setActiveGroupOwner("Pastor Robert");
                                            setCommunitySubView('home');
                                            setViewingGroupDetail(true);
                                            return;
                                          }

                                          setJoinedGroups(prev => [...prev, {
                                            id: g.id,
                                            name: g.name,
                                            desc: g.desc,
                                            role: 'Member',
                                            membersCount: g.membersCount + 1,
                                            isPublic: g.isPublic,
                                            focus: g.focus,
                                            code: g.code
                                          }]);

                                          setGroupMembersMap(prev => {
                                            if (prev[g.id]) return prev;
                                            return {
                                              ...prev,
                                              [g.id]: ["Pastor Robert", "Sarah Miller", "Brother Thomas", "Mark Davis", "Kenneth (Me)"]
                                            };
                                          });

                                          setActiveGroupName(g.name);
                                          setActiveGroupDesc(g.desc);
                                          setActiveGroupId(g.id);
                                          setActiveGroupIsPublic(g.isPublic);
                                          setActiveGroupOwner("Pastor Robert");
                                          setCommunitySubView('home');
                                          setViewingGroupDetail(true);
                                          triggerToast(g.isPublic ? `Successfully joined "${g.name}"! 🛡️` : `Membership request sent for "${g.name}"! 📬`);
                                        }}
                                        className={`px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition cursor-pointer ${
                                          isAlreadyJoined 
                                            ? 'bg-neutral-100 border border-neutral-300 text-neutral-600 hover:bg-neutral-200' 
                                            : 'bg-[#1A1A1A] hover:bg-neutral-850 text-white'
                                        }`}
                                      >
                                        {isAlreadyJoined ? 'View Dashboard' : g.isPublic ? 'Join Circle' : 'Request Invite'}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (communitySubView === 'create') {
                    return (
                      <div className="space-y-4 animate-fade-in text-left">
                        {/* Header with back */}
                        <div className="flex items-center gap-3 border-b border-neutral-100 pb-3">
                          <button 
                            onClick={() => setCommunitySubView('home')}
                            className="w-8 h-8 rounded-full border border-neutral-200 hover:border-neutral-950 flex items-center justify-center text-neutral-800 transition cursor-pointer bg-white"
                          >
                            <ArrowLeft size={14} />
                          </button>
                          <div>
                            <span className="text-[9px] uppercase tracking-wider font-extrabold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-sans">
                              ADMINISTRATION
                            </span>
                            <h2 className="text-base font-serif font-black text-neutral-900 leading-none mt-1">
                              Create Scripture Circle
                            </h2>
                          </div>
                        </div>

                        {/* Creation Form */}
                        <div className="space-y-4 text-xs font-sans">
                          {/* Group Name */}
                          <div className="space-y-1">
                            <label className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400 block">Circle Name</label>
                            <input
                              type="text"
                              value={createGroupName}
                              onChange={(e) => setCreateGroupName(e.target.value)}
                              placeholder="e.g. Wednesday Night Romans Fellowship"
                              className="w-full px-3 py-2 border border-neutral-300 rounded-xl text-xs focus:outline-neutral-900 font-bold"
                            />
                          </div>

                          {/* Focus Book */}
                          <div className="space-y-1">
                            <label className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400 block">Primary Scripture Focus</label>
                            <select
                              value={createGroupBook}
                              onChange={(e) => setCreateGroupBook(e.target.value)}
                              className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl text-xs focus:outline-neutral-900 font-bold"
                            >
                              <option value="Romans">Romans</option>
                              <option value="Psalms">Psalms</option>
                              <option value="Genesis">Genesis</option>
                              <option value="John">John</option>
                            </select>
                          </div>

                          {/* Short Description */}
                          <div className="space-y-1">
                            <label className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400 block">Short Description</label>
                            <textarea
                              value={createGroupDesc}
                              onChange={(e) => setCreateGroupDesc(e.target.value)}
                              placeholder="Describe the pacing target, meeting schedules, and target members..."
                              rows={3}
                              className="w-full px-3 py-2 border border-neutral-300 rounded-xl text-xs focus:outline-neutral-900"
                            />
                          </div>

                          {/* Privacy Flag */}
                          <div className="space-y-1">
                            <div className="flex items-center">
                              <label className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400 block">Privacy Setting</label>
                              <HelpTooltip text="Public groups can be joined instantly. Private groups require an administrator to input an invite code or approve join requests." />
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-1">
                              <button
                                onClick={() => setCreateGroupPrivacy('public')}
                                className={`p-3 rounded-xl border text-center transition cursor-pointer ${
                                  createGroupPrivacy === 'public'
                                    ? 'bg-white border-neutral-900 ring-2 ring-neutral-900/5'
                                    : 'bg-neutral-50 border-neutral-200 hover:bg-neutral-100 text-neutral-500'
                                }`}
                              >
                                <span className="text-xs font-black block leading-none">🔓 Public Circle</span>
                                <span className="text-[8px] font-medium block text-neutral-400 mt-1">Open to everyone</span>
                              </button>

                              <button
                                onClick={() => setCreateGroupPrivacy('private')}
                                className={`p-3 rounded-xl border text-center transition cursor-pointer ${
                                  createGroupPrivacy === 'private'
                                    ? 'bg-white border-neutral-900 ring-2 ring-neutral-900/5'
                                    : 'bg-neutral-50 border-neutral-200 hover:bg-neutral-100 text-neutral-500'
                                }`}
                              >
                                <span className="text-xs font-black block leading-none">🔒 Private Circle</span>
                                <span className="text-[8px] font-medium block text-neutral-400 mt-1">Requires code/approval</span>
                              </button>
                            </div>
                          </div>

                          {/* Capacity */}
                          <div className="space-y-1">
                            <label className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400 block">Maximum Member Capacity ({createGroupCapacity} max)</label>
                            <input
                              type="range"
                              min={5}
                              max={100}
                              value={createGroupCapacity}
                              onChange={(e) => setCreateGroupCapacity(Number(e.target.value))}
                              className="w-full accent-neutral-900"
                            />
                          </div>

                          {/* Create Action */}
                          <button
                            onClick={() => {
                              const name = createGroupName.trim();
                              if (!name) {
                                triggerToast("Please specify a circle name! 🏷️");
                                return;
                              }

                              const newId = `circle-${Date.now()}`;
                              const desc = createGroupDesc.trim() || `A vibrant circle pacing together through the Book of ${createGroupBook}.`;
                              const code = name.toUpperCase().slice(0, 5).replace(/\s/g, 'X');

                              setJoinedGroups(prev => [
                                ...prev,
                                {
                                  id: newId,
                                  name: name,
                                  desc: desc,
                                  role: 'Leader',
                                  membersCount: 1,
                                  isPublic: createGroupPrivacy === 'public',
                                  focus: createGroupBook,
                                  code: code
                                }
                              ]);

                              setGroupMembersMap(prev => ({
                                ...prev,
                                [newId]: ["Kenneth Carter (Me)"]
                              }));

                              setActiveGroupName(name);
                              setActiveGroupDesc(desc);
                              setActiveGroupId(newId);
                              setActiveGroupIsPublic(createGroupPrivacy === 'public');
                              setActiveGroupOwner("Kenneth Carter (Me)");
                              setCommunitySubView('home');
                              setViewingGroupDetail(true);
                              triggerToast(`Successfully created "${name}" Scripture Circle! 🛡️`);
                              
                              // Reset fields
                              setCreateGroupName('');
                              setCreateGroupDesc('');
                              setCreateGroupPrivacy('public');
                            }}
                            className="w-full py-3 bg-[#1A1A1A] hover:bg-neutral-850 text-white rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer shadow-md transition"
                          >
                            Create Scripture Circle 🛡️
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <>
                      {/* Sub-view Navigation Controls */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setCommunitySubView('find')}
                          className="border border-neutral-200 bg-neutral-50/50 p-2.5 rounded-xl text-left hover:border-neutral-900 cursor-pointer transition flex items-center justify-between"
                        >
                          <div>
                            <span className="text-[8px] font-bold text-indigo-600 uppercase block font-sans">Find Circle</span>
                            <span className="text-xs font-black text-neutral-850 leading-tight">Search Directory 🔍</span>
                          </div>
                          <Users size={14} className="text-neutral-500" />
                        </button>

                        <button
                          onClick={() => setCommunitySubView('create')}
                          className="border border-neutral-200 bg-neutral-50/50 p-2.5 rounded-xl text-left hover:border-neutral-900 cursor-pointer transition flex items-center justify-between"
                        >
                          <div>
                            <span className="text-[8px] font-bold text-emerald-600 uppercase block font-sans">Start Group</span>
                            <span className="text-xs font-black text-neutral-850 leading-tight">Create Circle ➕</span>
                          </div>
                          <Users size={14} className="text-neutral-500" />
                        </button>
                      </div>

                      {/* List of Joined Circles */}
                      <div className="space-y-1.5">
                        <div className="flex items-center px-1">
                          <span className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                            YOUR ACTIVE COMMUNITIES ({joinedGroups.length})
                          </span>
                          <HelpTooltip text="Scripture circles you actively participate in. Tap any circle to view its dashboard, pacing calendars, and progress statistics." />
                        </div>

                        <div className="space-y-2">
                          {joinedGroups.map(g => (
                            <button 
                              key={g.id}
                              onClick={() => {
                                setActiveGroupName(g.name);
                                setActiveGroupDesc(g.desc);
                                setActiveGroupId(g.id);
                                setActiveGroupIsPublic(g.isPublic);
                                setActiveGroupOwner(g.role === 'Leader' ? 'Kenneth Carter (Me)' : 'Pastor Robert');
                                setViewingGroupDetail(true);
                              }}
                              className="w-full bg-white border border-[#E5E5E5] rounded-2xl p-4 flex justify-between items-center shadow-3xs text-left hover:border-neutral-900 transition cursor-pointer"
                            >
                              <div className="space-y-0.5 pr-3">
                                <div className="flex items-center gap-1.5">
                                  <span className={`text-[7px] font-bold px-1.5 py-0.2 rounded font-sans uppercase ${g.id === activeGroupId ? 'bg-indigo-600 text-white' : 'bg-neutral-100 text-neutral-600 border border-neutral-200'}`}>
                                    {g.id === activeGroupId ? 'Active Circle' : g.role}
                                  </span>
                                  <span className={`text-[7px] font-bold px-1.5 py-0.2 rounded font-sans uppercase ${g.isPublic ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-amber-50 text-amber-700 border border-amber-100'}`}>
                                    {g.isPublic ? 'Public' : 'Private'}
                                  </span>
                                </div>
                                <h3 className="text-xs font-sans font-black text-[#1A1A1A] leading-snug mt-1">{g.name}</h3>
                                <p className="text-[9px] font-sans text-neutral-400">{g.membersCount} Members • Focus: <span className="font-bold text-neutral-650">{g.focus}</span></p>
                              </div>
                              <Users size={18} className="text-[#1A1A1A] shrink-0" />
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Joinable Community Memory Plans */}
                      <div className="space-y-2.5">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                            COMMUNITY PACING PLANS
                          </span>
                          <button 
                            onClick={loadSharedPlans} 
                            className="text-[9px] font-sans font-bold uppercase text-[#1A1A1A] hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <RefreshCw size={8} />
                            <span>Refresh</span>
                          </button>
                        </div>

                        {loadingSharedPlans ? (
                          <div className="text-center py-4 text-xs text-neutral-400 font-sans">
                            Loading shared plans...
                          </div>
                        ) : sharedPlans.length === 0 ? (
                          <div className="border border-dashed border-neutral-200 rounded-xl p-4 text-center text-xs text-neutral-400 font-sans">
                            No community memory plans published yet. Be the first to publish a custom plan!
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {sharedPlans.map((plan) => (
                              <div key={plan.id} className="border border-[#E5E5E5] rounded-xl p-3.5 bg-white space-y-3 text-left shadow-sm">
                                <div className="flex justify-between items-start">
                                  <div>
                                    <h4 className="text-xs font-sans font-black text-[#1A1A1A] leading-tight">
                                      {plan.name}
                                    </h4>
                                    <p className="text-[9px] font-sans text-neutral-400 mt-0.5">
                                      Shared by <button 
                                        onClick={() => viewMemberProfile(plan.creatorName)}
                                        className="font-semibold text-[#1A1A1A] hover:underline cursor-pointer"
                                      >
                                        {plan.creatorName || 'Anonymous'}
                                      </button>
                                    </p>
                                  </div>
                                  <span className="text-[8px] bg-neutral-100 border border-neutral-200 font-sans font-bold px-1.5 py-0.5 rounded uppercase">
                                    {plan.preset}
                                  </span>
                                </div>

                                {/* Plan Metrics bar */}
                                <div className="grid grid-cols-3 gap-2 py-1.5 border-y border-dashed border-neutral-100 text-[10px] font-sans">
                                  <div>
                                    <span className="text-[8px] text-neutral-400 block uppercase">Pace</span>
                                    <span className="font-bold text-neutral-800">{plan.newVersesPace} lines/day</span>
                                  </div>
                                  <div>
                                    <span className="text-[8px] text-neutral-400 block uppercase">Cap</span>
                                    <span className="font-bold text-neutral-800">{plan.maxReviewCap} mins</span>
                                  </div>
                                  <div>
                                    <span className="text-[8px] text-neutral-400 block uppercase">Members</span>
                                    <span className="font-bold text-neutral-800">{plan.downloadsCount || 0} joined</span>
                                  </div>
                                </div>

                                {/* Learning days overview */}
                                <div className="flex justify-between items-center pt-1">
                                  <div className="flex gap-1">
                                    {['M', 'T', 'W', 'Th', 'F', 'S', 'Su'].map((d) => {
                                      const active = plan.learningDays?.includes(d);
                                      return (
                                        <span 
                                          key={d} 
                                          className={`text-[8px] font-sans font-bold w-4 h-4 flex items-center justify-center rounded-full ${active ? 'bg-emerald-500 text-white font-black' : 'bg-neutral-50 text-neutral-300'}`}
                                          title={active ? 'Learning/Recitation Day' : 'Review/Reflection Day'}
                                        >
                                          {d[0]}
                                        </span>
                                      );
                                    })}
                                  </div>
                                  <button
                                    onClick={() => joinSharedPlan(plan)}
                                    className="bg-[#1A1A1A] hover:bg-neutral-800 text-white text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md transition cursor-pointer"
                                  >
                                    Join Plan
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Community Activity Feed */}
                      <div className="space-y-2.5">
                        <span className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                          RECENT GROUP FEED
                        </span>
                        
                        <div className="border border-neutral-200 rounded-xl p-4 bg-white space-y-3.5 shadow-sm">
                          {/* Event 1 */}
                          <div className="flex items-start gap-3">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                            <div className="space-y-0.5">
                              <p className="text-xs font-sans text-neutral-700 leading-relaxed">
                                <button 
                                  onClick={() => viewMemberProfile('Sarah Miller')}
                                  className="font-black text-black hover:underline cursor-pointer"
                                >
                                  Sarah Miller
                                </button>{' '}
                                completed memorizing the entire chapter of <span className="font-bold text-neutral-900">Romans 8</span> (39 verses)! 👑
                              </p>
                              <p className="text-[9px] text-neutral-400 font-mono">Today • Milestone Achievement</p>
                            </div>
                          </div>
                          
                          <div className="border-t border-neutral-100" />

                          {/* Event 2 */}
                          <div className="flex items-start gap-3">
                            <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                            <div className="space-y-0.5">
                              <p className="text-xs font-sans text-neutral-700 leading-relaxed">
                                <button 
                                  onClick={() => viewMemberProfile('Thomas Wright')}
                                  className="font-black text-black hover:underline cursor-pointer"
                                >
                                  Thomas Wright
                                </button>{' '}
                                completed memorizing <span className="font-bold text-neutral-900">Genesis 1:5-6</span>.
                              </p>
                              <p className="text-[9px] text-neutral-400 font-mono">Today</p>
                            </div>
                          </div>

                          <div className="border-t border-neutral-100" />

                          {/* Event 3 */}
                          <div className="flex items-start gap-3">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                            <div className="space-y-0.5">
                              <p className="text-xs font-sans text-neutral-700 leading-relaxed">
                                <button 
                                  onClick={() => viewMemberProfile('Esther Vance')}
                                  className="font-black text-black hover:underline cursor-pointer"
                                >
                                  Esther Vance
                                </button>{' '}
                                completed memorizing the entire chapter of <span className="font-bold text-neutral-900">John 15</span> (27 verses)! 🎉
                              </p>
                              <p className="text-[9px] text-neutral-400 font-mono">Today • Milestone Achievement</p>
                            </div>
                          </div>

                          <div className="border-t border-neutral-100" />

                          {/* Event 4 */}
                          <div className="flex items-start gap-3">
                            <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                            <div className="space-y-0.5">
                              <p className="text-xs font-sans text-neutral-700 leading-relaxed">
                                <button 
                                  onClick={() => viewMemberProfile('Chloe Vance')}
                                  className="font-black text-black hover:underline cursor-pointer"
                                >
                                  Chloe Vance
                                </button>{' '}
                                completed memorizing <span className="font-bold text-neutral-900">Psalm 23:1-3</span>.
                              </p>
                              <p className="text-[9px] text-neutral-400 font-mono">Today</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()
              )}

            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 3: RECORD SCREEN */}
          {/* ======================================================== */}
          {currentScreen !== 'memberProfile' && currentScreen !== 'analyzePlan' && currentScreen !== 'fullHistory' && currentScreen !== 'recordingDetail' && currentTab === 'record' && (
            <div className="flex-1 flex flex-col p-5 animate-fade-in text-left space-y-4 h-full relative">
              
              {/* Header Info */}
              <div className="border-b border-[#E5E5E5] pb-2 flex justify-between items-end">
                <div>
                  <span className="text-[9px] uppercase tracking-wider font-bold text-neutral-400 font-sans">
                    TELEPROMPTER VERIFICATION
                  </span>
                  <h1 className="text-xl font-serif font-bold text-[#1A1A1A]">Record Recitation</h1>
                </div>
                {/* Active Indicator */}
                {isRecording && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600 font-bold bg-red-50 border border-red-200 px-2 py-0.5 rounded-full animate-pulse">
                    <span className="w-2 h-2 bg-red-600 rounded-full" />
                    <span>{formatTime(recordingSeconds)}</span>
                  </div>
                )}
              </div>

              {/* Minimal Dropdown select controls */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[8px] font-extrabold uppercase text-neutral-400 font-sans tracking-wider block">
                    WHAT ARE YOU RECORDING?
                  </label>
                  <div className="relative">
                    <select
                      value={`${recordingBook} ${recordingChapter}`}
                      onChange={(e) => {
                        const [book, ch] = e.target.value.split(' ');
                        setRecordingBook(book);
                        setRecordingChapter(Number(ch));
                      }}
                      disabled={isRecording}
                      className="w-full bg-[#F3F2F1] border border-[#E5E5E5] rounded-xl px-3 py-2 text-xs font-bold text-[#1A1A1A] focus:outline-none focus:ring-1 focus:ring-[#1A1A1A] appearance-none"
                    >
                      <option value="Romans 8">Romans 8</option>
                      <option value="Genesis 1">Genesis 1</option>
                      <option value="Psalms 23">Psalms 23</option>
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-2.5 text-neutral-500 pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[8px] font-extrabold uppercase text-neutral-400 font-sans tracking-wider block">
                    TRANSLATION SELECT
                  </label>
                  <div className="relative">
                    <select
                      value={recordingTranslation}
                      onChange={(e) => setRecordingTranslation(e.target.value)}
                      disabled={isRecording}
                      className="w-full bg-[#F3F2F1] border border-[#E5E5E5] rounded-xl px-3 py-2 text-xs font-bold text-[#1A1A1A] focus:outline-none focus:ring-1 focus:ring-[#1A1A1A] appearance-none"
                    >
                      <option value="ESV">ESV Translation</option>
                      <option value="NIV">NIV Translation</option>
                      <option value="NKJV">NKJV Translation</option>
                      <option value="NLT">NLT Translation</option>
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-2.5 text-neutral-500 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Teleprompter Scrollable text display */}
              <div className="border border-[#1A1A1A] rounded-xl bg-[#F3F2F1]/35 p-4 flex-1 overflow-y-auto max-h-[380px] text-left">
                <span className="text-[9px] uppercase font-bold text-neutral-400 tracking-wider font-sans block mb-2">
                  TELEPROMPTER SCRIPT
                </span>
                
                <div className="space-y-4 font-serif text-lg leading-relaxed text-neutral-800 text-left">
                  {/* Pull verses based on chosen scripture */}
                  {(() => {
                    const matchedVerses = verses.filter(
                      (v) => v.book === recordingBook && v.chapter === recordingChapter
                    );
                    if (matchedVerses.length === 0) {
                      return <p className="text-xs text-neutral-400 italic">No scripture loaded.</p>;
                    }
                    return matchedVerses.map((v) => (
                      <p key={v.verse} className="relative">
                        <sup className="font-sans text-[10px] font-bold text-neutral-400 mr-1.5 select-none">{v.verse}</sup>
                        {v.text}
                      </p>
                    ));
                  })()}
                </div>
              </div>

              {/* Recording Animation Waveform Display */}
              {isRecording && (
                <div className="bg-[#1A1A1A] text-white p-3 rounded-xl flex items-center justify-between space-x-3.5 animate-pulse">
                  <span className="text-[9px] uppercase font-bold tracking-wider font-sans text-neutral-400">AUDIO SIGNAL</span>
                  {/* Dynamic wave animation */}
                  <div className="flex-1 flex items-end justify-center space-x-1.5 h-7">
                    {[3, 7, 5, 8, 4, 9, 6, 8, 5, 7, 3, 6, 8].map((val, idx) => (
                      <div 
                        key={idx} 
                        className="w-1 bg-red-500 rounded-full" 
                        style={{
                          height: `${Math.sin(Date.now() / 200 + idx) * 30 + 50}%`,
                          animation: `voiceWave 0.8s ease-in-out ${idx * 0.08}s infinite alternate`
                        }}
                      />
                    ))}
                    <style>{`
                      @keyframes voiceWave {
                        0% { height: 20%; }
                        100% { height: 100%; }
                      }
                    `}</style>
                  </div>
                  <span className="text-xs font-mono font-bold text-red-400">{formatTime(recordingSeconds)}</span>
                </div>
              )}

              {/* Recording Controls */}
              <div className="pt-2">
                {!isRecording ? (
                  <button
                    onClick={handleStartRecording}
                    className="w-full bg-[#1A1A1A] hover:bg-neutral-850 text-white font-sans font-bold text-sm py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition cursor-pointer shadow"
                  >
                    <Mic size={16} /> Tap to Record recitation
                  </button>
                ) : (
                  <button
                    onClick={handleStopRecording}
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-sans font-bold text-sm py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition cursor-pointer shadow-lg animate-pulse"
                  >
                    <div className="w-3 h-3 bg-white rounded-sm shrink-0" />
                    Stop Recording
                  </button>
                )}
              </div>

            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 4: PROFILE SCREEN */}
          {/* ======================================================== */}
          {currentScreen !== 'memberProfile' && currentScreen !== 'analyzePlan' && currentScreen !== 'fullHistory' && currentScreen !== 'recordingDetail' && currentTab === 'profile' && (
            <div className="flex-1 flex flex-col p-5 animate-fade-in text-left space-y-4">
              
              {/* Header row */}
              <div className="flex items-center justify-between pb-3 border-b border-[#E5E5E5]">
                <div className="flex items-center gap-3">
                  {user ? (
                    user.photoURL ? (
                      <img 
                        src={user.photoURL} 
                        alt={user.displayName || 'Profile'} 
                        className="w-12 h-12 rounded-full border-2 border-[#1A1A1A] object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full border-2 border-[#1A1A1A] bg-[#F3F2F1] flex items-center justify-center text-[#1A1A1A] font-serif font-bold text-lg">
                        {(user.displayName || 'K')[0]}
                      </div>
                    )
                  ) : (
                    <div className="w-12 h-12 rounded-full border-2 border-[#1A1A1A] bg-[#F3F2F1] flex items-center justify-center text-[#1A1A1A] font-serif font-bold text-lg">
                      K
                    </div>
                  )}
                  <div>
                    <h2 className="text-lg font-serif font-bold text-[#1A1A1A] leading-tight">
                      {user ? user.displayName : 'Kenneth Carter'}
                    </h2>
                    <p className="text-xs font-sans text-neutral-400 mt-0.5">
                      {user ? 'Memory Level: Cloud Sync Active' : 'Memory Level: Dedicated Devotee'}
                    </p>
                  </div>
                </div>

                {user ? (
                  <button
                    onClick={async () => {
                      try {
                        await signOut(auth);
                        triggerToast('Signed out from Cloud backup.');
                      } catch (error) {
                        console.error('Sign out error:', error);
                      }
                    }}
                    className="px-2.5 py-1.5 border border-red-200 hover:border-red-300 bg-red-50/50 hover:bg-red-50 text-red-600 font-sans font-bold text-[9px] uppercase tracking-wide rounded-lg transition cursor-pointer"
                  >
                    Sign Out
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      try {
                        await signInWithPopup(auth, googleProvider);
                        triggerToast('Cloud sync active! ☁️');
                      } catch (error) {
                        console.error('Sign in error:', error);
                        triggerToast('Sign in cancelled.');
                      }
                    }}
                    className="px-2.5 py-1.5 border-2 border-[#1A1A1A] hover:bg-neutral-50 text-[#1A1A1A] font-sans font-bold text-[9px] uppercase tracking-wider rounded-lg transition cursor-pointer"
                  >
                    Connect Cloud
                  </button>
                )}
              </div>

              {/* Cloud Sync Call to Action Banner if not logged in */}
              {!user && (
                <div className="border border-dashed border-[#1A1A1A] bg-[#FBF9F6] rounded-xl p-3 flex items-center justify-between gap-3">
                  <div className="space-y-0.5 text-left">
                    <h4 className="text-[10px] font-sans font-black text-[#1A1A1A] uppercase tracking-wider">Backup to Cloud</h4>
                    <p className="text-[9px] text-neutral-500 leading-normal font-sans">
                      Connect your Google Account to back up scripture, pacing settings, and user stats.
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        await signInWithPopup(auth, googleProvider);
                        triggerToast('Cloud sync active! ☁️');
                      } catch (error) {
                        console.error('Sign in error:', error);
                        triggerToast('Sign in cancelled.');
                      }
                    }}
                    className="shrink-0 px-3 py-1.5 bg-[#1A1A1A] hover:bg-neutral-850 text-white font-sans font-bold text-[9px] uppercase tracking-wider rounded-lg cursor-pointer transition shadow-xs"
                  >
                    Sign In
                  </button>
                </div>
              )}

              {/* Calculated Metrics cards (High Contrast) */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="bg-[#F3F2F1]/50 border border-[#E5E5E5] rounded-xl p-2.5 text-center space-y-0.5 relative">
                  <span className="text-[14px] font-bold text-[#1A1A1A] font-mono block">
                    {memorizedCount}
                  </span>
                  <span className="text-[8px] font-bold text-neutral-400 uppercase tracking-wide block">
                    memorized
                  </span>
                </div>
                
                <div className="bg-[#F3F2F1]/50 border border-[#E5E5E5] rounded-xl p-2.5 text-center space-y-0.5 relative">
                  <span className="text-[14px] font-bold text-[#1A1A1A] font-mono block text-amber-600">
                    {learningCount}
                  </span>
                  <span className="text-[8px] font-bold text-neutral-400 uppercase tracking-wide block">
                    learning
                  </span>
                </div>

                <div className="bg-[#F3F2F1]/50 border border-[#E5E5E5] rounded-xl p-2.5 text-center space-y-0.5 relative">
                  <span className="text-[14px] font-bold text-[#1A1A1A] font-mono block text-emerald-600">
                    45
                  </span>
                  <span className="text-[8px] font-bold text-neutral-400 uppercase tracking-wide block">
                    memory streak
                  </span>
                </div>
              </div>

              {/* GitHub-style visual memory grid representation */}
              <div className="space-y-1.5">
                <div className="flex items-center px-1">
                  <span className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                    PAST 15 DAYS ACTIVITY
                  </span>
                  <HelpTooltip text="Your consecutive study streak visualizer. Dark green indicates higher repetition volumes." />
                </div>
                <div className="border border-[#E5E5E5] rounded-xl p-3 bg-white">
                  <div className="grid grid-cols-5 gap-1.5 justify-center">
                    {[
                      { day: 'June 10', active: true, count: 5 },
                      { day: 'June 11', active: true, count: 8 },
                      { day: 'June 12', active: false, count: 0 },
                      { day: 'June 13', active: true, count: 3 },
                      { day: 'June 14', active: true, count: 4 },
                      { day: 'June 15', active: true, count: 9 },
                      { day: 'June 16', active: false, count: 0 },
                      { day: 'June 17', active: true, count: 2 },
                      { day: 'June 18', active: true, count: 7 },
                      { day: 'June 19', active: true, count: 4 },
                      { day: 'June 20', active: true, count: 12 },
                      { day: 'June 21', active: false, count: 0 },
                      { day: 'June 22', active: true, count: 6 },
                      { day: 'June 23', active: true, count: 5 },
                      { day: 'June 24', active: true, count: 8 },
                    ].map((item, index) => {
                      const color = item.count === 0 
                        ? 'bg-[#F3F2F1] border-[#E5E5E5]' 
                        : item.count > 6 
                          ? 'bg-emerald-600 border-emerald-700 text-white' 
                          : 'bg-emerald-300 border-emerald-400 text-emerald-950';
                      return (
                        <div 
                          key={index} 
                          className={`h-9 border rounded-md flex flex-col items-center justify-center font-mono text-[9px] transition-all relative group cursor-help ${color}`}
                          title={`${item.day}: ${item.count} repetitions`}
                        >
                          <span className="text-[8px] font-bold block">{item.day.split(' ')[1]}</span>
                          <span className="text-[10px] font-extrabold">{item.count > 0 ? `+${item.count}` : '0'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* MY FRIENDS SECTION */}
              <div className="space-y-1.5">
                <div className="flex items-center px-1">
                  <span className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                    FRIENDS (5)
                  </span>
                  <HelpTooltip text="Other active memorizers in your circles. Tap to view their memory levels and progress charts." />
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-thin">
                  {[
                    { name: 'Sarah Miller', avatar: 'SM', color: 'bg-indigo-50 border-indigo-200' },
                    { name: 'Thomas Wright', avatar: 'TW', color: 'bg-emerald-50 border-emerald-200' },
                    { name: 'Chloe Vance', avatar: 'CV', color: 'bg-amber-50 border-amber-200' },
                    { name: 'Esther Vance', avatar: 'EV', color: 'bg-purple-50 border-purple-200' },
                    { name: 'Pastor David', avatar: 'PD', color: 'bg-rose-50 border-rose-200' }
                  ].map((f) => (
                    <div 
                      key={f.name}
                      onClick={() => viewMemberProfile(f.name)}
                      className="flex items-center gap-2 border border-neutral-200 rounded-xl p-2 bg-white hover:bg-neutral-50 transition cursor-pointer shrink-0"
                    >
                      <div className={`w-7 h-7 rounded-full border border-neutral-300 ${f.color} font-serif font-black text-[10px] flex items-center justify-center`}>
                        {f.avatar}
                      </div>
                      <div className="text-left">
                        <h4 className="text-[10px] font-bold text-neutral-800 leading-none">{f.name}</h4>
                        <span className="text-[8px] font-sans text-neutral-400 leading-none block mt-0.5">View Profile</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* MY COMMUNITIES SECTION */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center">
                    <span className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                      COMMUNITIES ({joinedGroups.length})
                    </span>
                    <HelpTooltip text="Your active study groups and church pacing networks. Click any community to jump into its dashboard." />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {joinedGroups.map((c) => (
                    <div 
                      key={c.id} 
                      onClick={() => {
                        setActiveGroupName(c.name);
                        setActiveGroupDesc(c.desc);
                        setActiveGroupId(c.id);
                        setActiveGroupIsPublic(c.isPublic);
                        setActiveGroupOwner(c.role === 'Leader' ? 'Kenneth Carter (Me)' : 'Pastor Robert');
                        setCurrentTab('community');
                        setViewingGroupDetail(true);
                        triggerToast(`Viewing ${c.name} Circle! 🛡️`);
                      }}
                      className="border border-neutral-200 rounded-xl p-2.5 bg-neutral-50/50 flex justify-between items-center text-left hover:border-neutral-900 cursor-pointer transition"
                    >
                      <div>
                        <h4 className="text-xs font-sans font-bold text-neutral-800 leading-snug">{c.name}</h4>
                        <p className="text-[9px] font-sans text-neutral-400 mt-0.5">{c.desc}</p>
                      </div>
                      <span className="text-[7.5px] font-bold font-sans bg-neutral-900 text-white px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0">
                        {c.role}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* LIST OF SAVED VOICE RECORDINGS */}
              <div className="space-y-2">
                <div className="flex items-center px-1">
                  <span className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans block uppercase">
                    RECORDED CHAPTERS ({userRecordings.length})
                  </span>
                  <HelpTooltip text="Chapters recited and recorded. Click any recording to inspect timestamps or verify sync alignments." />
                </div>

                <div className="space-y-2 max-h-[190px] overflow-y-auto pr-1">
                  {userRecordings.length === 0 ? (
                    <div className="text-center p-4 bg-[#F3F2F1]/55 rounded-xl border border-dashed border-[#E5E5E5] text-xs text-[#888]">
                      No recorded chapters yet. Tap Record tab to make one!
                    </div>
                  ) : (
                    userRecordings.map((rec) => {
                      const isPlaying = playingRecordingId === rec.id;
                      return (
                        <div 
                          key={rec.id} 
                          onClick={() => {
                            setSelectedRecording(rec);
                            navigateTo('recordingDetail');
                          }}
                          className="border border-[#E5E5E5] hover:border-neutral-900 transition-all cursor-pointer rounded-xl p-3 bg-white space-y-2 group"
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-left">
                              <h4 className="text-xs font-black text-[#1A1A1A] leading-tight group-hover:underline flex items-center gap-1.5">
                                {rec.book} {rec.chapter}
                                <span className="text-[8px] bg-neutral-100 text-neutral-600 font-sans border border-neutral-200 px-1.5 py-0.2 rounded font-normal uppercase">View Sync</span>
                              </h4>
                              <p className="text-[9px] font-sans text-neutral-400 mt-0.5">{rec.date} • {rec.translation} • {rec.duration} seconds</p>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation(); // Stop parent click trigger
                                if (isPlaying) {
                                  setPlayingRecordingId(null);
                                } else {
                                  setPlayingRecordingId(rec.id);
                                  setPlayingRecProgress(0);
                                  triggerToast(`Playing ${rec.book} ${rec.chapter}...`);
                                }
                              }}
                              className={`w-7 h-7 rounded-full flex items-center justify-center transition cursor-pointer shrink-0 ${
                                isPlaying ? 'bg-[#1A1A1A] text-white' : 'border border-[#1A1A1A] hover:bg-[#F3F2F1] text-[#1A1A1A]'
                              }`}
                            >
                              {isPlaying ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
                            </button>
                          </div>
                          
                          {/* Playback bar indicator */}
                          {isPlaying && (
                            <div className="w-full bg-neutral-100 h-1.5 rounded-full overflow-hidden">
                              <div className="bg-[#1A1A1A] h-full transition-all duration-1000" style={{ width: `${playingRecProgress}%` }} />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>
          )}

        </div>

        {/* ==========================================
            IPHONE BOTTOM NAVIGATION BAR
            ========================================== */}
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-white border-t border-[#E5E5E5] px-6 flex items-center justify-between z-40 select-none">
          {[
            { id: 'home', label: 'Home', icon: HomeIcon },
            { id: 'community', label: 'Community', icon: Users },
            { id: 'record', label: 'Record', icon: Mic },
            { id: 'profile', label: 'Profile', icon: User }
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => selectTab(tab.id as any)}
                className={`flex flex-col items-center justify-center space-y-1 py-1.5 flex-1 cursor-pointer transition-colors duration-150 ${
                  isActive ? 'text-[#1A1A1A]' : 'text-[#888] hover:text-[#1A1A1A]'
                }`}
              >
                <Icon size={18} className={isActive ? 'stroke-[2.5px]' : 'stroke-[2px]'} />
                <span className="text-[10px] font-sans font-bold tracking-tight">
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>

      </div>

      {/* ==========================================
          INTERACTIVE FULL PRACTICE SCREEN OVERLAY
          ========================================== */}
      {activeModal && (
        <PracticeModals
          type={activeModal}
          verses={modalVerses}
          allVerses={verses}
          onClose={() => {
            setActiveModal(null);
            setModalVerses([]);
          }}
          onUpdateStatus={handleUpdateVerseStatus}
          memoryQueue={memoryQueue}
          primingLookahead={primingLookahead}
          setPrimingLookahead={setPrimingLookahead}
        />
      )}

      {/* ==========================================
          MODAL: SAVE RECORDING POPUP
          ========================================== */}
      {saveRecordingDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white border-2 border-[#1A1A1A] rounded-xl p-5 max-w-[320px] w-full text-left space-y-4">
            <div>
              <h3 className="text-base font-serif font-bold text-[#1A1A1A]">Save Recitation</h3>
              <p className="text-xs text-neutral-500 font-sans mt-1">Review the details of your recorded chapter before saving and sharing.</p>
            </div>
            
            <div className="space-y-2.5 bg-[#F3F2F1] p-3 rounded-xl border border-[#E5E5E5] text-xs">
              <div className="flex justify-between">
                <span className="text-neutral-400 font-bold uppercase text-[9px] font-sans">Chapter:</span>
                <span className="text-[#1A1A1A] font-bold font-sans">{recordingBook} {recordingChapter}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400 font-bold uppercase text-[9px] font-sans">Translation:</span>
                <span className="text-[#1A1A1A] font-bold font-sans">{recordingTranslation}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400 font-bold uppercase text-[9px] font-sans">Duration:</span>
                <span className="text-[#1A1A1A] font-bold font-sans">{formatTime(recordingSeconds)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400 font-bold uppercase text-[9px] font-sans">Scope:</span>
                <span className="text-emerald-700 font-bold font-sans">Full Chapter Recitation</span>
              </div>
            </div>

            <p className="text-[10px] text-neutral-400 font-sans leading-relaxed">
              * This recitation will be added to your profile library as a selectable audio narration for this chapter, and shared with your community group.
            </p>

            <div className="flex gap-2.5 pt-1">
              <button
                onClick={() => {
                  setSaveRecordingDialog(false);
                  triggerToast('Recording discarded.');
                }}
                className="flex-1 py-2.5 px-3 border border-[#E5E5E5] text-xs text-neutral-500 hover:bg-neutral-50 rounded-xl font-bold transition cursor-pointer text-center bg-white"
              >
                Discard
              </button>
              <button
                onClick={saveRecordedAudio}
                className="flex-1 py-2.5 px-3 bg-[#1A1A1A] text-white hover:bg-neutral-850 text-xs rounded-xl font-bold transition cursor-pointer text-center"
              >
                Confirm & Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          MODAL: DETAILED OVERALL PROGRESS POPUP
          ========================================== */}
      {showProgressModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white border-2 border-[#1A1A1A] rounded-xl p-5 max-w-[340px] w-full text-left space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-serif font-bold text-[#1A1A1A]">My Scripture Memory Plan</h3>
              <button 
                onClick={() => setShowProgressModal(false)}
                className="text-neutral-400 hover:text-black transition"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3.5 pt-1">
              {/* Detailed Breakdown stats */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="border border-emerald-200 rounded-xl p-2 bg-emerald-50/50">
                  <span className="text-base font-bold text-emerald-700 block">{memorizedCount}</span>
                  <span className="text-[9px] font-sans font-bold text-neutral-500">Memorized</span>
                </div>
                <div className="border border-amber-200 rounded-xl p-2 bg-amber-50/50">
                  <span className="text-base font-bold text-amber-600 block">{learningCount}</span>
                  <span className="text-[9px] font-sans font-bold text-neutral-500">Learning</span>
                </div>
                <div className="border border-neutral-200 rounded-xl p-2 bg-neutral-50/50">
                  <span className="text-base font-bold text-neutral-700 block">{untouchedCount}</span>
                  <span className="text-[9px] font-sans font-bold text-neutral-500">Untouched</span>
                </div>
              </div>

              {/* Progress split indicators by selected books */}
              <div className="space-y-3 pt-1">
                <span className="text-[10px] font-bold text-neutral-400 tracking-wider block uppercase">
                  PROGRESS BY BOOK
                </span>

                {['Genesis', 'Psalms', 'John', 'Romans'].map((bookName) => {
                  const bookVerses = verses.filter(v => v.book === bookName);
                  const memBookCount = bookVerses.filter(v => v.status === 'memorized').length;
                  const ratio = Math.round((memBookCount / bookVerses.length) * 100) || 0;

                  return (
                    <div key={bookName} className="space-y-1">
                      <div className="flex justify-between items-center text-xs font-sans font-bold">
                        <span className="text-neutral-800 font-serif">{bookName}</span>
                        <span className="text-neutral-400 text-[10px] font-mono">{memBookCount}/{bookVerses.length} memorized</span>
                      </div>
                      <div className="w-full bg-neutral-100 h-2 rounded-full overflow-hidden border border-neutral-200">
                        <div className="bg-[#1A1A1A] h-full" style={{ width: `${ratio}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              onClick={() => {
                setShowProgressModal(false);
                navigateTo('planDesigner');
              }}
              className="w-full py-2.5 px-4 bg-white border border-[#1A1A1A] text-[#1A1A1A] rounded-xl font-bold font-sans text-xs hover:bg-[#F3F2F1] transition cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Sliders size={13} />
              <span>Design Memory Plan</span>
            </button>

            <button
              onClick={() => setShowProgressModal(false)}
              className="w-full py-2.5 bg-neutral-200 text-[#1A1A1A] rounded-xl font-bold font-sans text-xs hover:bg-neutral-300 transition cursor-pointer"
            >
              Close Progress Dashboard
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
