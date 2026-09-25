import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { ArrowLeft, Check } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { auth } from '../firebase';
import { ChipRow, FadeInView, HelpTooltip } from '../components/ui';
import { RECORDING_VISIBILITY_OPTIONS } from '../data';
import { useGoogleSignIn } from '../state/useGoogleSignIn';
import { AUDIO_CACHE_SUPPORTED, CACHE_CAP_CHOICES } from '../lib/audioCache';
import {
  DEFAULT_STRIKE_LIMIT,
  isStrikeLimit,
  loadPracticePrefs,
  savePracticePrefs,
  STRIKE_LIMITS,
  StrikeLimit,
} from '../lib/practicePrefs';
import { AppButton, AppIconButton, AppTextInput, AppText } from '../components/design';
import { ACCENTS, useAccent, useThemeColors } from '../components/theme';

const formatMB = (bytes: number) => {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;
  return `${mb < 10 && mb > 0 ? mb.toFixed(1) : Math.round(mb)} MB`;
};

// Profile-sharing visibility choices, shared by the Memory Plan and Memory
// Queue pickers below. 'friends' surfaces a snapshot on your member profile
// for friends only; 'private' keeps it to yourself.
const VISIBILITY_OPTIONS: Array<{ id: 'private' | 'friends'; label: string }> = [
  { id: 'private', label: 'Private' },
  { id: 'friends', label: 'Friends' },
];

// Studio mode is a playback preference, not a processing one — recordings are
// always processed server-side; this only decides which version plays back.
// Turning it off is therefore instant and non-destructive.
const STUDIO_MODE_OPTIONS: Array<{ id: string; enabled: boolean; label: string }> = [
  { id: 'on', enabled: true, label: 'Studio' },
  { id: 'off', enabled: false, label: 'Original' },
];

const PAUSE_DURATIONS: { id: '1w' | '2w' | '1m' | 'indefinite'; label: string; days: number | null }[] = [
  { id: '1w', label: '1 Week', days: 7 },
  { id: '2w', label: '2 Weeks', days: 14 },
  { id: '1m', label: '1 Month', days: 30 },
  { id: 'indefinite', label: "Until I'm Back", days: null },
];

/**
 * Settings > Appearance > Accent color. Six swatches with a check on the
 * chosen one, and its name as the row's value. Choosing one recolors the
 * whole app at once (ThemeProvider in theme.tsx) and is remembered on this
 * device.
 */
/**
 * "Restart after": how many wrong words in one verse before Recall starts
 * that verse over. It used to sit on the Recall screen beside Words hidden,
 * but people set it once and leave it, while Words hidden changes from run to
 * run, so it lives here. The Recall screen still shows the count ("2 of 5
 * mistakes") and says where to change it when a verse restarts.
 */
function PracticeSettings() {
  const [strikeLimit, setStrikeLimit] = useState<StrikeLimit>(DEFAULT_STRIKE_LIMIT);
  useEffect(() => {
    loadPracticePrefs().then((saved) => {
      if (isStrikeLimit(saved.strikeLimit)) setStrikeLimit(saved.strikeLimit);
    });
  }, []);
  return (
    <View className="bg-surface border border-line rounded-card p-3.5" style={{ gap: 10 }}>
      <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3">Practice</AppText>
      <AppText variant="label" className="font-sans font-medium text-ink">Restart a verse after this many mistakes</AppText>
      <ChipRow
        value={strikeLimit}
        onChange={(limit) => {
          setStrikeLimit(limit);
          savePracticePrefs({ strikeLimit: limit });
        }}
        options={STRIKE_LIMITS.map((limit) => ({ id: limit, label: limit === 'unlimited' ? 'Never' : `${limit}` }))}
      />
      <AppText variant="caption" className="font-sans text-ink-3">
        In Recall, missing this many words in one verse starts that verse over from the top.
      </AppText>
    </View>
  );
}

function AccentColorPicker() {
  const { accentId, setAccentId, scheme } = useAccent();
  const palette = useThemeColors();
  // Swatches hold no text, so they stay 34pt at every text size: six of them
  // have to fit across an iPhone SE card.
  const d = 34;
  const chosen = ACCENTS.find((a) => a.id === accentId) ?? ACCENTS[0];
  return (
    <View style={{ gap: 12 }}>
      <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
        <AppText variant="label" className="font-sans font-semibold text-ink flex-1">Accent color</AppText>
        <AppText variant="label" className="font-sans text-ink-3 shrink-0">{chosen.name}</AppText>
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
      <AppText variant="caption" className="font-sans text-ink-3">
        Buttons, links and highlights use this color.
      </AppText>
    </View>
  );
}

export default function SettingsScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
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

  const [pauseDuration, setPauseDuration] = useState<'1w' | '2w' | '1m' | 'indefinite'>('1w');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isGoogleUser = auth.currentUser?.providerData.some((p) => p.providerId === 'google.com');
  const providerLabel = isGoogleUser ? 'Google' : 'Email & Password';

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
      if (result.requiresReauth) {
        setNeedsReauth(true);
        triggerToast(result.message);
      } else {
        triggerToast(result.message);
      }
    } finally {
      setDeleting(false);
    }
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

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4 pb-10" contentContainerStyle={{ gap: 12 }}>
        {/* Header */}
        <View className="flex-row items-center gap-3 border-b border-hairline pb-3">
          <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={14} iconColor={palette.ink} onPress={handleBack} className="rounded-full border border-line bg-surface" />
          <AppText variant="title" className="font-serif font-black text-ink leading-none">Settings</AppText>
        </View>

        {/* APPEARANCE */}
        <View className="bg-surface border border-line rounded-card p-3.5" style={{ gap: 12 }}>
          <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3">Appearance</AppText>
          <AccentColorPicker />
        </View>

        {/* PRACTICE */}
        <PracticeSettings />

        {/* ACCOUNT */}
        <View className="bg-surface border border-line rounded-xl p-3.5" style={{ gap: 12 }}>
          <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3">Account</AppText>

          <View>
            <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3 mb-1">Display Name</AppText>
            <AppTextInput defaultValue={user.displayName || ''} onEndEditing={(e) => { const val = e.nativeEvent.text.trim(); if (val && val !== user.displayName) updateDisplayName(val); }} className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl font-bold text-ink" placeholder="Your name" />
          </View>

          <View className="flex-row gap-2">
            <View className="flex-1">
              <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3">Email</AppText>
              <AppText variant="caption" className="font-sans text-ink-2 mt-0.5" numberOfLines={1}>{user.email || '—'}</AppText>
            </View>
            <View className="flex-1">
              <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3">Signed in with</AppText>
              <AppText variant="caption" className="font-sans text-ink-2 mt-0.5" numberOfLines={1}>{providerLabel}</AppText>
            </View>
          </View>
        </View>

        {/* RECORDING DEFAULTS */}
        <View className="bg-surface border border-line rounded-xl p-3.5" style={{ gap: 10 }}>
          <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3">
            Default Recording Visibility
          </AppText>
          <View className="flex-row gap-2">
            {RECORDING_VISIBILITY_OPTIONS.map((opt) => {
              const isSelected = (defaultRecordingVisibility || 'private') === opt.id;
              return (
                <AppButton size="md" key={opt.id} onPress={() => updateDefaultRecordingVisibility(opt.id)} className={`flex-1 rounded-lg items-center border ${ isSelected ? 'bg-accent border-accent' : 'bg-surface border-line' }`}>
                  <AppText variant="caption" className={`font-sans font-bold ${isSelected ? 'text-on-accent' : 'text-ink-2'}`}>
                    {opt.label}
                  </AppText>
                </AppButton>
              );
            })}
          </View>
        </View>

        {/* STUDIO MODE */}
        <View className="bg-surface border border-line rounded-xl p-3.5" style={{ gap: 10 }}>
          <View>
            <View className="flex-row items-center">
              <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3">Studio Mode</AppText>
              <HelpTooltip text="Every recitation you record is cleaned up automatically — harsh &quot;s&quot; sounds softened, background noise reduced, volume evened out. This just picks which version you hear. Your original take is always kept, so you can switch back any time." />
            </View>
          </View>
          <View className="flex-row gap-2">
            {STUDIO_MODE_OPTIONS.map((opt) => {
              const isSelected = studioPlaybackEnabled === opt.enabled;
              return (
                <AppButton size="md" key={opt.id} onPress={() => setStudioPlaybackEnabled(opt.enabled)} className={`flex-1 rounded-lg items-center border ${ isSelected ? 'bg-accent border-accent' : 'bg-surface border-line' }`}>
                  <AppText variant="caption" className={`font-sans font-bold ${isSelected ? 'text-on-accent' : 'text-ink-2'}`}>
                    {opt.label}
                  </AppText>
                </AppButton>
              );
            })}
          </View>
        </View>

        {/* OFFLINE AUDIO — native only. On web the browser's own HTTP cache
            handles this, so there is nothing here for the user to manage. */}
        {AUDIO_CACHE_SUPPORTED && (
          <View className="bg-surface border border-line rounded-xl p-3.5" style={{ gap: 10 }}>
            <View>
              <View className="flex-row items-center">
                <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3">Offline Audio</AppText>
                <HelpTooltip text="Recitations you play are kept on this device so they don't re-download every time — saving data and working without a signal. Recordings you save offline are never removed automatically." />
              </View>
            </View>

            <View className="flex-row justify-between items-center bg-surface-2 border border-line rounded-xl px-3 py-2">
              <AppText variant="caption" className="font-sans text-ink-2">
                {audioCache.map.size} recording{audioCache.map.size === 1 ? '' : 's'} on this device
              </AppText>
              <AppText variant="caption" className="font-mono font-bold text-ink-2">
                {formatMB(audioCache.totalBytes)} / {formatMB(audioCache.capBytes)}
              </AppText>
            </View>

            <View>
              <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3 mb-1">
                Storage Limit
              </AppText>
              <View className="flex-row gap-2">
                {CACHE_CAP_CHOICES.map((bytes) => {
                  const isSelected = audioCache.capBytes === bytes;
                  return (
                    <AppButton size="md" key={bytes} onPress={() => setAudioCacheCap(bytes)} className={`flex-1 rounded-lg items-center border ${ isSelected ? 'bg-accent border-accent' : 'bg-surface border-line' }`}>
                      <AppText variant="caption" className={`font-sans font-bold ${isSelected ? 'text-on-accent' : 'text-ink-2'}`} >
                        {formatMB(bytes)}
                      </AppText>
                    </AppButton>
                  );
                })}
              </View>
            </View>

            <AppButton size="md" onPress={() => { if (audioCache.map.size === 0) { triggerToast('Nothing stored on this device yet.'); return; } clearAudioDownloads(); }} className="w-full rounded-lg items-center border border-line bg-surface">
              <AppText variant="caption" className="font-sans font-bold text-ink-2">Clear Downloaded Audio</AppText>
            </AppButton>
          </View>
        )}

        {/* PROFILE SHARING */}
        <View className="bg-surface border border-line rounded-xl p-3.5" style={{ gap: 14 }}>
          <View>
            <View className="flex-row items-center">
              <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3">Profile Sharing</AppText>
              <HelpTooltip text="Choose what friends can see when they open your profile. Private means only you can see it." />
            </View>
          </View>

          {/* Verse-list visibility. There is deliberately no matching control
              for Review Settings -- sharing your retention method was removed
              entirely, so there's nothing to make visible. */}
          <View style={{ gap: 6 }}>
            <AppText variant="caption" className="font-sans font-bold text-ink-2">My Verses</AppText>
            <View className="flex-row gap-2">
              {VISIBILITY_OPTIONS.map((opt) => {
                const isSelected = memoryQueueVisibility === opt.id;
                return (
                  <AppButton size="md" key={opt.id} onPress={() => updateMemoryQueueVisibility(opt.id)} className={`flex-1 rounded-lg items-center border ${ isSelected ? 'bg-accent border-accent' : 'bg-surface border-line' }`}>
                    <AppText variant="caption" className={`font-sans font-bold ${isSelected ? 'text-on-accent' : 'text-ink-2'}`}>
                      {opt.label}
                    </AppText>
                  </AppButton>
                );
              })}
            </View>
          </View>
        </View>

        {/* NOTIFICATIONS */}
        <View className="bg-surface border border-line rounded-xl p-3.5" style={{ gap: 10 }}>
          <View>
            <View className="flex-row items-center">
              <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3">
                Accountability Notifications
              </AppText>
              <HelpTooltip text="Max accountability nudges you'll receive per day, combined across all friends. A sender is told clearly if you've already hit this for today." />
            </View>
          </View>
          <ChipRow
            value={accountabilityDailyCap}
            onChange={updateAccountabilityDailyCap}
            options={[
              { id: 3, label: '3' },
              { id: 5, label: '5' },
              { id: 10, label: '10' },
              { id: 999, label: 'Unlimited' },
            ]}
          />
        </View>

        {/* PAUSE REVIEWS */}
        <View className={`border rounded-xl p-4 ${pausedAt ? 'bg-warning-soft border-warning/30' : 'bg-surface border-line'}`} style={{ gap: 10 }}>
          <AppText variant="micro" className={`font-extrabold uppercase tracking-wider ${pausedAt ? 'text-warning' : 'text-ink-3'}`}>
            Pause Reviews
          </AppText>

          {pausedAt ? (
            <>
              <AppText variant="caption" className="text-warning font-sans leading-relaxed">
                Paused since {new Date(pausedAt).toLocaleDateString()}
                {pausedUntil ? ` -- planned return ${new Date(pausedUntil).toLocaleDateString()}` : ' -- resume manually whenever you\'re ready'}.
                Nothing is due, nothing counts as missed, and friends won't see accountability nudges reach you while
                you're away.
              </AppText>
              <AppButton size="md" onPress={resumeReviews} className="w-full bg-warning rounded-xl items-center">
                <AppText variant="label" className="text-on-accent font-sans font-bold ">Resume Now</AppText>
              </AppButton>
            </>
          ) : (
            <>
              <AppText variant="caption" className="text-ink-3 font-sans leading-relaxed">
                Going on a trip, or know you won't have your phone for a while? Pausing freezes your whole queue --
                nothing becomes due, and no reviews count as missed, until you resume.
              </AppText>
              <ChipRow
                value={pauseDuration}
                onChange={setPauseDuration}
                options={PAUSE_DURATIONS.map((d) => ({ id: d.id, label: d.label }))}
              />
              <AppButton size="md" onPress={() => { const cfg = PAUSE_DURATIONS.find((d) => d.id === pauseDuration)!; const untilISO = cfg.days ? (() => { const d = new Date(); d.setDate(d.getDate() + cfg.days!); return d.toISOString(); })() : null; pauseReviews(untilISO); }} className="w-full bg-accent rounded-xl items-center">
                <AppText variant="label" className="text-on-accent font-sans font-bold ">Pause Reviews</AppText>
              </AppButton>
            </>
          )}
        </View>

        {/* HELP -- two separate doors on purpose. "Show me around" explains
            what's where and answers the questions people actually ask; setup
            re-opens the three questions that configure the app. Conflating
            them is what made the old single "Getting Started Guide" entry
            unclear about whether tapping it would change anything. */}
        <View className="bg-surface border border-line rounded-xl p-3.5" style={{ gap: 10 }}>
          <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3">Help</AppText>
          <AppButton size="lg" onPress={() => setShowTour(true)} className="w-full bg-accent rounded-xl items-center">
            <AppText variant="label" className="text-on-accent font-sans font-bold">Show me around</AppText>
          </AppButton>
          <AppButton size="md" onPress={() => setShowOnboarding(true)} className="w-full bg-surface-2 border border-line rounded-xl items-center">
            <AppText variant="label" className="text-ink-2 font-sans font-bold">Run setup again</AppText>
          </AppButton>
        </View>

        {/* ABOUT */}
        <View className="bg-surface border border-line rounded-xl p-3.5" style={{ gap: 4 }}>
          <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3">About</AppText>
          <AppText variant="label" className="font-sans text-ink-2">
            Scripture Memory v{Constants.expoConfig?.version || '—'}
          </AppText>
        </View>

        {/* SIGN OUT */}
        <AppButton size="md" onPress={signOut} className="w-full border border-line-strong rounded-xl items-center">
          <AppText variant="label" className="text-ink-2 font-sans font-bold ">Sign Out</AppText>
        </AppButton>

        {/* DANGER ZONE */}
        <View className="bg-danger-soft border border-danger/30 rounded-xl p-4" style={{ gap: 10 }}>
          <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-danger">Danger Zone</AppText>

          {!showDeleteConfirm ? (
            <AppButton size="md" onPress={() => setShowDeleteConfirm(true)} className="w-full bg-surface border border-danger/30 rounded-xl items-center">
              <AppText variant="label" className="text-danger font-sans font-bold ">Delete Account</AppText>
            </AppButton>
          ) : (
            <View style={{ gap: 8 }}>
              <AppText variant="caption" className="font-sans font-bold text-danger">
                This permanently deletes your account and all your data — verses, memory queue, recordings, and
                circle memberships. This can't be undone.
              </AppText>
              <AppText variant="micro" className="font-sans text-danger">Type DELETE to confirm:</AppText>
              <AppTextInput value={deleteConfirmText} onChangeText={setDeleteConfirmText} autoCapitalize="characters" placeholder="DELETE" className="w-full px-3 py-2 bg-surface border border-danger/30 rounded-xl font-bold text-danger" />
              {needsReauth && !isGoogleUser && (
                <>
                  <AppText variant="micro" className="font-sans text-danger">Confirm your password:</AppText>
                  <AppTextInput value={deletePassword} onChangeText={setDeletePassword} secureTextEntry placeholder="Password" className="w-full px-3 py-2 bg-surface border border-danger/30 rounded-xl text-danger" />
                </>
              )}
              <View className="flex-row gap-2 justify-end pt-1">
                <Pressable
                  onPress={resetDeleteFlow}
                  className="px-3 py-1.5 border border-line-strong rounded-lg bg-surface"
                >
                  <AppText variant="caption" className="text-ink-2 font-sans font-bold ">Cancel</AppText>
                </Pressable>
                <Pressable
                  onPress={handleDeleteAccount}
                  disabled={deleteConfirmText !== 'DELETE' || deleting || (needsReauth && !isGoogleUser && !deletePassword)}
                  className={`px-3 py-1.5 rounded-lg ${
                    deleteConfirmText !== 'DELETE' || deleting || (needsReauth && !isGoogleUser && !deletePassword)
                      ? 'bg-danger/25'
                      : 'bg-danger'
                  }`}
                >
                  <AppText variant="caption" className="text-on-accent font-sans font-bold ">
                    {deleting ? 'Deleting…' : needsReauth ? 'Confirm & Delete' : 'Delete My Account'}
                  </AppText>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}
