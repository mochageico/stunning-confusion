import { ScrollView, View } from 'react-native';
import { ChevronRight, MessageCircle } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppText, useFontScale, useScaledSpace } from '../components/design';
import { Avatar, Badge, EmptyState, GroupedList, ListRow, ScreenHeader } from '../components/blocks';
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
  const scale = useFontScale();
  const space = useScaledSpace();
  const { dmThreads, loadingDmThreads, openDMThread, handleBack, user, friends, myChallengeBadges, isDMThreadUnread } = state;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader title="Messages" onBack={handleBack} backLabel="Community" />

        {!user ? (
          <AppText variant="label" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
            Sign in to message friends.
          </AppText>
        ) : loadingDmThreads ? (
          <AppText variant="label" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
            Loading conversations…
          </AppText>
        ) : dmThreads.length === 0 ? (
          <View className="bg-surface border border-line rounded-card">
            <EmptyState
              Icon={MessageCircle}
              title="No conversations yet"
              message="Message a friend from their profile to start one."
            />
          </View>
        ) : (
          <GroupedList>
            {dmThreads.map((thread) => {
              const isFriend = friends.some((f) => f.uid === thread.otherUid);
              const hasChallenge = myChallengeBadges.some((c) => c.dmThreadId === thread.id);
              // The badges drop out past 1.3x: they'd squeeze the name.
              const showBadge = scale < 1.3 && (hasChallenge || !isFriend);
              const unread = isDMThreadUnread(thread);
              const mine = thread.lastMessageFromUid === user?.uid;
              return (
                <ListRow
                  key={thread.id}
                  leading={
                    <View>
                      <Avatar name={thread.otherName} photoUri={thread.otherAvatarUrl || null} size={40} />
                      {unread ? (
                        <View
                          accessibilityLabel="Unread"
                          className="bg-accent rounded-full border-2 border-surface"
                          style={{ position: 'absolute', top: -1, right: -1, width: space(13), height: space(13) }}
                        />
                      ) : null}
                    </View>
                  }
                  title={unread ? `${thread.otherName} · new` : thread.otherName}
                  subtitle={thread.lastMessage ? `${mine ? 'You: ' : ''}${thread.lastMessage}` : 'No messages yet'}
                  subtitleLines={1}
                  value={timeAgo(thread.lastMessageAt)}
                  onPress={() => openDMThread(thread.otherUid, thread.otherName, thread.otherAvatarUrl)}
                  accessory={
                    <View className="flex-row items-center" style={{ gap: space(6) }}>
                      {showBadge && (hasChallenge ? <Badge label="Challenge" tone="accent" /> : <Badge label="May be read-only" tone="warning" />)}
                      <ChevronRight size={Math.round(18 * scale)} color={palette.ink3} strokeWidth={2.4} />
                    </View>
                  }
                />
              );
            })}
          </GroupedList>
        )}
      </ScrollView>
    </FadeInView>
  );
}
