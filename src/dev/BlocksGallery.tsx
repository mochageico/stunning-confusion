// ============================================================================
// BLOCKS GALLERY — every shared building block on one page (job F3).
//
// Demo preview only: open the web preview at /?s=blocks (add &ios=1,
// &accent=<id>, &scale=1.5 as usual). It is the reference the S jobs build
// screens from, and the quickest way to see a change to a shared part in
// every state at once. Never reachable in a production build (DEMO gate).
// ============================================================================
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bell, BookOpen, Clock, History, ListOrdered, MoreHorizontal, Palette, Share2, Trash2 } from 'lucide-react-native';

import {
  AppButton,
  AppIconButton,
  AppText,
  AppTextInput,
  ChoiceCard,
  CollapsibleCard,
  OptionCards,
  SettingRow,
  Switch,
  ToggleRow,
} from '../components/design';
import {
  Avatar,
  Badge,
  Dialog,
  EmptyState,
  GroupedList,
  ListRow,
  ScreenHeader,
  SectionHeader,
  SegmentedControl,
} from '../components/blocks';
import { ChipRow, DiscreteSlider, HelpTooltip, StepperRow } from '../components/ui';
import { Dropdown } from '../components/Dropdown';
import { formatDate, formatDuration, formatTimeAgo } from '../lib/format';

function Specimen({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <AppText variant="micro" className="font-mono text-ink-3">
        {name}
      </AppText>
      {children}
    </View>
  );
}

export default function BlocksGallery() {
  const [seg, setSeg] = useState<'list' | 'grid' | 'memory'>('list');
  const [range, setRange] = useState<'7' | '30' | '90' | 'all'>('30');
  const [chapter, setChapter] = useState(8);
  const [choice, setChoice] = useState<'grace' | 'escalate' | 'reset'>('grace');
  const [plan, setPlan] = useState<'gentle' | 'standard' | 'strict'>('standard');
  const [reminder, setReminder] = useState(true);
  const [studio, setStudio] = useState(false);
  const [pace, setPace] = useState(2);
  const [cap, setCap] = useState<number | 'off'>(20);
  const [translation, setTranslation] = useState('BSB');
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const now = Date.now();

  return (
    <SafeAreaView style={{ flex: 1 }} className="bg-canvas">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 28, paddingBottom: 64 }}>
        <Specimen name="ScreenHeader">
          <ScreenHeader
            title="My Memory Work"
            onBack={() => {}}
            backLabel="Today"
            subtitle="Everything about what you're memorizing."
            actions={<AppIconButton Icon={Share2} variant="outline" accessibilityLabel="Share" />}
          />
        </Specimen>

        <Specimen name="ScreenHeader eyebrow">
          <ScreenHeader title="Sarah Mitchell" eyebrow="Member" onBack={() => {}} backLabel="Community" />
        </Specimen>

        <Specimen name="ScreenHeader inline">
          <ScreenHeader
            inline
            title="Romans Fellowship"
            eyebrow="12 members"
            onBack={() => {}}
            actions={<AppIconButton Icon={MoreHorizontal} variant="outline" accessibilityLabel="More" />}
          />
        </Specimen>

        <Specimen name="GroupedList + ListRow">
          <GroupedList>
            <ListRow Icon={ListOrdered} title="My Verses & Schedule" value="5 waiting" onPress={() => {}} />
            <ListRow Icon={Clock} title="Memory Calendar" value="5 due today" onPress={() => {}} />
            <ListRow Icon={History} title="History" value="3 memorized" onPress={() => {}} />
          </GroupedList>
          <GroupedList header="Reminders" footer="A notification at this time on days with reviews due.">
            <ListRow Icon={Bell} title="Daily reminder" accessory={<Switch value={reminder} onChange={setReminder} />} />
            <ListRow Icon={Clock} title="Reminder time" value="7:00 AM" onPress={() => {}} />
            <ListRow title="Studio Mode" subtitle="Record without background noise reduction" accessory={<Switch value={studio} onChange={setStudio} />} />
            <ListRow Icon={Trash2} title="Delete recording" destructive onPress={() => {}} accessory="none" />
          </GroupedList>
        </Specimen>

        <Specimen name="SectionHeader">
          <SectionHeader title="Learning now" actionLabel="See all" onAction={() => {}} />
        </Specimen>

        <Specimen name="SegmentedControl / ChipRow (no wrap)">
          <SegmentedControl
            options={[
              { id: 'list', label: 'List' },
              { id: 'grid', label: 'Grid' },
              { id: 'memory', label: 'Memory grid' },
            ]}
            value={seg}
            onChange={setSeg}
          />
          <ChipRow
            options={[
              { id: '7', label: 'Last 7 Days' },
              { id: '30', label: 'Last 30 Days' },
              { id: '90', label: 'Last 90 Days' },
              { id: 'all', label: 'All Time' },
            ]}
            value={range}
            onChange={setRange}
          />
        </Specimen>

        <Specimen name="ChipRow wrap">
          <ChipRow
            wrap
            options={Array.from({ length: 16 }, (_, i) => ({ id: i + 1, label: String(i + 1) }))}
            value={chapter}
            onChange={setChapter}
          />
        </Specimen>

        <Specimen name="ChoiceCard">
          {(
            [
              ['grace', 'Pick up where I left off', 'Missed reviews wait for you. Nothing moves back.'],
              ['escalate', 'Standard', 'A verse you miss twice comes back more often for a while.'],
              ['reset', 'Reset streak only', 'Your streak restarts; verses stay where they are.'],
            ] as const
          ).map(([id, title, desc]) => (
            <ChoiceCard key={id} title={title} description={desc} selected={choice === id} onPress={() => setChoice(id)} />
          ))}
        </Specimen>

        <Specimen name="OptionCards">
          <OptionCards
            options={[
              { id: 'gentle', title: 'Gentle', desc: 'Fewer reviews, longer gaps. Good for a busy season.' },
              { id: 'standard', title: 'Standard', desc: 'Daily, then weekly, then monthly.' },
              { id: 'strict', title: 'Thorough', desc: 'More reviews before a verse moves on.' },
            ]}
            value={plan}
            onChange={setPlan}
          />
        </Specimen>

        <Specimen name="AppButton variants">
          <AppButton variant="primary" size="lg" label="Add to My Verses" onPress={() => {}} />
          <View className="flex-row" style={{ gap: 10 }}>
            <AppButton variant="secondary" label="Reveal word" onPress={() => {}} style={{ flex: 1 }} />
            <AppButton variant="quiet" label="Start over" onPress={() => {}} style={{ flex: 1 }} />
          </View>
          <View className="flex-row flex-wrap" style={{ gap: 10 }}>
            <AppButton variant="destructive" Icon={Trash2} label="Delete" onPress={() => {}} />
            <AppButton variant="primary" size="sm" label="Listen" onPress={() => {}} />
            <AppButton variant="secondary" size="sm" label="Learn" onPress={() => {}} />
            <AppButton variant="primary" label="Disabled" disabled onPress={() => {}} />
          </View>
        </Specimen>

        <Specimen name="AppIconButton variants">
          <View className="flex-row items-center" style={{ gap: 12 }}>
            <AppIconButton Icon={Share2} variant="outline" accessibilityLabel="Share" />
            <AppIconButton Icon={BookOpen} variant="filled" accessibilityLabel="Open" />
            <AppIconButton Icon={MoreHorizontal} variant="bare" accessibilityLabel="More" />
          </View>
        </Specimen>

        <Specimen name="Badge">
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            <Badge label="Queued" />
            <Badge label="Public" tone="success" />
            <Badge label="Race" tone="accent" />
            <Badge label="Due today" tone="warning" />
            <Badge label="Missed" tone="danger" />
          </View>
        </Specimen>

        <Specimen name="Avatar">
          <View className="flex-row items-center" style={{ gap: 12 }}>
            <Avatar name="Sarah" size={48} />
            <Avatar name="micah" />
            <View className="flex-row">
              {['Ann', 'Ben', 'Cal', 'Dee'].map((n, i) => (
                <View key={n} style={{ marginLeft: i === 0 ? 0 : -10 }}>
                  <Avatar name={n} size={32} ring />
                </View>
              ))}
            </View>
          </View>
        </Specimen>

        <Specimen name="EmptyState">
          <View className="bg-surface border border-line rounded-card">
            <EmptyState
              Icon={BookOpen}
              title="No verses yet"
              message="Pick a chapter and choose the verses you want to learn."
              actionLabel="Find verses"
              onAction={() => {}}
            />
          </View>
        </Specimen>

        <Specimen name="CollapsibleCard + SettingRow + StepperRow + ToggleRow">
          <CollapsibleCard storageKey="gallery.schedule" title="My Schedule" summary="5 days · 2/day · 20 min">
            <SettingRow label="New verses per learning day" value={pace} />
            <StepperRow value={pace} min={1} max={5} onChange={setPace} />
            <ToggleRow label="Daily reminder" hint="Only on days with reviews due." value={reminder} onChange={setReminder} />
            <DiscreteSlider
              options={[
                { id: 'off', label: 'Off' },
                { id: 10, label: '10' },
                { id: 20, label: '20' },
                { id: 30, label: '30' },
              ]}
              value={cap}
              onChange={setCap}
            />
          </CollapsibleCard>
        </Specimen>

        <Specimen name="Dropdown / HelpTooltip / input">
          <View className="flex-row items-center" style={{ gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Dropdown
                value={translation}
                onChange={setTranslation}
                options={['BSB', 'KJV', 'WEB'].map((t) => ({ id: t, label: t }))}
                title="Translation"
              />
            </View>
            <Dropdown
              compact
              value={translation}
              onChange={setTranslation}
              options={['BSB', 'KJV', 'WEB'].map((t) => ({ id: t, label: t }))}
              title="Translation"
            />
            <HelpTooltip text="Private circles don't show up in the directory. People join with the invite code you share." />
          </View>
          <AppTextInput placeholder="Type the first letter of each word" className="bg-surface border border-line-strong rounded-btn px-3.5 py-3 text-ink" />
        </Specimen>

        <Specimen name="Dialog">
          <View className="flex-row" style={{ gap: 10 }}>
            <AppButton variant="secondary" label="Open dialog" onPress={() => setDialog(true)} style={{ flex: 1 }} />
            <AppButton variant="secondary" label="Open sheet" onPress={() => setSheet(true)} style={{ flex: 1 }} />
          </View>
        </Specimen>

        <Specimen name="formatDate / formatDuration">
          <AppText variant="label" className="text-ink">
            {formatDate(now)} · {formatDate(now - 86400000, 'relative')} · {formatDate(now, 'long')} ·{' '}
            {formatTimeAgo(now - 5 * 60000)} · {formatDuration(312)} · {formatDuration(312, 'words')} ·{' '}
            {formatDuration(3723, 'short')}
          </AppText>
        </Specimen>
      </ScrollView>

      <Dialog
        visible={dialog}
        onClose={() => setDialog(false)}
        title="Delete this recording?"
        message="The recitation for Romans 8 will be removed. This can't be undone."
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setDialog(false)} />
            <AppButton variant="destructive" label="Delete" onPress={() => setDialog(false)} />
          </>
        }
      />
      <Dialog
        visible={sheet}
        placement="sheet"
        onClose={() => setSheet(false)}
        title="Missed reviews"
        actions={<AppButton variant="primary" label="Apply" onPress={() => setSheet(false)} style={{ flex: 1 }} />}
      >
        <AppText variant="body" className="text-ink-2">
          You missed 3 days. How should the verses you missed come back?
        </AppText>
        {(
          [
            ['grace', 'Pick up where I left off', 'Missed reviews wait for you. Nothing moves back.'],
            ['escalate', 'Standard', 'A verse you miss twice comes back more often for a while.'],
            ['reset', 'Reset streak only', 'Your streak restarts; verses stay where they are.'],
          ] as const
        ).map(([id, title, desc]) => (
          <ChoiceCard key={id} title={title} description={desc} selected={choice === id} onPress={() => setChoice(id)} />
        ))}
      </Dialog>
    </SafeAreaView>
  );
}
