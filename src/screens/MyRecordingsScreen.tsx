import { ScrollView, View } from 'react-native';
import { Mic, Pause, Play, Plus } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { Recording, normalizeRecordingVisibility } from '../types';
import { FadeInView } from '../components/ui';
import { AppButton, AppIconButton, AppText, useScaledSpace } from '../components/design';
import { Avatar, EmptyState, GroupedList, ListRow, ScreenHeader, SectionHeader } from '../components/blocks';
import { translationLabel } from '../data';
import { formatDate, formatDuration } from '../lib/format';
import { recordingLabel, recordingMeta } from '../lib/recordingLabel';

// Every recording you can play, in three groups: sent to you in a chat and
// not saved yet, recorded by you, and saved from someone else. It used to be
// one mixed list, where a saved recording looked just like your own.
export default function MyRecordingsScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const {
    userRecordings,
    receivedRecordings,
    saveSharedRecordingToLibrary,
    handleBack,
    navigateTo,
    setSelectedRecording,
    playingRecordingId,
    setPlayingRecordingId,
    setPlayingRecProgress,
  } = state;

  const own = userRecordings.filter((r) => !r.savedFromRecordingId);
  const saved = userRecordings.filter((r) => r.savedFromRecordingId);
  const savedIds = new Set(saved.map((r) => r.savedFromRecordingId));
  const sentToYou = receivedRecordings.filter((r) => !savedIds.has(r.id));
  const firstName = (r: Recording) => (r.user || 'someone').split(' ')[0];

  const open = (rec: Recording) => {
    setSelectedRecording(rec);
    navigateTo('recordingDetail');
  };

  const playButton = (rec: Recording) => {
    const isPlaying = playingRecordingId === rec.id;
    return (
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
    );
  };

  const section = (title: string, count: string, rows: React.ReactNode, note?: string) => (
    <View style={{ gap: space(6) }}>
      <View className="flex-row items-baseline justify-between">
        <SectionHeader title={title} />
        <AppText variant="caption" className="font-sans text-ink-3">
          {count}
        </AppText>
      </View>
      <GroupedList>{rows}</GroupedList>
      {!!note && (
        <AppText variant="caption" className="font-sans text-ink-3">
          {note}
        </AppText>
      )}
    </View>
  );

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader title="Your recordings" onBack={handleBack} backLabel="Record" />

        {userRecordings.length === 0 && sentToYou.length === 0 ? (
          <View className="bg-surface border border-line rounded-card">
            <EmptyState
              Icon={Mic}
              title="No recordings yet"
              message="Record or import one on the Record tab, or save one your friends and circles shared."
            />
          </View>
        ) : (
          <>
            {sentToYou.length > 0 &&
              section(
                'Sent to you',
                'Not saved yet',
                sentToYou.map((rec) => (
                  <ListRow
                    key={rec.id}
                    title={recordingLabel(rec)}
                    subtitle={[`From ${firstName(rec)} in chat`, translationLabel(rec.translation), formatDate(rec.date)].filter(Boolean).join(' · ')}
                    onPress={() => open(rec)}
                    accessory={
                      <View className="flex-row items-center" style={{ gap: space(8) }}>
                        {playButton(rec)}
                        <AppButton
                          size="sm"
                          variant="primary"
                          Icon={Plus}
                          label="Save"
                          accessibilityLabel={`Save ${recordingLabel(rec)}`}
                          onPress={() => void saveSharedRecordingToLibrary(rec)}
                        />
                      </View>
                    }
                  />
                ))
              )}

            {own.length > 0 &&
              section(
                'Recorded by you',
                String(own.length),
                // Tap a row for its page; the play button plays it in place
                // (the now-playing bar above the tabs shows progress).
                own.map((rec) => (
                  <ListRow
                    key={rec.id}
                    title={recordingLabel(rec)}
                    subtitle={`${recordingMeta(rec)} · ${
                      normalizeRecordingVisibility(rec.sharedVisibility) === 'circle' ? 'Friends & Circles' : 'Only you'
                    }`}
                    onPress={() => open(rec)}
                    accessory={playButton(rec)}
                  />
                ))
              )}

            {saved.length > 0 &&
              section(
                'Saved from others',
                String(saved.length),
                saved.map((rec) => (
                  <ListRow
                    key={rec.id}
                    leading={<Avatar name={rec.user} size={36} />}
                    title={recordingLabel(rec)}
                    subtitle={[
                      `From ${firstName(rec)}`,
                      translationLabel(rec.translation),
                      rec.customTimings ? 'Your timing' : formatDuration(rec.duration),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    onPress={() => open(rec)}
                    accessory={playButton(rec)}
                  />
                )),
                "Saved recordings play from the reader's file. If they delete it or make it private, it leaves your list too."
              )}
          </>
        )}
      </ScrollView>
    </FadeInView>
  );
}
