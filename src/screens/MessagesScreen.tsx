import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, MessageCircle } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { AvatarCircle, FadeInView } from '../components/ui';
import { AppIconButton, AppText } from '../components/design';

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
  const { dmThreads, loadingDmThreads, openDMThread, handleBack, user, friends, myChallengeBadges } = state;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 16 }}>
        <View className="flex-row items-center gap-3 border-b border-neutral-100 pb-3">
          <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={14} iconColor="#262626" onPress={handleBack} className="rounded-full border border-neutral-200 bg-white" />
          <View>
            <AppText variant="title" className="font-serif font-bold text-neutral-900 leading-none mt-0.5">Direct Messages</AppText>
          </View>
        </View>

        {!user ? (
          <AppText variant="label" className="text-neutral-400 font-sans px-1">Sign in to message friends.</AppText>
        ) : loadingDmThreads ? (
          <AppText variant="label" className="text-neutral-400 font-sans px-1">Loading conversations…</AppText>
        ) : dmThreads.length === 0 ? (
          <View className="p-6 border border-dashed border-neutral-200 rounded-2xl items-center" style={{ gap: 4 }}>
            <MessageCircle size={20} color="#a3a3a3" />
            <AppText variant="label" className="text-center text-neutral-400 font-sans mt-1">
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
                  className="flex-row items-center gap-3 border border-neutral-200 rounded-xl p-3 bg-white"
                >
                  <AvatarCircle name={thread.otherName} photoUri={thread.otherAvatarUrl || null} size={36} />
                  <View className="flex-1">
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-1">
                        <AppText variant="label" className="font-sans font-bold text-neutral-800">{thread.otherName}</AppText>
                        {hasChallenge && <AppText variant="caption">🏆</AppText>}
                      </View>
                      <AppText variant="micro" className="text-neutral-400 font-sans">{timeAgo(thread.lastMessageAt)}</AppText>
                    </View>
                    <AppText variant="caption" className="text-neutral-500 font-sans mt-0.5" numberOfLines={1} ellipsizeMode="tail">
                      {thread.lastMessage || 'Say hello 👋'}
                    </AppText>
                    {!isFriend && (
                      <AppText variant="micro" className="text-amber-600 font-sans font-bold uppercase tracking-wide mt-1">
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
