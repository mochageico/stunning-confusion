import { ScrollView, View } from 'react-native';
import { Mic, Pause, Play } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppIconButton, useScaledSpace } from '../components/design';
import { EmptyState, GroupedList, ListRow, ScreenHeader } from '../components/blocks';
import { recordingLabel, recordingMeta } from '../lib/recordingLabel';

// Every recording you've made or imported. It used to sit at the bottom of
// the Record tab, which cost the script room on the one screen where you
// need to read it; the tab now links here from its header.
export default function MyRecordingsScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const {
    userRecordings,
    handleBack,
    navigateTo,
    setSelectedRecording,
    playingRecordingId,
    setPlayingRecordingId,
    setPlayingRecProgress,
  } = state;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader title="Your recordings" onBack={handleBack} backLabel="Record" />

        {userRecordings.length === 0 ? (
          <View className="bg-surface border border-line rounded-card">
            <EmptyState Icon={Mic} title="No recordings yet" message="Record or import one on the Record tab and it will show up here." />
          </View>
        ) : (
          // Tap a row for its page; the play button plays it in place (the
          // now-playing bar above the tabs shows progress).
          <GroupedList>
            {userRecordings.map((rec) => {
              const isPlaying = playingRecordingId === rec.id;
              return (
                <ListRow
                  key={rec.id}
                  title={recordingLabel(rec)}
                  subtitle={recordingMeta(rec)}
                  onPress={() => {
                    setSelectedRecording(rec);
                    navigateTo('recordingDetail');
                  }}
                  accessory={
                    <AppIconButton
                      Icon={isPlaying ? Pause : Play}
                      variant={isPlaying ? 'filled' : 'outline'}
                      diameter={34}
                      accessibilityLabel={`${isPlaying ? 'Pause' : 'Play'} ${recordingLabel(rec)}`}
                      onPress={() => {
                        if (isPlaying) {
                          setPlayingRecordingId(null);
                        } else {
                          setPlayingRecordingId(rec.id);
                          setPlayingRecProgress(0);
                        }
                      }}
                    />
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
