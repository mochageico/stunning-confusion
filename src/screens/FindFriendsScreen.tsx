import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Check, UserPlus, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';

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
            <Text className="text-[9px] uppercase tracking-wider font-extrabold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-sans">
              FIND FRIENDS
            </Text>
            <Text className="text-base font-serif font-black text-neutral-900 leading-none mt-1">
              Search People
            </Text>
          </View>
        </View>

        {/* Incoming Requests */}
        {incomingFriendRequests.length > 0 && (
          <View className="gap-2">
            <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
              FRIEND REQUESTS ({incomingFriendRequests.length})
            </Text>
            <View className="gap-2">
              {incomingFriendRequests.map((req) => (
                <View
                  key={req.id}
                  className="border border-neutral-200 rounded-xl p-3 bg-white flex-row items-center justify-between"
                >
                  <Text className="text-xs font-sans font-bold text-neutral-800 flex-1 pr-2">{req.fromName}</Text>
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

        {/* Search box */}
        <View className="gap-2">
          <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
            SEARCH BY NAME OR EMAIL
          </Text>
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
              <Text className="text-white text-xs font-bold">Search</Text>
            </Pressable>
          </View>
        </View>

        {/* Results */}
        <View className="gap-2">
          {searchingUsers ? (
            <View className="py-4 items-center">
              <Text className="text-xs text-neutral-400 font-sans">Searching...</Text>
            </View>
          ) : userSearchResults.length === 0 ? (
            <View className="items-center p-6 border border-dashed border-neutral-200 rounded-2xl">
              <Text className="text-xs text-neutral-400 text-center">
                Search by exact email, or the start of someone's name.
              </Text>
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
                  <View className="flex-1 pr-2">
                    <Text className="text-xs font-sans font-bold text-neutral-800">{person.displayName}</Text>
                    {!!person.email && <Text className="text-[9px] font-sans text-neutral-400">{person.email}</Text>}
                  </View>

                  {isFriend ? (
                    <View className="bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                      <Text className="text-[9px] font-bold uppercase tracking-wider text-emerald-700">Friends</Text>
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
                      <Text className="text-[9px] font-bold uppercase tracking-wider text-neutral-600">
                        Request Sent — Cancel
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => sendFriendRequest(person.uid, person.displayName)}
                      className="bg-[#1A1A1A] px-2.5 py-1 rounded-lg flex-row items-center gap-1"
                    >
                      <UserPlus size={11} color="#FFFFFF" />
                      <Text className="text-[9px] font-bold uppercase tracking-wider text-white">Add Friend</Text>
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
