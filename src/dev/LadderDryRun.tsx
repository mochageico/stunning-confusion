// Dev-only dry run of the review ladder migration (REVIEW_LADDER_PLAN.md
// stage 3). Runs the migration in memory on the signed-in account's queue and
// shows what it would do. Writes nothing: no Firestore, no state.
import { useMemo } from 'react';
import { Platform, Share, View } from 'react-native';
import type { QueueItem } from '../types';
import type { ReviewClock } from '../lib/retention';
import { describeLadderState, migrateQueue, migrationReportText, oldStagesLine, passageTitle } from '../lib/ladderMigration';
import { formatDate } from '../lib/format';
import { AppButton, AppText, useScaledSpace } from '../components/design';
import { Badge, GroupedList, ListRow } from '../components/blocks';

export function LadderDryRun({ queue, clock }: { queue: QueueItem[]; clock: ReviewClock }) {
  const space = useScaledSpace();
  const { report } = useMemo(() => migrateQueue(queue, { clock }), [queue, clock]);

  const copy = async () => {
    const message = migrationReportText(report);
    if (Platform.OS === 'web') {
      await navigator.clipboard?.writeText(message).catch(() => undefined);
      return;
    }
    await Share.share({ message, title: 'Ladder dry run' }).catch(() => undefined);
  };

  return (
    <View style={{ gap: space(20) }}>
      <GroupedList footer="Runs the move to the review ladder in memory and shows the result. Nothing is saved.">
        <ListRow title="Passages" value={String(report.passages.length)} />
        <ListRow title="Verses that would change" value={String(report.changedCount)} />
        <ListRow title="Already on the ladder" value={String(report.alreadyMigrated)} />
        <ListRow title="Waiting or in Learning (untouched)" value={String(report.notStarted)} />
      </GroupedList>
      <AppButton variant="secondary" label={Platform.OS === 'web' ? 'Copy report' : 'Share report'} onPress={() => void copy()} />
      {report.passages.length === 0 ? (
        <AppText variant="body" className="font-sans text-ink-2">Nothing to move: every verse past Learning is already on the ladder.</AppText>
      ) : (
        <GroupedList header="Each passage">
          {report.passages.map((p) => (
            <ListRow
              key={p.key}
              title={passageTitle(p)}
              subtitle={`Was: ${oldStagesLine(p)}\nNow: ${describeLadderState(p.to)}\nNext review: ${p.due ? formatDate(p.due, 'long') : 'no date'}`}
              accessory={p.merged ? <Badge label="Mixed" /> : 'none'}
            />
          ))}
        </GroupedList>
      )}
    </View>
  );
}
