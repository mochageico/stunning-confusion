import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, Globe, Lock } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppButton, AppIconButton, AppText } from '../components/design';

// Read-only "profile page" for a community someone isn't a member of yet --
// same hero layout as CommunityGroupDetailScreen's header, but with none of
// the member/study-plan/chat machinery, since a non-member has no access to
// any of that.
export default function CommunityPreviewScreen({ state }: { state: AppState }) {
  const { user, previewCircle, myCircles, closeCirclePreview, openCircle, joinCircle } = state;

  if (!previewCircle) return null;

  const isAlreadyJoined = myCircles.some((mc) => mc.id === previewCircle.id);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5" contentContainerStyle={{ gap: 20 }}>
        <View className="flex-row items-center gap-2.5">
          <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={14} iconColor="#262626" onPress={closeCirclePreview} className="rounded-full border border-neutral-200 bg-white" />
          <View className="flex-row items-center gap-1 bg-neutral-100 px-2.5 py-1 rounded-full">
            {previewCircle.isPublic ? <Globe size={10} color="#525252" /> : <Lock size={10} color="#525252" />}
            <AppText variant="micro" className="font-sans font-bold text-neutral-600 uppercase tracking-wide">
              {previewCircle.isPublic ? 'Public Circle' : 'Private Circle'}
            </AppText>
          </View>
        </View>

        <View className="border-b border-[#E5E5E5] pb-5" style={{ gap: 8 }}>
          <AppText variant="section" className="uppercase tracking-widest font-extrabold text-neutral-400 font-sans">
            Scripture Circle
          </AppText>
          <AppText variant="display" className="leading-tight font-serif font-black text-[#1A1A1A]">{previewCircle.name}</AppText>
          <AppText variant="body" className="text-neutral-600 leading-relaxed font-sans">
            {previewCircle.description || 'No description yet.'}
          </AppText>
          <View className="pt-2">
            <AppText variant="micro" className="text-neutral-400 uppercase tracking-wider">Owner / Sponsor</AppText>
            <AppText variant="caption" className="font-semibold text-neutral-700 font-sans mt-0.5">{previewCircle.ownerName}</AppText>
          </View>
        </View>

        <AppButton size="lg" onPress={() => (isAlreadyJoined ? openCircle(previewCircle.id) : joinCircle(previewCircle.id, previewCircle.name))} className={`w-full rounded-2xl items-center justify-center shadow-sm ${ isAlreadyJoined ? 'bg-neutral-100 border border-neutral-300' : 'bg-[#1A1A1A]' }`}>
          <AppText variant="label" className={`font-bold uppercase tracking-wider ${isAlreadyJoined ? 'text-neutral-700' : 'text-white'}`}>
            {isAlreadyJoined ? 'View Dashboard' : 'Join Circle'}
          </AppText>
        </AppButton>

        {!isAlreadyJoined && (
          <AppText variant="caption" className="text-neutral-400 font-sans text-center -mt-2">
            {user ? "You'll be added as a member right away." : 'Sign in to join this circle.'}
          </AppText>
        )}
      </ScrollView>
    </FadeInView>
  );
}
