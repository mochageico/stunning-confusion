import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { BookOpen } from 'lucide-react-native';

import { FadeInView, useKeyboardHeight } from '../components/ui';
import { useGoogleSignIn } from '../state/useGoogleSignIn';
import { useEmailAuth } from '../state/useEmailAuth';
import { AppState } from '../state/useAppState';

// Shown instead of the whole tabbed app whenever there's no signed-in user --
// sign-in/sign-up now happens here, up front, rather than being buried in the
// Profile tab behind a guest/demo-data preview. Once auth resolves, the auth
// listener in useAppState flips `user`, this screen unmounts, and (for a
// brand-new account) the four-step Getting Started guide takes over from
// App.tsx's normal showOnboarding overlay.
export default function AuthGateScreen({ state }: { state: AppState }) {
  const { triggerToast } = state;
  const { signInWithGoogle } = useGoogleSignIn();
  const { signUp, signIn } = useEmailAuth();

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

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView
        className="flex-1 bg-white"
        contentContainerClassName="p-6"
        // Manual keyboard-height push, replacing KeyboardAvoidingView (see
        // useKeyboardHeight's comment) -- extra bottom padding while the
        // keyboard is up shifts this centered content upward instead of
        // letting the keyboard cover the password field.
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: 24, paddingBottom: 24 + keyboardHeight }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="items-center" style={{ gap: 8 }}>
          <View className="w-14 h-14 rounded-2xl bg-[#1A1A1A] items-center justify-center">
            <BookOpen size={26} color="#FFFFFF" />
          </View>
          <Text className="text-2xl font-serif font-black text-[#1A1A1A] text-center">Scripture Memory</Text>
          <Text className="text-xs font-sans text-neutral-500 text-center leading-relaxed max-w-[280px]">
            Sign in or create an account to start memorizing scripture and syncing your progress.
          </Text>
        </View>

        <View style={{ gap: 12 }}>
          <Pressable
            onPress={handleGoogleSignIn}
            disabled={submitting}
            className="w-full py-3 border-2 border-[#1A1A1A] rounded-xl items-center"
          >
            <Text className="text-[#1A1A1A] font-sans font-bold text-xs uppercase tracking-wider">
              Continue with Google
            </Text>
          </Pressable>

          <Pressable onPress={() => setShowEmailAuth(!showEmailAuth)}>
            <Text className="text-[11px] font-sans font-bold underline text-neutral-500 text-center">
              {showEmailAuth ? 'Hide email sign-in' : 'Or use email instead'}
            </Text>
          </Pressable>

          {showEmailAuth && (
            <FadeInView>
              <View className="border border-neutral-200 rounded-xl p-4" style={{ gap: 10 }}>
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => setAuthMode('signIn')}
                    className={`flex-1 py-2 rounded-lg border items-center ${
                      authMode === 'signIn' ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-neutral-200'
                    }`}
                  >
                    <Text className={`text-[10px] font-sans font-bold uppercase ${authMode === 'signIn' ? 'text-white' : 'text-neutral-500'}`}>
                      Sign In
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setAuthMode('signUp')}
                    className={`flex-1 py-2 rounded-lg border items-center ${
                      authMode === 'signUp' ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-neutral-200'
                    }`}
                  >
                    <Text className={`text-[10px] font-sans font-bold uppercase ${authMode === 'signUp' ? 'text-white' : 'text-neutral-500'}`}>
                      Create Account
                    </Text>
                  </Pressable>
                </View>

                {authMode === 'signUp' && (
                  <TextInput
                    value={displayNameInput}
                    onChangeText={setDisplayNameInput}
                    placeholder="Display name"
                    className="w-full px-3 py-2.5 bg-white border border-neutral-300 rounded-xl text-xs"
                  />
                )}
                <TextInput
                  value={emailInput}
                  onChangeText={setEmailInput}
                  placeholder="Email"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  className="w-full px-3 py-2.5 bg-white border border-neutral-300 rounded-xl text-xs"
                />
                <TextInput
                  value={passwordInput}
                  onChangeText={setPasswordInput}
                  placeholder="Password"
                  secureTextEntry
                  className="w-full px-3 py-2.5 bg-white border border-neutral-300 rounded-xl text-xs"
                />

                <Pressable
                  onPress={handleEmailAuthSubmit}
                  disabled={submitting}
                  className="w-full py-2.5 bg-[#1A1A1A] rounded-xl items-center"
                >
                  <Text className="text-white font-sans font-bold text-[11px] uppercase tracking-wider">
                    {authMode === 'signUp' ? 'Create Account' : 'Sign In'}
                  </Text>
                </Pressable>
              </View>
            </FadeInView>
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}
