import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, MessageCircle } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { AvatarCircle, FadeInView } from '../components/ui';

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
  const { dmThreads, loadingDmThreads, openDMThread, handleBack, user, friends } = state;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 16 }}>
        <View className="flex-row items-center gap-3 border-b border-neutral-100 pb-3">
          <Pressable
            onPress={handleBack}
            className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
          >
            <ArrowLeft size={14} color="#262626" />
          </Pressable>
          <View>
            <Text className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">Messages</Text>
            <Text className="text-base font-serif font-bold text-neutral-900 leading-none mt-0.5">Direct Messages</Text>
          </View>
        </View>

        {!user ? (
          <Text className="text-xs text-neutral-400 font-sans px-1">Sign in to message friends.</Text>
        ) : loadingDmThreads ? (
          <Text className="text-xs text-neutral-400 font-sans px-1">Loading conversations…</Text>
        ) : dmThreads.length === 0 ? (
          <View className="p-6 border border-dashed border-neutral-200 rounded-2xl items-center" style={{ gap: 4 }}>
            <MessageCircle size={20} color="#a3a3a3" />
            <Text className="text-center text-xs text-neutral-400 font-sans mt-1">
              No conversations yet. Message a friend from their profile to start one.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {dmThreads.map((thread) => {
              const isFriend = friends.some((f) => f.uid === thread.otherUid);
              return (
                <Pressable
                  key={thread.id}
                  onPress={() => openDMThread(thread.otherUid, thread.otherName, thread.otherAvatarUrl)}
                  className="flex-row items-center gap-3 border border-neutral-200 rounded-xl p-3 bg-white"
                >
                  <AvatarCircle name={thread.otherName} photoUri={thread.otherAvatarUrl || null} size={36} />
                  <View className="flex-1">
                    <View className="flex-row items-center justify-between">
                      <Text className="text-xs font-sans font-bold text-neutral-800">{thread.otherName}</Text>
                      <Text className="text-[9px] text-neutral-400 font-sans">{timeAgo(thread.lastMessageAt)}</Text>
                    </View>
                    <Text className="text-[10px] text-neutral-500 font-sans mt-0.5" numberOfLines={1} ellipsizeMode="tail">
                      {thread.lastMessage || 'Say hello 👋'}
                    </Text>
                    {!isFriend && (
                      <Text className="text-[8px] text-amber-600 font-sans font-bold uppercase tracking-wide mt-1">
                        May be read-only
                      </Text>
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
