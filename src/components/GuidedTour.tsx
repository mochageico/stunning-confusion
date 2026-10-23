import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { AppState } from '../state/useAppState';
import { AppButton, AppText, useScaledSpace } from './design';
import { FadeInView } from './ui';
import { dismissTip, setTipsPaused } from '../lib/tips';

// ============================================================================
// THE TOUR
//
// A short run of cards that sit just above the tab bar while the real app
// shows behind them. Each card moves to the tab it talks about, and the tab
// bar circles that tab (see `ring` on FloatingTabBar), so you see the place
// rather than read a description of it.
//
// It replaced the read-only "What's where" page, which described screens you
// couldn't see. What it keeps from the old guided walkthrough's lessons
// (see OnboardingScreen.tsx): it never starts on its own, Skip is on every
// card, nothing is locked or tracked, and the tab bar keeps working the whole
// time -- tap a tab and you just go there, the card stays until you close it.
//
// Opened from Today's "Start here", the end of setup, and Settings. The
// questions that used to sit under the old page are CommonQuestionsScreen,
// linked from the last card.
// ============================================================================

type Tab = Parameters<AppState['selectTab']>[0];

const STEPS: { tab: Tab; place: string; text: string }[] = [
  {
    tab: 'home',
    place: 'Today',
    text: "This is your day: everything due right now, and nothing else. If you only open one screen, open this one.",
  },
  {
    tab: 'verses',
    place: 'Verses',
    text: "My Verses is every verse you've picked. My Schedule is which days you learn new ones. Review Settings is how often learned verses come back.",
  },
  {
    tab: 'verses',
    place: 'Adding verses',
    text: 'Tap Add verses at the top to pick any verses from the Bible. They wait in line until one of your learning days comes around.',
  },
  {
    tab: 'home',
    place: 'Learning a verse',
    text: "When a verse's turn comes, it shows up here. Say it from memory until you get it right a few times, an hour or more apart. After that it comes back now and then, less often each time, so it sticks.",
  },
  {
    tab: 'record',
    place: 'Record',
    text: 'Read a passage aloud and save it. Then listen in your own voice while you practice — in the car, on a walk, anywhere.',
  },
  {
    tab: 'community',
    place: 'Community',
    text: "Optional. Memorize alongside friends or a group, and share recordings. Skip it entirely if you'd rather not.",
  },
  {
    tab: 'profile',
    place: 'Profile',
    text: 'Your progress and Settings live here. You can take this tour again from Settings any time.',
  },
];

/** The tour card. App.tsx shows it above the tab bar while `showTour === true`. */
export function TourCard({ state }: { state: AppState }) {
  const { selectTab, setShowTour } = state;
  const space = useScaledSpace();
  const [step, setStep] = useState(0);
  const { tab, place, text } = STEPS[step];
  const last = step === STEPS.length - 1;

  // Each card shows its own tab. selectTab also returns that tab to its first
  // screen, so "Verses" shows My Verses rather than wherever you left it.
  useEffect(() => {
    setTipsPaused(true);
    return () => setTipsPaused(false);
  }, []);

  useEffect(() => {
    selectTab(tab);
    // The Verses tab's own tip says what this card just said.
    if (tab === 'verses') dismissTip('versesTab');
    // selectTab is recreated every render; only a new step should move tabs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const close = () => setShowTour(false);

  return (
    <FadeInView key={step}>
      <View
        accessibilityLiveRegion="polite"
        className="rounded-card bg-surface border-2 border-accent"
        style={{ padding: space(14), gap: space(8) }}
      >
        <AppText variant="caption" className="font-sans font-semibold text-ink-3">
          {`${step + 1} of ${STEPS.length} · ${place}`}
        </AppText>
        <AppText variant="label" className="font-sans text-ink">
          {text}
        </AppText>
        <View className="flex-row items-center flex-wrap" style={{ gap: space(8), paddingTop: space(2) }}>
          {step > 0 && <AppButton size="sm" variant="quiet" label="Back" onPress={() => setStep(step - 1)} />}
          <View className="flex-1" />
          {last ? (
            <>
              <AppButton size="sm" variant="secondary" label="Common questions" onPress={() => setShowTour('questions')} />
              <AppButton
                size="sm"
                variant="primary"
                label="Done"
                onPress={() => {
                  close();
                  selectTab('home');
                }}
              />
            </>
          ) : (
            <>
              <AppButton size="sm" variant="quiet" label="Skip tour" onPress={close} />
              <AppButton size="sm" variant="primary" label="Next" onPress={() => setStep(step + 1)} />
            </>
          )}
        </View>
      </View>
    </FadeInView>
  );
}
