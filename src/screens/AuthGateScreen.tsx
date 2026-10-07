import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { BookOpen } from 'lucide-react-native';

import { FadeInView, useKeyboardHeight } from '../components/ui';
import { useGoogleSignIn } from '../state/useGoogleSignIn';
import { useEmailAuth } from '../state/useEmailAuth';
import { AppState } from '../state/useAppState';
import { AppButton, AppTextInput, AppText, useFontScale, useScaledSpace } from '../components/design';
import { SegmentedControl } from '../components/blocks';
import { useThemeColors } from '../components/theme';

const AUTH_MODES = [
  { id: 'signIn' as const, label: 'Sign in' },
  { id: 'signUp' as const, label: 'Create account' },
];

// Shown instead of the whole tabbed app whenever there's no signed-in user --
// sign-in/sign-up now happens here, up front, rather than being buried in the
// Profile tab behind a guest/demo-data preview. Once auth resolves, the auth
// listener in useAppState flips `user`, this screen unmounts, and (for a
// brand-new account) the Getting Started setup takes over from App.tsx's
// normal showOnboarding overlay.
export default function AuthGateScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
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
      triggerToast('Enter a name to create your account.');
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

  const inputBox = 'bg-surface border border-line rounded-btn text-ink font-sans';
  const inputStyle = { paddingHorizontal: space(12), paddingVertical: space(12) };
  const logoSize = Math.round(64 * scale);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView
        className="flex-1 bg-canvas"
        contentContainerClassName="p-6"
        // Manual keyboard-height push, replacing KeyboardAvoidingView (see
        // useKeyboardHeight's comment) -- extra bottom padding while the
        // keyboard is up shifts this centered content upward instead of
        // letting the keyboard cover the password field.
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: space(28), paddingBottom: 24 + keyboardHeight }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="items-center" style={{ gap: space(10) }}>
          <View className="rounded-card bg-accent items-center justify-center" style={{ width: logoSize, height: logoSize }}>
            <BookOpen size={Math.round(30 * scale)} color={palette.onAccent} />
          </View>
          <AppText variant="display" className="font-sans font-bold text-ink text-center">Scripture Memory</AppText>
          <AppText variant="body" className="font-sans text-ink-2 text-center" style={{ maxWidth: 300 }}>
            Learn verses, keep them, and practice with friends.
          </AppText>
        </View>

        <View style={{ gap: space(12) }}>
          <AppButton size="lg" variant="primary" label="Continue with Google" onPress={handleGoogleSignIn} disabled={submitting} />

          {!showEmailAuth && (
            <AppButton size="lg" variant="quiet" label="Continue with email" onPress={() => setShowEmailAuth(true)} />
          )}

          {showEmailAuth && (
            <FadeInView>
              <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(12) }}>
                <SegmentedControl value={authMode} onChange={setAuthMode} options={AUTH_MODES} accessibilityLabel="Sign in or create an account" />

                {authMode === 'signUp' && (
                  <AppTextInput
                    value={displayNameInput}
                    onChangeText={setDisplayNameInput}
                    placeholder="Your name"
                    accessibilityLabel="Your name"
                    variant="body"
                    className={inputBox}
                    style={inputStyle}
                  />
                )}
                <AppTextInput
                  value={emailInput}
                  onChangeText={setEmailInput}
                  placeholder="Email"
                  accessibilityLabel="Email"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  variant="body"
                  className={inputBox}
                  style={inputStyle}
                />
                <AppTextInput
                  value={passwordInput}
                  onChangeText={setPasswordInput}
                  placeholder="Password"
                  accessibilityLabel="Password"
                  secureTextEntry
                  variant="body"
                  className={inputBox}
                  style={inputStyle}
                />

                <AppButton
                  size="lg"
                  variant="primary"
                  label={authMode === 'signUp' ? 'Create account' : 'Sign in'}
                  onPress={handleEmailAuthSubmit}
                  disabled={submitting}
                />

                {/* Sign-in only -- meaningless while creating an account.
                    Reuses whatever is already typed in the Email field rather
                    than adding a second address input. */}
                {authMode === 'signIn' && (
                  <Pressable onPress={handleForgotPassword} disabled={submitting} accessibilityRole="button" className="items-center active:opacity-60" style={{ minHeight: 44, justifyContent: 'center' }}>
                    <AppText variant="label" className="font-sans font-medium text-accent">
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
