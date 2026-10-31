import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Award, Check, ChevronRight, MessageCircle, Plus, UserPlus, Users } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppIconButton, AppText, useScaledSpace } from '../components/design';
import { Avatar, Badge, CollapsibleSection, EmptyState, GroupedList, ListRow, ScreenHeader } from '../components/blocks';
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
    refreshCommunity,
  } = state;
  const [refreshing, setRefreshing] = useState(false);

  // First visit: ask once for the community guidelines (App Store 1.2).
  // undefined means still loading -- don't flash the sheet.
  useEffect(() => {
    if (guidelinesAcceptedAt === null) requireCommunityGuidelines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidelinesAcceptedAt]);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView
        className="flex-1 bg-canvas"
        contentContainerClassName="p-5 pb-12"
        contentContainerStyle={{ gap: space(20) }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={palette.ink3}
            onRefresh={() => {
              setRefreshing(true);
              refreshCommunity().finally(() => setRefreshing(false));
            }}
          />
        }
      >
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


        {/* Circles as a swipe row of cards: a circle is a place you go, so each
            one gets a card instead of a list row, and "new circle" is the last
            card in the row. */}
        <CollapsibleSection
          storageKey="community.circles"
          title={`Your circles · ${myCircles.length}`}
          actionLabel="Find circles"
          onAction={() => setCommunitySubView('find')}
        >
          {myCircles.length === 0 ? (
            <View className="bg-surface border border-line rounded-card">
              <EmptyState
                Icon={Users}
                title="You're not in a circle yet"
                message="A circle is a small group that shares plans, challenges and a chat."
                actionLabel="Find circles"
                onAction={() => setCommunitySubView('find')}
              />
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -20 }}
              contentContainerStyle={{ paddingHorizontal: 20, gap: space(10) }}
            >
              {myCircles.map((c) => {
                const unread = isCircleChatUnread(c.id);
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => openCircle(c.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${c.name}${unread ? ', new messages' : ''}`}
                    className="bg-surface border border-line rounded-card active:bg-surface-2 justify-between"
                    style={{ width: space(168), minHeight: space(112), padding: space(14), gap: space(10) }}
                  >
                    <View style={{ gap: space(2) }}>
                      <AppText variant="body" numberOfLines={2} className="font-sans font-semibold text-ink">
                        {c.name}
                      </AppText>
                      <AppText variant="caption" className="font-sans text-ink-3">
                        {c.ownerId === user?.uid ? 'Leader' : 'Member'} · {c.isPublic ? 'Public' : 'Private'}
                      </AppText>
                    </View>
                    {unread ? <Badge label="New messages" tone="accent" /> : null}
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => setCommunitySubView('create')}
                accessibilityRole="button"
                accessibilityLabel="Create a circle"
                className="border border-dashed border-line rounded-card items-center justify-center active:bg-surface-2"
                style={{ width: space(120), minHeight: space(112), padding: space(14), gap: space(6) }}
              >
                <Plus size={22} color={palette.accent} strokeWidth={2.4} />
                <AppText variant="caption" className="font-sans font-semibold text-accent text-center">
                  New circle
                </AppText>
              </Pressable>
            </ScrollView>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          storageKey="community.friends"
          title={`Friends · ${friends.length}`}
          actionLabel="Add friends"
          onAction={() => navigateTo('findFriends')}
        >
          {incomingFriendRequests.length > 0 && (
            <GroupedList>
              <ListRow
                Icon={UserPlus}
                title={incomingFriendRequests.length === 1 ? '1 friend request' : `${incomingFriendRequests.length} friend requests`}
                onPress={() => navigateTo('findFriends')}
                accessory={
                  <View className="flex-row items-center" style={{ gap: space(6) }}>
                    <Badge label="New" tone="accent" />
                    <ChevronRight size={18} color={palette.ink3} strokeWidth={2.4} />
                  </View>
                }
              />
            </GroupedList>
          )}
          {friends.length === 0 ? (
            incomingFriendRequests.length === 0 ? (
              <View className="bg-surface border border-line rounded-card">
                <EmptyState
                  Icon={UserPlus}
                  title="No friends yet"
                  message="Friends can see how you're doing and send you nudges."
                  actionLabel="Add friends"
                  onAction={() => navigateTo('findFriends')}
                />
              </View>
            ) : null
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -20 }}
              contentContainerStyle={{ paddingHorizontal: 20, gap: space(14) }}
            >
              {friends.map((f) => (
                <Pressable
                  key={f.uid}
                  onPress={() => viewMemberProfileById(f.uid)}
                  accessibilityRole="button"
                  accessibilityLabel={f.displayName}
                  className="items-center active:opacity-60"
                  style={{ width: space(64), gap: space(6) }}
                >
                  <Avatar name={f.displayName} photoUri={f.avatarUrl} size={52} />
                  <AppText variant="caption" numberOfLines={1} className="font-sans text-ink-2 text-center">
                    {f.displayName.split(' ')[0]}
                  </AppText>
                </Pressable>
              ))}
            </ScrollView>
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
