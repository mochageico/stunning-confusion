import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { BookOpen } from 'lucide-react-native';

import { FadeInView, useKeyboardHeight } from '../components/ui';
import { useGoogleSignIn } from '../state/useGoogleSignIn';
import { useEmailAuth } from '../state/useEmailAuth';
import { AppState } from '../state/useAppState';
import { AppButton, AppTextInput, AppText } from '../components/design';

import { useThemeColors } from '../components/theme';
// Shown instead of the whole tabbed app whenever there's no signed-in user --
// sign-in/sign-up now happens here, up front, rather than being buried in the
// Profile tab behind a guest/demo-data preview. Once auth resolves, the auth
// listener in useAppState flips `user`, this screen unmounts, and (for a
// brand-new account) the four-step Getting Started guide takes over from
// App.tsx's normal showOnboarding overlay.
export default function AuthGateScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const { triggerToast } = state;
  const { signInWithGoogle } = useGoogleSignIn();
  const { signUp, signIn, resetPassword } = useEmailAuth();

  const [showEmailAuth, setShowEmailAuth] = useState(false);
  const [authMode, setAuthMode] = useState<'signIn' | 'signUp'>('signIn');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const keyboardHeight = useKeyboardHeight();

  const handleGoogleSignIn = async () => {
    setSubmitting(true);
    const result = await signInWithGoogle();
    setSubmitting(false);
    if (!result.ok) {
      triggerToast(result.message);
    }
  };

  const handleEmailAuthSubmit = async () => {
    if (authMode === 'signUp' && !displayNameInput.trim()) {
      triggerToast('Enter a display name to create your account.');
      return;
    }
    if (!emailInput.trim() || !passwordInput) {
      triggerToast('Enter an email and password.');
      return;
    }
    setSubmitting(true);
    const result =
      authMode === 'signUp' ? await signUp(emailInput, passwordInput, displayNameInput) : await signIn(emailInput, passwordInput);
    setSubmitting(false);
    if (!result.ok) {
      triggerToast(result.message);
    }
  };

  const handleForgotPassword = async () => {
    setSubmitting(true);
    const result = await resetPassword(emailInput);
    setSubmitting(false);
    triggerToast(
      result.ok
        ? `If an account exists for ${emailInput.trim()}, a reset link is on its way. Check your inbox and spam folder.`
        : result.message
    );
  };

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView
        className="flex-1 bg-canvas"
        contentContainerClassName="p-6"
        // Manual keyboard-height push, replacing KeyboardAvoidingView (see
        // useKeyboardHeight's comment) -- extra bottom padding while the
        // keyboard is up shifts this centered content upward instead of
        // letting the keyboard cover the password field.
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: 24, paddingBottom: 24 + keyboardHeight }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="items-center" style={{ gap: 8 }}>
          <View className="w-14 h-14 rounded-2xl bg-accent items-center justify-center">
            <BookOpen size={26} color={palette.onAccent} />
          </View>
          <AppText variant="display" className="font-serif font-black text-ink text-center">Scripture Memory</AppText>
          <AppText variant="label" className="font-sans text-ink-3 text-center leading-relaxed max-w-[280px]">
            Sign in or create an account to start memorizing scripture and syncing your progress.
          </AppText>
        </View>

        <View style={{ gap: 12 }}>
          <AppButton size="lg" onPress={handleGoogleSignIn} disabled={submitting} className="w-full border-2 border-ink rounded-xl items-center">
            <AppText variant="label" className="text-ink font-sans font-bold uppercase tracking-wider">
              Continue with Google
            </AppText>
          </AppButton>

          <Pressable onPress={() => setShowEmailAuth(!showEmailAuth)}>
            <AppText variant="caption" className="font-sans font-bold underline text-ink-3 text-center">
              {showEmailAuth ? 'Hide email sign-in' : 'Or use email instead'}
            </AppText>
          </Pressable>

          {showEmailAuth && (
            <FadeInView>
              <View className="border border-line rounded-xl p-4" style={{ gap: 10 }}>
                <View className="flex-row gap-2">
                  <AppButton size="md" onPress={() => setAuthMode('signIn')} className={`flex-1 rounded-lg border items-center ${ authMode === 'signIn' ? 'bg-accent border-accent' : 'bg-surface border-line' }`}>
                    <AppText variant="caption" className={`font-sans font-bold uppercase ${authMode === 'signIn' ? 'text-on-accent' : 'text-ink-3'}`}>
                      Sign In
                    </AppText>
                  </AppButton>
                  <AppButton size="md" onPress={() => setAuthMode('signUp')} className={`flex-1 rounded-lg border items-center ${ authMode === 'signUp' ? 'bg-accent border-accent' : 'bg-surface border-line' }`}>
                    <AppText variant="caption" className={`font-sans font-bold uppercase ${authMode === 'signUp' ? 'text-on-accent' : 'text-ink-3'}`}>
                      Create Account
                    </AppText>
                  </AppButton>
                </View>

                {authMode === 'signUp' && (
                  <AppTextInput value={displayNameInput} onChangeText={setDisplayNameInput} placeholder="Display name" className="w-full px-3 py-2.5 bg-surface border border-line-strong rounded-xl" />
                )}
                <AppTextInput value={emailInput} onChangeText={setEmailInput} placeholder="Email" autoCapitalize="none" keyboardType="email-address" className="w-full px-3 py-2.5 bg-surface border border-line-strong rounded-xl" />
                <AppTextInput value={passwordInput} onChangeText={setPasswordInput} placeholder="Password" secureTextEntry className="w-full px-3 py-2.5 bg-surface border border-line-strong rounded-xl" />

                <AppButton size="md" onPress={handleEmailAuthSubmit} disabled={submitting} className="w-full bg-accent rounded-xl items-center">
                  <AppText variant="section" className="text-on-accent font-sans font-bold uppercase tracking-wider">
                    {authMode === 'signUp' ? 'Create Account' : 'Sign In'}
                  </AppText>
                </AppButton>

                {/* Sign-in only -- meaningless while creating an account.
                    Reuses whatever is already typed in the Email field rather
                    than adding a second address input. */}
                {authMode === 'signIn' && (
                  <Pressable onPress={handleForgotPassword} disabled={submitting} className="items-center pt-0.5">
                    <AppText variant="caption" className="font-sans font-bold underline text-ink-3">
                      Forgot your password?
                    </AppText>
                  </Pressable>
                )}
              </View>
            </FadeInView>
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}
