import { ScrollView, View } from 'react-native';
import { Check, Search, UserPlus, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppButton, AppIconButton, AppText, AppTextInput, useFontScale, useScaledSpace } from '../components/design';
import { Avatar, Badge, EmptyState, GroupedList, ListRow, ScreenHeader, SectionHeader } from '../components/blocks';
import { useThemeColors } from '../components/theme';

export default function FindFriendsScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
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

  // The avatar gives way at large text: the row has a name, a note and up to
  // two buttons to fit, and on an SE the name was wrapping a word per line.
  const avatar = (name: string) => (scale < 1.3 ? <Avatar name={name} size={40} /> : undefined);

  // Accept / decline as two round icon buttons, the same on a request row and
  // a search result.
  const acceptDecline = (accept: () => void, decline: () => void, name: string) => (
    <View className="flex-row items-center" style={{ gap: space(8) }}>
      <AppIconButton Icon={Check} variant="filled" diameter={34} accessibilityLabel={`Accept ${name}`} onPress={accept} />
      <AppIconButton Icon={X} variant="outline" diameter={34} accessibilityLabel={`Decline ${name}`} onPress={decline} />
    </View>
  );

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader title="Find friends" onBack={handleBack} backLabel="Community" />

        {/* Incoming requests. Names tap through to the sender's profile so you
            can see who they are before deciding. */}
        {incomingFriendRequests.length > 0 && (
          <GroupedList header={`Requests to you · ${incomingFriendRequests.length}`}>
            {incomingFriendRequests.map((req) => (
              <ListRow
                key={req.id}
                leading={avatar(req.fromName)}
                title={req.fromName}
                subtitle="Wants to be friends"
                onPress={() => viewMemberProfileById(req.fromUid)}
                accessory={acceptDecline(() => acceptFriendRequest(req), () => declineFriendRequest(req), req.fromName)}
              />
            ))}
          </GroupedList>
        )}

        {/* Outgoing requests -- these existed in state all along but were only
            ever visible as inline status on a search result, so a request sent
            and then navigated away from became invisible: no way to see who
            you were waiting on, and no way to cancel without re-finding them
            by search. */}
        {outgoingFriendRequests.length > 0 && (
          <GroupedList header={`Sent by you · ${outgoingFriendRequests.length}`}>
            {outgoingFriendRequests.map((req) => (
              <ListRow
                key={req.id}
                leading={avatar(req.toName)}
                title={req.toName}
                subtitle="Waiting for them to accept"
                onPress={() => viewMemberProfileById(req.toUid)}
                accessory={<AppButton size="sm" variant="quiet" label="Cancel" accessibilityLabel={`Cancel request to ${req.toName}`} onPress={() => cancelFriendRequest(req)} />}
              />
            ))}
          </GroupedList>
        )}

        <View style={{ gap: space(6) }}>
          <SectionHeader title="Search by name or email" />
          {/* The field and its button share a row until the text gets big,
              then stack, so neither is squeezed. */}
          <View className={scale >= 1.3 ? '' : 'flex-row items-center'} style={{ gap: space(8) }}>
            <View className="flex-1 flex-row items-center bg-surface border border-line rounded-btn" style={{ paddingHorizontal: space(12), gap: space(8) }}>
              <Search size={Math.round(16 * scale)} color={palette.ink3} />
              <AppTextInput
                value={userSearchQuery}
                onChangeText={setUserSearchQuery}
                onSubmitEditing={() => searchUsers(userSearchQuery)}
                placeholder="Name or email"
                accessibilityLabel="Search people"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                variant="body"
                className="flex-1 text-ink font-sans"
                style={{ minWidth: 0, paddingVertical: space(10) }}
              />
            </View>
            <AppButton variant="primary" label="Search" onPress={() => searchUsers(userSearchQuery)} />
          </View>
        </View>

        {searchingUsers ? (
          <AppText variant="label" className="font-sans text-ink-3 text-center" style={{ paddingVertical: space(8) }}>
            Searching…
          </AppText>
        ) : userSearchResults.length === 0 ? (
          <View className="bg-surface border border-line rounded-card">
            <EmptyState
              Icon={Search}
              title="Find someone"
              message="Enter an exact email address, or the start of someone's name."
            />
          </View>
        ) : (
          <GroupedList>
            {userSearchResults.map((person) => {
              const isFriend = friends.some((f) => f.uid === person.uid);
              const outgoing = outgoingFriendRequests.find((r) => r.toUid === person.uid);
              const incoming = incomingFriendRequests.find((r) => r.fromUid === person.uid);
              return (
                <ListRow
                  key={person.uid}
                  leading={avatar(person.displayName)}
                  title={person.displayName}
                  subtitle={person.email || undefined}
                  onPress={() => viewMemberProfileById(person.uid)}
                  accessory={
                    isFriend ? (
                      <Badge label="Friends" tone="success" />
                    ) : incoming ? (
                      acceptDecline(() => acceptFriendRequest(incoming), () => declineFriendRequest(incoming), person.displayName)
                    ) : outgoing ? (
                      <AppButton size="sm" variant="quiet" label="Requested" accessibilityLabel={`Cancel request to ${person.displayName}`} onPress={() => cancelFriendRequest(outgoing)} />
                    ) : (
                      <AppButton
                        size="sm"
                        variant="secondary"
                        Icon={UserPlus}
                        label="Add"
                        accessibilityLabel={`Add ${person.displayName}`}
                        onPress={() => sendFriendRequest(person.uid, person.displayName)}
                      />
                    )
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
