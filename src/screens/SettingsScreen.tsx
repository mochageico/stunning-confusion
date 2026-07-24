import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import { ArrowLeft } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { auth } from '../firebase';
import { ChipRow, FadeInView } from '../components/ui';
import { RECORDING_VISIBILITY_OPTIONS } from '../data';
import { useGoogleSignIn } from '../state/useGoogleSignIn';

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
          <Text className="text-xs text-neutral-400 font-sans text-center">Sign in to access Settings.</Text>
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
          <Text className="text-lg font-serif font-black text-[#1A1A1A] leading-none">Settings</Text>
        </View>

        {/* ACCOUNT */}
        <View className="bg-white border border-[#E5E5E5] rounded-xl p-4" style={{ gap: 12 }}>
          <Text className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400">Account</Text>

          <View>
            <Text className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400 mb-1">Display Name</Text>
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
              <Text className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400 mb-1">Email</Text>
              <Text className="text-xs font-sans text-neutral-600 px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl">
                {user.email || '—'}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400 mb-1">Sign-In Method</Text>
              <Text className="text-xs font-sans text-neutral-600 px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl">
                {providerLabel}
              </Text>
            </View>
          </View>
        </View>

        {/* RECORDING DEFAULTS */}
        <View className="bg-white border border-[#E5E5E5] rounded-xl p-4" style={{ gap: 10 }}>
          <Text className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400">
            Default Recording Visibility
          </Text>
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
                  <Text className={`text-[10px] font-sans font-bold ${isSelected ? 'text-white' : 'text-neutral-600'}`}>
                    {opt.label}
                  </Text>
                  <Text className={`text-[8px] font-sans ${isSelected ? 'text-neutral-300' : 'text-neutral-400'}`}>
                    {opt.desc}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* NOTIFICATIONS */}
        <View className="bg-white border border-[#E5E5E5] rounded-xl p-4" style={{ gap: 10 }}>
          <View>
            <Text className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400">
              Accountability Notifications
            </Text>
            <Text className="text-[10px] text-neutral-400 font-sans mt-0.5">
              Max accountability nudges you'll receive per day, combined across all friends. A sender is told clearly if
              you've already hit this for today.
            </Text>
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
          <Text className={`text-[9px] font-extrabold uppercase tracking-wider ${pausedAt ? 'text-amber-700' : 'text-neutral-400'}`}>
            Pause Reviews
          </Text>

          {pausedAt ? (
            <>
              <Text className="text-[11px] text-amber-900 font-sans leading-relaxed">
                Paused since {new Date(pausedAt).toLocaleDateString()}
                {pausedUntil ? ` -- planned return ${new Date(pausedUntil).toLocaleDateString()}` : ' -- resume manually whenever you\'re ready'}.
                Nothing is due, nothing counts as missed, and friends won't see accountability nudges reach you while
                you're away.
              </Text>
              <Pressable
                onPress={resumeReviews}
                className="w-full py-2.5 bg-amber-600 rounded-xl items-center"
              >
                <Text className="text-white font-sans font-bold text-xs">Resume Now</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text className="text-[10px] text-neutral-400 font-sans leading-relaxed">
                Going on a trip, or know you won't have your phone for a while? Pausing freezes your whole queue --
                nothing becomes due, and no reviews count as missed, until you resume.
              </Text>
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
                <Text className="text-white font-sans font-bold text-xs">Pause Reviews</Text>
              </Pressable>
            </>
          )}
        </View>

        {/* GETTING STARTED */}
        <Pressable
          onPress={() => setShowOnboarding(true)}
          className="w-full py-3 bg-neutral-50 border border-neutral-200 rounded-xl items-center"
        >
          <Text className="text-neutral-700 font-sans font-bold text-xs">View Getting Started Guide 🚀</Text>
        </Pressable>

        {/* ABOUT */}
        <View className="bg-white border border-[#E5E5E5] rounded-xl p-4" style={{ gap: 4 }}>
          <Text className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400">About</Text>
          <Text className="text-xs font-sans text-neutral-600">
            Scripture Memory v{Constants.expoConfig?.version || '—'}
          </Text>
        </View>

        {/* SIGN OUT */}
        <Pressable
          onPress={signOut}
          className="w-full py-2.5 border border-neutral-300 rounded-xl items-center"
        >
          <Text className="text-neutral-700 font-sans font-bold text-xs">Sign Out</Text>
        </Pressable>

        {/* DANGER ZONE */}
        <View className="bg-red-50 border border-red-200 rounded-xl p-4" style={{ gap: 10 }}>
          <Text className="text-[9px] font-extrabold uppercase tracking-wider text-red-700">Danger Zone</Text>

          {!showDeleteConfirm ? (
            <Pressable
              onPress={() => setShowDeleteConfirm(true)}
              className="w-full py-2.5 bg-white border border-red-300 rounded-xl items-center"
            >
              <Text className="text-red-600 font-sans font-bold text-xs">Delete Account</Text>
            </Pressable>
          ) : (
            <View style={{ gap: 8 }}>
              <Text className="text-[11px] font-sans font-bold text-red-800">
                This permanently deletes your account and all your data — verses, memory queue, recordings, and
                circle memberships. This can't be undone.
              </Text>
              <Text className="text-[9px] font-sans text-red-700/80">Type DELETE to confirm:</Text>
              <TextInput
                value={deleteConfirmText}
                onChangeText={setDeleteConfirmText}
                autoCapitalize="characters"
                placeholder="DELETE"
                className="w-full px-3 py-2 bg-white border border-red-300 rounded-xl text-xs font-bold text-red-900"
              />
              {needsReauth && !isGoogleUser && (
                <>
                  <Text className="text-[9px] font-sans text-red-700/80">Confirm your password:</Text>
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
                  <Text className="text-neutral-600 font-sans font-bold text-[10px]">Cancel</Text>
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
                  <Text className="text-white font-sans font-bold text-[10px]">
                    {deleting ? 'Deleting…' : needsReauth ? 'Confirm & Delete' : 'Delete My Account'}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}
