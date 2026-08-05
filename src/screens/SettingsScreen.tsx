import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import { ArrowLeft } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { auth } from '../firebase';
import { ChipRow, FadeInView } from '../components/ui';
import { RECORDING_VISIBILITY_OPTIONS } from '../data';
import { useGoogleSignIn } from '../state/useGoogleSignIn';
import { AUDIO_CACHE_SUPPORTED, CACHE_CAP_CHOICES } from '../lib/audioCache';
import { AppText } from '../components/design';

const formatMB = (bytes: number) => {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;
  return `${mb < 10 && mb > 0 ? mb.toFixed(1) : Math.round(mb)} MB`;
};

// Profile-sharing visibility choices, shared by the Memory Plan and Memory
// Queue pickers below. 'friends' surfaces a snapshot on your member profile
// for friends only; 'private' keeps it to yourself.
const VISIBILITY_OPTIONS: Array<{ id: 'private' | 'friends'; label: string; desc: string }> = [
  { id: 'private', label: 'Private', desc: 'Only you' },
  { id: 'friends', label: 'Friends', desc: 'Your friends' },
];

// Studio mode is a playback preference, not a processing one — recordings are
// always processed server-side; this only decides which version plays back.
// Turning it off is therefore instant and non-destructive.
const STUDIO_MODE_OPTIONS: Array<{ id: string; enabled: boolean; label: string; desc: string }> = [
  { id: 'on', enabled: true, label: 'Studio', desc: 'Cleaned up' },
  { id: 'off', enabled: false, label: 'Original', desc: 'As recorded' },
];

const PAUSE_DURATIONS: { id: '1w' | '2w' | '1m' | 'indefinite'; label: string; days: number | null }[] = [
  { id: '1w', label: '1 Week', days: 7 },
  { id: '2w', label: '2 Weeks', days: 14 },
  { id: '1m', label: '1 Month', days: 30 },
  { id: 'indefinite', label: "Until I'm Back", days: null },
];

export default function SettingsScreen({ state }: { state: AppState }) {
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
    memoryPlanVisibility,
    memoryQueueVisibility,
    updateMemoryPlanVisibility,
    updateMemoryQueueVisibility,
    setShowOnboarding,
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
          <AppText variant="label" className="text-neutral-400 font-sans text-center">Sign in to access Settings.</AppText>
        </View>
      </FadeInView>
    );
  }

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 20 }}>
        {/* Header */}
        <View className="flex-row items-center gap-3 border-b border-neutral-100 pb-3">
          <Pressable
            onPress={handleBack}
            className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
          >
            <ArrowLeft size={14} color="#262626" />
          </Pressable>
          <AppText variant="title" className="font-serif font-black text-[#1A1A1A] leading-none">Settings</AppText>
        </View>

        {/* ACCOUNT */}
        <View className="bg-white border border-[#E5E5E5] rounded-xl p-4" style={{ gap: 12 }}>
          <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-neutral-400">Account</AppText>

          <View>
            <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-neutral-400 mb-1">Display Name</AppText>
            <TextInput
              defaultValue={user.displayName || ''}
              onEndEditing={(e) => {
                const val = e.nativeEvent.text.trim();
                if (val && val !== user.displayName) updateDisplayName(val);
              }}
              className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs font-bold text-neutral-800"
              placeholder="Your name"
            />
          </View>

          <View className="flex-row gap-2">
            <View className="flex-1">
              <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-neutral-400 mb-1">Email</AppText>
              <AppText variant="label" className="font-sans text-neutral-600 px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl">
                {user.email || '—'}
              </AppText>
            </View>
            <View className="flex-1">
              <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-neutral-400 mb-1">Sign-In Method</AppText>
              <AppText variant="label" className="font-sans text-neutral-600 px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl">
                {providerLabel}
              </AppText>
            </View>
          </View>
        </View>

        {/* RECORDING DEFAULTS */}
        <View className="bg-white border border-[#E5E5E5] rounded-xl p-4" style={{ gap: 10 }}>
          <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-neutral-400">
            Default Recording Visibility
          </AppText>
          <View className="flex-row gap-2">
            {RECORDING_VISIBILITY_OPTIONS.map((opt) => {
              const isSelected = (defaultRecordingVisibility || 'private') === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => updateDefaultRecordingVisibility(opt.id)}
                  className={`flex-1 py-2 rounded-lg items-center border ${
                    isSelected ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-neutral-200'
                  }`}
                >
                  <AppText variant="caption" className={`font-sans font-bold ${isSelected ? 'text-white' : 'text-neutral-600'}`}>
                    {opt.label}
                  </AppText>
                  <AppText variant="micro" className={`font-sans ${isSelected ? 'text-neutral-300' : 'text-neutral-400'}`}>
                    {opt.desc}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* STUDIO MODE */}
        <View className="bg-white border border-[#E5E5E5] rounded-xl p-4" style={{ gap: 10 }}>
          <View>
            <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-neutral-400">Studio Mode</AppText>
            <AppText variant="caption" className="text-neutral-400 font-sans mt-0.5">
              Every recitation you record is cleaned up automatically — harsh "s" sounds softened, background
              noise reduced, volume evened out. This just picks which version you hear. Your original take is
              always kept, so you can switch back any time.
            </AppText>
          </View>
          <View className="flex-row gap-2">
            {STUDIO_MODE_OPTIONS.map((opt) => {
              const isSelected = studioPlaybackEnabled === opt.enabled;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => setStudioPlaybackEnabled(opt.enabled)}
                  className={`flex-1 py-2 rounded-lg items-center border ${
                    isSelected ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-neutral-200'
                  }`}
                >
                  <AppText variant="caption" className={`font-sans font-bold ${isSelected ? 'text-white' : 'text-neutral-600'}`}>
                    {opt.label}
                  </AppText>
                  <AppText variant="micro" className={`font-sans ${isSelected ? 'text-neutral-300' : 'text-neutral-400'}`}>
                    {opt.desc}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* OFFLINE AUDIO — native only. On web the browser's own HTTP cache
            handles this, so there is nothing here for the user to manage. */}
        {AUDIO_CACHE_SUPPORTED && (
          <View className="bg-white border border-[#E5E5E5] rounded-xl p-4" style={{ gap: 10 }}>
            <View>
              <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-neutral-400">Offline Audio</AppText>
              <AppText variant="caption" className="text-neutral-400 font-sans mt-0.5">
                Recitations you play are kept on this device so they don't re-download every time — saving data and
                working without a signal. Recordings you save offline are never removed automatically.
              </AppText>
            </View>

            <View className="flex-row justify-between items-center bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2">
              <AppText variant="caption" className="font-sans text-neutral-600">
                {audioCache.map.size} recording{audioCache.map.size === 1 ? '' : 's'} on this device
              </AppText>
              <AppText variant="caption" className="font-mono font-bold text-neutral-700">
                {formatMB(audioCache.totalBytes)} / {formatMB(audioCache.capBytes)}
              </AppText>
            </View>

            <View>
              <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-neutral-400 mb-1">
                Storage Limit
              </AppText>
              <View className="flex-row gap-2">
                {CACHE_CAP_CHOICES.map((bytes) => {
                  const isSelected = audioCache.capBytes === bytes;
                  return (
                    <Pressable
                      key={bytes}
                      onPress={() => setAudioCacheCap(bytes)}
                      className={`flex-1 py-2 rounded-lg items-center border ${
                        isSelected ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-neutral-200'
                      }`}
                    >
                      <AppText variant="caption" className={`font-sans font-bold ${isSelected ? 'text-white' : 'text-neutral-600'}`} >
                        {formatMB(bytes)}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Pressable
              onPress={() => {
                if (audioCache.map.size === 0) {
                  triggerToast('Nothing stored on this device yet.');
                  return;
                }
                clearAudioDownloads();
              }}
              className="w-full py-2 rounded-lg items-center border border-neutral-200 bg-white"
            >
              <AppText variant="caption" className="font-sans font-bold text-neutral-600">Clear Downloaded Audio</AppText>
            </Pressable>
          </View>
        )}

        {/* PROFILE SHARING */}
        <View className="bg-white border border-[#E5E5E5] rounded-xl p-4" style={{ gap: 14 }}>
          <View>
            <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-neutral-400">Profile Sharing</AppText>
            <AppText variant="caption" className="text-neutral-400 font-sans mt-0.5">
              Choose what friends can see when they open your profile. Private means only you can see it.
            </AppText>
          </View>

          {/* Memory Plan visibility */}
          <View style={{ gap: 6 }}>
            <AppText variant="caption" className="font-sans font-bold text-neutral-700">Memory Plan</AppText>
            <View className="flex-row gap-2">
              {VISIBILITY_OPTIONS.map((opt) => {
                const isSelected = memoryPlanVisibility === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => updateMemoryPlanVisibility(opt.id)}
                    className={`flex-1 py-2 rounded-lg items-center border ${
                      isSelected ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-neutral-200'
                    }`}
                  >
                    <AppText variant="caption" className={`font-sans font-bold ${isSelected ? 'text-white' : 'text-neutral-600'}`}>
                      {opt.label}
                    </AppText>
                    <AppText variant="micro" className={`font-sans ${isSelected ? 'text-neutral-300' : 'text-neutral-400'}`}>
                      {opt.desc}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Memory Queue visibility */}
          <View style={{ gap: 6 }}>
            <AppText variant="caption" className="font-sans font-bold text-neutral-700">Memory Queue</AppText>
            <View className="flex-row gap-2">
              {VISIBILITY_OPTIONS.map((opt) => {
                const isSelected = memoryQueueVisibility === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => updateMemoryQueueVisibility(opt.id)}
                    className={`flex-1 py-2 rounded-lg items-center border ${
                      isSelected ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-neutral-200'
                    }`}
                  >
                    <AppText variant="caption" className={`font-sans font-bold ${isSelected ? 'text-white' : 'text-neutral-600'}`}>
                      {opt.label}
                    </AppText>
                    <AppText variant="micro" className={`font-sans ${isSelected ? 'text-neutral-300' : 'text-neutral-400'}`}>
                      {opt.desc}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        {/* NOTIFICATIONS */}
        <View className="bg-white border border-[#E5E5E5] rounded-xl p-4" style={{ gap: 10 }}>
          <View>
            <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-neutral-400">
              Accountability Notifications
            </AppText>
            <AppText variant="caption" className="text-neutral-400 font-sans mt-0.5">
              Max accountability nudges you'll receive per day, combined across all friends. A sender is told clearly if
              you've already hit this for today.
            </AppText>
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
        <View className={`border rounded-xl p-4 ${pausedAt ? 'bg-amber-50 border-amber-200' : 'bg-white border-[#E5E5E5]'}`} style={{ gap: 10 }}>
          <AppText variant="micro" className={`font-extrabold uppercase tracking-wider ${pausedAt ? 'text-amber-700' : 'text-neutral-400'}`}>
            Pause Reviews
          </AppText>

          {pausedAt ? (
            <>
              <AppText variant="caption" className="text-amber-900 font-sans leading-relaxed">
                Paused since {new Date(pausedAt).toLocaleDateString()}
                {pausedUntil ? ` -- planned return ${new Date(pausedUntil).toLocaleDateString()}` : ' -- resume manually whenever you\'re ready'}.
                Nothing is due, nothing counts as missed, and friends won't see accountability nudges reach you while
                you're away.
              </AppText>
              <Pressable
                onPress={resumeReviews}
                className="w-full py-2.5 bg-amber-600 rounded-xl items-center"
              >
                <AppText variant="label" className="text-white font-sans font-bold ">Resume Now</AppText>
              </Pressable>
            </>
          ) : (
            <>
              <AppText variant="caption" className="text-neutral-400 font-sans leading-relaxed">
                Going on a trip, or know you won't have your phone for a while? Pausing freezes your whole queue --
                nothing becomes due, and no reviews count as missed, until you resume.
              </AppText>
              <ChipRow
                value={pauseDuration}
                onChange={setPauseDuration}
                options={PAUSE_DURATIONS.map((d) => ({ id: d.id, label: d.label }))}
              />
              <Pressable
                onPress={() => {
                  const cfg = PAUSE_DURATIONS.find((d) => d.id === pauseDuration)!;
                  const untilISO = cfg.days
                    ? (() => {
                        const d = new Date();
                        d.setDate(d.getDate() + cfg.days!);
                        return d.toISOString();
                      })()
                    : null;
                  pauseReviews(untilISO);
                }}
                className="w-full py-2.5 bg-neutral-800 rounded-xl items-center"
              >
                <AppText variant="label" className="text-white font-sans font-bold ">Pause Reviews</AppText>
              </Pressable>
            </>
          )}
        </View>

        {/* GETTING STARTED */}
        <Pressable
          onPress={() => setShowOnboarding(true)}
          className="w-full py-3 bg-neutral-50 border border-neutral-200 rounded-xl items-center"
        >
          <AppText variant="label" className="text-neutral-700 font-sans font-bold ">View Getting Started Guide 🚀</AppText>
        </Pressable>

        {/* ABOUT */}
        <View className="bg-white border border-[#E5E5E5] rounded-xl p-4" style={{ gap: 4 }}>
          <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-neutral-400">About</AppText>
          <AppText variant="label" className="font-sans text-neutral-600">
            Scripture Memory v{Constants.expoConfig?.version || '—'}
          </AppText>
        </View>

        {/* SIGN OUT */}
        <Pressable
          onPress={signOut}
          className="w-full py-2.5 border border-neutral-300 rounded-xl items-center"
        >
          <AppText variant="label" className="text-neutral-700 font-sans font-bold ">Sign Out</AppText>
        </Pressable>

        {/* DANGER ZONE */}
        <View className="bg-red-50 border border-red-200 rounded-xl p-4" style={{ gap: 10 }}>
          <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-red-700">Danger Zone</AppText>

          {!showDeleteConfirm ? (
            <Pressable
              onPress={() => setShowDeleteConfirm(true)}
              className="w-full py-2.5 bg-white border border-red-300 rounded-xl items-center"
            >
              <AppText variant="label" className="text-red-600 font-sans font-bold ">Delete Account</AppText>
            </Pressable>
          ) : (
            <View style={{ gap: 8 }}>
              <AppText variant="caption" className="font-sans font-bold text-red-800">
                This permanently deletes your account and all your data — verses, memory queue, recordings, and
                circle memberships. This can't be undone.
              </AppText>
              <AppText variant="micro" className="font-sans text-red-700/80">Type DELETE to confirm:</AppText>
              <TextInput
                value={deleteConfirmText}
                onChangeText={setDeleteConfirmText}
                autoCapitalize="characters"
                placeholder="DELETE"
                className="w-full px-3 py-2 bg-white border border-red-300 rounded-xl text-xs font-bold text-red-900"
              />
              {needsReauth && !isGoogleUser && (
                <>
                  <AppText variant="micro" className="font-sans text-red-700/80">Confirm your password:</AppText>
                  <TextInput
                    value={deletePassword}
                    onChangeText={setDeletePassword}
                    secureTextEntry
                    placeholder="Password"
                    className="w-full px-3 py-2 bg-white border border-red-300 rounded-xl text-xs text-red-900"
                  />
                </>
              )}
              <View className="flex-row gap-2 justify-end pt-1">
                <Pressable
                  onPress={resetDeleteFlow}
                  className="px-3 py-1.5 border border-neutral-300 rounded-lg bg-white"
                >
                  <AppText variant="caption" className="text-neutral-600 font-sans font-bold ">Cancel</AppText>
                </Pressable>
                <Pressable
                  onPress={handleDeleteAccount}
                  disabled={deleteConfirmText !== 'DELETE' || deleting || (needsReauth && !isGoogleUser && !deletePassword)}
                  className={`px-3 py-1.5 rounded-lg ${
                    deleteConfirmText !== 'DELETE' || deleting || (needsReauth && !isGoogleUser && !deletePassword)
                      ? 'bg-red-200'
                      : 'bg-red-600'
                  }`}
                >
                  <AppText variant="caption" className="text-white font-sans font-bold ">
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
