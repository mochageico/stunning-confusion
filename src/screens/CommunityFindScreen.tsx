import { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Search, Users, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppButton, AppText, AppTextInput, useFontScale, useScaledSpace } from '../components/design';
import { EmptyState, GroupedList, ListRow, ScreenHeader, SectionHeader } from '../components/blocks';
import { useThemeColors } from '../components/theme';

export default function CommunityFindScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const {
    setCommunitySubView,
    inviteCodeInput,
    setInviteCodeInput,
    findSearchQuery,
    setFindSearchQuery,
    myCircles,
    publicCircles,
    loadingPublicCircles,
    loadPublicCircles,
    joinCircle,
    joinCircleByCode,
    openCircle,
    openCirclePreview,
  } = state;

  useEffect(() => {
    loadPublicCircles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredCircles = publicCircles.filter(
    (c) =>
      c.name.toLowerCase().includes(findSearchQuery.toLowerCase()) ||
      c.description.toLowerCase().includes(findSearchQuery.toLowerCase())
  );
  const iconSize = Math.round(16 * scale);
  const fieldBox = 'flex-row items-center bg-surface border border-line rounded-btn';

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader
          title="Find a circle"
          subtitle="Search the public circles, or join a private one with its code."
          onBack={() => setCommunitySubView('home')}
          backLabel="Community"
        />

        {/* The code field and its button share a row until the text gets big,
            then stack, so neither is squeezed. */}
        <View style={{ gap: space(6) }}>
          <SectionHeader title="Have an invite code?" />
          <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(10) }}>
            <View className={scale >= 1.3 ? '' : 'flex-row items-center'} style={{ gap: space(8) }}>
              <View className={`${fieldBox} flex-1`} style={{ paddingHorizontal: space(12) }}>
                <AppTextInput
                  value={inviteCodeInput}
                  onChangeText={setInviteCodeInput}
                  placeholder="Invite code"
                  accessibilityLabel="Invite code"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  variant="body"
                  className="flex-1 text-ink font-sans"
                  style={{ minWidth: 0, paddingVertical: space(10), letterSpacing: 1 }}
                />
              </View>
              <AppButton variant="primary" label="Join" onPress={() => joinCircleByCode(inviteCodeInput)} />
            </View>
            <AppText variant="caption" className="font-sans text-ink-3">
              Private circles don't appear in the search below.
            </AppText>
          </View>
        </View>

        <View style={{ gap: space(12) }}>
          <View className={fieldBox} style={{ paddingHorizontal: space(12), gap: space(8) }}>
            <Search size={iconSize} color={palette.ink3} />
            <AppTextInput
              value={findSearchQuery}
              onChangeText={setFindSearchQuery}
              placeholder="Search public circles"
              accessibilityLabel="Search public circles"
              variant="body"
              className="flex-1 text-ink font-sans"
              style={{ minWidth: 0, paddingVertical: space(10) }}
            />
            {!!findSearchQuery && (
              <Pressable onPress={() => setFindSearchQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                <X size={iconSize} color={palette.ink3} />
              </Pressable>
            )}
          </View>

          {loadingPublicCircles ? (
            <AppText variant="label" className="font-sans text-ink-3 text-center" style={{ paddingVertical: space(24) }}>
              Loading circles…
            </AppText>
          ) : filteredCircles.length === 0 ? (
            <View className="bg-surface border border-line rounded-card">
              <EmptyState
                Icon={Users}
                title="No circles match"
                message="Try a different word, or ask a friend for their invite code."
              />
            </View>
          ) : (
            // The description stays out of the list: it's free text of any
            // length, and it set every row's height. Tap a row to read it.
            <GroupedList header={`${filteredCircles.length} public ${filteredCircles.length === 1 ? 'circle' : 'circles'}`}>
              {filteredCircles.map((c) => {
                const joined = myCircles.some((mc) => mc.id === c.id);
                return (
                  <ListRow
                    key={c.id}
                    Icon={Users}
                    title={c.name}
                    subtitle={c.ownerName ? `Led by ${c.ownerName}` : undefined}
                    onPress={() => openCirclePreview(c)}
                    // Past 1.3x the button would squeeze the name to a word a
                    // line; the row opens the preview, which has Join.
                    accessory={
                      scale >= 1.3 ? undefined : (
                      <AppButton
                        size="sm"
                        variant={joined ? 'quiet' : 'secondary'}
                        label={joined ? 'Open' : 'Join'}
                        accessibilityLabel={`${joined ? 'Open' : 'Join'} ${c.name}`}
                        onPress={() => (joined ? openCircle(c.id) : joinCircle(c.id, c.name))}
                      />
                      )
                    }
                  />
                );
              })}
            </GroupedList>
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}
