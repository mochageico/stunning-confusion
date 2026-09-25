import { Pressable, ScrollView, View } from 'react-native';
import { MessageCircle, Plus, RefreshCw, Search, UserPlus, Users } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { AvatarCircle, FadeInView, HelpTooltip } from '../components/ui';
import { AppText } from '../components/design';

import { useThemeColors } from '../components/theme';
import { formatTimeAgo } from '../lib/format';
export default function CommunityHomeScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
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
  } = state;

  const formatEventAge = (createdAtMs: number) => formatTimeAgo(createdAtMs);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5" contentContainerStyle={{ gap: 16 }}>
        {/* Sub-view navigation. One label each: the old eyebrow-plus-title
            pair ("Find Circle" over "Search Directory") said the same thing
            twice at two sizes, which is what made this header feel inflated.
            An eyebrow earns its place only when it adds information the
            title doesn't. */}
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => setCommunitySubView('find')}
            className="flex-1 border border-line bg-surface-2 p-2.5 rounded-xl flex-row items-center justify-between"
          >
            <AppText variant="label" className="font-sans font-bold text-ink">Find Circle</AppText>
            <Search size={14} color={palette.ink3} />
          </Pressable>

          <Pressable
            onPress={() => setCommunitySubView('create')}
            className="flex-1 border border-line bg-surface-2 p-2.5 rounded-xl flex-row items-center justify-between"
          >
            <AppText variant="label" className="font-sans font-bold text-ink">Create Circle</AppText>
            <Plus size={14} color={palette.ink3} />
          </Pressable>
        </View>

        {/* List of Joined Circles */}
        <View className="gap-1.5">
          <View className="flex-row items-center px-1">
            <AppText variant="section" className="font-bold text-ink-3 tracking-wider font-sans uppercase">
              YOUR ACTIVE COMMUNITIES ({myCircles.length})
            </AppText>
            <HelpTooltip text="The scripture circles you've joined. Tap one to open its members, shared group plans, challenges, and group chat." />
          </View>

          <View className="gap-2">
            {myCircles.map((c) => {
              const role = c.ownerId === user?.uid ? 'Leader' : 'Member';
              return (
                // The badge shows your role and nothing else. It used to flip
                // to "Active Circle" for whichever circle you last opened,
                // which described app state rather than the circle -- and it
                // replaced the one genuinely useful fact (are you the leader
                // here?) with something the user hadn't asked about.
                <Pressable
                  key={c.id}
                  onPress={() => openCircle(c.id)}
                  className="w-full bg-surface border border-line rounded-2xl p-3 flex-row justify-between items-center shadow-xs"
                >
                  <View className="gap-0.5 pr-3 flex-1">
                    <View className="flex-row items-center gap-1.5">
                      <View className="px-1.5 py-0.5 rounded bg-surface-2 border border-line">
                        <AppText variant="micro" className="font-bold font-sans uppercase text-ink-2">{role}</AppText>
                      </View>
                      <View
                        className={`px-1.5 py-0.5 rounded border ${
                          c.isPublic ? 'bg-success-soft border-success/30' : 'bg-warning-soft border-warning/30'
                        }`}
                      >
                        <AppText variant="micro" className={`font-bold font-sans uppercase ${ c.isPublic ? 'text-success' : 'text-warning' }`} >
                          {c.isPublic ? 'Public' : 'Private'}
                        </AppText>
                      </View>
                    </View>
                    <AppText variant="caption" className="font-sans font-black text-ink leading-snug mt-1">{c.name}</AppText>
                  </View>
                  <Users size={16} color={palette.ink} />
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Friends -- real, mutual connections independent of circle
            membership. Same pattern as ProfileScreen's Friends section,
            surfaced here too since Community is where people look for
            other people. */}
        <View className="gap-1.5">
          <View className="flex-row items-center justify-between px-1 gap-2">
            <AppText variant="section" className="font-bold text-ink-3 tracking-wider font-sans uppercase flex-1">
              FRIENDS ({friends.length})
            </AppText>
            {/* Direct messages. This was a lone envelope button in the Profile
                header -- Profile is where you go to look at yourself, not at
                other people, and it was the only door into the DM inbox. DMs
                are 1:1 with the people in this very list, so the entry point
                sits on it. */}
            <Pressable
              onPress={() => navigateTo('messages')}
              accessibilityRole="button"
              accessibilityLabel="Messages"
              hitSlop={8}
              className="border border-line-strong rounded-lg px-2 py-1.5 shrink-0"
            >
              <MessageCircle size={14} color={palette.ink2} />
            </Pressable>
            <Pressable onPress={() => navigateTo('findFriends')} className="bg-accent px-2.5 py-1.5 rounded-lg relative flex-row items-center gap-1 shrink-0">
              <UserPlus size={11} color={palette.onAccent} />
              <AppText variant="micro" className="text-on-accent font-sans font-bold uppercase tracking-wider">Find Friends</AppText>
              {incomingFriendRequests.length > 0 && (
                <View className="absolute -top-1.5 -right-1.5 bg-danger w-4 h-4 rounded-full items-center justify-center border border-surface">
                  <AppText variant="micro" className="text-on-accent font-black">{incomingFriendRequests.length}</AppText>
                </View>
              )}
            </Pressable>
          </View>
          {friends.length === 0 ? (
            <AppText variant="caption" className="text-ink-3 font-sans italic px-1">
              No friends yet — tap Find Friends to search for people.
            </AppText>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 2 }}>
              {friends.map((f) => (
                <Pressable
                  key={f.uid}
                  onPress={() => viewMemberProfileById(f.uid)}
                  className="flex-row items-center gap-2 border border-line rounded-xl p-2 bg-surface shrink-0"
                >
                  <AvatarCircle name={f.displayName} photoUri={f.avatarUrl} size={28} />
                  <View>
                    <AppText variant="caption" className="font-bold text-ink leading-none">{f.displayName}</AppText>
                    <AppText variant="micro" className="font-sans text-ink-3 leading-none mt-0.5">View Profile</AppText>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Community Activity Feed */}
        <View className="gap-2.5">
          <View className="flex-row justify-between items-center">
            <AppText variant="section" className="font-bold text-ink-3 tracking-wider font-sans uppercase">
              RECENT GROUP FEED
            </AppText>
            <Pressable onPress={loadActivityFeed} className="flex-row items-center gap-1">
              <RefreshCw size={8} color={palette.ink} />
              <AppText variant="micro" className="font-sans font-bold uppercase text-ink">Refresh</AppText>
            </Pressable>
          </View>

          {loadingActivityEvents ? (
            <View className="py-4 items-center">
              <AppText variant="label" className="text-ink-3 font-sans">Loading activity...</AppText>
            </View>
          ) : activityEvents.length === 0 ? (
            <View className="border border-dashed border-line rounded-xl p-4 items-center">
              <AppText variant="label" className="text-ink-3 font-sans text-center">
                No milestones yet. This fills in as you or your real circle members fully memorize a verse or chapter —
                keep at it! 🌱
              </AppText>
            </View>
          ) : (
            <View className="border border-line rounded-xl p-4 bg-surface gap-3.5 shadow-sm">
              {activityEvents.map((event, idx) => (
                <View key={event.id}>
                  <View className="flex-row items-start gap-3">
                    <View
                      className={`w-2 h-2 rounded-full mt-1.5 bg-success`}
                    />
                    <View className="gap-0.5 flex-1">
                      <AppText variant="label" className="font-sans text-ink-2 leading-relaxed">
                        <AppText variant="inherit" onPress={() => viewMemberProfileById(event.uid)} className="font-black text-ink">
                          {event.uid === user?.uid ? 'You' : event.authorName}
                        </AppText>{' '}
                        {event.type === 'chapter' ? (
                          <>
                            completed memorizing the entire chapter of{' '}
                            <AppText variant="inherit" className="font-bold text-ink">
                              {event.book} {event.chapter}
                            </AppText>{' '}
                            ({event.verseCount} verses)! 👑
                          </>
                        ) : (
                          <>
                            completed memorizing{' '}
                            <AppText variant="inherit" className="font-bold text-ink">
                              {event.book} {event.chapter}:{event.verse}
                            </AppText>
                            .
                          </>
                        )}
                      </AppText>
                      <AppText variant="micro" className="text-ink-3 font-mono">
                        {formatEventAge(event.createdAtMs)}
                        {event.type === 'chapter' ? ' • Milestone Achievement' : ''}
                      </AppText>
                    </View>
                  </View>
                  {idx < activityEvents.length - 1 && <View className="border-t border-hairline mt-3.5" />}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}
