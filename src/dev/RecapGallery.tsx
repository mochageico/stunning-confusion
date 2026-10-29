// ============================================================================
// RECAP GALLERY -- the Mixed review recap's ladder pieces on one page
// (REVIEW_LADDER_PLAN.md stage 7): the per-passage outcome rows and the
// "Fix the transitions" offer. Demo preview only: /?s=ladderRecap (add
// &ios=1, &scale=1.5, &dark=1 as usual). Never reachable in a production
// build (DEMO gate).
// ============================================================================
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { QueueItem } from '../types';
import type { ReviewNote } from '../lib/ladderEngine';
import { AppText } from '../components/design';
import { FixTransitions, PassageOutcomes, transitionTargets } from '../components/practice/ReviewRecap';

const TEXT = [
  'Therefore, there is now no condemnation for those who are in Christ Jesus,',
  'because through Christ Jesus the law of the Spirit of life has set you free from the law of sin and death.',
  'For what the law was powerless to do in that it was weakened by the flesh, God did by sending His own Son in the likeness of sinful flesh to be a sin offering.',
];

const verse = (n: number, slipped: boolean): QueueItem => ({
  verseId: `BSB_ROM_8_${n}`,
  translationId: 'BSB',
  book: 'Romans',
  chapter: 8,
  verseNumber: n,
  text: TEXT[n - 1],
  orderIndex: n,
  status: 'reviewing',
  retentionPhase: 'daily',
  dateStarted: null,
  lastReviewDate: null,
  nextReviewDueDate: null,
  currentStreakCount: 0,
  totalSuccessfulReviews: 0,
  gracePeriodUsedToday: false,
  ladderStep: 0,
  ladderReviews: 3,
  ...(slipped ? { slipped: true as const } : {}),
});

const QUEUE = [verse(1, false), verse(2, true), verse(3, true)];
const now = Date.now();
const note = (n: Partial<ReviewNote> & Pick<ReviewNote, 'title' | 'tag' | 'reason'>): ReviewNote => ({
  at: now,
  verseIds: [],
  slipped: [],
  firmUp: false,
  ...n,
});

const NOTES: ReviewNote[] = [
  note({ title: 'Psalm 23:1–6', tag: 'Clean', reason: 'Review 4 of 7 at Every day.' }),
  note({ title: 'Matthew 7:1–14', tag: 'Clean', reason: 'Moved up to Every 2 days.' }),
  note({
    title: 'Romans 8:1–3',
    tag: 'Held',
    reason: "2 stumbles, so this review didn't count.",
    firmUp: true,
    verseIds: QUEUE.map((q) => q.verseId),
    slipped: [
      { verseId: 'BSB_ROM_8_2', verseNumber: 2 },
      { verseId: 'BSB_ROM_8_3', verseNumber: 3 },
    ],
  }),
  note({ title: 'Philippians 4:4–9', tag: 'Forgiven', reason: '1 stumble in 6 verses forgiven, so the review counted.' }),
  note({ title: 'John 15:1–8', tag: 'Back 1', reason: '3 stumbles, so it goes back one review.', firmUp: true }),
  note({ title: 'Isaiah 40:28–31', tag: 'Down a step', reason: 'A blank moved it down to Every 4 days.' }),
  note({ title: 'Romans 12:1–2', tag: 'Won back', reason: 'You recited the slipped verses clean, so the review is back.' }),
];

export default function RecapGallery() {
  return (
    <SafeAreaView className="flex-1 bg-canvas">
      <ScrollView className="flex-1" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 20 }}>
        <AppText variant="display" className="font-sans font-bold text-ink">
          Reviews done
        </AppText>
        <PassageOutcomes notes={NOTES} />
        <View>
          <FixTransitions queue={QUEUE} targets={transitionTargets(NOTES, QUEUE)} onClear={() => {}} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
