import { Pressable, View } from 'react-native';
import { FileAudio, Mic, Pause, Play } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { Recording, normalizeRecordingVisibility } from '../types';
import { AppButton, AppIconButton, AppText, useScaledSpace } from './design';
import { Avatar, GroupedList, ListRow, ScreenHeader, SectionHeader } from './blocks';
import { OverflowMenu } from './session';
import { formatDate, formatDuration } from '../lib/format';
import { recordingLabel } from '../lib/recordingLabel';

// ============================================================================
// The Audio tab's first page (UI simplify Job 11, the "Record" sketch): a
// record card (the passage, Change, Start recording), My recordings (the
// latest few, See all), and From friends and circles (Find more). Import sits
// in the header's ⋯. The listening row was dropped by the owner (Round 2).
// ============================================================================

const SHOWN = 3;

export function AudioHub({
  state,
  passageTitle,
  passageSubtitle,
  passageChosen,
  canStart,
  requestBanner,
  onChangePassage,
  onStart,
  onImport,
}: {
  state: AppState;
  passageTitle: string;
  passageSubtitle: string;
  passageChosen: boolean;
  canStart: boolean;
  /** "Recording for Sarah", when a chat asked for one. */
  requestBanner?: React.ReactNode;
  onChangePassage: () => void;
  onStart: () => void;
  onImport: () => void;
}) {
  const space = useScaledSpace();
  const { userRecordings, feedRecordings, user, navigateTo, setSelectedRecording, playingRecordingId, setPlayingRecordingId, setPlayingRecProgress } = state;

  const mine = userRecordings.filter((r) => !r.savedFromRecordingId).slice(0, SHOWN);
  const fromOthers = feedRecordings.filter((r) => (r.userId || (r as { ownerId?: string }).ownerId) !== user?.uid).slice(0, SHOWN);

  const open = (rec: Recording) => {
    setSelectedRecording(rec);
    navigateTo('recordingDetail');
  };
  const play = (rec: Recording) => {
    const isPlaying = playingRecordingId === rec.id;
    return (
      <AppIconButton
        Icon={isPlaying ? Pause : Play}
        variant="outline"
        diameter={36}
        accessibilityLabel={`${isPlaying ? 'Pause' : 'Play'} ${recordingLabel(rec)}`}
        onPress={() => {
          if (isPlaying) setPlayingRecordingId(null);
          else {
            setPlayingRecordingId(rec.id);
            setPlayingRecProgress(0);
          }
        }}
      />
    );
  };
  const who = (rec: Recording) => (normalizeRecordingVisibility(rec.sharedVisibility) === 'circle' ? 'Friends & circles' : 'Private');

  const sectionHead = (title: string, action: string, onAction: () => void) => <SectionHeader title={title} actionLabel={action} onAction={onAction} />;

  return (
    <>
      <ScreenHeader
        title="Audio"
        actions={<OverflowMenu title="Audio" groups={[[{ label: 'Import audio', Icon: FileAudio, onPress: onImport }]]} />}
      />

      {requestBanner}

      {/* Record card: the passage, Change, and the one filled button. */}
      <View className="bg-surface border border-line rounded-card" style={{ padding: space(16), gap: space(14) }}>
        <Pressable
          onPress={onChangePassage}
          accessibilityRole="button"
          accessibilityLabel={`${passageTitle}. ${passageChosen ? 'Change' : 'Choose'} the passage`}
          className="flex-row items-start active:opacity-70"
          style={{ gap: space(10) }}
        >
          <View className="flex-1" style={{ gap: space(2) }}>
            <AppText variant="caption" className="font-sans font-medium text-ink-3">
              Record yourself reading
            </AppText>
            <AppText variant="title" className="font-sans font-bold text-ink">
              {passageTitle}
            </AppText>
            <AppText variant="caption" className="font-sans text-ink-2">
              {passageSubtitle}
            </AppText>
          </View>
          <AppText variant="label" className="font-sans font-semibold text-accent">
            {passageChosen ? 'Change' : 'Choose'}
          </AppText>
        </Pressable>
        <AppButton
          size="lg"
          variant="primary"
          Icon={Mic}
          label={passageChosen ? 'Start recording' : 'Choose a passage'}
          disabled={passageChosen && !canStart}
          onPress={passageChosen ? onStart : onChangePassage}
        />
      </View>

      <View style={{ gap: space(6) }}>
        {sectionHead('My recordings', 'See all', () => navigateTo('myRecordings'))}
        <GroupedList>
          {mine.length === 0 ? (
            <ListRow Icon={Mic} title="None yet" accessory="none" />
          ) : (
            mine.map((rec) => (
              <ListRow
                key={rec.id}
                leading={play(rec)}
                title={recordingLabel(rec)}
                subtitle={[formatDate(rec.date), rec.duration ? formatDuration(rec.duration) : null, who(rec)].filter(Boolean).join(' · ')}
                onPress={() => open(rec)}
              />
            ))
          )}
        </GroupedList>
      </View>

      <View style={{ gap: space(6) }}>
        {sectionHead('From friends and circles', 'Find more', () => navigateTo('audioFeed'))}
        <GroupedList>
          {fromOthers.length === 0 ? (
            <ListRow title="Nothing shared yet" accessory="none" />
          ) : (
            fromOthers.map((rec) => (
              <ListRow
                key={rec.id}
                leading={<Avatar name={rec.user} size={36} />}
                title={recordingLabel(rec)}
                subtitle={[rec.user || 'Someone', rec.duration ? formatDuration(rec.duration) : null].filter(Boolean).join(' · ')}
                onPress={() => open(rec)}
                accessory={play(rec)}
              />
            ))
          )}
        </GroupedList>
      </View>
    </>
  );
}
