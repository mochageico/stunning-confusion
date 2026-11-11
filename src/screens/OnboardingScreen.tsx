import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Check, ChevronLeft, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, NumericInput, StepperRow, useClampedNumberField } from '../components/ui';
import { BookPicker } from '../components/BookPicker';
import { AppButton, AppIconButton, AppText, MIN_TOUCH, useFontScale, useScaledSpace } from '../components/design';

import { useThemeColors } from '../components/theme';
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

export default function OnboardingScreen({ state }: { state: AppState }) {
    const palette = useThemeColors();
  const {
    dismissOnboarding,
    setShowTour,
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

  // One question per page, a progress bar and one Continue (UI simplify
  // Job 13, the Duolingo pattern), instead of one long scrolling page.
  const [step, setStep] = useState(0);
  const STEPS = 4;
  const next = () => setStep((s) => Math.min(STEPS - 1, s + 1));

  const title = ['How this works', 'Pick something to start with', 'Which days do you learn new verses?', "You're set"][step];

  const body = [
    // 1 -- the idea, in three short lines.
    <View key="idea" style={{ gap: space(14) }}>
      {['Pick verses you want to know by heart.', 'Each day, learn a few new ones and review older ones right before you’d forget.', 'Open the app, do what’s on Today, done.'].map((line) => (
        <View key={line} className="flex-row items-start" style={{ gap: space(10) }}>
          <View style={{ paddingTop: space(3) }}>
            <Check size={18} color={palette.accent} strokeWidth={2.6} />
          </View>
          <AppText variant="body" className="font-sans text-ink flex-1">
            {line}
          </AppText>
        </View>
      ))}
    </View>,

    // 2 -- pick something to memorize, and actually queue it.
    <View key="verses" style={{ gap: space(12) }}>
      <View style={{ gap: space(4) }}>
        <AppText variant="caption" className="font-sans font-medium text-ink-2">Book</AppText>
        <BookPicker value={book} onChange={setBook} />
      </View>
      {/* The three numbers share a row and wrap when the text is big. */}
      <View className="flex-row flex-wrap" style={{ gap: space(10) }}>
        {[
          { label: 'Chapter', field: chapterField },
          { label: 'From verse', field: startField },
          { label: 'To verse', field: endField },
        ].map(({ label, field }) => (
          <View key={label} style={{ flexGrow: 1, flexBasis: space(96), gap: space(4) }}>
            <AppText variant="caption" className="font-sans font-medium text-ink-2">{label}</AppText>
            <NumericInput
              {...field}
              className="w-full bg-surface border border-line rounded-btn font-sans text-ink"
              style={{ minHeight: MIN_TOUCH * 0.8, paddingHorizontal: space(8) }}
            />
          </View>
        ))}
      </View>
      <AppButton variant="secondary" label={adding ? 'Adding…' : 'Add these verses'} disabled={adding} onPress={handleAddVerses} />
      {addedLabel && (
        <AppText variant="label" className="font-sans font-semibold text-success">
          {addedLabel}
        </AppText>
      )}
    </View>,

    // 3 -- the week. Commits live, same as the My Schedule editor.
    <View key="days" style={{ gap: space(14) }}>
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
              className={`flex-1 items-center justify-center rounded-full border ${isActive ? 'bg-accent border-accent' : 'bg-surface border-line-strong'}`}
              style={{ minHeight: MIN_TOUCH * 0.8, paddingVertical: space(4) }}
            >
              <AppText variant="caption" className={`font-sans font-bold ${isActive ? 'text-on-accent' : 'text-ink-2'}`}>
                {d}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      <View style={{ gap: space(6) }}>
        <View className="flex-row items-center justify-between" style={{ gap: space(8) }}>
          <AppText variant="label" className="font-sans font-medium text-ink-2 flex-1">
            New verses each of those days
          </AppText>
          <AppText variant="label" className="font-sans font-semibold text-ink shrink-0">{newVersesPace}</AppText>
        </View>
        <StepperRow value={newVersesPace} min={1} max={10} onChange={(v) => updateRhythm({ newVersesPace: v })} />
      </View>
      <AppText variant="label" className="font-sans text-ink-2">
        {learningDays.length === 0
          ? 'Pick at least one day, or nothing new will start.'
          : `About ${versesPerWeek} new ${versesPerWeek === 1 ? 'verse' : 'verses'} a week. Reviews come every day.`}
      </AppText>
    </View>,

    // 4 -- done: start, or take the optional tour first.
    <View key="done" style={{ gap: space(10) }}>
      <AppText variant="body" className="font-sans text-ink">
        {hasVerses ? 'Today has your first verses.' : 'Add verses any time from the Verses tab.'}
      </AppText>
      <AppButton
        variant="quiet"
        label="Take a 1-minute tour first"
        onPress={() => {
          dismissOnboarding();
          setShowTour(true);
        }}
      />
    </View>,
  ][step];

  const last = step === STEPS - 1;

  return (
    <FadeInView style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas">
        <View className="flex-row items-center" style={{ minHeight: MIN_TOUCH + space(8), paddingHorizontal: space(16), gap: space(12) }}>
          {step > 0 ? (
            <AppIconButton Icon={ChevronLeft} variant="outline" diameter={40} accessibilityLabel="Back" onPress={() => setStep(step - 1)} />
          ) : (
            <AppIconButton Icon={X} variant="outline" diameter={40} accessibilityLabel="Skip setup" onPress={dismissOnboarding} />
          )}
          <View className="flex-1 bg-fill rounded-full overflow-hidden" style={{ height: 8 /* layout-ok: a progress track */ }}>
            <View className="bg-accent rounded-full" style={{ height: 8 /* layout-ok: the track's fill */, width: `${((step + 1) / STEPS) * 100}%` }} />
          </View>
          <AppButton size="sm" variant="quiet" label="Skip" onPress={dismissOnboarding} className="border-0" />
        </View>

        <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: space(20), paddingTop: space(24), paddingBottom: space(24), gap: space(20) }}>
          <AppText variant="display" className="font-sans font-bold text-ink" accessibilityRole="header">
            {title}
          </AppText>
          {body}
        </ScrollView>

        <View className="border-t border-line bg-surface" style={{ paddingHorizontal: space(16), paddingTop: space(14), paddingBottom: space(14) }}>
          <AppButton size="lg" variant="primary" label={last ? (hasVerses ? 'Start' : 'Go to Today') : 'Continue'} onPress={last ? dismissOnboarding : next} />
        </View>
      </View>
    </FadeInView>
  );
}
