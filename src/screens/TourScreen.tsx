import { ScrollView, View } from 'react-native';
import { BookMarked, CalendarDays, FolderOpen, Home as HomeIcon, Mic, Users, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppIconButton, AppText, useScaledSpace } from '../components/design';
import { GroupedList, ListRow, ScreenHeader, SectionHeader } from '../components/blocks';

// ============================================================================
// SHOW ME AROUND
//
// The optional counterpart to first-run setup: setup CONFIGURES, this one
// EXPLAINS. Reachable from Settings at any time, never shown automatically.
//
// It is deliberately a read-only page rather than the old guided walkthrough.
// That version navigated you out to each screen in turn and took over the tab
// bar so you couldn't leave, which made "having a look" indistinguishable
// from "being marched somewhere". Here every entry names a place and says what
// it's for; you go look whenever you want, in any order, and nothing is
// tracked, locked, or completed.
// ============================================================================

const PLACES: {
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  name: string;
  what: string;
}[] = [
  {
    Icon: HomeIcon,
    name: 'Today',
    what: "Everything due right now, and nothing else. Verses you're learning, verses coming back for a check, and what's next in line. If you only ever open one screen, open this one.",
  },
  {
    Icon: BookMarked,
    name: 'Add verses',
    what: 'Browse the Bible, pick any verses you want to know by heart, and add them. They wait in line until one of your chosen days comes around.',
  },
  {
    Icon: FolderOpen,
    name: 'My Memory Work',
    what: 'The back room. Your full list of verses, the days you memorize on, how long verses keep coming back, and everything you\'ve finished so far.',
  },
  {
    Icon: CalendarDays,
    name: 'Memory Calendar',
    what: "What's coming, day by day, so a busy week never surprises you.",
  },
  {
    Icon: Mic,
    name: 'Record',
    what: 'Read a passage aloud and save it. You can then listen to it in your own voice while you practice — in the car, on a walk, anywhere.',
  },
  {
    Icon: Users,
    name: 'Community',
    what: "Optional. Memorize alongside friends or a group, see what they're working on, and share recordings. Skip it entirely if you'd rather not.",
  },
];

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
    a: 'Any time. My Memory Work → My Verses & Schedule sets which days you take on new verses and how many. Nothing you\'ve already learned is affected.',
  },
];

export default function TourScreen({ state }: { state: AppState }) {
  const { setShowTour } = state;
  const space = useScaledSpace();

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader
          eyebrow="A quick look"
          title="What's where"
          subtitle="You pick verses. Each day the app gives you a few to work on and brings older ones back before you'd forget them. Everything below just supports that."
          actions={<AppIconButton Icon={X} variant="outline" diameter={36} accessibilityLabel="Close" onPress={() => setShowTour(false)} />}
        />

        <GroupedList>
          {PLACES.map(({ Icon, name, what }) => (
            <ListRow key={name} Icon={Icon} title={name} subtitle={what} accessory="none" />
          ))}
        </GroupedList>

        <View style={{ gap: space(6) }}>
          <SectionHeader title="Common questions" />
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
        </View>
      </ScrollView>
    </FadeInView>
  );
}
