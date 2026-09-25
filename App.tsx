import './global.css';
import React from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Check, Home as HomeIcon, Mic, Pause, Sliders, User, Users, X } from 'lucide-react-native';

import { AppState, useAppState } from './src/state/useAppState';
import PracticeModals from './src/components/PracticeModals';
import { FadeInView, NumericKeyboardAccessory } from './src/components/ui';
import { RECORDING_VISIBILITY_OPTIONS } from './src/data';

import RecordingDetailScreen from './src/screens/RecordingDetailScreen';
import MemberProfileScreen from './src/screens/MemberProfileScreen';
import FullHistoryScreen from './src/screens/FullHistoryScreen';
import HomeScreen from './src/screens/HomeScreen';
import BooksScreen from './src/screens/BooksScreen';
import ChaptersScreen from './src/screens/ChaptersScreen';
import ChapterLandingScreen from './src/screens/ChapterLandingScreen';
import AudioFeedScreen from './src/screens/AudioFeedScreen';
import PlanDesignerScreen from './src/screens/PlanDesignerScreen';
import ActivePlanScreen from './src/screens/ActivePlanScreen';
import SavedPlansScreen from './src/screens/SavedPlansScreen';
import MemoryDeskScreen from './src/screens/MemoryDeskScreen';
import MemoryCalendarScreen from './src/screens/MemoryCalendarScreen';
import ReferenceDrillScreen from './src/screens/ReferenceDrillScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import TourScreen from './src/screens/TourScreen';
import AuthGateScreen from './src/screens/AuthGateScreen';
import DevLayoutLab from './src/screens/DevLayoutLab';

// Set to true to mount the layout lab instead of the app -- side-by-side
// specimens at every supported font scale, no sign-in required. Must be false
// in anything that ships.
const DEV_LAYOUT_LAB = false;
import CommunityGroupDetailScreen from './src/screens/CommunityGroupDetailScreen';
import GroupPlanDetailScreen from './src/screens/GroupPlanDetailScreen';
import CommunityHomeScreen from './src/screens/CommunityHomeScreen';
import CommunityFindScreen from './src/screens/CommunityFindScreen';
import CommunityCreateScreen from './src/screens/CommunityCreateScreen';
import CommunityPreviewScreen from './src/screens/CommunityPreviewScreen';
import RecordScreen from './src/screens/RecordScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import FindFriendsScreen from './src/screens/FindFriendsScreen';
import MessagesScreen from './src/screens/MessagesScreen';
import DMThreadScreen from './src/screens/DMThreadScreen';
import CircleChatScreen from './src/screens/CircleChatScreen';
import { APP_FONTS, AppIconButton, AppText, FontScaleOverrideProvider } from './src/components/design';
import { DEMO_ACCENT, DEMO_FONT_SCALE, useDemoState } from './src/dev/DemoHarness';
import { ACCENTS, AccentId, ThemeProvider, loadStoredAccent } from './src/components/theme';

import { useThemeColors } from './src/components/theme';
// The original web app has no router — it's a hand-rolled state machine on
// `currentTab` / `currentScreen`. This mirrors that structure 1:1 instead of
// introducing React Navigation, to keep the port low-risk.
function CommunityScreen({ state }: { state: AppState }) {
  if (state.viewingGroupDetail) return <CommunityGroupDetailScreen state={state} />;
  if (state.communitySubView === 'preview' && state.previewCircle) return <CommunityPreviewScreen state={state} />;
  if (state.communitySubView === 'find') return <CommunityFindScreen state={state} />;
  if (state.communitySubView === 'create') return <CommunityCreateScreen state={state} />;
  return <CommunityHomeScreen state={state} />;
}

const TABS = [
  // "Today", not "Home": the tab's job is to answer "what do I do right now",
  // and naming it after that job is one less thing to figure out.
  { id: 'home' as const, label: 'Today', Icon: HomeIcon },
  { id: 'community' as const, label: 'Community', Icon: Users },
  { id: 'record' as const, label: 'Record', Icon: Mic },
  { id: 'profile' as const, label: 'Profile', Icon: User },
];

// ONBOARDING_STEP_INSTRUCTIONS was deleted here. It supplied per-step copy for
// a banner shown while the user was "out doing" one step of the old
// Getting-Started walkthrough. Both the banner and the walkthrough are gone --
// see the note at the top of OnboardingScreen.tsx for why.

function Screens({ state }: { state: AppState }) {
  if (state.currentScreen === 'recordingDetail' && state.selectedRecording) {
    return <RecordingDetailScreen state={state} />;
  }
  if (state.currentScreen === 'memberProfile' && state.selectedUserProfile) {
    return <MemberProfileScreen state={state} />;
  }
  if (state.currentScreen === 'groupPlanDetail' && state.viewingGroupPlan) {
    return <GroupPlanDetailScreen state={state} />;
  }
  if (state.currentScreen === 'fullHistory') {
    return <FullHistoryScreen state={state} />;
  }
  if (state.currentScreen === 'dashboard') {
    return <DashboardScreen state={state} />;
  }
  if (state.currentScreen === 'settings') {
    return <SettingsScreen state={state} />;
  }
  if (state.currentScreen === 'findFriends') {
    return <FindFriendsScreen state={state} />;
  }
  if (state.currentScreen === 'messages') {
    return <MessagesScreen state={state} />;
  }
  if (state.currentScreen === 'dmThread' && state.activeDMThread) {
    return <DMThreadScreen state={state} />;
  }
  if (state.currentScreen === 'circleChat' && state.activeCircleChatId) {
    return <CircleChatScreen state={state} />;
  }

  if (state.currentTab === 'home') {
    switch (state.currentScreen) {
      case 'home':
        return <HomeScreen state={state} />;
      case 'books':
        return <BooksScreen state={state} />;
      case 'chapters':
        return <ChaptersScreen state={state} />;
      case 'chapterLanding':
        return <ChapterLandingScreen state={state} />;
      case 'audioFeed':
        return <AudioFeedScreen state={state} />;
      case 'planDesigner':
        return <PlanDesignerScreen state={state} />;
      case 'activePlan':
        return <ActivePlanScreen state={state} />;
      case 'savedPlans':
        return <SavedPlansScreen state={state} />;
      case 'memoryDesk':
        return <MemoryDeskScreen state={state} />;
      case 'memoryCalendar':
        return <MemoryCalendarScreen state={state} />;
      case 'referenceDrill':
        return <ReferenceDrillScreen state={state} />;
      default:
        return <HomeScreen state={state} />;
    }
  }

  if (state.currentTab === 'community') {
    return <CommunityScreen state={state} />;
  }

  if (state.currentTab === 'record') {
    return <RecordScreen state={state} />;
  }

  return <ProfileScreen state={state} />;
}

function SaveRecordingDialog({ state }: { state: AppState }) {
  const {
    recordingBook,
    recordingChapter,
    recordingTranslation,
    lastRecordingDuration,
    formatTime,
    setSaveRecordingDialog,
    saveRecordedAudio,
    triggerToast,
    defaultRecordingVisibility,
    pickedRecordingVisibility,
    setPickedRecordingVisibility,
    pendingRecordingSource,
    importPlayerStatus,
    recordingSelectedVerses,
    isRecordingFullChapterRange,
  } = state;
  const isImport = pendingRecordingSource === 'import';
  const durationSec = isImport ? Math.round(importPlayerStatus.duration || 0) : lastRecordingDuration;
  const rangeLabel = isRecordingFullChapterRange
    ? 'Full Chapter'
    : recordingSelectedVerses.length === 1
      ? `Verse ${recordingSelectedVerses[0]?.verse}`
      : `Verses ${recordingSelectedVerses[0]?.verse}-${recordingSelectedVerses[recordingSelectedVerses.length - 1]?.verse}`;
  return (
    <View className="absolute inset-0 bg-black/60 items-center justify-center p-4 z-50">
      <FadeInView style={{ width: '100%', maxWidth: 320 }}>
        <View className="bg-surface border-2 border-ink rounded-xl p-5 gap-4">
          <View>
            <AppText variant="title" className="font-serif font-bold text-ink">Save Recitation</AppText>
            <AppText variant="label" className="text-ink-3 font-sans mt-1">
              {isImport
                ? 'Review the details of your tagged audio before saving and sharing.'
                : 'Review the details of your recorded chapter before saving and sharing.'}
            </AppText>
          </View>

          <View className="gap-2.5 bg-surface-2 p-3 rounded-xl border border-line">
            <View className="flex-row justify-between">
              <AppText variant="micro" className="text-ink-3 font-bold uppercase font-sans">Chapter:</AppText>
              <AppText variant="label" className="text-ink font-bold font-sans ">
                {recordingBook} {recordingChapter}
              </AppText>
            </View>
            <View className="flex-row justify-between">
              <AppText variant="micro" className="text-ink-3 font-bold uppercase font-sans">Translation:</AppText>
              <AppText variant="label" className="text-ink font-bold font-sans ">{recordingTranslation}</AppText>
            </View>
            <View className="flex-row justify-between">
              <AppText variant="micro" className="text-ink-3 font-bold uppercase font-sans">Duration:</AppText>
              <AppText variant="label" className="text-ink font-bold font-sans ">{formatTime(durationSec)}</AppText>
            </View>
            <View className="flex-row justify-between">
              <AppText variant="micro" className="text-ink-3 font-bold uppercase font-sans">Scope:</AppText>
              <AppText variant="label" className="text-success font-bold font-sans ">
                {rangeLabel} {isImport ? 'Imported Recitation' : 'Recitation'}
              </AppText>
            </View>
          </View>

          <View className="gap-2">
            <AppText variant="micro" className="font-bold uppercase text-ink-3 tracking-wider font-sans">
              Who can see this recitation?
            </AppText>
            <View className="flex-row gap-1.5">
              {RECORDING_VISIBILITY_OPTIONS.map((opt) => {
                const isSelected = pickedRecordingVisibility === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => setPickedRecordingVisibility(opt.id)}
                    className={`flex-1 py-2 rounded-lg items-center border ${
                      isSelected ? 'bg-accent border-accent' : 'bg-surface border-line'
                    }`}
                  >
                    <AppText variant="caption" className={`font-bold ${isSelected ? 'text-on-accent' : 'text-ink-2'}`}>
                      {opt.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
            {defaultRecordingVisibility === null && (
              <AppText variant="micro" className="text-accent bg-accent-soft border border-accent/30 rounded-lg p-2 leading-relaxed">
                Whatever you pick here becomes your default for future recordings — you can still change it each time,
                and eventually from Settings too.
              </AppText>
            )}
          </View>

          <View className="flex-row gap-2.5 pt-1">
            <Pressable
              onPress={() => {
                setSaveRecordingDialog(false);
                triggerToast('Recording discarded.');
              }}
              className="flex-1 py-2.5 px-3 border border-line rounded-xl items-center bg-surface"
            >
              <AppText variant="label" className="text-ink-3 font-bold">Discard</AppText>
            </Pressable>
            <Pressable onPress={saveRecordedAudio} className="flex-1 py-2.5 px-3 bg-accent rounded-xl items-center">
              <AppText variant="label" className="text-on-accent font-bold">Confirm & Save</AppText>
            </Pressable>
          </View>
        </View>
      </FadeInView>
    </View>
  );
}

function ProgressModal({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const { memorizedCount, learningCount, untouchedCount, verses, setShowProgressModal, navigateTo } = state;
  // Derive from the user's actual verses (previously a hardcoded demo list
  // of four books, which showed empty 0/0 bars for anyone whose real verses
  // were in other books).
  const books = Array.from(new Set(verses.map((v) => v.book)));
  return (
    <View className="absolute inset-0 bg-black/60 items-center justify-center p-4 z-50">
      <FadeInView style={{ width: '100%', maxWidth: 340 }}>
        <View className="bg-surface border-2 border-ink rounded-xl p-5 gap-4">
          <View className="flex-row items-center justify-between border-b border-line pb-2">
            <AppText variant="title" className="font-serif font-bold text-ink">My Scripture Memory Plan</AppText>
            <Pressable onPress={() => setShowProgressModal(false)}>
              <X size={16} color={palette.ink3} />
            </Pressable>
          </View>

          <View className="gap-3.5 pt-1">
            <View className="flex-row gap-2">
              <View className="flex-1 border border-success/30 rounded-xl p-2 bg-success-soft items-center">
                <AppText variant="title" className="font-bold text-success">{memorizedCount}</AppText>
                <AppText variant="micro" className="font-sans font-bold text-ink-3">Memorized</AppText>
              </View>
              <View className="flex-1 border border-warning/30 rounded-xl p-2 bg-warning-soft items-center">
                <AppText variant="title" className="font-bold text-warning">{learningCount}</AppText>
                <AppText variant="micro" className="font-sans font-bold text-ink-3">Learning</AppText>
              </View>
              <View className="flex-1 border border-line rounded-xl p-2 bg-surface-2 items-center">
                <AppText variant="title" className="font-bold text-ink-2">{untouchedCount}</AppText>
                <AppText variant="micro" className="font-sans font-bold text-ink-3">Untouched</AppText>
              </View>
            </View>

            <View className="gap-3 pt-1">
              <AppText variant="section" className="font-bold text-ink-3 tracking-wider uppercase">PROGRESS BY BOOK</AppText>
              {books.map((bookName) => {
                const bookVerses = verses.filter((v) => v.book === bookName);
                const memBookCount = bookVerses.filter((v) => v.status === 'memorized').length;
                const ratio = Math.round((memBookCount / bookVerses.length) * 100) || 0;
                return (
                  <View key={bookName} className="gap-1">
                    <View className="flex-row justify-between items-center">
                      <AppText variant="label" className="text-ink font-serif font-bold">{bookName}</AppText>
                      <AppText variant="caption" className="text-ink-3 font-mono">
                        {memBookCount}/{bookVerses.length} memorized
                      </AppText>
                    </View>
                    <View className="w-full bg-surface-2 h-2 rounded-full overflow-hidden border border-line">
                      <View className="bg-accent h-full" style={{ width: `${ratio}%` }} />
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Saved Memory Rhythms, not the designer directly. The designer has
              to be told which rhythm it's editing -- a bare navigateTo left
              editingPlanId null, and Save then took the create-new branch,
              minting a duplicate. Going through the list is now the one door
              into it (see MemoryDeskScreen). */}
          <Pressable
            onPress={() => {
              setShowProgressModal(false);
              navigateTo('savedPlans');
            }}
            className="w-full py-2.5 px-4 bg-surface border border-ink rounded-xl flex-row items-center justify-center gap-1.5"
          >
            <Sliders size={13} color={palette.ink} />
            <AppText variant="label" className="text-ink font-bold font-sans ">Saved Memory Rhythms</AppText>
          </Pressable>

          <Pressable onPress={() => setShowProgressModal(false)} className="w-full py-2.5 bg-fill rounded-xl items-center">
            <AppText variant="label" className="text-ink font-bold font-sans ">Close</AppText>
          </Pressable>
        </View>
      </FadeInView>
    </View>
  );
}

// Fires on app open when the active plan's "ask me every time" miss-policy
// setting is on and at least one verse has silently missed review cycles
// (see the scan in loadUserData and resolveMissedCycles in useAppState.ts).
// Offers the same 3 outcomes as the reactive per-item catch-up -- this is
// just the proactive, bulk version of the exact same choice.
const MISS_CHOICES: { id: 'grace' | 'escalate' | 'reset'; label: string; desc: string }[] = [
  {
    id: 'grace',
    label: 'Pick up where I left off',
    desc: 'No penalty -- streak and phase stay exactly as they were.',
  },
  {
    id: 'escalate',
    label: 'Standard escalation',
    desc: 'Weekly verses get a short daily refresher, Monthly verses a short weekly refresher, before returning.',
  },
  {
    id: 'reset',
    label: 'Reset streak only',
    desc: "Lose progress toward the next graduation, but stay in today's phase -- no refresher detour.",
  },
];

function MissedReviewPromptModal({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const { missedReviewQueue, setShowMissedReviewPrompt, resolveMissedReviewChoice, missPolicy } = state;
  const defaultChoice: 'grace' | 'escalate' | 'reset' = missPolicy === 'graceDiscretion' ? 'grace' : 'escalate';
  const [bulkChoice, setBulkChoice] = React.useState<'grace' | 'escalate' | 'reset'>(defaultChoice);
  const [customizing, setCustomizing] = React.useState(false);
  const [overrides, setOverrides] = React.useState<Record<string, 'grace' | 'escalate' | 'reset'>>({});

  const verseCount = missedReviewQueue.length;

  return (
    <View className="absolute inset-0 bg-black/60 items-center justify-center p-4 z-50">
      <FadeInView style={{ width: '100%', maxWidth: 360 }}>
        <View className="bg-surface border-2 border-ink rounded-xl p-5 gap-4" style={{ maxHeight: '85%' }}>
          <View className="flex-row items-center justify-between border-b border-line pb-2">
            <View className="flex-1 pr-2">
              <AppText variant="title" className="font-serif font-bold text-ink">Missed Reviews</AppText>
              <AppText variant="caption" className="text-ink-3 font-sans mt-0.5">
                You missed reviews on {verseCount} verse{verseCount === 1 ? '' : 's'}. What should happen?
              </AppText>
            </View>
            <Pressable onPress={() => setShowMissedReviewPrompt(false)}>
              <X size={16} color={palette.ink3} />
            </Pressable>
          </View>

          <View className="gap-2">
            {MISS_CHOICES.map((choice) => {
              const isSelected = bulkChoice === choice.id;
              return (
                <Pressable
                  key={choice.id}
                  onPress={() => setBulkChoice(choice.id)}
                  className={`border-2 rounded-xl p-3 ${isSelected ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
                >
                  <View className="flex-row items-center gap-2">
                    <View
                      className={`w-3.5 h-3.5 rounded-full border-2 items-center justify-center ${
                        isSelected ? 'border-accent' : 'border-line-strong'
                      }`}
                    >
                      {isSelected && <View className="w-1.5 h-1.5 bg-accent rounded-full" />}
                    </View>
                    <AppText variant="label" className="font-sans font-bold text-ink">{choice.label}</AppText>
                  </View>
                  <AppText variant="caption" className="text-ink-3 font-sans mt-1 leading-relaxed pl-5.5">{choice.desc}</AppText>
                </Pressable>
              );
            })}
          </View>

          <Pressable onPress={() => setCustomizing((v) => !v)}>
            <AppText variant="section" className="font-sans font-bold text-accent uppercase tracking-wider">
              {customizing ? 'Hide per-verse customization' : 'Customize per verse ->'}
            </AppText>
          </Pressable>

          {customizing && (
            <ScrollView style={{ maxHeight: 180 }} className="border border-line rounded-xl">
              {missedReviewQueue.map(({ item, missedCycles }) => {
                const current = overrides[item.verseId] || bulkChoice;
                return (
                  <View key={item.verseId} className="p-2.5 border-b border-hairline last:border-b-0">
                    <AppText variant="caption" className="font-sans font-bold text-ink">
                      {item.book} {item.chapter}:{item.verseNumber}
                    </AppText>
                    <AppText variant="micro" className="text-ink-3 font-sans mb-1.5">
                      {missedCycles} cycle{missedCycles === 1 ? '' : 's'} missed -- {item.retentionPhase}
                    </AppText>
                    <View className="flex-row gap-1.5">
                      {MISS_CHOICES.map((choice) => (
                        <Pressable
                          key={choice.id}
                          onPress={() => setOverrides((prev) => ({ ...prev, [item.verseId]: choice.id }))}
                          className={`px-2 py-1 rounded-lg border ${
                            current === choice.id ? 'bg-accent border-accent' : 'bg-surface border-line'
                          }`}
                        >
                          <AppText variant="micro" className={`font-bold ${current === choice.id ? 'text-on-accent' : 'text-ink-3'}`}>
                            {choice.id === 'grace' ? 'Grace' : choice.id === 'escalate' ? 'Standard' : 'Reset'}
                          </AppText>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}

          <Pressable
            onPress={() => resolveMissedReviewChoice(bulkChoice, customizing ? overrides : undefined)}
            className="w-full py-2.5 px-4 bg-accent rounded-xl items-center"
          >
            <AppText variant="label" className="text-on-accent font-bold font-sans ">Apply</AppText>
          </Pressable>
        </View>
      </FadeInView>
    </View>
  );
}

// Persistent mini-player, shown above the tab bar whenever a recording is
// playing, so playback keeps going (and stays controllable) while navigating
// to a different tab — previously play/pause controls only existed on the
// screen you started playback from.
function NowPlayingBar({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const { playingRecordingId, nowPlayingRecording, playingRecProgress, setPlayingRecordingId, setSelectedRecording, navigateTo } = state;

  if (!playingRecordingId || !nowPlayingRecording) return null;

  return (
    <FadeInView>
      <Pressable
        onPress={() => {
          setSelectedRecording(nowPlayingRecording);
          navigateTo('recordingDetail');
        }}
        className="mx-3 mt-2 mb-1 bg-accent rounded-xl px-3 py-2 flex-row items-center gap-3"
      >
        <View className="w-8 h-8 rounded-lg bg-on-accent/15 items-center justify-center shrink-0">
          <Mic size={14} color={palette.onAccent} />
        </View>

        <View className="flex-1" style={{ gap: 4 }}>
          <AppText variant="label" numberOfLines={1} className="text-on-accent font-sans font-bold ">
            {nowPlayingRecording.book} {nowPlayingRecording.chapter}
          </AppText>
          <View className="w-full bg-on-accent/20 h-1 rounded-full overflow-hidden">
            <View className="bg-surface h-full" style={{ width: `${playingRecProgress}%` }} />
          </View>
        </View>

        <AppIconButton Icon={Pause} diameter={32} iconSize={13} iconColor={palette.onAccent} onPress={(e) => { e.stopPropagation(); setPlayingRecordingId(null); }} className="rounded-full bg-on-accent/15 shrink-0" />
      </Pressable>
    </FadeInView>
  );
}

function AppShell() {
  const palette = useThemeColors();
  // Demo mode (sample data, no sign-in) for checking UI work -- a no-op unless
  // the web preview URL carries ?s=<screen>, and never in a production build.
  // See src/dev/DemoHarness.tsx.
  const state = useDemoState(useAppState());
  // Chat screens go full-screen (no tab bar / now-playing bar below them) --
  // partly for a standard chat-app feel, but mainly so KeyboardAvoidingView's
  // bottom edge is the true physical screen bottom instead of sitting above
  // a sibling bar it doesn't know about, which was undershooting how far the
  // composer needs to rise above the keyboard.
  const chatScreenActive = state.currentScreen === 'dmThread' || state.currentScreen === 'circleChat';

  // While Firebase resolves whether a session already exists, render nothing
  // rather than flashing the sign-in gate first. Once resolved, no user means
  // no demo/guest content -- show the auth gate instead of the tabbed app;
  // a brand-new account's showOnboarding overlay (below) then takes over
  // automatically once loadUserData creates their profile.
  if (state.loadingAuth) {
    return <View style={{ flex: 1 }} className="bg-canvas" />;
  }
  if (!state.user) {
    return (
      <View style={{ flex: 1 }} className="bg-canvas">
        <StatusBar style="dark" />
        <SafeAreaView style={{ flex: 1 }}>
          <AuthGateScreen state={state} />
        </SafeAreaView>
        <ToastLayer state={state} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }} className="bg-canvas">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <View style={{ flex: 1 }}>
          <Screens state={state} />
        </View>
      </SafeAreaView>

      {!chatScreenActive && (
      <SafeAreaView edges={['bottom', 'left', 'right']}>
        <NowPlayingBar state={state} />
        {/* The tab bar is now always the tab bar. It used to be swapped out
            for a single "Back to Guide" button whenever a Getting-Started
            step was running, to stop a first-time user wandering off
            mid-step -- but that made the guide something you were trapped
            inside rather than something you used, and the guide it belonged
            to no longer exists.

            56pt rather than 64: the bar sits on top of the home-indicator
            inset already added by SafeAreaView, so the old height pushed it
            noticeably far up the screen. */}
        <View className="h-14 bg-surface border-t border-line px-6 flex-row items-center justify-between">
          {TABS.map((tab) => {
            const isActive = state.currentTab === tab.id;
            const Icon = tab.Icon;
            return (
              <Pressable key={tab.id} onPress={() => state.selectTab(tab.id)} className="items-center justify-center flex-1 py-1">
                <Icon size={20} color={isActive ? palette.ink : palette.ink3} strokeWidth={isActive ? 2.5 : 2} />
                <AppText variant="micro" className={`font-sans font-bold tracking-tight mt-0.5 ${isActive ? 'text-ink' : 'text-ink-3'}`}>
                  {tab.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
      )}

      {/* Interactive Full Practice Screen Overlay */}
      {state.activeModal && (
        <PracticeModals
          type={state.activeModal}
          verses={state.modalVerses}
          allVerses={state.verses}
          onClose={state.abortReviewSession}
          onAdvance={state.advanceReviewSession}
          sessionPosition={state.reviewSessionPosition}
          sessionTotal={state.reviewSessionTotal}
          onUpdateStatus={state.handleUpdateVerseStatus}
          memoryQueue={state.memoryQueue}
          primingLookahead={state.primingLookahead}
          setPrimingLookahead={state.setPrimingLookahead}
          userRecordings={state.userRecordings}
          selectedChapterAudios={state.selectedChapterAudios}
          studioPlaybackEnabled={state.studioPlaybackEnabled}
          audioCacheMap={state.audioCache.map}
          onCacheAudio={state.cacheRecordingAudio}
          onListenPlayingChange={state.setListenModePlaying}
          playingRecordingId={state.playingRecordingId}
          setPlayingRecordingId={state.setPlayingRecordingId}
          highlightedVerses={state.highlightedVerses}
          onToggleVerseHighlight={state.toggleVerseHighlight}
          verseDoodles={state.verseDoodles}
          onSaveVerseDoodle={state.saveVerseDoodle}
          memoryGridColumns={state.memoryGridColumns}
          chapterPhotos={state.chapterPhotos}
          photoCache={state.photoCache}
          onCacheChapterPhoto={state.cacheChapterPhoto}
          // Camera rather than a source chooser: the placeholder only appears
          // for a chapter you are listening to right now, and the useful move
          // in that moment is photographing the Bible in front of you. The
          // library route stays on Chapter Landing.
          onAddChapterPhoto={(book, chapter) => {
            void state.addChapterPhoto(book, chapter, 'camera');
          }}
        />
      )}

      {state.saveRecordingDialog && <SaveRecordingDialog state={state} />}
      {state.showProgressModal && <ProgressModal state={state} />}
      {state.showMissedReviewPrompt && <MissedReviewPromptModal state={state} />}

      {/* First-run setup -- same full-screen-overlay convention as the
          practice modal above, sitting above the tab router rather than
          going through currentScreen routing, so it shows regardless of
          whatever screen/tab was active when it fires. */}
      {state.showOnboarding && (
        <View className="absolute inset-0 bg-canvas z-50">
          <SafeAreaView style={{ flex: 1 }}>
            <OnboardingScreen state={state} />
          </SafeAreaView>
        </View>
      )}

      {/* "Show me around" -- opened on demand from Settings or from Today's
          empty state, never automatically. Rendered after setup so that if
          both are somehow open, setup (the one with unanswered questions)
          isn't buried underneath it. */}
      {state.showTour && (
        <View className="absolute inset-0 bg-canvas z-50">
          <SafeAreaView style={{ flex: 1 }}>
            <TourScreen state={state} />
          </SafeAreaView>
        </View>
      )}

      <ToastLayer state={state} />

      {/* The shared "Done" bar for every numeric TextInput in the app -- see
          NumericInput in ui.tsx. Registered once here for all normal screens;
          Modals are their own iOS view controller and register their own. */}
      <NumericKeyboardAccessory />
    </View>
  );
}

// Rendered last (highest paint order) so it always shows above any
// full-screen modal/overlay (practice session, save-recording dialog,
// progress modal, onboarding, the auth gate), which all share zIndex 50 and
// previously painted over toasts fired while they were open.
function ToastLayer({ state }: { state: AppState }) {
  const palette = useThemeColors();
  if (!state.toastMessage) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 56, left: 0, right: 0, alignItems: 'center', zIndex: 100 }}>
      <FadeInView>
        <View className="flex-row items-center gap-2 bg-ink border border-ink py-2.5 px-4 rounded-full">
          <Check size={12} color={palette.success} />
          <AppText variant="label" className="text-on-accent font-bold font-sans">{state.toastMessage}</AppText>
        </View>
      </FadeInView>
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts(APP_FONTS);
  // Read before first paint, alongside the fonts, so the app opens in the
  // chosen accent instead of flashing navy first.
  const [initialAccent, setInitialAccent] = React.useState<AccentId | null>(null);
  React.useEffect(() => {
    loadStoredAccent().then((saved) => {
      // Demo preview only: ?accent=<id> shows the app in another accent.
      const demo = ACCENTS.find((a) => a.id === DEMO_ACCENT);
      setInitialAccent(demo ? demo.id : saved);
    });
  }, []);

  // app.config.js sets orientation: 'default' rather than 'portrait' so the
  // photo viewer can unlock landscape at runtime -- iOS refuses to rotate
  // beyond the app-level mask, so that mask has to be widened at BUILD time or
  // never at all. Widening it also un-pins Android, where the plugin's
  // initialOrientation prop does nothing (it is an iOS Info.plist mod). This
  // pins it back, so the app stays portrait everywhere exactly as before.
  // Anything that wants rotation unlocks explicitly and re-locks on the way out.
  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    try {
      // REQUIRED LAZILY, never imported at the top of this file.
      // expo-screen-orientation calls requireNativeModule() at module scope, so a
      // static import THROWS during startup on any binary built before the module
      // was added -- including every dev client and TestFlight build that predates
      // it. That takes the whole app down instantly instead of degrading. Keeping
      // the require in here means an older binary just skips the lock.
      const ScreenOrientation =
        require('expo-screen-orientation') as typeof import('expo-screen-orientation');
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {
        // Non-fatal -- a device that refuses the lock still renders fine.
      });
    } catch {
      // Older binary without the native module. Harmless: those builds predate the
      // orientation: 'default' switch, so their Info.plist still pins portrait.
    }
  }, []);

  if (!fontsLoaded || !initialAccent) {
    return <View style={{ flex: 1, backgroundColor: '#EFECE6' }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider initialAccent={initialAccent}>
          {DEV_LAYOUT_LAB ? (
            <SafeAreaView style={{ flex: 1 }}>
              <DevLayoutLab />
            </SafeAreaView>
          ) : DEMO_FONT_SCALE ? (
            <FontScaleOverrideProvider scale={DEMO_FONT_SCALE}>
              <AppShell />
            </FontScaleOverrideProvider>
          ) : (
            <AppShell />
          )}
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
