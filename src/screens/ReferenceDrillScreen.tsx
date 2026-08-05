import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Check, RefreshCw, Target, X } from 'lucide-react-native';

import { AppState, isReviewDue } from '../state/useAppState';
import { ChipRow, FadeInView, NumericInput } from '../components/ui';
import { BookPicker } from '../components/BookPicker';
import { AppText } from '../components/design';
import {
  buildReferenceRounds,
  formatReference,
  referenceAnswerMatches,
  DrillDirection,
  ReferenceItem,
  ReferenceRound,
} from '../lib/drills';

// ============================================================================
// REFERENCE <-> VERSE DRILL
// ----------------------------------------------------------------------------
// Quizzes "where is this?" against verses already in the review system. Two
// deliberate scoping decisions:
//
// 1. The pool is every matching queue item REGARDLESS of phase or due date.
//    This is a study tool you reach for on purpose, not a scheduled review
//    surface -- gating it to what's due today would make it useless the
//    moment you'd finished your reviews.
//
// 2. It never calls handleUpdateVerseStatus. Knowing a verse's address is a
//    different skill from reciting it, and the whole graduation engine is
//    built on the latter; letting this drill advance reviews would blur what
//    "graduated" means. Sessions end in their own scorecard instead.
// ============================================================================

const SESSION_LENGTHS = [
  { id: 5, label: '5' },
  { id: 10, label: '10' },
  { id: 20, label: '20' },
  { id: 0, label: 'All' },
];

// Which slice of the review system to quiz from. 'all' is every started
// verse (the original, and still the default). The three retentionPhase
// values let you drill one review set at a time -- e.g. "just my Monthly
// verses", the ones most at risk of having quietly faded. 'learning' is the
// other end: verses still being learned, not yet on a spaced schedule.
const REVIEW_SETS = [
  { id: 'all' as const, label: 'All started' },
  { id: 'learning' as const, label: 'Learning' },
  { id: 'daily' as const, label: 'Daily' },
  { id: 'weekly' as const, label: 'Weekly' },
  { id: 'monthly' as const, label: 'Monthly' },
];
type ReviewSet = (typeof REVIEW_SETS)[number]['id'];

type Phase = 'setup' | 'playing' | 'done';

export default function ReferenceDrillScreen({ state }: { state: AppState }) {
  const { memoryQueue, navigateTo } = state;

  const [book, setBook] = useState('');
  const [startChapter, setStartChapter] = useState('');
  const [endChapter, setEndChapter] = useState('');
  // Verse-level bounds, only applied when the range narrows to a single
  // chapter -- a "verse 5 to verse 20" span means nothing across chapters
  // with different verse counts. Same scoping rule the Goal feature uses.
  const [startVerse, setStartVerse] = useState('');
  const [endVerse, setEndVerse] = useState('');
  const [reviewSet, setReviewSet] = useState<ReviewSet>('all');
  const [dueTodayOnly, setDueTodayOnly] = useState(false);
  const [direction, setDirection] = useState<DrillDirection>('both');
  const [sessionLength, setSessionLength] = useState(10);
  const [hardMode, setHardMode] = useState(false);

  const [phase, setPhase] = useState<Phase>('setup');
  const [rounds, setRounds] = useState<ReferenceRound[]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [score, setScore] = useState(0);
  // Null while the current round is unanswered; otherwise the outcome, which
  // freezes the round until the user advances.
  const [lastResult, setLastResult] = useState<'right' | 'wrong' | null>(null);
  const [freeGuess, setFreeGuess] = useState({ book: '', chapter: '', verse: '' });
  // refToVerse in hard mode has no options to pick from -- the user recalls
  // it themselves, reveals, and self-scores.
  const [revealed, setRevealed] = useState(false);

  // Verse bounds only make sense inside one chapter, so they're offered (and
  // applied) only when the chapter range collapses to a single chapter.
  const singleChapter =
    !!book && !!startChapter && (endChapter === '' || endChapter === startChapter) ? Number(startChapter) : null;
  // Once a verse bound is actually typed, the chapter stops being a lower
  // bound and pins to exactly that chapter. Without this, "Romans 8, verses
  // 2-4" also matched Romans 12:2 -- From-chapter alone means "chapter >= 8",
  // so every later chapter stayed in the pool and got verse-filtered too.
  const verseBoundsActive = singleChapter !== null && (!!startVerse || !!endVerse);

  // Anything actually in the review system: learning, reviewing, or retained.
  // 'queued' verses haven't been started yet, so quizzing on them would be
  // testing something never taught.
  const pool = useMemo<ReferenceItem[]>(() => {
    const started = memoryQueue.filter((i) => i.status !== 'queued');
    const from = Number(startChapter);
    const to = Number(endChapter);
    const fromV = Number(startVerse);
    const toV = Number(endVerse);
    return started
      .filter((i) => {
        if (book && i.book !== book) return false;
        if (startChapter && Number.isFinite(from) && i.chapter < from) return false;
        if (endChapter && Number.isFinite(to) && i.chapter > to) return false;
        if (verseBoundsActive) {
          if (i.chapter !== singleChapter) return false;
          if (startVerse && Number.isFinite(fromV) && i.verseNumber < fromV) return false;
          if (endVerse && Number.isFinite(toV) && i.verseNumber > toV) return false;
        }

        // Review-set filter. 'learning' is a status; the three phase names are
        // only meaningful on items that have actually reached 'reviewing'.
        // 'retained' items carry retentionPhase 'monthly' from their last
        // phase, so they're deliberately excluded from the phase buckets --
        // those mean "currently on this review cadence".
        if (reviewSet === 'learning' && i.status !== 'learning') return false;
        if (reviewSet !== 'all' && reviewSet !== 'learning') {
          if (i.status !== 'reviewing' || i.retentionPhase !== reviewSet) return false;
        }

        if (dueTodayOnly && !(i.status === 'reviewing' && isReviewDue(i.nextReviewDueDate))) return false;
        return true;
      })
      .map((i) => ({ book: i.book, chapter: i.chapter, verse: i.verseNumber, text: i.text }));
  }, [
    memoryQueue,
    book,
    startChapter,
    endChapter,
    startVerse,
    endVerse,
    singleChapter,
    verseBoundsActive,
    reviewSet,
    dueTodayOnly,
  ]);

  const uniqueCount = useMemo(() => new Set(pool.map(formatReference)).size, [pool]);

  const currentRound = rounds[roundIndex] ?? null;

  const startSession = () => {
    const count = sessionLength === 0 ? uniqueCount : sessionLength;
    const built = buildReferenceRounds(pool, count, direction);
    if (built.length === 0) return;
    setRounds(built);
    setRoundIndex(0);
    setScore(0);
    setLastResult(null);
    setRevealed(false);
    setFreeGuess({ book: '', chapter: '', verse: '' });
    setPhase('playing');
  };

  const recordResult = (correct: boolean) => {
    setLastResult(correct ? 'right' : 'wrong');
    if (correct) setScore((s) => s + 1);
  };

  const advance = () => {
    setLastResult(null);
    setRevealed(false);
    setFreeGuess({ book: '', chapter: '', verse: '' });
    if (roundIndex >= rounds.length - 1) setPhase('done');
    else setRoundIndex((i) => i + 1);
  };

  const handleBack = () => navigateTo('home');

  // ==========================================================================
  // SETUP
  // ==========================================================================
  if (phase === 'setup') {
    const canStart = uniqueCount > 0;
    return (
      <FadeInView style={{ flex: 1 }}>
        <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 18 }}>
          <View className="flex-row items-center gap-3">
            <Pressable onPress={handleBack} className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white">
              <ArrowLeft size={14} color="#262626" />
            </Pressable>
            <View>
              <AppText variant="micro" className="uppercase tracking-wider font-extrabold text-neutral-400 font-sans">Practice</AppText>
              <AppText variant="title" className="font-serif font-black text-neutral-900 mt-0.5">Reference Drill</AppText>
            </View>
          </View>

          <AppText variant="caption" className="text-neutral-400 leading-relaxed -mt-2">
            Quiz yourself on where your verses live. Pulls from everything you've started memorizing, whether or not it's due
            today — and it's practice only, so nothing here changes your review schedule.
          </AppText>

          {/* Range */}
          <View className="gap-2">
            <AppText variant="section" className="font-sans font-extrabold uppercase tracking-wider text-neutral-400">Range</AppText>
            <BookPicker value={book} onChange={setBook} allowAll allLabel="All my verses" title="Limit to a Book" />
            {!!book && (
              <View className="flex-row items-center gap-2">
                <View className="flex-1">
                  <AppText variant="micro" className="font-sans font-bold text-neutral-400 mb-1">From chapter</AppText>
                  <NumericInput
                    value={startChapter}
                    onChangeText={setStartChapter}
                    placeholder="Any"
                    placeholderTextColor="#a3a3a3"
                    className="bg-white border border-neutral-300 rounded-xl px-3 py-2 text-xs text-[#1A1A1A]"
                  />
                </View>
                <View className="flex-1">
                  <AppText variant="micro" className="font-sans font-bold text-neutral-400 mb-1">To chapter</AppText>
                  <NumericInput
                    value={endChapter}
                    onChangeText={setEndChapter}
                    placeholder="Any"
                    placeholderTextColor="#a3a3a3"
                    className="bg-white border border-neutral-300 rounded-xl px-3 py-2 text-xs text-[#1A1A1A]"
                  />
                </View>
              </View>
            )}

            {/* Verse bounds appear only once the range is a single chapter --
                see the singleChapter note above. */}
            {singleChapter !== null && (
              <View className="flex-row items-center gap-2">
                <View className="flex-1">
                  <AppText variant="micro" className="font-sans font-bold text-neutral-400 mb-1">From verse</AppText>
                  <NumericInput
                    value={startVerse}
                    onChangeText={setStartVerse}
                    placeholder="Any"
                    placeholderTextColor="#a3a3a3"
                    className="bg-white border border-neutral-300 rounded-xl px-3 py-2 text-xs text-[#1A1A1A]"
                  />
                </View>
                <View className="flex-1">
                  <AppText variant="micro" className="font-sans font-bold text-neutral-400 mb-1">To verse</AppText>
                  <NumericInput
                    value={endVerse}
                    onChangeText={setEndVerse}
                    placeholder="Any"
                    placeholderTextColor="#a3a3a3"
                    className="bg-white border border-neutral-300 rounded-xl px-3 py-2 text-xs text-[#1A1A1A]"
                  />
                </View>
              </View>
            )}
            <AppText variant="caption" className={`font-sans font-bold ${canStart ? 'text-neutral-500' : 'text-amber-700'}`}>
              {canStart
                ? `${uniqueCount} ${uniqueCount === 1 ? 'verse' : 'verses'} available`
                : 'No verses match those filters yet — memorize some first, or widen the range.'}
            </AppText>
          </View>

          {/* Review set */}
          <View className="gap-2">
            <AppText variant="section" className="font-sans font-extrabold uppercase tracking-wider text-neutral-400">
              Pull from
            </AppText>
            <ChipRow options={REVIEW_SETS} value={reviewSet} onChange={(s) => setReviewSet(s as ReviewSet)} wrap />
            <Pressable
              onPress={() => setDueTodayOnly((d) => !d)}
              className={`flex-row items-center justify-between border rounded-xl p-3 ${
                dueTodayOnly ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-neutral-300'
              }`}
            >
              <View className="flex-1 pr-3">
                <AppText variant="caption" className={`font-sans font-extrabold ${dueTodayOnly ? 'text-white' : 'text-neutral-800'}`} >
                  Due today only
                </AppText>
                <AppText variant="micro" className={`font-sans leading-snug ${dueTodayOnly ? 'text-neutral-300' : 'text-neutral-500'}`}>
                  Narrow to verses whose review is actually due today. Still practice only — it won't clear them.
                </AppText>
              </View>
              <View
                className={`w-5 h-5 rounded-full items-center justify-center ${
                  dueTodayOnly ? 'bg-white' : 'border border-neutral-300'
                }`}
              >
                {dueTodayOnly && <Check size={12} color="#171717" />}
              </View>
            </Pressable>
          </View>

          {/* Direction */}
          <View className="gap-2">
            <AppText variant="section" className="font-sans font-extrabold uppercase tracking-wider text-neutral-400">Ask me</AppText>
            <ChipRow
              options={[
                { id: 'both' as const, label: 'Both ways' },
                { id: 'refToVerse' as const, label: 'Reference → Verse' },
                { id: 'verseToRef' as const, label: 'Verse → Reference' },
              ]}
              value={direction}
              onChange={(d) => setDirection(d as DrillDirection)}
              wrap
            />
          </View>

          {/* Length */}
          <View className="gap-2">
            <AppText variant="section" className="font-sans font-extrabold uppercase tracking-wider text-neutral-400">Questions</AppText>
            <ChipRow options={SESSION_LENGTHS} value={sessionLength} onChange={setSessionLength} />
          </View>

          {/* Hard mode */}
          <Pressable
            onPress={() => setHardMode((h) => !h)}
            className={`flex-row items-center justify-between border rounded-xl p-3 ${
              hardMode ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-neutral-300'
            }`}
          >
            <View className="flex-1 pr-3">
              <AppText variant="caption" className={`font-sans font-extrabold ${hardMode ? 'text-white' : 'text-neutral-800'}`}>Hard mode</AppText>
              <AppText variant="micro" className={`font-sans leading-snug ${hardMode ? 'text-neutral-300' : 'text-neutral-500'}`}>
                No multiple choice — type the reference yourself, and recall verses from memory before revealing.
              </AppText>
            </View>
            <View className={`w-5 h-5 rounded-full items-center justify-center ${hardMode ? 'bg-white' : 'border border-neutral-300'}`}>
              {hardMode && <Check size={12} color="#171717" />}
            </View>
          </Pressable>

          <Pressable
            onPress={startSession}
            disabled={!canStart}
            className={`w-full py-3 rounded-xl flex-row items-center justify-center gap-2 ${canStart ? 'bg-[#1A1A1A]' : 'bg-neutral-200'}`}
          >
            <Target size={15} color={canStart ? '#ffffff' : '#a3a3a3'} />
            <AppText variant="label" className={`font-sans font-bold ${canStart ? 'text-white' : 'text-neutral-400'}`}>Start Drill</AppText>
          </Pressable>
        </ScrollView>
      </FadeInView>
    );
  }

  // ==========================================================================
  // SCORECARD
  // ==========================================================================
  if (phase === 'done') {
    const pct = rounds.length === 0 ? 0 : Math.round((score / rounds.length) * 100);
    return (
      <FadeInView style={{ flex: 1 }}>
        <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: 18 }}>
          <View className="items-center gap-2">
            <View className="w-14 h-14 rounded-full border-2 border-[#1A1A1A] bg-neutral-100 items-center justify-center">
              <Target size={26} color="#171717" />
            </View>
            <AppText variant="display" className="font-serif font-black text-neutral-900">
              {score} / {rounds.length}
            </AppText>
            <AppText variant="label" className="font-sans font-bold text-neutral-500">{pct}% correct</AppText>
            <AppText variant="caption" className="text-neutral-400 font-sans text-center px-6">
              Practice only — your review schedule is untouched.
            </AppText>
          </View>

          <View className="gap-2">
            <Pressable onPress={startSession} className="w-full py-3 bg-[#1A1A1A] rounded-xl flex-row items-center justify-center gap-2">
              <RefreshCw size={14} color="#ffffff" />
              <AppText variant="label" className="font-sans font-bold text-white">Run It Again</AppText>
            </Pressable>
            <Pressable onPress={() => setPhase('setup')} className="w-full py-2.5 border border-neutral-300 rounded-xl items-center">
              <AppText variant="caption" className="font-sans font-bold text-neutral-700">Change Settings</AppText>
            </Pressable>
            <Pressable onPress={handleBack} className="w-full py-2 items-center">
              <AppText variant="caption" className="font-sans font-bold text-neutral-400">Done</AppText>
            </Pressable>
          </View>
        </ScrollView>
      </FadeInView>
    );
  }

  // ==========================================================================
  // PLAYING
  // ==========================================================================
  if (!currentRound) return null;

  const answered = lastResult !== null;
  const answerRef = formatReference(currentRound.answer);

  return (
    <FadeInView style={{ flex: 1 }}>
      <View className="flex-1 bg-white p-5">
        {/* Header: progress + score + bail out */}
        <View className="flex-row items-center justify-between mb-4">
          <View>
            <AppText variant="micro" className="uppercase tracking-wider font-extrabold text-neutral-400 font-sans">
              Question {roundIndex + 1} of {rounds.length}
            </AppText>
            <AppText variant="body" className="font-serif font-black text-neutral-900">
              Score {score}/{roundIndex + (answered ? 1 : 0)}
            </AppText>
          </View>
          <Pressable onPress={() => setPhase('done')} className="w-9 h-9 rounded-full border border-neutral-300 items-center justify-center" hitSlop={8}>
            <X size={16} color="#262626" />
          </Pressable>
        </View>

        <ScrollView className="flex-1" contentContainerStyle={{ gap: 14, paddingBottom: 12 }}>
          {currentRound.kind === 'verseToRef' ? (
            <>
              <AppText variant="section" className="font-sans font-extrabold uppercase tracking-wider text-neutral-400">Where is this?</AppText>
              <View className="border-2 border-[#1A1A1A] rounded-2xl p-4 bg-white">
                <AppText variant="body" className="font-serif leading-relaxed text-neutral-800">{currentRound.answer.text}</AppText>
              </View>

              {hardMode ? (
                <View className="gap-2">
                  {/* Plain text entry rather than the BookPicker sheet: typing
                      "Romans" is faster than scrolling a 66-book list mid-
                      quiz, and referenceAnswerMatches already compares book
                      names case/whitespace-insensitively. It also keeps the
                      answer path free of react-native's Modal, which does not
                      currently overlay on web anywhere in this app. */}
                  <TextInput
                    value={freeGuess.book}
                    onChangeText={(t) => setFreeGuess((g) => ({ ...g, book: t }))}
                    placeholder="Book (e.g. Romans)"
                    placeholderTextColor="#a3a3a3"
                    autoCapitalize="words"
                    autoCorrect={false}
                    editable={!answered}
                    className="bg-white border border-neutral-300 rounded-xl px-3 py-2.5 text-xs text-[#1A1A1A]"
                  />
                  <View className="flex-row gap-2">
                    <NumericInput
                      value={freeGuess.chapter}
                      onChangeText={(t) => setFreeGuess((g) => ({ ...g, chapter: t }))}
                      placeholder="Chapter"
                      placeholderTextColor="#a3a3a3"
                      editable={!answered}
                      className="flex-1 bg-white border border-neutral-300 rounded-xl px-3 py-2.5 text-xs text-[#1A1A1A]"
                    />
                    <NumericInput
                      value={freeGuess.verse}
                      onChangeText={(t) => setFreeGuess((g) => ({ ...g, verse: t }))}
                      placeholder="Verse"
                      placeholderTextColor="#a3a3a3"
                      editable={!answered}
                      className="flex-1 bg-white border border-neutral-300 rounded-xl px-3 py-2.5 text-xs text-[#1A1A1A]"
                    />
                  </View>
                  {!answered && (
                    <Pressable
                      onPress={() => recordResult(referenceAnswerMatches(currentRound.answer, freeGuess))}
                      disabled={!freeGuess.book || !freeGuess.chapter || !freeGuess.verse}
                      className={`w-full py-2.5 rounded-xl items-center ${
                        freeGuess.book && freeGuess.chapter && freeGuess.verse ? 'bg-[#1A1A1A]' : 'bg-neutral-200'
                      }`}
                    >
                      <AppText variant="label" className={`font-sans font-bold ${ freeGuess.book && freeGuess.chapter && freeGuess.verse ? 'text-white' : 'text-neutral-400' }`} >
                        Check Answer
                      </AppText>
                    </Pressable>
                  )}
                </View>
              ) : (
                <View className="gap-2">
                  {currentRound.options.map((opt) => {
                    const optRef = formatReference(opt);
                    const isAnswer = optRef === answerRef;
                    return (
                      <Pressable
                        key={optRef}
                        onPress={answered ? undefined : () => recordResult(isAnswer)}
                        className={`border rounded-xl px-3 py-2.5 ${
                          answered && isAnswer
                            ? 'border-emerald-500 bg-emerald-50'
                            : answered
                              ? 'border-neutral-200 bg-neutral-50'
                              : 'border-neutral-300 bg-white'
                        }`}
                      >
                        <AppText variant="label" className={`font-serif font-bold ${answered && isAnswer ? 'text-emerald-800' : 'text-neutral-800'}`}>
                          {optRef}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </>
          ) : (
            <>
              <AppText variant="section" className="font-sans font-extrabold uppercase tracking-wider text-neutral-400">What does this say?</AppText>
              <View className="border-2 border-[#1A1A1A] rounded-2xl p-4 bg-white items-center">
                <AppText variant="title" className="font-serif font-black text-neutral-900">{answerRef}</AppText>
              </View>

              {hardMode ? (
                <View className="gap-2">
                  {revealed ? (
                    <>
                      <View className="bg-neutral-50 border border-neutral-200 rounded-xl p-3">
                        <AppText variant="body" className="font-serif leading-relaxed text-neutral-800">{currentRound.answer.text}</AppText>
                      </View>
                      {!answered && (
                        <View className="flex-row gap-2">
                          <Pressable onPress={() => recordResult(false)} className="flex-1 py-2.5 border border-neutral-300 rounded-xl items-center">
                            <AppText variant="caption" className="font-sans font-bold text-neutral-600">Missed it</AppText>
                          </Pressable>
                          <Pressable onPress={() => recordResult(true)} className="flex-1 py-2.5 bg-emerald-600 rounded-xl items-center">
                            <AppText variant="caption" className="font-sans font-bold text-white">I knew it</AppText>
                          </Pressable>
                        </View>
                      )}
                    </>
                  ) : (
                    <Pressable onPress={() => setRevealed(true)} className="w-full py-2.5 bg-[#1A1A1A] rounded-xl items-center">
                      <AppText variant="label" className="font-sans font-bold text-white">Recall it, then reveal</AppText>
                    </Pressable>
                  )}
                </View>
              ) : (
                <View className="gap-2">
                  {currentRound.options.map((opt) => {
                    const optRef = formatReference(opt);
                    const isAnswer = optRef === answerRef;
                    return (
                      <Pressable
                        key={optRef}
                        onPress={answered ? undefined : () => recordResult(isAnswer)}
                        className={`border rounded-xl px-3 py-2.5 ${
                          answered && isAnswer
                            ? 'border-emerald-500 bg-emerald-50'
                            : answered
                              ? 'border-neutral-200 bg-neutral-50'
                              : 'border-neutral-300 bg-white'
                        }`}
                      >
                        <AppText variant="label" className={`font-serif leading-snug ${answered && isAnswer ? 'text-emerald-800' : 'text-neutral-700'}`} numberOfLines={3} >
                          {opt.text}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </>
          )}
        </ScrollView>

        {/* Result + advance */}
        {answered && (
          <View className="shrink-0 gap-2 pt-2">
            <View className={`rounded-xl p-2.5 ${lastResult === 'right' ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
              <AppText variant="caption" className={`font-sans font-bold text-center ${lastResult === 'right' ? 'text-emerald-800' : 'text-red-800'}`}>
                {lastResult === 'right' ? 'Correct!' : `Not quite — that was ${answerRef}.`}
              </AppText>
            </View>
            <Pressable onPress={advance} className="w-full py-3 bg-[#1A1A1A] rounded-xl items-center">
              <AppText variant="label" className="font-sans font-bold text-white">
                {roundIndex >= rounds.length - 1 ? 'See Score' : 'Next Question'}
              </AppText>
            </Pressable>
          </View>
        )}
      </View>
    </FadeInView>
  );
}
