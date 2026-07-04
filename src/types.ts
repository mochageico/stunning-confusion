export interface VerseState {
  book: string;
  chapter: number;
  verse: number;
  text: string;
  status: 'memorized' | 'learning' | 'untouched';
  dueDate?: string;
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

export interface Recording {
  id: string;
  title: string;
  book: string;
  chapter: number;
  translation: string;
  duration: number;
  date: string;
  audioUrl?: string;
  user?: string;
  avatar?: string;
  category?: 'global' | 'group' | 'friends';
  versesStr?: string;
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

