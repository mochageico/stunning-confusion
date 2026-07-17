import './global.css';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import {
  PlayfairDisplay_400Regular,
  PlayfairDisplay_500Medium,
  PlayfairDisplay_600SemiBold,
  PlayfairDisplay_700Bold,
} from '@expo-google-fonts/playfair-display';
import { Check, Home as HomeIcon, Mic, Pause, Sliders, User, Users, X } from 'lucide-react-native';

import { AppState, useAppState } from './src/state/useAppState';
import PracticeModals from './src/components/PracticeModals';
import { FadeInView } from './src/components/ui';
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
import MemoryCalendarScreen from './src/screens/MemoryCalendarScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import CommunityGroupDetailScreen from './src/screens/CommunityGroupDetailScreen';
import StudyPlanDetailScreen from './src/screens/StudyPlanDetailScreen';
import CommunityHomeScreen from './src/screens/CommunityHomeScreen';
import CommunityFindScreen from './src/screens/CommunityFindScreen';
import CommunityCreateScreen from './src/screens/CommunityCreateScreen';
import RecordScreen from './src/screens/RecordScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import FindFriendsScreen from './src/screens/FindFriendsScreen';

// The original web app has no router — it's a hand-rolled state machine on
// `currentTab` / `currentScreen`. This mirrors that structure 1:1 instead of
// introducing React Navigation, to keep the port low-risk.
function CommunityScreen({ state }: { state: AppState }) {
  if (state.viewingGroupDetail) return <CommunityGroupDetailScreen state={state} />;
  if (state.communitySubView === 'find') return <CommunityFindScreen state={state} />;
  if (state.communitySubView === 'create') return <CommunityCreateScreen state={state} />;
  return <CommunityHomeScreen state={state} />;
}

const TABS = [
  { id: 'home' as const, label: 'Home', Icon: HomeIcon },
  { id: 'community' as const, label: 'Community', Icon: Users },
  { id: 'record' as const, label: 'Record', Icon: Mic },
  { id: 'profile' as const, label: 'Profile', Icon: User },
];

// Concrete, actionable copy for whichever Getting-Started step the user is
// currently "out doing" -- shown in a persistent banner (below) alongside
// the Back-to-Guide bar replacing the tab row, so a first-time user always
// has an explanation of exactly what to tap next, not just a destination.
const ONBOARDING_STEP_INSTRUCTIONS = [
  'This is your Plan Designer — the pacing, learning days, and retention settings that drive everything else. Tap "Back to Guide" below when you\'re ready to continue.',
  'Pick a book, then a chapter. Tap verses to select them, then tap "Add to Queue" in the bar that appears at the bottom.',
  'Tap "Pull New Verses" to bring today\'s verses into Learning phase, then tap "Learn" on a verse group to start practicing.',
  'Browse public circles below, or enter an invite code, then tap to join one.',
];

function Screens({ state }: { state: AppState }) {
  if (state.currentScreen === 'recordingDetail' && state.selectedRecording) {
    return <RecordingDetailScreen state={state} />;
  }
  if (state.currentScreen === 'memberProfile' && state.selectedUserProfile) {
    return <MemberProfileScreen state={state} />;
  }
  if (state.currentScreen === 'studyPlanDetail' && state.viewingStudyPlan) {
    return <StudyPlanDetailScreen state={state} />;
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
      case 'memoryCalendar':
        return <MemoryCalendarScreen state={state} />;
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
  } = state;
  const isImport = pendingRecordingSource === 'import';
  const durationSec = isImport ? Math.round(importPlayerStatus.duration || 0) : lastRecordingDuration;
  return (
    <View className="absolute inset-0 bg-black/60 items-center justify-center p-4 z-50">
      <FadeInView style={{ width: '100%', maxWidth: 320 }}>
        <View className="bg-white border-2 border-[#1A1A1A] rounded-xl p-5 gap-4">
          <View>
            <Text className="text-base font-serif font-bold text-[#1A1A1A]">Save Recitation</Text>
            <Text className="text-xs text-neutral-500 font-sans mt-1">
              {isImport
                ? 'Review the details of your tagged audio before saving and sharing.'
                : 'Review the details of your recorded chapter before saving and sharing.'}
            </Text>
          </View>

          <View className="gap-2.5 bg-[#F3F2F1] p-3 rounded-xl border border-[#E5E5E5]">
            <View className="flex-row justify-between">
              <Text className="text-neutral-400 font-bold uppercase text-[9px] font-sans">Chapter:</Text>
              <Text className="text-[#1A1A1A] font-bold font-sans text-xs">
                {recordingBook} {recordingChapter}
              </Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-neutral-400 font-bold uppercase text-[9px] font-sans">Translation:</Text>
              <Text className="text-[#1A1A1A] font-bold font-sans text-xs">{recordingTranslation}</Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-neutral-400 font-bold uppercase text-[9px] font-sans">Duration:</Text>
              <Text className="text-[#1A1A1A] font-bold font-sans text-xs">{formatTime(durationSec)}</Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-neutral-400 font-bold uppercase text-[9px] font-sans">Scope:</Text>
              <Text className="text-emerald-700 font-bold font-sans text-xs">
                {isImport ? 'Imported Audio Recitation' : 'Full Chapter Recitation'}
              </Text>
            </View>
          </View>

          <View className="gap-2">
            <Text className="text-[9px] font-bold uppercase text-neutral-400 tracking-wider font-sans">
              Who can see this recitation?
            </Text>
            <View className="flex-row gap-1.5">
              {RECORDING_VISIBILITY_OPTIONS.map((opt) => {
                const isSelected = pickedRecordingVisibility === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => setPickedRecordingVisibility(opt.id)}
                    className={`flex-1 py-2 rounded-lg items-center border ${
                      isSelected ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-[#E5E5E5]'
                    }`}
                  >
                    <Text className={`text-[10px] font-bold ${isSelected ? 'text-white' : 'text-neutral-700'}`}>
                      {opt.label}
                    </Text>
                    <Text className={`text-[8px] mt-0.5 ${isSelected ? 'text-white/70' : 'text-neutral-400'}`}>
                      {opt.desc}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {defaultRecordingVisibility === null && (
              <Text className="text-[9px] text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg p-2 leading-relaxed">
                Whatever you pick here becomes your default for future recordings — you can still change it each time,
                and eventually from Settings too.
              </Text>
            )}
          </View>

          <View className="flex-row gap-2.5 pt-1">
            <Pressable
              onPress={() => {
                setSaveRecordingDialog(false);
                triggerToast('Recording discarded.');
              }}
              className="flex-1 py-2.5 px-3 border border-[#E5E5E5] rounded-xl items-center bg-white"
            >
              <Text className="text-xs text-neutral-500 font-bold">Discard</Text>
            </Pressable>
            <Pressable onPress={saveRecordedAudio} className="flex-1 py-2.5 px-3 bg-[#1A1A1A] rounded-xl items-center">
              <Text className="text-xs text-white font-bold">Confirm & Save</Text>
            </Pressable>
          </View>
        </View>
      </FadeInView>
    </View>
  );
}

function ProgressModal({ state }: { state: AppState }) {
  const { memorizedCount, learningCount, untouchedCount, verses, setShowProgressModal, navigateTo } = state;
  // Derive from the user's actual verses (previously a hardcoded demo list
  // of four books, which showed empty 0/0 bars for anyone whose real verses
  // were in other books).
  const books = Array.from(new Set(verses.map((v) => v.book)));
  return (
    <View className="absolute inset-0 bg-black/60 items-center justify-center p-4 z-50">
      <FadeInView style={{ width: '100%', maxWidth: 340 }}>
        <View className="bg-white border-2 border-[#1A1A1A] rounded-xl p-5 gap-4">
          <View className="flex-row items-center justify-between border-b border-neutral-200 pb-2">
            <Text className="text-base font-serif font-bold text-[#1A1A1A]">My Scripture Memory Plan</Text>
            <Pressable onPress={() => setShowProgressModal(false)}>
              <X size={16} color="#a3a3a3" />
            </Pressable>
          </View>

          <View className="gap-3.5 pt-1">
            <View className="flex-row gap-2">
              <View className="flex-1 border border-emerald-200 rounded-xl p-2 bg-emerald-50/50 items-center">
                <Text className="text-base font-bold text-emerald-700">{memorizedCount}</Text>
                <Text className="text-[9px] font-sans font-bold text-neutral-500">Memorized</Text>
              </View>
              <View className="flex-1 border border-amber-200 rounded-xl p-2 bg-amber-50/50 items-center">
                <Text className="text-base font-bold text-amber-600">{learningCount}</Text>
                <Text className="text-[9px] font-sans font-bold text-neutral-500">Learning</Text>
              </View>
              <View className="flex-1 border border-neutral-200 rounded-xl p-2 bg-neutral-50/50 items-center">
                <Text className="text-base font-bold text-neutral-700">{untouchedCount}</Text>
                <Text className="text-[9px] font-sans font-bold text-neutral-500">Untouched</Text>
              </View>
            </View>

            <View className="gap-3 pt-1">
              <Text className="text-[10px] font-bold text-neutral-400 tracking-wider uppercase">PROGRESS BY BOOK</Text>
              {books.map((bookName) => {
                const bookVerses = verses.filter((v) => v.book === bookName);
                const memBookCount = bookVerses.filter((v) => v.status === 'memorized').length;
                const ratio = Math.round((memBookCount / bookVerses.length) * 100) || 0;
                return (
                  <View key={bookName} className="gap-1">
                    <View className="flex-row justify-between items-center">
                      <Text className="text-neutral-800 font-serif text-xs font-bold">{bookName}</Text>
                      <Text className="text-neutral-400 text-[10px] font-mono">
                        {memBookCount}/{bookVerses.length} memorized
                      </Text>
                    </View>
                    <View className="w-full bg-neutral-100 h-2 rounded-full overflow-hidden border border-neutral-200">
                      <View className="bg-[#1A1A1A] h-full" style={{ width: `${ratio}%` }} />
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          <Pressable
            onPress={() => {
              setShowProgressModal(false);
              navigateTo('planDesigner');
            }}
            className="w-full py-2.5 px-4 bg-white border border-[#1A1A1A] rounded-xl flex-row items-center justify-center gap-1.5"
          >
            <Sliders size={13} color="#1A1A1A" />
            <Text className="text-[#1A1A1A] font-bold font-sans text-xs">Design Memory Plan</Text>
          </Pressable>

          <Pressable onPress={() => setShowProgressModal(false)} className="w-full py-2.5 bg-neutral-200 rounded-xl items-center">
            <Text className="text-[#1A1A1A] font-bold font-sans text-xs">Close Progress Dashboard</Text>
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
  const { playingRecordingId, nowPlayingRecording, playingRecProgress, setPlayingRecordingId, setSelectedRecording, navigateTo } = state;

  if (!playingRecordingId || !nowPlayingRecording) return null;

  return (
    <FadeInView>
      <Pressable
        onPress={() => {
          setSelectedRecording(nowPlayingRecording);
          navigateTo('recordingDetail');
        }}
        className="mx-3 mt-2 mb-1 bg-[#1A1A1A] rounded-xl px-3 py-2 flex-row items-center gap-3"
      >
        <View className="w-8 h-8 rounded-lg bg-white/15 items-center justify-center shrink-0">
          <Mic size={14} color="#FFFFFF" />
        </View>

        <View className="flex-1" style={{ gap: 4 }}>
          <Text numberOfLines={1} className="text-white font-sans font-bold text-xs">
            {nowPlayingRecording.book} {nowPlayingRecording.chapter}
          </Text>
          <View className="w-full bg-white/20 h-1 rounded-full overflow-hidden">
            <View className="bg-white h-full" style={{ width: `${playingRecProgress}%` }} />
          </View>
        </View>

        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            setPlayingRecordingId(null);
          }}
          className="w-8 h-8 rounded-full bg-white/15 items-center justify-center shrink-0"
        >
          <Pause size={13} color="#FFFFFF" />
        </Pressable>
      </Pressable>
    </FadeInView>
  );
}

function AppShell() {
  const state = useAppState();
  const onboardingStepIndex = state.onboardingStepInProgress;
  const onboardingStepActive = onboardingStepIndex !== null;

  return (
    <View style={{ flex: 1 }} className="bg-white">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        {/* While a Getting-Started step is active, this banner sits above
            whatever real screen the user navigated to -- explains exactly
            what to do there, since the destination screen itself has no
            idea it's being visited as part of a guided step. */}
        {onboardingStepActive && (
          <View className="bg-indigo-50 border-b border-indigo-200 px-4 py-3">
            <Text className="text-[8px] font-sans font-extrabold uppercase tracking-widest text-indigo-500">
              Step {onboardingStepIndex! + 1} of 4
            </Text>
            <Text className="text-[11px] font-sans text-indigo-900 leading-relaxed mt-0.5">
              {ONBOARDING_STEP_INSTRUCTIONS[onboardingStepIndex!]}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Screens state={state} />
        </View>
      </SafeAreaView>

      <SafeAreaView edges={['bottom', 'left', 'right']}>
        <NowPlayingBar state={state} />
        {onboardingStepActive ? (
          // Replaces the whole tab row -- deliberately the ONLY way out of
          // wherever this step sent the user, so a first-time user can't
          // tap Community/Record/Profile mid-step and get lost. The step
          // itself already navigated to the right tab/screen; any further
          // in-screen navigation the step needs (e.g. Books -> Chapters ->
          // ChapterLanding) still works normally since that's not gated by
          // this bar.
          <Pressable
            onPress={state.returnToOnboardingGuide}
            className="h-16 bg-[#1A1A1A] px-6 flex-row items-center justify-center gap-2"
          >
            <Text className="text-white font-sans font-bold text-xs uppercase tracking-wider">← Back to Guide</Text>
          </Pressable>
        ) : (
          <View className="h-16 bg-white border-t border-[#E5E5E5] px-6 flex-row items-center justify-between">
            {TABS.map((tab) => {
              const isActive = state.currentTab === tab.id;
              const Icon = tab.Icon;
              return (
                <Pressable key={tab.id} onPress={() => state.selectTab(tab.id)} className="items-center justify-center flex-1 py-1.5">
                  <Icon size={18} color={isActive ? '#1A1A1A' : '#888888'} strokeWidth={isActive ? 2.5 : 2} />
                  <Text className={`text-[10px] font-sans font-bold tracking-tight mt-1 ${isActive ? 'text-[#1A1A1A]' : 'text-[#888888]'}`}>
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </SafeAreaView>

      {/* Toast Notification Layer */}
      {state.toastMessage && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 56, left: 0, right: 0, alignItems: 'center', zIndex: 50 }}>
          <FadeInView>
            <View className="flex-row items-center gap-2 bg-neutral-900 border border-neutral-800 py-2.5 px-4 rounded-full">
              <Check size={12} color="#34d399" />
              <Text className="text-white text-xs font-bold font-sans">{state.toastMessage}</Text>
            </View>
          </FadeInView>
        </View>
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
        />
      )}

      {state.saveRecordingDialog && <SaveRecordingDialog state={state} />}
      {state.showProgressModal && <ProgressModal state={state} />}

      {/* First-run "Getting Started" checklist -- same full-screen-overlay
          convention as the practice modal above, sitting above the tab
          router rather than going through currentScreen routing, so it
          shows regardless of whatever screen/tab was active when it fires. */}
      {state.showOnboarding && (
        <View className="absolute inset-0 bg-white z-50">
          <SafeAreaView style={{ flex: 1 }}>
            <OnboardingScreen state={state} />
          </SafeAreaView>
        </View>
      )}
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    PlayfairDisplay_400Regular,
    PlayfairDisplay_500Medium,
    PlayfairDisplay_600SemiBold,
    PlayfairDisplay_700Bold,
  });

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#ffffff' }} />;
  }

  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  );
}
