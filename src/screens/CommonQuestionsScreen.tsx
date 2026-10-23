import { ScrollView, View } from 'react-native';
import { Compass, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppButton, AppIconButton, AppText, useScaledSpace } from '../components/design';
import { ScreenHeader, SectionHeader } from '../components/blocks';

// ============================================================================
// COMMON QUESTIONS
//
// What's left of the old "Show me around" page. Its "what's where" list is
// now the tour (components/GuidedTour.tsx), which shows each place instead of
// describing it; the questions stay here because they're about ideas, not
// places, and you look one up when it comes up rather than walk through them.
//
// Opened from the tour's last card or from Settings (showTour === 'questions').
// Never shown automatically.
// ============================================================================

const ANSWERS: { q: string; a: string }[] = [
  {
    q: 'Do I have to use it every day?',
    a: "No. Miss a day and nothing is lost — verses just come back a little later. If you're away for a while, Settings has a Pause that stops everything cleanly until you're back.",
  },
  {
    q: 'What if I already know some of these verses?',
    a: 'Open the chapter, select those verses, and tap Status. Tell the app you already know them and it starts reviewing them straight away instead of making you learn them from scratch.',
  },
  {
    q: 'Why does it keep showing me verses I already know?',
    a: "That's the point, and it's the part that actually works. A verse you saw once is gone in a month. Seeing it again today, next week, then next month is what makes it stick — and each time, it asks less often.",
  },
  {
    q: "Can I change how much I'm doing?",
    a: "Any time. The Verses tab → My Schedule sets which days you take on new verses and how many. Nothing you've already learned is affected.",
  },
  {
    q: 'Where did that tip go?',
    a: "Each tip shows once and goes away when you tap Got it. To see them all again, use Show tips again in Settings.",
  },
];

export default function CommonQuestionsScreen({ state }: { state: AppState }) {
  const { setShowTour } = state;
  const space = useScaledSpace();

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader
          title="Common questions"
          subtitle="You pick verses. Each day the app gives you a few to work on and brings older ones back before you'd forget them."
          actions={<AppIconButton Icon={X} variant="outline" diameter={36} accessibilityLabel="Close" onPress={() => setShowTour(false)} />}
        />

        <View style={{ gap: space(10) }}>
          {ANSWERS.map(({ q, a }) => (
            <View key={q} className="rounded-card bg-surface border border-line" style={{ padding: space(14), gap: space(4) }}>
              <AppText variant="body" className="font-sans font-semibold text-ink">
                {q}
              </AppText>
              <AppText variant="label" className="font-sans text-ink-2">
                {a}
              </AppText>
            </View>
          ))}
        </View>

        <View style={{ gap: space(6) }}>
          <SectionHeader title="Rather see it?" />
          <AppButton variant="secondary" Icon={Compass} label="Take the tour" onPress={() => setShowTour(true)} />
        </View>
      </ScrollView>
    </FadeInView>
  );
}
