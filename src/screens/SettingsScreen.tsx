import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Constants from 'expo-constants';
import { Check, Compass, LogOut, PauseCircle, RotateCcw, Trash2 } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { auth } from '../firebase';
import { FadeInView } from '../components/ui';
import { RECORDING_VISIBILITY_OPTIONS } from '../data';
import { useGoogleSignIn } from '../state/useGoogleSignIn';
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
import { AppButton, AppText, AppTextInput, ChoiceCard, ToggleRow, useScaledSpace } from '../components/design';
import { Dialog, GroupedList, ListRow, ScreenHeader, SectionHeader, SegmentedControl } from '../components/blocks';
import { ACCENTS, useAccent, useThemeColors } from '../components/theme';
import { BlockedPeopleSettings, GuidelinesRow, NotificationSettings } from '../components/SocialSettings';

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

/**
 * "Restart after": how many wrong words in one verse before Recall starts
 * that verse over. It used to sit on the Recall screen beside Words hidden,
 * but people set it once and leave it, while Words hidden changes from run to
 * run, so it lives here. The Recall screen still shows the count ("2 of 5
 * mistakes") and says where to change it when a verse restarts.
 */
function PracticeSettings() {
  const space = useScaledSpace();
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
    <View style={{ gap: space(6) }}>
      <SectionHeader title="Restart a verse after this many mistakes" />
      <SegmentedControl
        value={strikeLimit}
        onChange={(limit) => {
          setStrikeLimit(limit);
          savePracticePrefs({ strikeLimit: limit });
        }}
        accessibilityLabel="Mistakes before a verse restarts"
        options={STRIKE_LIMITS.map((limit) => ({ id: limit, label: limit === 'unlimited' ? 'Never' : `${limit}` }))}
      />
      <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
        In Recall, missing this many words in one verse starts that verse over from the top.
      </AppText>
      <View style={{ paddingTop: space(10), paddingHorizontal: space(4) }}>
        <ToggleRow
          label="Jigsaw warm-up in Guided learning"
          hint="Before every second stitch of three verses, put them in order first."
          value={jigsaw}
          onChange={(on) => {
            setJigsaw(on);
            savePracticePrefs({ guidedJigsaw: on });
          }}
        />
      </View>
    </View>
  );
}

/**
 * Appearance > Accent color. Six swatches with a check on the chosen one, and
 * its name as the row's value. Choosing one recolors the whole app at once
 * (ThemeProvider in theme.tsx) and is remembered on this device.
 */
function AccentColorPicker() {
  const { accentId, setAccentId, scheme } = useAccent();
  const palette = useThemeColors();
  const space = useScaledSpace();
  // Swatches hold no text, so they stay 34pt at every text size: six of them
  // have to fit across an iPhone SE card.
  const d = 34;
  const chosen = ACCENTS.find((a) => a.id === accentId) ?? ACCENTS[0];
  return (
    <View style={{ gap: space(6) }}>
      <SectionHeader title="Appearance" />
      <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(12) }}>
        <View className="flex-row items-center justify-between" style={{ gap: space(8) }}>
          <AppText variant="body" className="font-sans text-ink flex-1">Accent color</AppText>
          <AppText variant="body" className="font-sans text-ink-3 shrink-0">{chosen.name}</AppText>
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
      <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
        Buttons, links and highlights use this color.
      </AppText>
    </View>
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
      {caption ? (
        <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
          {caption}
        </AppText>
      ) : null}
    </View>
  );
}

export default function SettingsScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const {
    user,
    handleBack,
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
  } = state;

  const { signInWithGoogle } = useGoogleSignIn();

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

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader title="Settings" onBack={handleBack} backLabel="Profile" />

        <GroupedList header="Account">
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

        <NotificationSettings state={state} />

        <AccentColorPicker />

        <PracticeSettings />

        <ChoiceSection
          title="New recordings are shared with"
          value={defaultRecordingVisibility || 'private'}
          onChange={updateDefaultRecordingVisibility}
          options={RECORDING_VISIBILITY_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
          caption="The starting choice when you save a recording. You can change it each time."
        />

        <ChoiceSection
          title="Recordings play as"
          value={studioPlaybackEnabled ? 'on' : 'off'}
          onChange={(id) => setStudioPlaybackEnabled(id === 'on')}
          options={STUDIO_MODE_OPTIONS}
          caption="Every recording is cleaned up automatically: harsh s sounds softened, background noise reduced, volume evened out. This picks which version you hear. Your original is always kept."
        />

        {/* OFFLINE AUDIO — native only. On web the browser's own HTTP cache
            handles this, so there is nothing here for the user to manage. */}
        {AUDIO_CACHE_SUPPORTED && (
          <View style={{ gap: space(12) }}>
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
          </View>
        )}

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

        <GroupedList footer="Away for a while? Pausing stops reviews from coming due and from counting as missed until you resume.">
          <ListRow
            Icon={PauseCircle}
            title="Pause reviews"
            value={pausedAt ? 'Paused' : 'Off'}
            onPress={openPause}
          />
        </GroupedList>

        {/* Two separate doors on purpose. "Show me around" explains what's
            where; setup re-opens the questions that configure the app.
            Conflating them is what made the old single entry unclear about
            whether tapping it would change anything. */}
        <GroupedList header="Help">
          <ListRow Icon={Compass} title="Show me around" onPress={() => setShowTour(true)} />
          <ListRow Icon={RotateCcw} title="Run setup again" onPress={() => setShowOnboarding(true)} />
        </GroupedList>

        <GroupedList>
          <ListRow title="Version" value={Constants.expoConfig?.version || '—'} />
          <ListRow Icon={LogOut} title="Sign out" accessory="none" onPress={signOut} />
        </GroupedList>

        <GroupedList>
          <ListRow Icon={Trash2} title="Delete account" destructive accessory="none" onPress={() => setShowDeleteConfirm(true)} />
        </GroupedList>
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
