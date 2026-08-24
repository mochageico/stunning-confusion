import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Check, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, NumericInput, StepperRow, useClampedNumberField } from '../components/ui';
import { BookPicker } from '../components/BookPicker';
import { AppIconButton, AppText, MIN_TOUCH, useFontScale, useScaledSpace } from '../components/design';

// ============================================================================
// FIRST-RUN SETUP
//
// This replaced a four-step "Getting Started" checklist. That version was a
// TOUR: it sent you out to a real screen per step, locked each step behind the
// previous one, and replaced the tab bar with a "Back to Guide" bar so you
// couldn't wander off. Its problems, in order of severity:
//
//   1. It taught navigation, never the idea. Nothing in it ever said what the
//      app actually does.
//   2. Step 1 opened the retention editor -- the most jargon-dense screen in
//      the app ("touches to graduate", "reviews required per cycle") -- to
//      someone who had not yet memorized a single verse.
//   3. Finishing it left the app exactly as empty as before, because a tour
//      configures nothing.
//
// So this asks three questions and ACTS on each answer as it's given. Someone
// who finishes has verses on their list and a schedule that fits their week.
// Nothing is locked, every card can be skipped, and the answers commit
// independently -- closing halfway keeps whatever was already answered.
//
// The deliberate omissions: no Review Settings (the default is good, and it's
// the wrong first thing to think about) and no Circles (a social feature is
// not a setup step).
// ============================================================================

const WEEK_DAYS = ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'];
const DAY_FULL_NAMES: Record<string, string> = {
  M: 'Monday',
  T: 'Tuesday',
  W: 'Wednesday',
  Th: 'Thursday',
  F: 'Friday',
  S: 'Saturday',
  Su: 'Sunday',
};

/** A numbered card. Plain container -- no lock state, by design. */
function SetupCard({
  index,
  title,
  done,
  children,
}: {
  index: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  const space = useScaledSpace();
  const scale = useFontScale();
  const badge = Math.round(26 * scale);

  return (
    <View
      className={`rounded-xl border-2 bg-white ${done ? 'border-emerald-500' : 'border-[#1A1A1A]'}`}
      style={{ padding: space(14), gap: space(10) }}
    >
      <View className="flex-row items-center" style={{ gap: space(8) }}>
        <View
          className={`rounded-full items-center justify-center shrink-0 ${done ? 'bg-emerald-600' : 'bg-[#1A1A1A]'}`}
          style={{ width: badge, height: badge }}
        >
          {done ? (
            <Check size={Math.round(13 * scale)} color="#FFFFFF" />
          ) : (
            <AppText variant="caption" className="font-sans font-black text-white">
              {index}
            </AppText>
          )}
        </View>
        <AppText variant="body" className="font-serif font-black text-[#1A1A1A] flex-1">
          {title}
        </AppText>
      </View>
      {children}
    </View>
  );
}

export default function OnboardingScreen({ state }: { state: AppState }) {
  const {
    dismissOnboarding,
    addVerseRangeToQueue,
    updateRhythm,
    learningDays,
    newVersesPace,
    memoryQueue,
    triggerToast,
  } = state;

  const space = useScaledSpace();

  // Card 2 -- the first passage. Defaults to a short, well-known, genuinely
  // achievable range rather than a whole chapter: "Philippians 4" as a first
  // goal is how people quit in week one.
  const [book, setBook] = useState('Philippians');
  const [chapter, setChapter] = useState(4);
  const [startVerse, setStartVerse] = useState(4);
  const [endVerse, setEndVerse] = useState(7);
  const [adding, setAdding] = useState(false);
  const [addedLabel, setAddedLabel] = useState<string | null>(null);

  const chapterField = useClampedNumberField(chapter, setChapter, (n) => Math.max(1, n));
  const startField = useClampedNumberField(
    startVerse,
    (n) => {
      setStartVerse(n);
      if (n > endVerse) setEndVerse(n);
    },
    (n) => Math.max(1, n)
  );
  const endField = useClampedNumberField(endVerse, setEndVerse, (n) => Math.max(startVerse, n));

  // Card 3 -- the week. Commits live through updateRhythm, exactly like the
  // My Schedule editor does, so there's no separate save step to forget.
  const toggleDay = (day: string) => {
    const next = learningDays.includes(day)
      ? learningDays.filter((d) => d !== day)
      : [...learningDays, day];
    updateRhythm({ learningDays: next });
  };

  const handleAddVerses = async () => {
    setAdding(true);
    const result = await addVerseRangeToQueue(book, chapter, startVerse, endVerse);
    setAdding(false);

    if (result.error) {
      triggerToast(result.error);
      return;
    }
    const ref = `${book} ${chapter}:${startVerse}${endVerse > startVerse ? `-${endVerse}` : ''}`;
    if (result.added === 0) {
      setAddedLabel(`${ref} is already on your list.`);
      return;
    }
    setAddedLabel(`Added ${ref} — ${result.added} ${result.added === 1 ? 'verse' : 'verses'}.`);
  };

  const hasVerses = memoryQueue.length > 0;
  const versesPerWeek = newVersesPace * learningDays.length;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView
        className="flex-1 bg-white"
        contentContainerClassName="p-5 pb-12"
        contentContainerStyle={{ gap: space(16) }}
      >
        {/* Header */}
        <View className="flex-row items-start justify-between border-b border-neutral-100" style={{ paddingBottom: space(12), gap: space(10) }}>
          <View className="flex-1">
            <AppText variant="micro" className="font-sans font-bold uppercase tracking-widest text-neutral-500">
              Welcome
            </AppText>
            <AppText variant="display" className="font-serif font-black text-[#1A1A1A]">
              Let's set you up
            </AppText>
          </View>
          <AppIconButton
            Icon={X}
            diameter={32}
            iconSize={14}
            iconColor="#262626"
            onPress={dismissOnboarding}
            className="rounded-full border border-neutral-200 bg-white shrink-0"
          />
        </View>

        {/* CARD 1 -- the idea. This is the piece the old checklist never had:
            a plain-English statement of the loop, before any settings. */}
        <SetupCard index={1} title="How this works" done>
          <View style={{ gap: space(8) }}>
            <AppText variant="label" className="font-sans text-neutral-800 leading-relaxed">
              You pick verses you want to know by heart.
            </AppText>
            <AppText variant="label" className="font-sans text-neutral-800 leading-relaxed">
              Each day, the app gives you a few new ones to work on — and brings back older ones right before you'd
              start to forget them.
            </AppText>
            <AppText variant="label" className="font-sans text-neutral-800 leading-relaxed">
              Open the app, do what's on the Today screen, and close it. That's the whole thing.
            </AppText>
            <View className="rounded-lg bg-[#FBF9F6] border border-[#E5E5E5]" style={{ padding: space(10) }}>
              <AppText variant="caption" className="font-sans text-neutral-600 leading-relaxed">
                A verse comes back every day for a few weeks, then once a week, then once a month — and then it stops,
                because by then it's yours. You don't have to schedule any of that.
              </AppText>
            </View>
          </View>
        </SetupCard>

        {/* CARD 2 -- pick something to memorize, and actually queue it. */}
        <SetupCard index={2} title="Pick something to start with" done={hasVerses}>
          <AppText variant="caption" className="font-sans text-neutral-600 leading-relaxed">
            A few verses is a better start than a whole chapter. You can always add more later.
          </AppText>

          <View className="flex-row" style={{ gap: space(8) }}>
            <View className="flex-1" style={{ gap: space(4) }}>
              <AppText variant="micro" className="font-sans font-bold uppercase text-neutral-500">Book</AppText>
              <BookPicker value={book} onChange={setBook} />
            </View>
            <View style={{ width: '28%', gap: space(4) }}>
              <AppText variant="micro" className="font-sans font-bold uppercase text-neutral-500">Chapter</AppText>
              <NumericInput
                {...chapterField}
                className="w-full border border-neutral-300 rounded-lg font-mono font-bold text-[#1A1A1A]"
                style={{ minHeight: MIN_TOUCH * 0.8, paddingHorizontal: space(8) }}
              />
            </View>
          </View>

          <View className="flex-row" style={{ gap: space(8) }}>
            <View className="flex-1" style={{ gap: space(4) }}>
              <AppText variant="micro" className="font-sans font-bold uppercase text-neutral-500">From verse</AppText>
              <NumericInput
                {...startField}
                className="w-full border border-neutral-300 rounded-lg font-mono font-bold text-[#1A1A1A]"
                style={{ minHeight: MIN_TOUCH * 0.8, paddingHorizontal: space(8) }}
              />
            </View>
            <View className="flex-1" style={{ gap: space(4) }}>
              <AppText variant="micro" className="font-sans font-bold uppercase text-neutral-500">To verse</AppText>
              <NumericInput
                {...endField}
                className="w-full border border-neutral-300 rounded-lg font-mono font-bold text-[#1A1A1A]"
                style={{ minHeight: MIN_TOUCH * 0.8, paddingHorizontal: space(8) }}
              />
            </View>
          </View>

          <Pressable
            onPress={handleAddVerses}
            disabled={adding}
            accessibilityRole="button"
            className={`w-full rounded-xl items-center justify-center ${adding ? 'bg-neutral-400' : 'bg-[#1A1A1A]'}`}
            style={{ minHeight: MIN_TOUCH, paddingVertical: space(10) }}
          >
            <AppText variant="label" className="text-white font-sans font-bold">
              {adding ? 'Adding…' : 'Add these verses'}
            </AppText>
          </Pressable>

          {addedLabel && (
            <View className="rounded-lg border border-emerald-200 bg-emerald-50" style={{ padding: space(10) }}>
              <AppText variant="caption" className="font-sans font-bold text-emerald-800">{addedLabel}</AppText>
            </View>
          )}
        </SetupCard>

        {/* CARD 3 -- the week. Commits live, same as the My Schedule editor. */}
        <SetupCard index={3} title="When do you want to do this?" done={learningDays.length > 0}>
          <AppText variant="caption" className="font-sans text-neutral-600 leading-relaxed">
            Pick the days you'll take on new verses. Reviews still come every day — these are just the days you add
            something new, so leaving gaps is completely fine.
          </AppText>

          <View className="flex-row" style={{ gap: space(5) }}>
            {WEEK_DAYS.map((d) => {
              const isActive = learningDays.includes(d);
              return (
                <Pressable
                  key={d}
                  onPress={() => toggleDay(d)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isActive }}
                  accessibilityLabel={DAY_FULL_NAMES[d]}
                  className={`flex-1 items-center justify-center rounded-full border ${
                    isActive ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-neutral-300'
                  }`}
                  style={{ minHeight: MIN_TOUCH * 0.68, paddingVertical: space(4) }}
                >
                  <AppText
                    variant="micro"
                    className={`font-sans font-bold ${isActive ? 'text-white' : 'text-neutral-600'}`}
                  >
                    {d}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <View style={{ gap: space(6) }}>
            <View className="flex-row items-center justify-between" style={{ gap: space(8) }}>
              <AppText variant="micro" className="font-sans font-bold uppercase text-neutral-500 flex-1">
                New verses each of those days
              </AppText>
              <AppText variant="micro" className="font-mono font-bold text-neutral-700 shrink-0">{newVersesPace}</AppText>
            </View>
            <StepperRow
              value={newVersesPace}
              min={1}
              max={10}
              onChange={(v) => updateRhythm({ newVersesPace: v })}
            />
          </View>

          {/* The consequence, in one line -- so the dials mean something
              without having to imagine their effect. */}
          <View className="rounded-lg bg-[#FBF9F6] border border-[#E5E5E5]" style={{ padding: space(10) }}>
            <AppText variant="caption" className="font-sans text-neutral-700 leading-relaxed">
              {learningDays.length === 0
                ? "No days picked yet — pick at least one, or nothing new will start."
                : `That's about ${versesPerWeek} new ${versesPerWeek === 1 ? 'verse' : 'verses'} a week.`}
            </AppText>
          </View>
        </SetupCard>

        <Pressable
          onPress={dismissOnboarding}
          accessibilityRole="button"
          className="w-full rounded-xl bg-[#1A1A1A] items-center justify-center"
          style={{ minHeight: MIN_TOUCH, paddingVertical: space(12) }}
        >
          <AppText variant="label" className="text-white font-sans font-bold uppercase tracking-widest">
            {hasVerses ? "I'm ready — start" : 'Go to Today'}
          </AppText>
        </Pressable>

        <Pressable onPress={dismissOnboarding} className="w-full items-center" style={{ paddingVertical: space(6) }}>
          <AppText variant="caption" className="text-neutral-400 font-sans font-bold underline">
            Skip for now
          </AppText>
        </Pressable>
      </ScrollView>
    </FadeInView>
  );
}
