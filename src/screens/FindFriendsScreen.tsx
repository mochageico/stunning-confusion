import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, Check, UserPlus, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppButton, AppIconButton, AppTextInput, AppText } from '../components/design';

import { useThemeColors } from '../components/theme';
export default function FindFriendsScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const {
    handleBack,
    userSearchQuery,
    setUserSearchQuery,
    userSearchResults,
    searchingUsers,
    searchUsers,
    friends,
    incomingFriendRequests,
    outgoingFriendRequests,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    cancelFriendRequest,
    viewMemberProfileById,
  } = state;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5" contentContainerStyle={{ gap: 16 }}>
        {/* Header with back */}
        <View className="flex-row items-center gap-3 border-b border-hairline pb-3">
          <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={14} iconColor={palette.ink} onPress={handleBack} className="rounded-full border border-line bg-surface" />
          <View className="flex-1">
            <AppText variant="title" className="font-serif font-black text-ink leading-none mt-1">
              Search People
            </AppText>
          </View>
        </View>

        {/* Incoming Requests. Names tap through to the sender's profile so you
            can see who they are before deciding -- previously the only thing
            on offer was a bare name and two buttons. */}
        {incomingFriendRequests.length > 0 && (
          <View className="gap-2">
            <AppText variant="section" className="font-bold text-ink-3 tracking-wider font-sans uppercase">
              INCOMING REQUESTS ({incomingFriendRequests.length})
            </AppText>
            <View className="gap-2">
              {incomingFriendRequests.map((req) => (
                <View
                  key={req.id}
                  className="border border-line rounded-xl p-3 bg-surface flex-row items-center justify-between"
                >
                  <Pressable className="flex-1 pr-2" onPress={() => viewMemberProfileById(req.fromUid)}>
                    <AppText variant="label" className="font-sans font-bold text-ink">{req.fromName}</AppText>
                    <AppText variant="micro" className="font-sans text-ink-3">Wants to be friends — tap to view</AppText>
                  </Pressable>
                  <View className="flex-row gap-1.5">
                    <AppIconButton Icon={Check} diameter={28} iconSize={13} iconColor={palette.onAccent} onPress={() => acceptFriendRequest(req)} className="rounded-full bg-success" />
                    <AppIconButton Icon={X} diameter={28} iconSize={13} iconColor={palette.ink2} onPress={() => declineFriendRequest(req)} className="rounded-full bg-surface-2 border border-line" />
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Outgoing Requests -- these existed in state all along but were only
            ever visible as inline status on a search result, so a request sent
            and then navigated away from became invisible: no way to see who
            you were waiting on, and no way to cancel without re-finding them
            by search. */}
        {outgoingFriendRequests.length > 0 && (
          <View className="gap-2">
            <AppText variant="section" className="font-bold text-ink-3 tracking-wider font-sans uppercase">
              SENT REQUESTS ({outgoingFriendRequests.length})
            </AppText>
            <View className="gap-2">
              {outgoingFriendRequests.map((req) => (
                <View
                  key={req.id}
                  className="border border-line rounded-xl p-3 bg-surface-2 flex-row items-center justify-between"
                >
                  <Pressable className="flex-1 pr-2" onPress={() => viewMemberProfileById(req.toUid)}>
                    <AppText variant="label" className="font-sans font-bold text-ink-2">{req.toName}</AppText>
                    <AppText variant="micro" className="font-sans text-ink-3">Waiting for them to accept</AppText>
                  </Pressable>
                  <Pressable
                    onPress={() => cancelFriendRequest(req)}
                    className="bg-surface border border-line-strong px-2.5 py-1 rounded-lg"
                  >
                    <AppText variant="micro" className="font-bold uppercase tracking-wider text-ink-2">Cancel</AppText>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Search box */}
        <View className="gap-2">
          <AppText variant="section" className="font-bold text-ink-3 tracking-wider font-sans uppercase">
            SEARCH BY NAME OR EMAIL
          </AppText>
          <View className="flex-row gap-2">
            <AppTextInput value={userSearchQuery} onChangeText={setUserSearchQuery} onSubmitEditing={() => searchUsers(userSearchQuery)} placeholder="e.g. Jane or jane@example.com" autoCapitalize="none" className="flex-1 px-3 py-2 bg-surface border border-line-strong rounded-xl" />
            <AppButton size="md" onPress={() => searchUsers(userSearchQuery)} className="bg-accent rounded-xl items-center justify-center">
              <AppText variant="label" className="text-on-accent font-bold">Search</AppText>
            </AppButton>
          </View>
        </View>

        {/* Results */}
        <View className="gap-2">
          {searchingUsers ? (
            <View className="py-4 items-center">
              <AppText variant="label" className="text-ink-3 font-sans">Searching...</AppText>
            </View>
          ) : userSearchResults.length === 0 ? (
            <View className="items-center p-6 border border-dashed border-line rounded-2xl">
              <AppText variant="label" className="text-ink-3 text-center">
                Search by exact email, or the start of someone's name.
              </AppText>
            </View>
          ) : (
            userSearchResults.map((person) => {
              const isFriend = friends.some((f) => f.uid === person.uid);
              const outgoing = outgoingFriendRequests.find((r) => r.toUid === person.uid);
              const incoming = incomingFriendRequests.find((r) => r.fromUid === person.uid);
              return (
                <View
                  key={person.uid}
                  className="border border-line rounded-xl p-3 bg-surface flex-row items-center justify-between"
                >
                  <Pressable className="flex-1 pr-2" onPress={() => viewMemberProfileById(person.uid)}>
                    <AppText variant="label" className="font-sans font-bold text-ink">{person.displayName}</AppText>
                    {!!person.email && <AppText variant="micro" className="font-sans text-ink-3">{person.email}</AppText>}
                  </Pressable>

                  {isFriend ? (
                    <View className="bg-success-soft border border-success/30 px-2.5 py-1 rounded-lg">
                      <AppText variant="micro" className="font-bold uppercase tracking-wider text-success">Friends</AppText>
                    </View>
                  ) : incoming ? (
                    <View className="flex-row gap-1.5">
                      <AppIconButton Icon={Check} diameter={28} iconSize={13} iconColor={palette.onAccent} onPress={() => acceptFriendRequest(incoming)} className="rounded-full bg-success" />
                      <AppIconButton Icon={X} diameter={28} iconSize={13} iconColor={palette.ink2} onPress={() => declineFriendRequest(incoming)} className="rounded-full bg-surface-2 border border-line" />
                    </View>
                  ) : outgoing ? (
                    <Pressable
                      onPress={() => cancelFriendRequest(outgoing)}
                      className="bg-surface-2 border border-line px-2.5 py-1 rounded-lg"
                    >
                      <AppText variant="micro" className="font-bold uppercase tracking-wider text-ink-2">
                        Request Sent — Cancel
                      </AppText>
                    </Pressable>
                  ) : (
                    <AppButton size="sm" onPress={() => sendFriendRequest(person.uid, person.displayName)} className="bg-accent rounded-lg flex-row items-center gap-1">
                      <UserPlus size={11} color={palette.onAccent} />
                      <AppText variant="micro" className="font-bold uppercase tracking-wider text-on-accent">Add Friend</AppText>
                    </AppButton>
                  )}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}
