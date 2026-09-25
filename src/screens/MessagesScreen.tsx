import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, MessageCircle } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { AvatarCircle, FadeInView } from '../components/ui';
import { AppIconButton, AppText } from '../components/design';

import { useThemeColors } from '../components/theme';
function timeAgo(iso: string): string {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function MessagesScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const { dmThreads, loadingDmThreads, openDMThread, handleBack, user, friends, myChallengeBadges } = state;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 16 }}>
        <View className="flex-row items-center gap-3 border-b border-hairline pb-3">
          <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={14} iconColor={palette.ink} onPress={handleBack} className="rounded-full border border-line bg-surface" />
          <View className="flex-1">
            <AppText variant="title" className="font-serif font-bold text-ink leading-none mt-0.5">Direct Messages</AppText>
          </View>
        </View>

        {!user ? (
          <AppText variant="label" className="text-ink-3 font-sans px-1">Sign in to message friends.</AppText>
        ) : loadingDmThreads ? (
          <AppText variant="label" className="text-ink-3 font-sans px-1">Loading conversations…</AppText>
        ) : dmThreads.length === 0 ? (
          <View className="p-6 border border-dashed border-line rounded-2xl items-center" style={{ gap: 4 }}>
            <MessageCircle size={20} color={palette.ink3} />
            <AppText variant="label" className="text-center text-ink-3 font-sans mt-1">
              No conversations yet. Message a friend from their profile to start one.
            </AppText>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {dmThreads.map((thread) => {
              const isFriend = friends.some((f) => f.uid === thread.otherUid);
              const hasChallenge = myChallengeBadges.some((c) => c.dmThreadId === thread.id);
              return (
                <Pressable
                  key={thread.id}
                  onPress={() => openDMThread(thread.otherUid, thread.otherName, thread.otherAvatarUrl)}
                  className="flex-row items-center gap-3 border border-line rounded-xl p-3 bg-surface"
                >
                  <AvatarCircle name={thread.otherName} photoUri={thread.otherAvatarUrl || null} size={36} />
                  <View className="flex-1">
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-1">
                        <AppText variant="label" className="font-sans font-bold text-ink">{thread.otherName}</AppText>
                        {hasChallenge && <AppText variant="caption">🏆</AppText>}
                      </View>
                      <AppText variant="micro" className="text-ink-3 font-sans">{timeAgo(thread.lastMessageAt)}</AppText>
                    </View>
                    <AppText variant="caption" className="text-ink-3 font-sans mt-0.5" numberOfLines={1} ellipsizeMode="tail">
                      {thread.lastMessage || 'Say hello 👋'}
                    </AppText>
                    {!isFriend && (
                      <AppText variant="micro" className="text-warning font-sans font-bold uppercase tracking-wide mt-1">
                        May be read-only
                      </AppText>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </FadeInView>
  );
}
