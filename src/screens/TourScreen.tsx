import { ScrollView, View } from 'react-native';
import { BookMarked, CalendarDays, FolderOpen, Home as HomeIcon, Mic, Users, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppIconButton, AppText, MIN_TOUCH, useFontScale, useScaledSpace } from '../components/design';

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
  const scale = useFontScale();

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView
        className="flex-1 bg-white"
        contentContainerClassName="p-5 pb-12"
        contentContainerStyle={{ gap: space(16) }}
      >
        <View
          className="flex-row items-start justify-between border-b border-neutral-100"
          style={{ paddingBottom: space(12), gap: space(10) }}
        >
          <View className="flex-1">
            <AppText variant="micro" className="font-sans font-bold uppercase tracking-widest text-neutral-500">
              A quick look
            </AppText>
            <AppText variant="display" className="font-serif font-black text-[#1A1A1A]">
              What's where
            </AppText>
          </View>
          <AppIconButton
            Icon={X}
            diameter={32}
            iconSize={14}
            iconColor="#262626"
            onPress={() => setShowTour(false)}
            className="rounded-full border border-neutral-200 bg-white shrink-0"
          />
        </View>

        <AppText variant="label" className="font-sans text-neutral-700 leading-relaxed">
          You pick verses. Each day the app gives you a few to work on and brings older ones back before you'd forget
          them. Everything below just supports that.
        </AppText>

        <View style={{ gap: space(10) }}>
          {PLACES.map(({ Icon, name, what }) => (
            <View
              key={name}
              className="rounded-xl border border-[#E5E5E5] bg-white flex-row"
              style={{ padding: space(12), gap: space(10), minHeight: MIN_TOUCH }}
            >
              <View className="shrink-0" style={{ paddingTop: space(2) }}>
                <Icon size={Math.round(18 * scale)} color="#1A1A1A" />
              </View>
              <View className="flex-1" style={{ gap: space(3) }}>
                <AppText variant="label" className="font-serif font-black text-[#1A1A1A]">
                  {name}
                </AppText>
                <AppText variant="caption" className="font-sans text-neutral-600 leading-relaxed">
                  {what}
                </AppText>
              </View>
            </View>
          ))}
        </View>

        <View style={{ gap: space(10) }}>
          <AppText variant="section" className="font-sans font-bold uppercase tracking-wider text-neutral-700">
            Common questions
          </AppText>
          {ANSWERS.map(({ q, a }) => (
            <View
              key={q}
              className="rounded-xl bg-[#FBF9F6] border border-[#E5E5E5]"
              style={{ padding: space(12), gap: space(4) }}
            >
              <AppText variant="label" className="font-sans font-bold text-[#1A1A1A]">
                {q}
              </AppText>
              <AppText variant="caption" className="font-sans text-neutral-600 leading-relaxed">
                {a}
              </AppText>
            </View>
          ))}
        </View>
      </ScrollView>
    </FadeInView>
  );
}
