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
}

export interface VerseTimestamp {
  verse: number;
  startSec: number;
  endSec: number;
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
  reviewingDays: string[];
  primingDays: string[];
  newVersesPace: number;
  maxReviewCap: number;
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
