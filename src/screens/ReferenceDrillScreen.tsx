import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Check, RefreshCw, Target, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { ChipRow, FadeInView } from '../components/ui';
import { BookPicker } from '../components/BookPicker';
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

type Phase = 'setup' | 'playing' | 'done';

export default function ReferenceDrillScreen({ state }: { state: AppState }) {
  const { memoryQueue, navigateTo } = state;

  const [book, setBook] = useState('');
  const [startChapter, setStartChapter] = useState('');
  const [endChapter, setEndChapter] = useState('');
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

  // Anything actually in the review system: learning, reviewing, or retained.
  // 'queued' verses haven't been started yet, so quizzing on them would be
  // testing something never taught.
  const pool = useMemo<ReferenceItem[]>(() => {
    const started = memoryQueue.filter((i) => i.status !== 'queued');
    const from = Number(startChapter);
    const to = Number(endChapter);
    return started
      .filter((i) => {
        if (book && i.book !== book) return false;
        if (startChapter && Number.isFinite(from) && i.chapter < from) return false;
        if (endChapter && Number.isFinite(to) && i.chapter > to) return false;
        return true;
      })
      .map((i) => ({ book: i.book, chapter: i.chapter, verse: i.verseNumber, text: i.text }));
  }, [memoryQueue, book, startChapter, endChapter]);

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
              <Text className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">Practice</Text>
              <Text className="text-xl font-serif font-black text-neutral-900 mt-0.5">Reference Drill</Text>
            </View>
          </View>

          <Text className="text-[10px] text-neutral-400 leading-relaxed -mt-2">
            Quiz yourself on where your verses live. Pulls from everything you've started memorizing, whether or not it's due
            today — and it's practice only, so nothing here changes your review schedule.
          </Text>

          {/* Range */}
          <View className="gap-2">
            <Text className="text-[10px] font-sans font-extrabold uppercase tracking-wider text-neutral-400">Range</Text>
            <BookPicker value={book} onChange={setBook} allowAll allLabel="All my verses" title="Limit to a Book" />
            {!!book && (
              <View className="flex-row items-center gap-2">
                <View className="flex-1">
                  <Text className="text-[9px] font-sans font-bold text-neutral-400 mb-1">From chapter</Text>
                  <TextInput
                    value={startChapter}
                    onChangeText={setStartChapter}
                    placeholder="Any"
                    placeholderTextColor="#a3a3a3"
                    keyboardType="number-pad"
                    className="bg-white border border-neutral-300 rounded-xl px-3 py-2 text-xs text-[#1A1A1A]"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-[9px] font-sans font-bold text-neutral-400 mb-1">To chapter</Text>
                  <TextInput
                    value={endChapter}
                    onChangeText={setEndChapter}
                    placeholder="Any"
                    placeholderTextColor="#a3a3a3"
                    keyboardType="number-pad"
                    className="bg-white border border-neutral-300 rounded-xl px-3 py-2 text-xs text-[#1A1A1A]"
                  />
                </View>
              </View>
            )}
            <Text className={`text-[10px] font-sans font-bold ${canStart ? 'text-neutral-500' : 'text-amber-700'}`}>
              {canStart
                ? `${uniqueCount} ${uniqueCount === 1 ? 'verse' : 'verses'} available`
                : 'No verses in that range yet — memorize some first, or widen the range.'}
            </Text>
          </View>

          {/* Direction */}
          <View className="gap-2">
            <Text className="text-[10px] font-sans font-extrabold uppercase tracking-wider text-neutral-400">Ask me</Text>
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
            <Text className="text-[10px] font-sans font-extrabold uppercase tracking-wider text-neutral-400">Questions</Text>
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
              <Text className={`text-[11px] font-sans font-extrabold ${hardMode ? 'text-white' : 'text-neutral-800'}`}>Hard mode</Text>
              <Text className={`text-[9px] font-sans leading-snug ${hardMode ? 'text-neutral-300' : 'text-neutral-500'}`}>
                No multiple choice — type the reference yourself, and recall verses from memory before revealing.
              </Text>
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
            <Text className={`font-sans font-bold text-xs ${canStart ? 'text-white' : 'text-neutral-400'}`}>Start Drill</Text>
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
            <Text className="text-2xl font-serif font-black text-neutral-900">
              {score} / {rounds.length}
            </Text>
            <Text className="text-xs font-sans font-bold text-neutral-500">{pct}% correct</Text>
            <Text className="text-[10px] text-neutral-400 font-sans text-center px-6">
              Practice only — your review schedule is untouched.
            </Text>
          </View>

          <View className="gap-2">
            <Pressable onPress={startSession} className="w-full py-3 bg-[#1A1A1A] rounded-xl flex-row items-center justify-center gap-2">
              <RefreshCw size={14} color="#ffffff" />
              <Text className="font-sans font-bold text-xs text-white">Run It Again</Text>
            </Pressable>
            <Pressable onPress={() => setPhase('setup')} className="w-full py-2.5 border border-neutral-300 rounded-xl items-center">
              <Text className="font-sans font-bold text-[11px] text-neutral-700">Change Settings</Text>
            </Pressable>
            <Pressable onPress={handleBack} className="w-full py-2 items-center">
              <Text className="font-sans font-bold text-[11px] text-neutral-400">Done</Text>
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
            <Text className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">
              Question {roundIndex + 1} of {rounds.length}
            </Text>
            <Text className="text-sm font-serif font-black text-neutral-900">
              Score {score}/{roundIndex + (answered ? 1 : 0)}
            </Text>
          </View>
          <Pressable onPress={() => setPhase('done')} className="w-9 h-9 rounded-full border border-neutral-300 items-center justify-center" hitSlop={8}>
            <X size={16} color="#262626" />
          </Pressable>
        </View>

        <ScrollView className="flex-1" contentContainerStyle={{ gap: 14, paddingBottom: 12 }}>
          {currentRound.kind === 'verseToRef' ? (
            <>
              <Text className="text-[10px] font-sans font-extrabold uppercase tracking-wider text-neutral-400">Where is this?</Text>
              <View className="border-2 border-[#1A1A1A] rounded-2xl p-4 bg-white">
                <Text className="font-serif text-[15px] leading-relaxed text-neutral-800">{currentRound.answer.text}</Text>
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
                    <TextInput
                      value={freeGuess.chapter}
                      onChangeText={(t) => setFreeGuess((g) => ({ ...g, chapter: t }))}
                      placeholder="Chapter"
                      placeholderTextColor="#a3a3a3"
                      keyboardType="number-pad"
                      editable={!answered}
                      className="flex-1 bg-white border border-neutral-300 rounded-xl px-3 py-2.5 text-xs text-[#1A1A1A]"
                    />
                    <TextInput
                      value={freeGuess.verse}
                      onChangeText={(t) => setFreeGuess((g) => ({ ...g, verse: t }))}
                      placeholder="Verse"
                      placeholderTextColor="#a3a3a3"
                      keyboardType="number-pad"
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
                      <Text
                        className={`font-sans font-bold text-xs ${
                          freeGuess.book && freeGuess.chapter && freeGuess.verse ? 'text-white' : 'text-neutral-400'
                        }`}
                      >
                        Check Answer
                      </Text>
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
                        <Text className={`font-serif text-[13px] font-bold ${answered && isAnswer ? 'text-emerald-800' : 'text-neutral-800'}`}>
                          {optRef}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </>
          ) : (
            <>
              <Text className="text-[10px] font-sans font-extrabold uppercase tracking-wider text-neutral-400">What does this say?</Text>
              <View className="border-2 border-[#1A1A1A] rounded-2xl p-4 bg-white items-center">
                <Text className="font-serif text-lg font-black text-neutral-900">{answerRef}</Text>
              </View>

              {hardMode ? (
                <View className="gap-2">
                  {revealed ? (
                    <>
                      <View className="bg-neutral-50 border border-neutral-200 rounded-xl p-3">
                        <Text className="font-serif text-[14px] leading-relaxed text-neutral-800">{currentRound.answer.text}</Text>
                      </View>
                      {!answered && (
                        <View className="flex-row gap-2">
                          <Pressable onPress={() => recordResult(false)} className="flex-1 py-2.5 border border-neutral-300 rounded-xl items-center">
                            <Text className="font-sans font-bold text-[11px] text-neutral-600">Missed it</Text>
                          </Pressable>
                          <Pressable onPress={() => recordResult(true)} className="flex-1 py-2.5 bg-emerald-600 rounded-xl items-center">
                            <Text className="font-sans font-bold text-[11px] text-white">I knew it</Text>
                          </Pressable>
                        </View>
                      )}
                    </>
                  ) : (
                    <Pressable onPress={() => setRevealed(true)} className="w-full py-2.5 bg-[#1A1A1A] rounded-xl items-center">
                      <Text className="font-sans font-bold text-xs text-white">Recall it, then reveal</Text>
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
                        <Text
                          className={`font-serif text-[13px] leading-snug ${answered && isAnswer ? 'text-emerald-800' : 'text-neutral-700'}`}
                          numberOfLines={3}
                        >
                          {opt.text}
                        </Text>
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
              <Text className={`font-sans font-bold text-[11px] text-center ${lastResult === 'right' ? 'text-emerald-800' : 'text-red-800'}`}>
                {lastResult === 'right' ? 'Correct!' : `Not quite — that was ${answerRef}.`}
              </Text>
            </View>
            <Pressable onPress={advance} className="w-full py-3 bg-[#1A1A1A] rounded-xl items-center">
              <Text className="font-sans font-bold text-xs text-white">
                {roundIndex >= rounds.length - 1 ? 'See Score' : 'Next Question'}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </FadeInView>
  );
}
