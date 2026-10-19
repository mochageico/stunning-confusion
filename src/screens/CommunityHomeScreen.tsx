import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { Award, Check, ChevronRight, MessageCircle, Plus, Search, UserPlus, Users } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppIconButton, AppText, useScaledSpace } from '../components/design';
import { Avatar, Badge, CollapsibleSection, EmptyState, GroupedList, ListRow, ScreenHeader, SectionHeader } from '../components/blocks';
import { useThemeColors } from '../components/theme';
import { formatTimeAgo } from '../lib/format';

export default function CommunityHomeScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const {
    user,
    setCommunitySubView,
    myCircles,
    openCircle,
    viewMemberProfileById,
    activityEvents,
    loadingActivityEvents,
    loadActivityFeed,
    friends,
    incomingFriendRequests,
    navigateTo,
    unreadDMCount,
    isCircleChatUnread,
    guidelinesAcceptedAt,
    requireCommunityGuidelines,
  } = state;

  // First visit: ask once for the community guidelines (App Store 1.2).
  // undefined means still loading -- don't flash the sheet.
  useEffect(() => {
    if (guidelinesAcceptedAt === null) requireCommunityGuidelines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidelinesAcceptedAt]);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        {/* The one tab that had no title. Messages sits up here because DMs
            are with the people below, and Community is where you look for
            people. */}
        <ScreenHeader
          title="Community"
          subtitle="Memorize alongside friends and circles."
          actions={
            <View>
              <AppIconButton
                Icon={MessageCircle}
                variant="outline"
                diameter={36}
                accessibilityLabel={unreadDMCount > 0 ? `Messages, ${unreadDMCount} unread` : 'Messages'}
                onPress={() => navigateTo('messages')}
              />
              {unreadDMCount > 0 ? (
                <View
                  pointerEvents="none"
                  className="bg-accent rounded-full items-center justify-center border-2 border-canvas"
                  style={{ position: 'absolute', top: -6, right: -6, minWidth: space(20), height: space(20), paddingHorizontal: space(4) }}
                >
                  <AppText variant="micro" maxScale={1.15} className="font-sans font-bold text-on-accent">
                    {unreadDMCount > 9 ? '9+' : unreadDMCount}
                  </AppText>
                </View>
              ) : null}
            </View>
          }
        />

        <View style={{ gap: space(12) }}>
          {myCircles.length === 0 ? (
            <View style={{ gap: space(6) }}>
              <SectionHeader title="Your circles" />
              <View className="bg-surface border border-line rounded-card">
                <EmptyState
                  Icon={Users}
                  title="You're not in a circle yet"
                  message="A circle is a small group that shares plans, challenges and a chat."
                  actionLabel="Find a circle"
                  onAction={() => setCommunitySubView('find')}
                />
              </View>
            </View>
          ) : (
            // The role sits under the name; it's the one fact about a circle
            // you can't tell from its title.
            <GroupedList
              header={`Your circles · ${myCircles.length}`}
              footer="Open a circle for its members, group plans, challenges and chat."
            >
              {myCircles.map((c) => (
                <ListRow
                  key={c.id}
                  Icon={Users}
                  title={c.name}
                  subtitle={`${c.ownerId === user?.uid ? 'Leader' : 'Member'} · ${c.isPublic ? 'Public' : 'Private'}`}
                  onPress={() => openCircle(c.id)}
                  accessory={
                    isCircleChatUnread(c.id) ? (
                      <View className="flex-row items-center" style={{ gap: space(6) }}>
                        <Badge label="New messages" tone="accent" />
                        <ChevronRight size={18} color={palette.ink3} strokeWidth={2.4} />
                      </View>
                    ) : undefined
                  }
                />
              ))}
            </GroupedList>
          )}

          <GroupedList>
            <ListRow Icon={Search} title="Find a circle" onPress={() => setCommunitySubView('find')} />
            <ListRow Icon={Plus} title="Create a circle" onPress={() => setCommunitySubView('create')} />
          </GroupedList>
        </View>

        <CollapsibleSection
          storageKey="community.friends"
          title={`Friends · ${friends.length}`}
          actionLabel="Find friends"
          onAction={() => navigateTo('findFriends')}
        >
          {friends.length === 0 && incomingFriendRequests.length === 0 ? (
            <View className="bg-surface border border-line rounded-card">
              <EmptyState
                Icon={UserPlus}
                title="No friends yet"
                message="Friends can see how you're doing and send you nudges."
                actionLabel="Find friends"
                onAction={() => navigateTo('findFriends')}
              />
            </View>
          ) : (
            <GroupedList>
              {incomingFriendRequests.length > 0 && (
                <ListRow
                  key="requests"
                  Icon={UserPlus}
                  title="Friend requests"
                  onPress={() => navigateTo('findFriends')}
                  accessory={
                    <View className="flex-row items-center" style={{ gap: space(6) }}>
                      <Badge label={`${incomingFriendRequests.length} new`} tone="accent" />
                      <ChevronRight size={18} color={palette.ink3} strokeWidth={2.4} />
                    </View>
                  }
                />
              )}
              {friends.map((f) => (
                <ListRow
                  key={f.uid}
                  leading={<Avatar name={f.displayName} photoUri={f.avatarUrl} size={36} />}
                  title={f.displayName}
                  onPress={() => viewMemberProfileById(f.uid)}
                />
              ))}
            </GroupedList>
          )}
        </CollapsibleSection>

        <CollapsibleSection storageKey="community.milestones" title="Recent milestones" actionLabel="Refresh" onAction={loadActivityFeed}>
          {loadingActivityEvents ? (
            <AppText variant="label" className="font-sans text-ink-3 text-center" style={{ paddingVertical: space(24) }}>
              Loading…
            </AppText>
          ) : activityEvents.length === 0 ? (
            <View className="bg-surface border border-line rounded-card">
              <EmptyState
                Icon={Award}
                title="No milestones yet"
                message="When you or people in your circles finish memorizing a verse or chapter, it shows up here."
              />
            </View>
          ) : (
            <GroupedList>
              {activityEvents.map((event) => {
                const who = event.uid === user?.uid ? 'You' : event.authorName;
                const isChapter = event.type === 'chapter';
                return (
                  <ListRow
                    key={event.id}
                    Icon={isChapter ? Award : Check}
                    title={
                      isChapter
                        ? `${who} memorized ${event.book} ${event.chapter}`
                        : `${who} memorized ${event.book} ${event.chapter}:${event.verse}`
                    }
                    subtitle={`${isChapter ? `Whole chapter, ${event.verseCount} verses · ` : ''}${formatTimeAgo(event.createdAtMs)}`}
                    onPress={() => viewMemberProfileById(event.uid)}
                    accessory="none"
                  />
                );
              })}
            </GroupedList>
          )}
        </CollapsibleSection>
      </ScrollView>
    </FadeInView>
  );
}
