import './global.css';
import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { BookOpen, Check, Home as HomeIcon, Mic, Pause, User, Users } from 'lucide-react-native';

import { AppState, useAppState } from './src/state/useAppState';
import PracticeModals from './src/components/PracticeModals';
import { FadeInView, NumericKeyboardAccessory, useKeyboardHeight } from './src/components/ui';
import { BottomBars, FloatingTabBar, PageFade } from './src/components/TabBar';
import { RECORDING_VISIBILITY_OPTIONS } from './src/data';

import RecordingDetailScreen from './src/screens/RecordingDetailScreen';
import MyRecordingsScreen from './src/screens/MyRecordingsScreen';
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
import AddVersesScreen from './src/screens/AddVersesScreen';
import MyScheduleScreen from './src/screens/MyScheduleScreen';
import VerseSourcesScreen from './src/screens/VerseSourcesScreen';
import MemoryCalendarScreen from './src/screens/MemoryCalendarScreen';
import VerseRoadScreen from './src/screens/VerseRoadScreen';
import VersePageScreen from './src/screens/VersePageScreen';
import ReferenceDrillScreen from './src/screens/ReferenceDrillScreen';
import ThreadDrillScreen from './src/screens/ThreadDrillScreen';
import GuidedLearningScreen from './src/screens/GuidedLearningScreen';
import MixedReviewScreen from './src/screens/MixedReviewScreen';
import TakeawaysScreen from './src/screens/TakeawaysScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import CommonQuestionsScreen from './src/screens/CommonQuestionsScreen';
import { TourCard } from './src/components/GuidedTour';
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
import QuizScreen from './src/screens/QuizScreen';
import { CommunityGuidelinesSheet } from './src/components/CommunityGuidelinesSheet';
import { NotificationAskSheet } from './src/components/NotificationAskSheet';
import { APP_FONTS, AppButton, AppIconButton, AppText, ChoiceCard, FontScaleOverrideProvider, useScaledSpace } from './src/components/design';
import { Dialog, GroupedList, ListRow, SectionHeader, SegmentedControl } from './src/components/blocks';
import { DEMO_ACCENT, DEMO_FONT_SCALE, DEMO_SCREEN, useDemoState } from './src/dev/DemoHarness';
import BlocksGallery from './src/dev/BlocksGallery';
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
  // Your verses and everything about how they're scheduled. Replaced the My
  // Memory Work menu, which was three taps and a long scroll from Today.
  { id: 'verses' as const, label: 'Verses', Icon: BookOpen },
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
  if (state.currentScreen === 'myRecordings') {
    return <MyRecordingsScreen state={state} />;
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
  // Opens over whichever tab you're on (Today or Verses), so Back returns
  // there.
  if (state.currentScreen === 'addVerses') {
    return <AddVersesScreen state={state} />;
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
  if (state.currentScreen === 'quiz' && state.activeQuiz) {
    return <QuizScreen state={state} />;
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
      case 'referenceDrill':
        return <ReferenceDrillScreen state={state} />;
      case 'threadDrill':
        return <ThreadDrillScreen state={state} />;
      case 'guided':
        return <GuidedLearningScreen state={state} />;
      case 'mixedReview':
        return <MixedReviewScreen state={state} />;
      default:
        return <HomeScreen state={state} />;
    }
  }

  if (state.currentTab === 'verses') {
    switch (state.currentScreen) {
      case 'mySchedule':
        return <MyScheduleScreen state={state} />;
      case 'verseSources':
        return <VerseSourcesScreen state={state} />;
      case 'memoryCalendar':
        return <MemoryCalendarScreen state={state} />;
      case 'takeaways':
        return <TakeawaysScreen state={state} />;
      case 'verseRoad':
        return <VerseRoadScreen state={state} />;
      case 'versePage':
        return <VersePageScreen state={state} />;
      case 'savedPlans':
        return <SavedPlansScreen state={state} />;
      case 'planDesigner':
        return <PlanDesignerScreen state={state} />;
      default:
        return <ActivePlanScreen state={state} />;
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

// What each visibility choice means, said once under the switch.
const VISIBILITY_HINT: Record<'private' | 'circle' | 'public', string> = {
  private: 'Only you can hear it.',
  circle: 'People in your circles can hear it.',
  public: 'Anyone can find it in recordings.',
};

// A Dialog that needs an answer: tapping outside mustn't quietly throw a
// recording away, so the only ways out are Discard and Save.
function SaveRecordingDialog({ state }: { state: AppState }) {
  const space = useScaledSpace();
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
  const first = recordingSelectedVerses[0]?.verse;
  const last = recordingSelectedVerses[recordingSelectedVerses.length - 1]?.verse;
  const passage =
    isRecordingFullChapterRange || first === undefined
      ? `${recordingBook} ${recordingChapter}`
      : `${recordingBook} ${recordingChapter}:${first === last ? first : `${first}-${last}`}`;

  return (
    <Dialog
      visible
      dismissable={false}
      onClose={() => setSaveRecordingDialog(false)}
      title={isImport ? 'Save this audio?' : 'Save this recitation?'}
      actions={
        <>
          <AppButton
            variant="quiet"
            label="Discard"
            onPress={() => {
              setSaveRecordingDialog(false);
              triggerToast('Recording discarded.');
            }}
          />
          <AppButton variant="primary" label="Save" onPress={saveRecordedAudio} />
        </>
      }
    >
      <GroupedList>
        <ListRow title="Passage" value={passage} />
        <ListRow title="Translation" value={recordingTranslation} />
        <ListRow title="Length" value={formatTime(durationSec)} />
      </GroupedList>

      <View style={{ gap: space(6) }}>
        <SectionHeader title="Who can hear it" />
        <SegmentedControl
          value={pickedRecordingVisibility}
          onChange={setPickedRecordingVisibility}
          accessibilityLabel="Who can hear it"
          options={RECORDING_VISIBILITY_OPTIONS}
        />
        <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
          {VISIBILITY_HINT[pickedRecordingVisibility]}
          {defaultRecordingVisibility === null ? ' It will be your default next time.' : ''}
        </AppText>
      </View>
    </Dialog>
  );
}

// Fires on app open when the active plan's "ask me every time" miss-policy
// setting is on and at least one verse has silently missed review cycles
// (see the scan in loadUserData and resolveMissedCycles in useAppState.ts).
// Offers the same 3 outcomes as the reactive per-item catch-up -- this is
// just the proactive, bulk version of the exact same choice.
type MissChoice = 'grace' | 'escalate' | 'reset';

// `short` is the per-verse segment label. "Catch-up" is the user-facing word
// for what the engine calls a refresher (same as MissPolicySection).
const MISS_CHOICES: { id: MissChoice; label: string; short: string; desc: string }[] = [
  {
    id: 'grace',
    label: 'Pick up where I left off',
    short: 'Carry on',
    desc: 'No penalty. Each verse carries on exactly where it was.',
  },
  {
    id: 'escalate',
    label: 'A short catch‑up', // non-breaking hyphen: never "catch- / up" at large text
    short: 'Catch up',
    desc: 'Verses you review weekly get a few days of daily reviews, and monthly ones a few weeks of weekly reviews, then carry on as before.',
  },
  {
    id: 'reset',
    label: 'Start the count over',
    short: 'Start over',
    desc: 'Keep the same pace, with no extra reviews, but progress toward the next step starts again.',
  },
];

const PACE_LABEL: Record<string, string> = {
  daily: 'reviewed daily',
  weekly: 'reviewed weekly',
  monthly: 'reviewed monthly',
};

// A Dialog, so the body scrolls and Apply stays pinned inside the card. The
// old hand-built overlay capped the card at 85% height without scrolling,
// which pushed Apply off the card on an 844pt phone.
function MissedReviewPromptModal({ state }: { state: AppState }) {
  const { missedReviewQueue, setShowMissedReviewPrompt, resolveMissedReviewChoice, missPolicy } = state;
  const defaultChoice: MissChoice = missPolicy === 'graceDiscretion' ? 'grace' : 'escalate';
  const [bulkChoice, setBulkChoice] = React.useState<MissChoice>(defaultChoice);
  const [customizing, setCustomizing] = React.useState(false);
  const [overrides, setOverrides] = React.useState<Record<string, MissChoice>>({});

  const verseCount = missedReviewQueue.length;

  return (
    <Dialog
      visible
      onClose={() => setShowMissedReviewPrompt(false)}
      title="Missed reviews"
      message={`You missed reviews on ${verseCount} ${verseCount === 1 ? 'verse' : 'verses'}. What should happen to ${
        verseCount === 1 ? 'it' : 'them'
      }?`}
      actions={
        <AppButton
          variant="primary"
          label="Apply"
          onPress={() => resolveMissedReviewChoice(bulkChoice, customizing ? overrides : undefined)}
        />
      }
    >
      {customizing ? (
        // One row per verse, each with its own choice. Starts from the
        // choice made above it, so switching modes never loses a pick.
        <View className="bg-surface border border-line rounded-card overflow-hidden">
          {missedReviewQueue.map(({ item, missedCycles }, i) => (
            <MissedVerseRow
              key={item.verseId}
              first={i === 0}
              reference={`${item.book} ${item.chapter}:${item.verseNumber}`}
              detail={`Missed ${missedCycles === 1 ? 'once' : `${missedCycles} times`}${
                PACE_LABEL[item.retentionPhase] ? `, ${PACE_LABEL[item.retentionPhase]}` : ''
              }`}
              value={overrides[item.verseId] || bulkChoice}
              onChange={(choice) => setOverrides((prev) => ({ ...prev, [item.verseId]: choice }))}
            />
          ))}
        </View>
      ) : (
        MISS_CHOICES.map((choice) => (
          <ChoiceCard
            key={choice.id}
            title={choice.label}
            description={choice.desc}
            selected={bulkChoice === choice.id}
            onPress={() => setBulkChoice(choice.id)}
          />
        ))
      )}
      {/* In the scrolling body, not beside Apply: at large text two buttons
          wrap to two rows and squeeze the choices into a sliver. */}
      <View className="flex-row">
        <AppButton
          size="sm"
          variant="quiet"
          label={customizing ? 'Same for all verses' : 'Choose for each verse'}
          onPress={() => setCustomizing((v) => !v)}
        />
      </View>
    </Dialog>
  );
}

function MissedVerseRow({
  first,
  reference,
  detail,
  value,
  onChange,
}: {
  first: boolean;
  reference: string;
  detail: string;
  value: MissChoice;
  onChange: (choice: MissChoice) => void;
}) {
  const space = useScaledSpace();
  return (
    <View className={first ? '' : 'border-t border-hairline'} style={{ padding: space(12), gap: space(8) }}>
      <View style={{ gap: space(1) }}>
        <AppText variant="body" className="font-sans font-semibold text-ink">
          {reference}
        </AppText>
        <AppText variant="caption" className="font-sans text-ink-3">
          {detail}
        </AppText>
      </View>
      <SegmentedControl
        value={value}
        onChange={onChange}
        accessibilityLabel={`What happens to ${reference}`}
        options={MISS_CHOICES.map((c) => ({ id: c.id, label: c.short }))}
      />
    </View>
  );
}

// Persistent mini-player, shown above the tab bar whenever a recording is
// playing, so playback keeps going (and stays controllable) while navigating
// to a different tab — previously play/pause controls only existed on the
// screen you started playback from.
function NowPlayingBar({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const { playingRecordingId, nowPlayingRecording, playingRecProgress, setPlayingRecordingId, setSelectedRecording, navigateTo } = state;

  if (!playingRecordingId || !nowPlayingRecording) return null;

  // The tab bar's pill, one step up: surface, hairline edge, one static
  // shadow on a view that mounts and unmounts whole (never a toggled class).
  return (
    <FadeInView>
      {/* button-ok: the floating now-playing bar, not a button */}
      <Pressable
        onPress={() => {
          setSelectedRecording(nowPlayingRecording);
          navigateTo('recordingDetail');
        }}
        accessibilityRole="button"
        accessibilityLabel={`Now playing ${nowPlayingRecording.book} ${nowPlayingRecording.chapter}. Open the recording.`}
        className="bg-surface border border-line rounded-full flex-row items-center shadow-md active:bg-surface-2"
        style={{ paddingVertical: space(6), paddingLeft: space(6), paddingRight: space(6), gap: space(10) }}
      >
        <View className="rounded-full bg-accent-soft items-center justify-center shrink-0" style={{ width: space(36), height: space(36) }}>
          <Mic size={16} color={palette.accent} />
        </View>

        <View className="flex-1" style={{ gap: space(4), minWidth: 0 }}>
          <AppText variant="label" numberOfLines={1} className="text-ink font-sans font-semibold">
            {nowPlayingRecording.book} {nowPlayingRecording.chapter}
          </AppText>
          <View className="w-full bg-fill h-1 rounded-full overflow-hidden">
            <View className="bg-accent h-full" style={{ width: `${playingRecProgress}%` }} />
          </View>
        </View>

        <AppIconButton
          Icon={Pause}
          variant="filled"
          diameter={36}
          accessibilityLabel="Pause"
          onPress={(e) => { e.stopPropagation(); setPlayingRecordingId(null); }}
        />
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
  const chatScreenActive = state.currentScreen === 'dmThread' || state.currentScreen === 'circleChat' || state.currentScreen === 'quiz';
  // The bars also step aside while the keyboard is up, so a text field near
  // the bottom isn't squeezed against them. Unmounted, never hidden by style.
  const keyboardHeight = useKeyboardHeight();
  // And while recording: the Record tab goes full screen so the text has the
  // room, and a stray tap on a tab can't walk away from a live take.
  const showBars = !chatScreenActive && keyboardHeight === 0 && !state.isRecording;

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
          {showBars && <PageFade />}
        </View>
      </SafeAreaView>

      {/* Floating tab bar (job F4). It sits below the screens, not over
          them, so content ends just above it and nothing can hide under it;
          PageFade softens that edge. The tab bar used to be swapped for a
          "Back to Guide" button during Getting Started; it is always the tab
          bar now. */}
      {showBars && (
        <BottomBars>
          {/* The tour card sits here rather than over the screen, so the
              screen it's describing stays fully in view above it. */}
          {state.showTour === true && <TourCard state={state} />}
          <NowPlayingBar state={state} />
          <FloatingTabBar
            tabs={TABS}
            current={state.currentTab}
            onSelect={state.selectTab}
            ring={state.showTour === true}
            dots={{ community: state.unreadDMCount + state.unreadCircleCount + state.incomingFriendRequests.length > 0 }}
          />
        </BottomBars>
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
          onPickUpThread={(v) => state.openThreadDrill({ book: v.book, chapter: v.chapter, verse: v.verse, translationId: v.translationId })}
          memoryQueue={state.memoryQueue}
          primingLookahead={state.primingLookahead}
          reviewsPaused={state.reviewsPaused}
          setPrimingLookahead={state.setPrimingLookahead}
          initialListenSource={state.listenSource}
          listenPlaylists={state.listenPlaylists}
          onSaveListenPlaylist={state.saveListenPlaylist}
          onDeleteListenPlaylist={state.deleteListenPlaylist}
          preferredTranslationId={state.selectedTranslationId}
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
          initialLearnTab={state.practiceLearnTab ?? undefined}
          sectionsForChapter={state.sectionsForChapter}
          onSaveOutlineExtra={state.saveOutlineExtra}
          onSaveTakeawayDraft={state.saveTakeawayDraft}
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

      {/* Common questions -- opened from the tour's last card or Settings,
          never automatically. (The tour itself is the card in BottomBars.)
          Rendered after setup so that if both are somehow open, setup (the
          one with unanswered questions) isn't buried underneath it. */}
      {state.showTour === 'questions' && (
        <View className="absolute inset-0 bg-canvas z-50">
          <SafeAreaView style={{ flex: 1 }}>
            <CommonQuestionsScreen state={state} />
          </SafeAreaView>
        </View>
      )}

      <CommunityGuidelinesSheet state={state} />
      <NotificationAskSheet state={state} />

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
              {DEMO_SCREEN === 'blocks' ? <BlocksGallery /> : <AppShell />}
            </FontScaleOverrideProvider>
          ) : DEMO_SCREEN === 'blocks' ? (
            <BlocksGallery />
          ) : (
            <AppShell />
          )}
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
