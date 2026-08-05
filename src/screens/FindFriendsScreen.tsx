import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Check, UserPlus, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppText } from '../components/design';

export default function FindFriendsScreen({ state }: { state: AppState }) {
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
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5" contentContainerStyle={{ gap: 16 }}>
        {/* Header with back */}
        <View className="flex-row items-center gap-3 border-b border-neutral-100 pb-3">
          <Pressable
            onPress={handleBack}
            className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
          >
            <ArrowLeft size={14} color="#262626" />
          </Pressable>
          <View>
            <AppText variant="micro" className="uppercase tracking-wider font-extrabold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-sans">
              FIND FRIENDS
            </AppText>
            <AppText variant="title" className="font-serif font-black text-neutral-900 leading-none mt-1">
              Search People
            </AppText>
          </View>
        </View>

        {/* Incoming Requests. Names tap through to the sender's profile so you
            can see who they are before deciding -- previously the only thing
            on offer was a bare name and two buttons. */}
        {incomingFriendRequests.length > 0 && (
          <View className="gap-2">
            <AppText variant="section" className="font-bold text-neutral-400 tracking-wider font-sans uppercase">
              INCOMING REQUESTS ({incomingFriendRequests.length})
            </AppText>
            <View className="gap-2">
              {incomingFriendRequests.map((req) => (
                <View
                  key={req.id}
                  className="border border-neutral-200 rounded-xl p-3 bg-white flex-row items-center justify-between"
                >
                  <Pressable className="flex-1 pr-2" onPress={() => viewMemberProfileById(req.fromUid)}>
                    <AppText variant="label" className="font-sans font-bold text-neutral-800">{req.fromName}</AppText>
                    <AppText variant="micro" className="font-sans text-neutral-400">Wants to be friends — tap to view</AppText>
                  </Pressable>
                  <View className="flex-row gap-1.5">
                    <Pressable
                      onPress={() => acceptFriendRequest(req)}
                      className="w-7 h-7 rounded-full bg-emerald-600 items-center justify-center"
                    >
                      <Check size={13} color="#FFFFFF" />
                    </Pressable>
                    <Pressable
                      onPress={() => declineFriendRequest(req)}
                      className="w-7 h-7 rounded-full bg-neutral-100 border border-neutral-200 items-center justify-center"
                    >
                      <X size={13} color="#525252" />
                    </Pressable>
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
            <AppText variant="section" className="font-bold text-neutral-400 tracking-wider font-sans uppercase">
              SENT REQUESTS ({outgoingFriendRequests.length})
            </AppText>
            <View className="gap-2">
              {outgoingFriendRequests.map((req) => (
                <View
                  key={req.id}
                  className="border border-neutral-200 rounded-xl p-3 bg-neutral-50 flex-row items-center justify-between"
                >
                  <Pressable className="flex-1 pr-2" onPress={() => viewMemberProfileById(req.toUid)}>
                    <AppText variant="label" className="font-sans font-bold text-neutral-700">{req.toName}</AppText>
                    <AppText variant="micro" className="font-sans text-neutral-400">Waiting for them to accept</AppText>
                  </Pressable>
                  <Pressable
                    onPress={() => cancelFriendRequest(req)}
                    className="bg-white border border-neutral-300 px-2.5 py-1 rounded-lg"
                  >
                    <AppText variant="micro" className="font-bold uppercase tracking-wider text-neutral-600">Cancel</AppText>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Search box */}
        <View className="gap-2">
          <AppText variant="section" className="font-bold text-neutral-400 tracking-wider font-sans uppercase">
            SEARCH BY NAME OR EMAIL
          </AppText>
          <View className="flex-row gap-2">
            <TextInput
              value={userSearchQuery}
              onChangeText={setUserSearchQuery}
              onSubmitEditing={() => searchUsers(userSearchQuery)}
              placeholder="e.g. Jane or jane@example.com"
              autoCapitalize="none"
              className="flex-1 px-3 py-2 bg-white border border-neutral-300 rounded-xl text-xs"
            />
            <Pressable
              onPress={() => searchUsers(userSearchQuery)}
              className="px-4 py-2 bg-[#1A1A1A] rounded-xl items-center justify-center"
            >
              <AppText variant="label" className="text-white font-bold">Search</AppText>
            </Pressable>
          </View>
        </View>

        {/* Results */}
        <View className="gap-2">
          {searchingUsers ? (
            <View className="py-4 items-center">
              <AppText variant="label" className="text-neutral-400 font-sans">Searching...</AppText>
            </View>
          ) : userSearchResults.length === 0 ? (
            <View className="items-center p-6 border border-dashed border-neutral-200 rounded-2xl">
              <AppText variant="label" className="text-neutral-400 text-center">
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
                  className="border border-neutral-200 rounded-xl p-3 bg-white flex-row items-center justify-between"
                >
                  <Pressable className="flex-1 pr-2" onPress={() => viewMemberProfileById(person.uid)}>
                    <AppText variant="label" className="font-sans font-bold text-neutral-800">{person.displayName}</AppText>
                    {!!person.email && <AppText variant="micro" className="font-sans text-neutral-400">{person.email}</AppText>}
                  </Pressable>

                  {isFriend ? (
                    <View className="bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                      <AppText variant="micro" className="font-bold uppercase tracking-wider text-emerald-700">Friends</AppText>
                    </View>
                  ) : incoming ? (
                    <View className="flex-row gap-1.5">
                      <Pressable
                        onPress={() => acceptFriendRequest(incoming)}
                        className="w-7 h-7 rounded-full bg-emerald-600 items-center justify-center"
                      >
                        <Check size={13} color="#FFFFFF" />
                      </Pressable>
                      <Pressable
                        onPress={() => declineFriendRequest(incoming)}
                        className="w-7 h-7 rounded-full bg-neutral-100 border border-neutral-200 items-center justify-center"
                      >
                        <X size={13} color="#525252" />
                      </Pressable>
                    </View>
                  ) : outgoing ? (
                    <Pressable
                      onPress={() => cancelFriendRequest(outgoing)}
                      className="bg-neutral-100 border border-neutral-200 px-2.5 py-1 rounded-lg"
                    >
                      <AppText variant="micro" className="font-bold uppercase tracking-wider text-neutral-600">
                        Request Sent — Cancel
                      </AppText>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => sendFriendRequest(person.uid, person.displayName)}
                      className="bg-[#1A1A1A] px-2.5 py-1 rounded-lg flex-row items-center gap-1"
                    >
                      <UserPlus size={11} color="#FFFFFF" />
                      <AppText variant="micro" className="font-bold uppercase tracking-wider text-white">Add Friend</AppText>
                    </Pressable>
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
