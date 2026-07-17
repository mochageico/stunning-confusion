export interface VerseState {
  book: string;
  chapter: number;
  verse: number;
  text: string;
  status: 'memorized' | 'learning' | 'untouched';
  dueDate?: string;
}

export interface BibleBook {
  id: string; // standard 3-character USFM book code, e.g. 'GEN', 'JHN'
  name: string; // display name, e.g. 'Genesis', 'John'
  testament: 'ot' | 'nt';
  chapters: number; // total chapter count in this book
}

export interface BibleTranslation {
  id: string; // short code, e.g. 'ESV', 'WEB'
  name: string; // full name, e.g. 'English Standard Version'
  copyright?: string; // required attribution text, when the translation is not public domain
  isPublicDomain: boolean;
}

export interface ChapterText {
  translationId: string;
  bookId: string;
  book: string;
  chapter: number;
  verses: Record<string, string>; // verse number (as string) -> verse text
  verseCount: number;
}

export interface TouchLog {
  timestamp: string;           // ISO timestamp of successful recall
  drillType: 'speak' | 'type' | 'reveal';
}

export interface GroupPlan {
  planId: string;
  circleId?: string;           // Associated scripture circle ID
  name: string;                // e.g., "Romans 10 Shared Study"
  managerId: string;           // User ID of the plan manager
  scriptureRange: string[];    // Array of verseIds (e.g., ["ROM_10_1", "ROM_10_2", ...])
  startDate: string;           // ISO start date
  pacingPerWeek: number;       // e.g., 3 (verses per week)
  learningDays: ('Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun' | 'Su')[]; // e.g., ['Mon', 'Wed', 'Fri']
  currentGroupVerseIndex: number; // Pointer to where the group is currently at
  description?: string;
  managerName?: string;
}

export interface QueueItem {
  verseId: string;             // Unique identifier (e.g., "ROM_8_1", "PHP_4_6")
  book: string;                // e.g., "Romans"
  chapter: number;             // e.g., 8
  verseNumber: number;         // e.g., 1
  text: string;                // Verse text
  orderIndex: number;          // Position in the queue
  status: 'queued' | 'learning' | 'reviewing' | 'retained';
  origin?: 'individual' | 'group'; // Origin of the verse (colored orange/red for individual, blue/purple for group)

  // 7-6-5 Retention System State
  retentionPhase: 'none' | 'daily' | 'weekly' | 'monthly';
  dateStarted: string | null;  // ISO string when first moved to 'learning'
  lastReviewDate: string | null; // ISO string when last practiced/reviewed
  nextReviewDueDate: string | null; // ISO string when next review is required

  // Progress counters
  currentStreakCount: number;  // Consecutive successful daily/weekly/monthly practices
  totalSuccessfulReviews: number; // Cumulative correct reviews

  // Grace Period state
  gracePeriodUsedToday: boolean; // Flag to prevent multiple grace uses in one day

  // 3-Touch Mastery State
  touchLogs?: TouchLog[];      // Tracks valid, hour-separated touches
  reviewsToday?: number;       // Tracks successful reviews for today

  // Demotion softening: a miss while in Daily doesn't send the verse back to
  // Learning anymore -- it just makes Daily's own graduation target longer.
  dailyPhaseExtensionDays?: number; // Extra days added to Daily's graduation target by misses (default 0)

  // Demotion softening: a miss while in Weekly/Monthly sends the verse down
  // for a temporary "refresher" stint instead of a full phase demotion. Its
  // progress in the original phase is preserved and resumed once the
  // refresher is cleared, rather than lost.
  refresherActive?: boolean;               // True while doing a temporary refresher stint
  refresherReturnPhase?: 'weekly' | 'monthly'; // Phase to resume once the refresher is cleared
  refresherReturnProgress?: number;        // currentStreakCount to restore on return
  refresherTargetUnits?: number;           // Successful reviews needed to clear the refresher (days if refreshing via Daily, weeks if refreshing via Weekly)

  // Chapter review-day anchoring ("Snap-to-Grid"): set once, the first time
  // ANY chunk of this book+chapter graduates out of Daily review, to
  // whichever weekday that happened to land on. Every other chunk of the
  // same chapter looks this up and snaps its own Weekly/Monthly due dates
  // onto it instead of drifting onto its own independent schedule -- so a
  // chapter learned in scattered daily pieces still converges onto one
  // shared review day. Never overwritten once set; absent on verses that
  // haven't graduated out of Daily yet (or predate this feature).
  chapterReviewAnchorDay?: string; // a DAY_ABBREVS value, e.g. 'M', 'Th'
}

export interface VerseTimestamp {
  verse: number;
  startSec: number;
  endSec: number;
}

// Real memorization-milestone event (Community activity feed) — fires only
// when a verse actually reaches the deep 'retained' status, the same
// long-term-mastery threshold that already drives "Memorized" everywhere
// else in the app (ProfileScreen's count, HomeScreen's grouping).
export interface ActivityEvent {
  id: string;
  uid: string;
  authorName: string;
  book: string;
  chapter: number;
  type: 'verse' | 'chapter';
  verse?: number; // set when type === 'verse'
  verseCount?: number; // set when type === 'chapter'
  createdAtMs: number; // client-side snapshot for sorting/display; Firestore createdAt is the source of truth
}

export interface Recording {
  id: string;
  title: string;
  book: string;
  chapter: number;
  translation: string;
  duration: number;
  date: string;
  audioUrl?: string;
  audioPath?: string; // Firebase Storage path, e.g. recordings/{uid}/{id}.m4a — needed to delete the blob
  userId?: string;
  user?: string;
  avatar?: string;
  category?: 'global' | 'group' | 'friends';
  versesStr?: string;
  verseTimestamps?: VerseTimestamp[]; // populated once auto-alignment (phase 2) runs; empty until then
  sharedVisibility?: 'private' | 'circle' | 'public'; // absent/undefined == 'private' (recordings predating this field)
  savedFromUid?: string; // set only on a reference copy saved via "Save to Library" — the original owner's uid
  savedFromRecordingId?: string; // the original sharedRecordings/recording id — used to detect "already saved"
  // 'imported' == tagged from a pre-existing audio file (see the Import
  // Audio flow in RecordScreen) rather than captured live with the mic.
  // Absent/undefined == 'recorded' (every recording before this field existed).
  sourceType?: 'recorded' | 'imported';
  // Playback-time volume leveling, computed from the peak input level seen
  // while recording (see computePlaybackGain in useAppState.ts). Only ever
  // <= 1: it can tame a recording that came in too hot, never boost one that
  // came in too quiet -- expo-audio's player volume can't exceed the
  // original level. Absent/undefined == 1 (play at full/original volume),
  // true for every recording predating this field and for imports (no
  // metering data was ever captured for those).
  playbackGain?: number;
}

export interface GroupedQueueItem {
  id: string;
  book: string;
  chapter: number;
  verses: number[];
  status: string;
  origin: 'individual' | 'group';
  items: QueueItem[];
}

export interface MemoryPlan {
  id: string;
  name: string;
  preset: 'drip' | 'warrior' | 'custom';
  learningDays: string[];
  newVersesPace: number;
  maxReviewCap: number;
  // Retention rigor: how many weeks/months/years a verse spends in each
  // review phase before graduating. 'light'/'standard'/'deep' are named
  // presets (5-4-3 / 7-6-5 / 9-8-7); 'custom' means the three *PhaseX
  // fields below were hand-set and don't match a named preset.
  retentionRigor: 'light' | 'standard' | 'deep' | 'custom';
  dailyPhaseWeeks: number;
  weeklyPhaseMonths: number;
  monthlyPhaseYears: number;
  // Mastery-gate settings: these were previously live useState values that
  // drove the engine but were never part of the saved plan, so they didn't
  // survive a save/switch/reload. Now part of the plan like everything else.
  masteryTouches: number;
  reviewsRequired: number;
  // Sabbath: an optional single weekday, off by default, free from both
  // learning and reviewing -- the engine treats it as not existing at all
  // (due dates never land on it, and it doesn't count as elapsed time when
  // detecting silently-missed review cycles).
  sabbathEnabled: boolean;
  sabbathDay: string;
  // Multiplier applied to the daily time estimate (0.75/1.0/1.5 for
  // low/medium/high) -- previously a live useState with no UI control and
  // no persistence, so it silently reset to 'medium' every reload.
  cognitiveLoadSensitivity: 'low' | 'medium' | 'high';
  isActive: boolean;
  updatedAt: string | Date;
}

export interface Circle {
  id: string;
  name: string;
  description: string;
  isPublic: boolean;
  ownerId: string;              // creator's uid — the only 'leader' in v1 (no promote/demote yet)
  ownerName: string;
  inviteCode: string;            // uppercase, used for private join-by-code
  pinnedAnnouncement: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CircleMember {
  uid: string;
  displayName: string;
  avatarUrl: string;
  role: 'leader' | 'member';    // set once at creation, immutable in v1
  joinedAt: string;
}

// Real, mutual, persistent friend connection — independent of circle
// membership (survives leaving a shared circle), unlike the old
// "circleFriends" (real co-members across your circles, recomputed live).
export interface FriendRequest {
  id: string;
  fromUid: string;
  fromName: string;
  toUid: string;
  toName: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}

export interface Friend {
  uid: string;
  displayName: string;
  avatarUrl: string;
  friendsSince: string;
}

// Real user profile, stored at profiles/{uid}. memorizedCount/learningCount are
// denormalized snapshots the owning client patches in opportunistically, so
// other users can see meaningful stats without exposing private
// verses/memoryQueue subcollections.
export interface UserProfile {
  uid: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  streakDays?: number;
  memorizedCount?: number;
  learningCount?: number;
  circleIds?: string[];
}
