import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import Constants from 'expo-constants';
import {
  BellRing,
  BookOpen,
  CalendarDays,
  Check,
  CircleHelp,
  Compass,
  Ear,
  Download,
  FileText,
  Layers,
  Lightbulb,
  LogOut,
  Mic,
  Palette,
  PauseCircle,
  PenLine,
  RotateCcw,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Type,
} from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { auth } from '../firebase';
import { FadeInView } from '../components/ui';
import { RECORDING_VISIBILITY_OPTIONS, translationLabel } from '../data';
import { useGoogleSignIn } from '../state/useGoogleSignIn';
import { usePickerTranslations } from '../state/usePickerTranslations';
import { AUDIO_CACHE_SUPPORTED, CACHE_CAP_CHOICES } from '../lib/audioCache';
import { formatDate } from '../lib/format';
import {
  DEFAULT_STRIKE_LIMIT,
  isStrikeLimit,
  loadPracticePrefs,
  savePracticePrefs,
  STRIKE_LIMITS,
  StrikeLimit,
} from '../lib/practicePrefs';
import { AppButton, AppText, AppTextInput, ChoiceCard, ToggleRow, useFontScale, useScaledSpace } from '../components/design';
import { Badge, Dialog, GroupedList, ListRow, ScreenHeader, SectionHeader, SegmentedControl } from '../components/blocks';
import { Dropdown } from '../components/Dropdown';
import { ACCENTS, useAccent, useThemeColors } from '../components/theme';
import { BlockedPeopleSettings, GuidelinesRow, NotificationSettings } from '../components/SocialSettings';
import { FORMATS, formatLabel, FormatId, MIX_NAMES } from '../lib/formatNames';
import { FALLBACK_FORMAT, MIX_COUNTS_PREF, MIX_FORMAT_ORDER, MIX_FORMATS_PREF, MixCounts, readMixCounts, readMixFormats } from '../lib/mix';
import { PassMark, PracticeTextSize, SchemeChoice, setAppPref, useAppPrefs } from '../lib/appPrefs';
import { printVerses, shareVersesAsText } from '../lib/exportVerses';
import { resetTips } from '../lib/tips';
import { forgetAllSpeechSlips, forgetSpeechSlip, SLIP_LEARN_AFTER, useSpeechSlips } from '../lib/speechSlips';

// ============================================================================
// SETTINGS
// ----------------------------------------------------------------------------
// A short home page of groups, each row opening a small page of its own, with
// the current choice shown on the row so most visits never need to open one.
// It used to be one long page with every setting in no particular order.
//
// A page can also be opened directly (Mixed review's "Choose formats" opens
// Review formats): Back then returns to where you came from, not to the
// Settings home.
// ============================================================================

type Page =
  | 'home'
  | 'account'
  | 'formats'
  | 'recall'
  | 'text'
  | 'audio'
  | 'offline'
  | 'notifications'
  | 'privacy'
  | 'appearance'
  | 'help';

const PAGE_TITLE: Record<Page, string> = {
  home: 'Settings',
  account: 'Account',
  formats: 'Review formats',
  recall: 'Recall and typing',
  text: 'Bible and text',
  audio: 'Playback and sharing',
  offline: 'Offline audio',
  notifications: 'Notifications',
  privacy: 'Privacy and safety',
  appearance: 'Appearance',
  help: 'Help and tour',
};

// Set just before navigateTo('settings') to land on one page.
let pagePending: Page | null = null;

/** Opens Settings on one of its pages. Call it right before navigateTo('settings'). */
export function openSettingsAt(page: Exclude<Page, 'home'>) {
  pagePending = page;
}

// What Back says, from the screen Settings was opened over.
const BACK_LABELS: Partial<Record<string, string>> = {
  mixedReview: MIX_NAMES.mixedReview,
  home: 'Today',
  activePlan: 'My Verses',
};

const formatMB = (bytes: number) => {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;
  return `${mb < 10 && mb > 0 ? mb.toFixed(1) : Math.round(mb)} MB`;
};

// Profile-sharing visibility choices. 'friends' surfaces a snapshot on your
// member profile for friends only; 'private' keeps it to yourself.
const VISIBILITY_OPTIONS: Array<{ id: 'private' | 'friends'; label: string }> = [
  { id: 'private', label: 'Only me' },
  { id: 'friends', label: 'Friends' },
];

// Studio mode is a playback preference, not a processing one — recordings are
// always processed server-side; this only decides which version plays back.
// Turning it off is therefore instant and non-destructive.
const STUDIO_MODE_OPTIONS: Array<{ id: 'on' | 'off'; label: string }> = [
  { id: 'on', label: 'Studio' },
  { id: 'off', label: 'Original' },
];

const PAUSE_DURATIONS: { id: '1w' | '2w' | '1m' | 'indefinite'; label: string; description: string; days: number | null }[] = [
  { id: '1w', label: '1 week', description: 'Reviews start again in 7 days.', days: 7 },
  { id: '2w', label: '2 weeks', description: 'Reviews start again in 14 days.', days: 14 },
  { id: '1m', label: '1 month', description: 'Reviews start again in 30 days.', days: 30 },
  { id: 'indefinite', label: "Until I'm back", description: 'Stays paused until you resume it here.', days: null },
];

const PASS_MARKS: { id: PassMark; label: string }[] = [
  { id: 0.8, label: '80%' },
  { id: 0.9, label: '90%' },
  { id: 1, label: '100%' },
];

const TEXT_SIZES: { id: PracticeTextSize; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'larger', label: 'Larger' },
  { id: 'largest', label: 'Largest' },
];

const SCHEMES: { id: SchemeChoice; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'Match phone' },
];


// A sample for the font choice to show itself on (BSB, public domain).
const SAMPLE_VERSE = 'Your word is a lamp to my feet and a light to my path.';

/** A caption under a control, lined up with the card's text. */
function Caption({ children }: { children: React.ReactNode }) {
  const space = useScaledSpace();
  return (
    <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
      {children}
    </AppText>
  );
}

// A section that is one choice: a heading, the choice, and one line saying
// what it does.
function ChoiceSection<T extends string | number>({
  title,
  value,
  onChange,
  options,
  caption,
}: {
  title: string;
  value: T;
  onChange: (id: T) => void;
  options: { id: T; label: string }[];
  caption?: string;
}) {
  const space = useScaledSpace();
  return (
    <View style={{ gap: space(6) }}>
      <SectionHeader title={title} />
      <SegmentedControl value={value} onChange={onChange} options={options} accessibilityLabel={title} />
      {caption ? <Caption>{caption}</Caption> : null}
    </View>
  );
}

/** Switches in one card, each with its own line of explanation. */
function ToggleCard({ children }: { children: React.ReactNode }) {
  const space = useScaledSpace();
  return (
    <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(16) }}>
      {children}
    </View>
  );
}

// ----------------------------------------------------------------------------
// Review formats
// ----------------------------------------------------------------------------

type FormatChoice = 'counts' | 'practice' | 'off';

/** Both Mixed review choices (which formats, and which of them count), loaded once. */
function useMixChoices() {
  const [enabled, setEnabled] = useState<FormatId[]>(MIX_FORMAT_ORDER);
  const [counts, setCounts] = useState<MixCounts>(() => readMixCounts(undefined));
  useEffect(() => {
    loadPracticePrefs().then((saved) => {
      setEnabled(readMixFormats(saved[MIX_FORMATS_PREF]));
      setCounts(readMixCounts(saved[MIX_COUNTS_PREF]));
    });
  }, []);
  const choiceOf = (id: FormatId): FormatChoice => (!enabled.includes(id) ? 'off' : counts[id] ? 'counts' : 'practice');
  const setChoice = (id: FormatId, choice: FormatChoice) => {
    const nextEnabled = choice === 'off' ? enabled.filter((f) => f !== id) : MIX_FORMAT_ORDER.filter((f) => f === id || enabled.includes(f));
    const nextCounts = choice === 'off' ? counts : { ...counts, [id]: choice === 'counts' };
    setEnabled(nextEnabled);
    setCounts(nextCounts);
    savePracticePrefs({ [MIX_FORMATS_PREF]: nextEnabled, [MIX_COUNTS_PREF]: nextCounts });
  };
  const counting = MIX_FORMAT_ORDER.filter((f) => f === FALLBACK_FORMAT || choiceOf(f) === 'counts').length;
  const practice = MIX_FORMAT_ORDER.filter((f) => f !== FALLBACK_FORMAT && choiceOf(f) === 'practice').length;
  return { choiceOf, setChoice, counting, practice };
}

/**
 * Each format is Counts, Practice or Off, in one list. Recite always counts
 * and can't be turned off: it's what Mixed review falls back on. Put in order,
 * Which section and Teach-It are warm-ups that never count, by the user's rule;
 * Scramble can, because you read every word to solve it.
 */
function FormatsPage({ mix }: { mix: ReturnType<typeof useMixChoices> }) {
  const space = useScaledSpace();
  return (
    <View style={{ gap: space(8) }}>
      <Caption>
        {`${MIX_NAMES.countsTag} moves a verse along its schedule. ${MIX_NAMES.practiceTag} is for warming up and never counts. Off leaves it out of ${MIX_NAMES.mixedReview}.`}
      </Caption>
      <View className="bg-surface border border-line rounded-card overflow-hidden">
        {MIX_FORMAT_ORDER.map((id, i) => {
          const canCount = FORMATS[id].canCount !== false;
          return (
            <View
              key={id}
              className={i === 0 ? '' : 'border-t border-hairline'}
              style={{ paddingVertical: space(12), paddingHorizontal: space(14), gap: space(8) }}
            >
              <View className="flex-row items-center" style={{ gap: space(8) }}>
                <AppText variant="body" className="font-sans font-semibold text-ink flex-1">
                  {formatLabel(id)}
                </AppText>
                {id === FALLBACK_FORMAT && <Badge label="Always counts" tone="accent" />}
              </View>
              {id !== FALLBACK_FORMAT && (
                <SegmentedControl<FormatChoice>
                  value={mix.choiceOf(id)}
                  onChange={(c) => mix.setChoice(id, c)}
                  accessibilityLabel={`${formatLabel(id)} in ${MIX_NAMES.mixedReview}`}
                  options={[
                    ...(canCount ? [{ id: 'counts' as const, label: MIX_NAMES.countsTag }] : []),
                    { id: 'practice' as const, label: MIX_NAMES.practiceTag },
                    { id: 'off' as const, label: 'Off' },
                  ]}
                />
              )}
            </View>
          );
        })}
      </View>
      <Caption>
        {`${formatLabel('recite')} fills in when nothing else fits a section. Every ${MIX_NAMES.practiceTag} round is followed by one that counts, and a drill that doesn't grade you asks "Got it?" when it counts.`}
      </Caption>
    </View>
  );
}

// ----------------------------------------------------------------------------
// Recall and typing
// ----------------------------------------------------------------------------

/**
 * "Restart after": how many wrong words in one verse before Recall starts
 * that verse over. It used to sit on the Recall screen beside Words hidden,
 * but people set it once and leave it, while Words hidden changes from run to
 * run, so it lives here. The Recall screen still shows the count ("2 of 5
 * mistakes") and says where to change it when a verse restarts.
 */
function RecallPage() {
  const space = useScaledSpace();
  const prefs = useAppPrefs();
  const [strikeLimit, setStrikeLimit] = useState<StrikeLimit>(DEFAULT_STRIKE_LIMIT);
  // Guided learning's jigsaw warm-up before stitches. Off is saved as false;
  // anything else (never set) means on.
  const [jigsaw, setJigsaw] = useState(true);
  useEffect(() => {
    loadPracticePrefs().then((saved) => {
      if (isStrikeLimit(saved.strikeLimit)) setStrikeLimit(saved.strikeLimit);
      if (saved.guidedJigsaw === false) setJigsaw(false);
    });
  }, []);
  return (
    <View style={{ gap: space(20) }}>
      <ChoiceSection
        title="A review passes at"
        value={prefs.passMark}
        onChange={(v) => setAppPref('passMark', v)}
        options={PASS_MARKS}
        caption="The share of words you need right for a review to count. Below it, the review counts as a miss."
      />
      <ChoiceSection
        title="Restart a verse after this many mistakes"
        value={strikeLimit}
        onChange={(limit) => {
          setStrikeLimit(limit);
          savePracticePrefs({ strikeLimit: limit });
        }}
        options={STRIKE_LIMITS.map((limit) => ({ id: limit, label: limit === 'unlimited' ? 'Never' : `${limit}` }))}
        caption="In Recall, missing this many words in one verse starts that verse over from the top."
      />
      <ToggleCard>
        <ToggleRow
          label="Forgive nearby keys"
          hint="Typing a key next to the right letter counts as right. Off: only the exact letter counts."
          value={prefs.forgiveNearbyKeys}
          onChange={(on) => setAppPref('forgiveNearbyKeys', on)}
        />
        <ToggleRow
          label="Hide the reference"
          hint="Practice shows Reference hidden until you tap it, so you can learn where each verse is too."
          value={prefs.hideReference}
          onChange={(on) => setAppPref('hideReference', on)}
        />
        <ToggleRow
          label="Jigsaw warm-up in Guided learning"
          hint="Before every second stitch of three verses, put them in order first."
          value={jigsaw}
          onChange={(on) => {
            setJigsaw(on);
            savePracticePrefs({ guidedJigsaw: on });
          }}
        />
      </ToggleCard>
      <LearnedSlips />
      <View style={{ gap: space(6) }}>
        <SectionHeader title="Sounds and vibration" />
        <ToggleCard>
          <ToggleRow
            label="Sounds"
            hint="A soft chime when you finish a verse, a low tone on a wrong word."
            value={prefs.sounds}
            onChange={(on) => setAppPref('sounds', on)}
          />
          {Platform.OS !== 'web' && (
            <ToggleRow
              label="Vibration"
              hint="A light tap on a wrong word."
              value={prefs.vibration}
              onChange={(on) => setAppPref('vibration', on)}
            />
          )}
        </ToggleCard>
      </View>
    </View>
  );
}

/**
 * The speech slips tap-to-fix has taught the grader (lib/speechSlips): every
 * one it now accepts, each forgettable, plus how many are still on their
 * first fix.
 */
function LearnedSlips() {
  const slips = useSpeechSlips();
  const [confirmAll, setConfirmAll] = useState(false);
  const accepted = slips.filter((s) => s.count >= SLIP_LEARN_AFTER);
  const pending = slips.length - accepted.length;
  return (
    <>
      <GroupedList
        header="Speech slips accepted for you"
        footer={`When you tap a red word to say you did say it, the app remembers what the speech engine heard instead. Fix the same one ${SLIP_LEARN_AFTER === 2 ? 'twice' : `${SLIP_LEARN_AFTER} times`} and it counts as right on its own after that. Only the words are saved, never your voice.${
          pending > 0 ? ` ${pending} more ${pending === 1 ? 'has' : 'have'} been fixed once so far.` : ''
        }`}
      >
        {accepted.length === 0 ? (
          <ListRow Icon={Ear} title="None yet" accessory="none" />
        ) : (
          accepted.map((slip) => (
            <ListRow
              key={slip.key}
              Icon={Ear}
              title={`"${slip.heard}" for "${slip.expected}"`}
              subtitle={`Fixed ${slip.count} times`}
              value="Forget"
              onPress={() => forgetSpeechSlip(slip.key)}
            />
          ))
        )}
        {slips.length > 0 && <ListRow Icon={RotateCcw} title="Forget all" destructive onPress={() => setConfirmAll(true)} />}
      </GroupedList>
      <Dialog
        visible={confirmAll}
        onClose={() => setConfirmAll(false)}
        title="Forget every speech slip?"
        message="Recall goes back to grading every misheard word as missed until you fix it again."
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setConfirmAll(false)} />
            <AppButton
              variant="primary"
              label="Forget all"
              onPress={() => {
                forgetAllSpeechSlips();
                setConfirmAll(false);
              }}
            />
          </>
        }
      />
    </>
  );
}

// ----------------------------------------------------------------------------
// Bible and text
// ----------------------------------------------------------------------------

function TextPage({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const prefs = useAppPrefs();
  const { selectedTranslationId, setSelectedTranslationId } = state;
  const translationOptions = usePickerTranslations().map((t) => ({ id: t.id, label: translationLabel(t.id) }));
  return (
    <View style={{ gap: space(20) }}>
      <View style={{ gap: space(6) }}>
        <SectionHeader title="Translation" />
        <Dropdown value={selectedTranslationId} options={translationOptions} title="Translation" onChange={setSelectedTranslationId} />
        <Caption>Chapters open in this one, and new verses are added in it. You can still pick another each time.</Caption>
      </View>
      <View style={{ gap: space(6) }}>
        <SectionHeader title="Verse text" />
        <SegmentedControl
          value={prefs.verseFont}
          onChange={(v) => setAppPref('verseFont', v)}
          accessibilityLabel="Verse text"
          options={[
            { id: 'serif', label: 'Book' },
            { id: 'plain', label: 'Plain' },
          ]}
        />
        <View className="bg-surface border border-line rounded-card" style={{ padding: space(14) }}>
          <AppText variant="body" className="font-serif text-ink">
            {SAMPLE_VERSE}
          </AppText>
          <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingTop: space(4) }}>
            Psalm 119:105
          </AppText>
        </View>
        <Caption>Book is a serif face, like a printed Bible. Plain matches the rest of the app.</Caption>
      </View>
      <ChoiceSection
        title="Practice text size"
        value={prefs.practiceTextSize}
        onChange={(v) => setAppPref('practiceTextSize', v)}
        options={TEXT_SIZES}
        caption="Larger text on the practice screen only, on top of your phone's own text size."
      />
    </View>
  );
}

// ----------------------------------------------------------------------------
// Appearance
// ----------------------------------------------------------------------------

/**
 * Light, dark or the phone's own setting, then the accent color: six swatches
 * with a check on the chosen one. Choosing recolors the whole app at once
 * (ThemeProvider in theme.tsx) and is remembered on this device.
 */
function AppearancePage() {
  const { accentId, setAccentId, scheme } = useAccent();
  const prefs = useAppPrefs();
  const palette = useThemeColors();
  const space = useScaledSpace();
  // Swatches hold no text, so they stay 34pt at every text size: six of them
  // have to fit across an iPhone SE card.
  const d = 34;
  const chosen = ACCENTS.find((a) => a.id === accentId) ?? ACCENTS[0];
  return (
    <View style={{ gap: space(20) }}>
      <ChoiceSection
        title="Theme"
        value={prefs.colorScheme}
        onChange={(v) => setAppPref('colorScheme', v)}
        options={SCHEMES}
        caption="Match phone follows your phone's light or dark setting."
      />
      <View style={{ gap: space(6) }}>
        <SectionHeader title="Accent color" />
        <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(12) }}>
          <View className="flex-row items-center justify-between" style={{ gap: space(8) }}>
            <AppText variant="body" className="font-sans text-ink flex-1">
              Accent color
            </AppText>
            <AppText variant="body" className="font-sans text-ink-3 shrink-0">
              {chosen.name}
            </AppText>
          </View>
          <View className="flex-row justify-between" accessibilityRole="radiogroup">
            {ACCENTS.map((a) => {
              const active = a.id === accentId;
              return (
                <Pressable
                  key={a.id}
                  onPress={() => setAccentId(a.id)}
                  accessibilityRole="radio"
                  accessibilityLabel={a.name}
                  accessibilityState={{ checked: active }}
                  aria-checked={active}
                  hitSlop={6}
                  // The ring changes color only; the border is always there so
                  // choosing a swatch never shifts the row.
                  className={`rounded-full border-2 items-center justify-center ${active ? 'border-ink' : 'border-transparent'}`}
                  style={{ padding: 2 }}
                >
                  <View
                    className="rounded-full items-center justify-center"
                    style={{ width: d, height: d, backgroundColor: scheme === 'light' ? a.light : a.dark }}
                  >
                    {active ? <Check size={18} color={palette.onAccent} strokeWidth={3} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
        <Caption>Buttons, links and highlights use this color.</Caption>
      </View>
    </View>
  );
}

// ----------------------------------------------------------------------------
// The screen
// ----------------------------------------------------------------------------

export default function SettingsScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const {
    user,
    handleBack,
    backHistory,
    navigateTo,
    triggerToast,
    updateDisplayName,
    defaultRecordingVisibility,
    updateDefaultRecordingVisibility,
    studioPlaybackEnabled,
    setStudioPlaybackEnabled,
    audioCache,
    setAudioCacheCap,
    clearAudioDownloads,
    memoryQueueVisibility,
    updateMemoryQueueVisibility,
    setShowOnboarding,
    setShowTour,
    signOut,
    deleteAccount,
    accountabilityDailyCap,
    updateAccountabilityDailyCap,
    pausedAt,
    pausedUntil,
    pauseReviews,
    resumeReviews,
    memoryQueue,
    learningDays,
    newVersesPace,
    savedPlans,
    selectedTranslationId,
  } = state;

  const prefs = useAppPrefs();
  const mix = useMixChoices();
  const { accentId } = useAccent();
  const { signInWithGoogle } = useGoogleSignIn();

  // The page showing, and whether Settings was opened straight onto it.
  const [page, setPage] = useState<Page>(() => {
    const p = pagePending ?? 'home';
    pagePending = null;
    return p;
  });
  const [openedOnPage] = useState(page !== 'home');

  const prev = backHistory[backHistory.length - 1];
  // The Profile tab draws over whatever screen was last open, so its tab
  // says more than the screen does.
  const cameFrom = (prev && (prev.tab === 'profile' ? 'Profile' : BACK_LABELS[prev.screen])) || 'Back';
  const onSubPage = page !== 'home';
  const goBack = () => (onSubPage && !openedOnPage ? setPage('home') : handleBack());
  const backLabel = onSubPage && !openedOnPage ? 'Settings' : cameFrom;

  const [showName, setShowName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [showPause, setShowPause] = useState(false);
  // Whether the pause dialog opened to pause or to resume, fixed at open so
  // its title doesn't flip while it fades out after you act.
  const [pauseMode, setPauseMode] = useState<'pause' | 'resume'>('pause');
  const [pauseDuration, setPauseDuration] = useState<'1w' | '2w' | '1m' | 'indefinite'>('1w');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isGoogleUser = auth.currentUser?.providerData.some((p) => p.providerId === 'google.com');
  const providerLabel = isGoogleUser ? 'Google' : 'Email';

  const resetDeleteFlow = () => {
    setShowDeleteConfirm(false);
    setDeleteConfirmText('');
    setDeletePassword('');
    setNeedsReauth(false);
    setDeleting(false);
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      if (needsReauth && isGoogleUser) {
        const reauthResult = await signInWithGoogle();
        if (!reauthResult.ok) {
          triggerToast(reauthResult.message);
          setDeleting(false);
          return;
        }
      }
      const result = await deleteAccount(needsReauth && !isGoogleUser ? deletePassword : undefined);
      if (result.ok) {
        triggerToast('Account deleted.');
        return;
      }
      if (result.requiresReauth) setNeedsReauth(true);
      triggerToast(result.message);
    } finally {
      setDeleting(false);
    }
  };

  const openPause = () => {
    setPauseMode(pausedAt ? 'resume' : 'pause');
    setShowPause(true);
  };

  const confirmPause = () => {
    const cfg = PAUSE_DURATIONS.find((d) => d.id === pauseDuration)!;
    let untilISO: string | null = null;
    if (cfg.days) {
      const d = new Date();
      d.setDate(d.getDate() + cfg.days);
      untilISO = d.toISOString();
    }
    setShowPause(false);
    pauseReviews(untilISO);
  };

  if (!user) {
    return (
      <FadeInView style={{ flex: 1 }}>
        <View className="flex-1 items-center justify-center p-5">
          <AppText variant="label" className="text-ink-3 font-sans text-center">Sign in to access Settings.</AppText>
        </View>
      </FadeInView>
    );
  }

  const deleteDisabled = deleteConfirmText !== 'DELETE' || deleting || (needsReauth && !isGoogleUser && !deletePassword);
  const inputBox = 'bg-surface border border-line rounded-btn text-ink font-sans';
  const inputStyle = { paddingHorizontal: space(12), paddingVertical: space(10) };

  const activePlan = savedPlans.find((p) => p.isActive) || savedPlans[0];
  const accentName = ACCENTS.find((a) => a.id === accentId)?.name ?? '';
  const schemeName = SCHEMES.find((s) => s.id === prefs.colorScheme)?.label ?? '';
  // Into a Verses-tab screen and back again: Back there returns here.
  const openVersesScreen = (screen: 'mySchedule' | 'savedPlans') => navigateTo(screen, null, null, { keepBack: true });

  const home = (
    <>
      {/* The account, as a card: who you are, and the way into everything about it. */}
      <GroupedList>
        <ListRow title={user.displayName || 'Add your name'} subtitle={user.email || providerLabel} onPress={() => setPage('account')} />
      </GroupedList>

      <GroupedList header="Practice and review">
        <ListRow
          Icon={Layers}
          title="Review formats"
          value={`${mix.counting} count · ${mix.practice} practice`}
          onPress={() => setPage('formats')}
        />
        <ListRow Icon={PenLine} title="Recall and typing" value={`Pass at ${Math.round(prefs.passMark * 100)}%`} onPress={() => setPage('recall')} />
        <ListRow
          Icon={CalendarDays}
          title="My Schedule"
          value={`${learningDays.length} days · ${newVersesPace} a day`}
          onPress={() => openVersesScreen('mySchedule')}
        />
        <ListRow
          Icon={SlidersHorizontal}
          title="Review Settings"
          value={activePlan ? activePlan.name : 'None chosen'}
          onPress={() => openVersesScreen('savedPlans')}
        />
        <ListRow Icon={PauseCircle} title="Pause reviews" value={pausedAt ? 'Paused' : 'Off'} onPress={openPause} />
      </GroupedList>

      <GroupedList header="Bible and text">
        <ListRow Icon={BookOpen} title="Translation" value={translationLabel(selectedTranslationId)} onPress={() => setPage('text')} />
        <ListRow Icon={Type} title="Verse text" value={prefs.verseFont === 'serif' ? 'Book' : 'Plain'} onPress={() => setPage('text')} />
      </GroupedList>

      <GroupedList header="Recordings and audio">
        <ListRow
          Icon={Mic}
          title="Playback and sharing"
          value={`${studioPlaybackEnabled ? 'Studio' : 'Original'} · ${
            RECORDING_VISIBILITY_OPTIONS.find((o) => o.id === (defaultRecordingVisibility || 'private'))?.label ?? ''
          }`}
          onPress={() => setPage('audio')}
        />
        {AUDIO_CACHE_SUPPORTED && (
          <ListRow
            Icon={Download}
            title="Offline audio"
            value={`${audioCache.map.size} · ${formatMB(audioCache.totalBytes)}`}
            onPress={() => setPage('offline')}
          />
        )}
      </GroupedList>

      <GroupedList header="People">
        <ListRow Icon={BellRing} title="Notifications" onPress={() => setPage('notifications')} />
        <ListRow
          Icon={ShieldCheck}
          title="Privacy and safety"
          value={memoryQueueVisibility === 'friends' ? 'Friends' : 'Only me'}
          onPress={() => setPage('privacy')}
        />
      </GroupedList>

      <GroupedList header="App" footer={`Version ${Constants.expoConfig?.version || '—'}`}>
        <ListRow Icon={Palette} title="Appearance" value={`${schemeName} · ${accentName}`} onPress={() => setPage('appearance')} />
        <ListRow Icon={CircleHelp} title="Help and tour" onPress={() => setPage('help')} />
      </GroupedList>
    </>
  );

  const pages: Record<Exclude<Page, 'home'>, React.ReactNode> = {
    account: (
      <>
        <GroupedList>
          <ListRow
            title="Name"
            value={user.displayName || 'Add your name'}
            onPress={() => {
              setDraftName(user.displayName || '');
              setShowName(true);
            }}
          />
          <ListRow title="Email" subtitle={user.email || '—'} />
          <ListRow title="Signed in with" value={providerLabel} />
        </GroupedList>
        <GroupedList
          header="Export my verses"
          footer={`All ${memoryQueue.length} verses on My Verses, in Bible order, with each one's translation and stage.`}
        >
          <ListRow
            Icon={Share2}
            title={Platform.OS === 'web' ? 'Copy as text' : 'Share as text'}
            accessory="none"
            onPress={() => {
              void shareVersesAsText(memoryQueue);
              if (Platform.OS === 'web') triggerToast('Copied.');
            }}
          />
          <ListRow Icon={FileText} title="Print or save as PDF" accessory="none" onPress={() => void printVerses(memoryQueue)} />
        </GroupedList>
        <GroupedList>
          <ListRow Icon={LogOut} title="Sign out" accessory="none" onPress={signOut} />
        </GroupedList>
        <GroupedList>
          <ListRow Icon={Trash2} title="Delete account" destructive accessory="none" onPress={() => setShowDeleteConfirm(true)} />
        </GroupedList>
      </>
    ),
    formats: <FormatsPage mix={mix} />,
    recall: <RecallPage />,
    text: <TextPage state={state} />,
    audio: (
      <>
        <ChoiceSection
          title="Recordings play as"
          value={studioPlaybackEnabled ? 'on' : 'off'}
          onChange={(id) => setStudioPlaybackEnabled(id === 'on')}
          options={STUDIO_MODE_OPTIONS}
          caption="Every recording is cleaned up automatically: harsh s sounds softened, background noise reduced, volume evened out. This picks which version you hear. Your original is always kept."
        />
        <ChoiceSection
          title="New recordings are shared with"
          value={defaultRecordingVisibility || 'private'}
          onChange={updateDefaultRecordingVisibility}
          options={RECORDING_VISIBILITY_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
          caption="The starting choice when you save a recording. You can change it each time."
        />
      </>
    ),
    // OFFLINE AUDIO — native only. On web the browser's own HTTP cache
    // handles this, so there is nothing here for the user to manage.
    offline: (
      <>
        <ChoiceSection
          title="Offline audio limit"
          value={audioCache.capBytes}
          onChange={setAudioCacheCap}
          options={CACHE_CAP_CHOICES.map((bytes) => ({ id: bytes, label: formatMB(bytes) }))}
          caption="Recordings you play are kept on this device so they don't download again and work without a signal. Recordings you save offline are never removed automatically."
        />
        <GroupedList>
          <ListRow
            title="On this device"
            value={`${audioCache.map.size} ${audioCache.map.size === 1 ? 'recording' : 'recordings'}, ${formatMB(audioCache.totalBytes)}`}
          />
          <ListRow
            Icon={Trash2}
            title="Clear downloaded audio"
            accessory="none"
            onPress={() => {
              if (audioCache.map.size === 0) {
                triggerToast('Nothing stored on this device yet.');
                return;
              }
              clearAudioDownloads();
            }}
          />
        </GroupedList>
      </>
    ),
    notifications: <NotificationSettings state={state} />,
    privacy: (
      <>
        <ChoiceSection
          title="Who can see my verses"
          value={memoryQueueVisibility}
          onChange={updateMemoryQueueVisibility}
          options={VISIBILITY_OPTIONS}
          caption="Friends see the list of verses you're working on when they open your profile. There's no setting for your Review Settings, because those are never shared."
        />
        <ChoiceSection
          title="Friend nudges per day"
          value={accountabilityDailyCap}
          onChange={updateAccountabilityDailyCap}
          options={[
            { id: 3, label: '3' },
            { id: 5, label: '5' },
            { id: 10, label: '10' },
            { id: 999, label: 'No limit' },
          ]}
          caption="The most nudges you'll get in a day, from all friends together. A friend is told if you've reached it."
        />
        <BlockedPeopleSettings state={state} />
        <GuidelinesRow state={state} />
      </>
    ),
    appearance: <AppearancePage />,
    // Two separate doors on purpose. The tour explains what's where; setup
    // re-opens the questions that configure the app. Conflating them is what
    // made the old single entry unclear about whether tapping it would change
    // anything.
    help: (
      <GroupedList>
        <ListRow Icon={Compass} title="Take the tour" onPress={() => setShowTour(true)} />
        <ListRow Icon={CircleHelp} title="Common questions" onPress={() => setShowTour('questions')} />
        <ListRow
          Icon={Lightbulb}
          title="Show tips again"
          accessory="none"
          onPress={() => {
            void resetTips();
            triggerToast('Tips will show again.');
          }}
        />
        <ListRow Icon={RotateCcw} title="Run setup again" onPress={() => setShowOnboarding(true)} />
      </GroupedList>
    ),
  };

  return (
    <FadeInView style={{ flex: 1 }}>
      {/* Keyed by page, so each page opens at its top. */}
      <ScrollView
        key={page}
        className="flex-1 bg-canvas"
        contentContainerClassName="p-5 pb-12"
        contentContainerStyle={{ gap: space(20) }}
      >
        <ScreenHeader title={PAGE_TITLE[page]} onBack={goBack} backLabel={backLabel} />
        {page === 'home' ? home : pages[page]}
      </ScrollView>

      {/* Name */}
      <Dialog
        visible={showName}
        onClose={() => setShowName(false)}
        title="Your name"
        message="Friends and circles see this."
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setShowName(false)} />
            <AppButton
              variant="primary"
              label="Save"
              onPress={() => {
                const val = draftName.trim();
                setShowName(false);
                if (val && val !== user.displayName) updateDisplayName(val);
              }}
            />
          </>
        }
      >
        <AppTextInput
          value={draftName}
          onChangeText={setDraftName}
          placeholder="Your name"
          accessibilityLabel="Your name"
          variant="body"
          autoFocus
          className={inputBox}
          style={inputStyle}
        />
      </Dialog>

      {/* Pause / resume */}
      <Dialog
        visible={showPause}
        onClose={() => setShowPause(false)}
        placement={pauseMode === 'pause' ? 'sheet' : 'center'}
        title={pauseMode === 'pause' ? 'Pause reviews' : 'Reviews are paused'}
        message={
          pauseMode === 'pause'
            ? "Nothing becomes due and no reviews count as missed until you resume. Friends can't nudge you while you're away."
            : `Paused since ${pausedAt ? formatDate(pausedAt, 'long') : ''}${
                pausedUntil ? `, until ${formatDate(pausedUntil, 'long')}` : '. It stays paused until you resume'
              }. Nothing is due and nothing counts as missed.`
        }
        actions={
          pauseMode === 'pause' ? (
            <>
              <AppButton variant="quiet" label="Cancel" onPress={() => setShowPause(false)} />
              <AppButton variant="primary" label="Pause" onPress={confirmPause} />
            </>
          ) : (
            <>
              <AppButton variant="quiet" label="Close" onPress={() => setShowPause(false)} />
              <AppButton
                variant="primary"
                label="Resume now"
                onPress={() => {
                  setShowPause(false);
                  resumeReviews();
                }}
              />
            </>
          )
        }
      >
        {pauseMode === 'pause' ? (
          <View style={{ gap: space(8) }}>
            {PAUSE_DURATIONS.map((d) => (
              <ChoiceCard
                key={d.id}
                title={d.label}
                description={d.description}
                selected={d.id === pauseDuration}
                onPress={() => setPauseDuration(d.id)}
              />
            ))}
          </View>
        ) : null}
      </Dialog>

      {/* Delete account */}
      <Dialog
        visible={showDeleteConfirm}
        onClose={resetDeleteFlow}
        title="Delete your account?"
        message="This permanently deletes your account and everything in it: verses, review history, recordings and circle memberships. It can't be undone."
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={resetDeleteFlow} />
            <AppButton
              variant="destructive"
              label={deleting ? 'Deleting…' : needsReauth ? 'Confirm and delete' : 'Delete account'}
              disabled={deleteDisabled}
              onPress={handleDeleteAccount}
            />
          </>
        }
      >
        <View style={{ gap: space(4) }}>
          <AppText variant="caption" className="font-sans font-medium text-ink-2">Type DELETE to confirm</AppText>
          <AppTextInput
            value={deleteConfirmText}
            onChangeText={setDeleteConfirmText}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="DELETE"
            accessibilityLabel="Type DELETE to confirm"
            variant="body"
            className={inputBox}
            style={inputStyle}
          />
        </View>
        {needsReauth && !isGoogleUser && (
          <View style={{ gap: space(4) }}>
            <AppText variant="caption" className="font-sans font-medium text-ink-2">Confirm your password</AppText>
            <AppTextInput
              value={deletePassword}
              onChangeText={setDeletePassword}
              secureTextEntry
              placeholder="Password"
              accessibilityLabel="Password"
              variant="body"
              className={inputBox}
              style={inputStyle}
            />
          </View>
        )}
      </Dialog>
    </FadeInView>
  );
}
