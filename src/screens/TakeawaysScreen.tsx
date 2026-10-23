import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Bookmark, ChevronDown, Flag, ChevronUp, MessageCircle, Send, Trash2, Users } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { replyKey } from '../state/useCircleTakeaways';
import { FadeInView } from '../components/ui';
import { AppButton, AppIconButton, AppText, AppTextInput, useFontScale, useScaledSpace } from '../components/design';
import { Badge, EmptyState, ScreenHeader, SegmentedControl } from '../components/blocks';
import { bracketColor, useThemeColors } from '../components/theme';
import { SectionTitle, ShareSwitch, spotName, TakeawayForm, useNewShareChoice } from '../components/TakeawayAsk';
import { formatDate, formatTimeAgo } from '../lib/format';
import { heldDates, ladderPosition, landmarkDates, nextLine } from '../lib/milestones';
import { sectionIndexOf } from '../lib/sections';
import { buildPath, PathEntry, sectionStatuses } from '../lib/takeaways';
import { authorShort, circleList, nextSharedTo, REPLY_MAX, replyCountText, sharedChoiceFor, visibleReplies } from '../lib/takeawaySharing';
import type { SharedTakeaway, Takeaway } from '../types';

// ============================================================================
// THE TAKEAWAYS PATH
// ----------------------------------------------------------------------------
// A journal of what you've memorized: one stop per section, newest on top,
// alternating sides of one line, each in its section's bracket color. A
// dashed stop is a takeaway not written yet ("Later") or the section that
// unlocks next. Tap a stop to open it and change it, or share it.
//
// "With my circle" (the switch at the top) lists what the people in one of
// your circles shared: each person's takeaways as their own items, never
// grouped by passage (everyone's sections differ), with a reply count. The
// replies and the author's note show once one is opened.
// ============================================================================

const STOP_LINE = 3;

type View_ = 'mine' | 'circle';

function Stop({ entry, onOpen }: { entry: Extract<PathEntry, { kind: 'stop' }>; onOpen: () => void }) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const color = bracketColor(palette, entry.index);
  const t = entry.takeaway;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${entry.label ?? entry.range}, ${entry.empty ? 'not written yet' : t.text}`}
      className="active:opacity-70 rounded-card bg-surface"
      // layout-ok: the stop's border; dashed while it has no words, in the section's color.
      style={{ borderWidth: 1.5, borderStyle: entry.empty ? 'dashed' : 'solid', borderColor: color, padding: space(10), gap: space(4) }}
    >
      <AppText variant="caption" className="font-sans font-bold text-ink" numberOfLines={2}>
        {entry.label ?? entry.range}
      </AppText>
      {entry.label ? (
        <AppText variant="caption" className="font-sans text-ink-3" numberOfLines={1}>
          {entry.range}
        </AppText>
      ) : null}
      {entry.empty ? (
        <AppText variant="caption" className="font-sans italic text-ink-3">
          Not written yet
        </AppText>
      ) : (
        <AppText variant="label" className="font-serif text-ink" numberOfLines={STOP_LINE + 2}>
          {t.text}
        </AppText>
      )}
      {!entry.empty && (t.note || t.sharedTo?.length) ? (
        <AppText variant="caption" className="font-sans text-ink-3" numberOfLines={1}>
          {[t.note ? '+ a note' : '', t.sharedTo?.length ? 'Shared' : ''].filter(Boolean).join(' · ')}
        </AppText>
      ) : null}
    </Pressable>
  );
}

function NextStop({ entry }: { entry: Extract<PathEntry, { kind: 'next' }> }) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const color = bracketColor(palette, entry.status.index);
  return (
    <View
      className="rounded-card"
      // layout-ok: the stop's dashed border, in the section's color.
      style={{ borderWidth: 1.5, borderStyle: 'dashed', borderColor: color, padding: space(10), gap: space(4) }}
    >
      <AppText variant="caption" className="font-sans font-bold text-ink-2" numberOfLines={2}>
        {entry.status.label ?? entry.range}
      </AppText>
      {entry.status.label ? (
        <AppText variant="caption" className="font-sans text-ink-3" numberOfLines={1}>
          {entry.range}
        </AppText>
      ) : null}
      <AppText variant="caption" className="font-sans text-ink-3">
        Unlocks at weekly reviews
      </AppText>
    </View>
  );
}

function Path({ entries, onOpen }: { entries: PathEntry[]; onOpen: (id: string) => void }) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const scale = useFontScale();
  const rail = space(30);
  const dot = Math.round(14 * Math.min(scale, 1.3));
  // At large text two half-width columns leave a card a few words a line, so
  // every stop moves to one side of the line (the line then runs down the left).
  const stacked = scale >= 1.3;
  return (
    <View>
      {entries.map((e, i) => {
        const first = i === 0;
        const last = i === entries.length - 1;
        // The line runs through every row; it starts below the first dot and ends at the last.
        const line = (
          // layout-ok: the path's line.
          <View
            style={{
              position: 'absolute',
              left: '50%',
              marginLeft: -1.5,
              width: 3,
              top: first ? '50%' : 0,
              bottom: last ? '50%' : 0,
              backgroundColor: palette.lineStrong,
            }}
          />
        );
        if (e.kind === 'chapter') {
          return (
            <View key={e.key} className={stacked ? 'flex-row items-center' : 'items-center justify-center'}>
              {stacked ? <View className="self-stretch" style={{ width: rail }}>{line}</View> : line}
              <View className="bg-canvas border border-line rounded-full" style={{ marginVertical: space(8), paddingHorizontal: space(12), paddingVertical: space(4) }}>
                <AppText variant="caption" className="font-sans font-bold text-ink-2">
                  {e.book} {e.chapter}
                </AppText>
              </View>
            </View>
          );
        }
        if (e.kind === 'landmark') {
          // A book of the Bible you now hold more verses than, on the line at the day you passed it.
          return (
            <View key={e.key} className={stacked ? 'flex-row items-center' : 'items-center justify-center'}>
              {stacked ? <View className="self-stretch" style={{ width: rail }}>{line}</View> : line}
              <View
                className={`flex-row items-center bg-canvas border border-line-strong flex-shrink ${stacked ? 'rounded-card' : 'rounded-full'}`}
                style={{ marginVertical: space(8), paddingHorizontal: space(12), paddingVertical: space(4), gap: space(6) }}
              >
                <Flag size={Math.round(13 * Math.min(scale, 1.3))} color={palette.ink3} />
                {/* At large text the day goes on its own line so it never splits mid-date. */}
                <View className="flex-shrink">
                  <AppText variant="caption" className="font-sans font-semibold text-ink-2">
                    More than {e.book}
                    {e.at && !stacked ? ` · ${formatDate(e.at)}` : ''}
                  </AppText>
                  {e.at && stacked ? (
                    <AppText variant="caption" className="font-sans text-ink-3">
                      {formatDate(e.at)}
                    </AppText>
                  ) : null}
                </View>
              </View>
            </View>
          );
        }
        const color = bracketColor(palette, e.kind === 'stop' ? e.index : e.status.index);
        const filled = e.kind === 'stop' && !e.empty;
        const card = e.kind === 'stop' ? <Stop entry={e} onOpen={() => onOpen(e.takeaway.id)} /> : <NextStop entry={e} />;
        const gap = { marginVertical: space(6) };
        const dotView = (
          <View className="items-center justify-center self-stretch" style={{ width: rail }}>
            {line}
            {/* layout-ok: the stop's dot, filled once written. */}
            <View className="rounded-full" style={{ width: dot, height: dot, borderWidth: 3, borderColor: color, backgroundColor: filled ? color : palette.canvas }} />
          </View>
        );
        if (stacked) {
          return (
            <View key={e.key} className="flex-row items-center">
              {dotView}
              <View className="flex-1" style={gap}>{card}</View>
            </View>
          );
        }
        return (
          <View key={e.key} className="flex-row items-center">
            <View className="flex-1" style={gap}>{e.side === 'left' ? card : null}</View>
            {dotView}
            <View className="flex-1" style={gap}>{e.side === 'right' ? card : null}</View>
          </View>
        );
      })}
    </View>
  );
}

function Opened({ state, takeaway, onClose }: { state: AppState; takeaway: Takeaway; onClose: () => void }) {
  const space = useScaledSpace();
  const palette = useThemeColors();
  const [showVerses, setShowVerses] = useState(false);
  const doc = state.sectionsForChapter(takeaway.book, takeaway.chapter);
  const index = doc ? Math.max(0, sectionIndexOf(doc.starts, takeaway.sectionStart)) : 0;
  const label = doc?.labels[takeaway.sectionStart]?.trim() || takeaway.label || undefined;
  const name = spotName(takeaway);
  const empty = takeaway.status === 'later' || takeaway.text.trim() === '';
  const spot = {
    book: takeaway.book,
    chapter: takeaway.chapter,
    sectionStart: takeaway.sectionStart,
    sectionEnd: takeaway.sectionEnd,
    label,
    index,
  };

  // The switch starts on the circles it's shared with; a stop never written
  // starts on the last choice, like the ask.
  const [newChoice, setNewChoice, offered] = useNewShareChoice(state);
  const [choice, setChoice] = useState<string[]>(() => sharedChoiceFor(takeaway, offered));
  const share = empty ? newChoice : choice;
  const setShare = empty ? setNewChoice : setChoice;

  const verses = useMemo(() => {
    const seen = new Map<number, string>();
    for (const q of state.memoryQueue) {
      if (q.book === takeaway.book && q.chapter === takeaway.chapter && q.verseNumber >= takeaway.sectionStart && q.verseNumber <= takeaway.sectionEnd && !seen.has(q.verseNumber)) {
        seen.set(q.verseNumber, q.text);
      }
    }
    return [...seen.entries()].sort((a, b) => a[0] - b[0]);
  }, [state.memoryQueue, takeaway.book, takeaway.chapter, takeaway.sectionStart, takeaway.sectionEnd]);

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(16) }} keyboardShouldPersistTaps="handled">
      <ScreenHeader title={empty ? 'Takeaway' : 'Your takeaway'} onBack={onClose} backLabel="Path" />
      <SectionTitle index={index} label={label} name={name} />
      {empty && (
        <View className="flex-row">
          <Badge label="Not written yet" tone="neutral" />
        </View>
      )}

      <TakeawayForm
        key={takeaway.id + takeaway.updatedAt}
        initialText={takeaway.text}
        initialNote={takeaway.note ?? ''}
        saveLabel="Save"
        onSave={(text, note) => {
          void state.saveTakeaway(spot, { text, note, status: 'saved', sharedTo: nextSharedTo(takeaway.sharedTo, share, offered) });
          state.setLastShareChoice(share);
          onClose();
        }}
        shareSlot={<ShareSwitch circles={state.myCircles} value={share} onChange={setShare} />}
      />

      {verses.length > 0 && (
        <View style={{ gap: space(8) }}>
          <Pressable onPress={() => setShowVerses((v) => !v)} accessibilityRole="button" className="flex-row items-center self-start active:opacity-60" style={{ gap: space(4), minHeight: 44 }}>
            <AppText variant="caption" className="font-sans font-semibold text-ink-3">
              {showVerses ? 'Hide the verses' : 'Show the verses'}
            </AppText>
            {showVerses ? <ChevronUp size={16} color={palette.ink3} /> : <ChevronDown size={16} color={palette.ink3} />}
          </Pressable>
          {showVerses && (
            <View className="bg-surface-2 border border-line rounded-card" style={{ padding: space(12), gap: space(6) }}>
              {verses.map(([n, text]) => (
                <AppText key={n} variant="label" className="font-serif text-ink-2">
                  <AppText variant="caption" className="font-sans font-bold text-ink-3">{n}  </AppText>
                  {text}
                </AppText>
              ))}
            </View>
          )}
        </View>
      )}

      <AppButton
        variant="quiet"
        Icon={Trash2}
        label={empty ? 'Remove this stop' : 'Remove this takeaway'}
        onPress={() => {
          void state.deleteTakeaway(takeaway.id);
          onClose();
        }}
      />
    </ScrollView>
  );
}

// ----------------------------------------------------------------------------
// With my circle
// ----------------------------------------------------------------------------

/** One person's shared takeaway in the circle's list. */
function CircleItem({ item, replies, myUid, onOpen }: { item: SharedTakeaway; replies: number; myUid?: string; onOpen: () => void }) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const who = authorShort(item, myUid);
  const name = spotName(item);
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${who}, ${item.label || name}: ${item.text}. ${replyCountText(replies)}`}
      className="flex-row bg-surface border border-line rounded-card active:opacity-70 overflow-hidden"
    >
      {/* layout-ok: the author's section's bracket color, a bar with no text. */}
      <View style={{ width: Math.max(4, Math.round(space(4))), backgroundColor: bracketColor(palette, item.bracketIndex) }} />
      <View className="flex-1" style={{ padding: space(12), gap: space(6) }}>
        <View className="flex-row items-baseline flex-wrap" style={{ columnGap: space(8) }}>
          <AppText variant="label" className="font-sans font-bold text-ink">
            {who}
          </AppText>
          <AppText variant="caption" className="font-sans text-ink-3">
            {formatTimeAgo(item.createdAt)}
          </AppText>
        </View>
        <View style={{ gap: space(1) }}>
          <AppText variant="caption" className="font-sans font-semibold text-ink-2">
            {item.label || name}
          </AppText>
          {item.label ? (
            <AppText variant="caption" className="font-sans text-ink-3">
              {name}
            </AppText>
          ) : null}
        </View>
        <AppText variant="label" className="font-serif text-ink" numberOfLines={STOP_LINE + 1}>
          {item.text}
        </AppText>
        <View className="flex-row items-center flex-wrap" style={{ gap: space(6) }}>
          <MessageCircle size={Math.round(14 * scale)} color={palette.ink3} />
          <AppText variant="caption" className="font-sans text-ink-3">
            {replyCountText(replies)}
            {item.note ? ' · a note' : ''}
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

function CircleView({ state, circleId, onOpen }: { state: AppState; circleId: string; onOpen: (docId: string) => void }) {
  const space = useScaledSpace();
  const { loadCircleTakeaways } = state;
  useEffect(() => {
    void loadCircleTakeaways(circleId);
    // Reload when the circle changes; loadCircleTakeaways is remade each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleId]);
  const entry = state.circleTakeaways[circleId];
  const list = useMemo(
    () => circleList(entry?.items ?? [], { blockedUids: state.blockedUids, memberUids: entry?.memberUids ?? null }),
    [entry, state.blockedUids]
  );

  if (!entry || (entry.loading && entry.items.length === 0)) {
    return (
      <AppText variant="caption" className="font-sans text-ink-3 text-center" style={{ paddingVertical: space(24) }}>
        Loading…
      </AppText>
    );
  }
  if (list.length === 0) {
    return (
      <EmptyState
        Icon={Users}
        title="Nothing shared yet"
        message="When someone in this circle shares a takeaway, it shows here. Share one of yours from its stop on the path."
      />
    );
  }
  return (
    <View style={{ gap: space(10) }}>
      {list.map((t) => (
        <CircleItem
          key={t.id}
          item={t}
          myUid={state.user?.uid}
          replies={visibleReplies(state.takeawayReplies[replyKey(circleId, t.id)] ?? [], state.blockedUids).length}
          onOpen={() => onOpen(t.id)}
        />
      ))}
    </View>
  );
}

/** A shared takeaway, opened: the takeaway, the author's note, then the replies and a reply box. */
function OpenedShared({ state, item, circleName, onClose }: { state: AppState; item: SharedTakeaway; circleName: string; onClose: () => void }) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const myUid = state.user?.uid;
  const mine = item.authorUid === myUid;
  const who = authorShort(item, myUid);
  const key = replyKey(item.circleId, item.id);
  const { watchTakeawayReplies } = state;
  useEffect(() => watchTakeawayReplies(item.circleId, item.id),
    // Watch the one that's open; watchTakeawayReplies is remade each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item.circleId, item.id]);
  const replies = visibleReplies(state.takeawayReplies[key] ?? [], state.blockedUids);

  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    const ok = await state.postTakeawayReply(item.circleId, item.id, draft);
    setSending(false);
    if (ok) setDraft('');
  };

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerClassName="p-5 pb-12"
      contentContainerStyle={{ gap: space(16) }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <ScreenHeader title={mine ? 'Your takeaway' : `${who}'s takeaway`} onBack={onClose} backLabel={circleName} subtitle={formatTimeAgo(item.createdAt)} />
      <SectionTitle index={item.bracketIndex} label={item.label} name={spotName(item)} />

      <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(12) }}>
        <AppText variant="body" className="font-serif text-ink">
          {item.text}
        </AppText>
        {item.note ? (
          <View className="border-t border-hairline" style={{ paddingTop: space(10), gap: space(4) }}>
            <AppText variant="caption" className="font-sans font-semibold text-ink-3">
              {mine ? 'Your note' : `${who}'s note`}
            </AppText>
            <AppText variant="label" className="font-sans text-ink-2">
              {item.note}
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={{ gap: space(10) }}>
        <View className="flex-row items-center" style={{ gap: space(6) }}>
          <MessageCircle size={Math.round(16 * scale)} color={palette.ink2} />
          <AppText variant="label" className="font-sans font-semibold text-ink-2">
            {replyCountText(replies.length)}
          </AppText>
        </View>
        {replies.map((r) => (
          <View key={r.id} className="flex-row items-start bg-surface-2 rounded-card" style={{ padding: space(10), gap: space(8) }}>
            <View className="flex-1" style={{ gap: space(2) }}>
              <View className="flex-row items-baseline flex-wrap" style={{ columnGap: space(8) }}>
                <AppText variant="caption" className="font-sans font-bold text-ink">
                  {r.fromUid === myUid ? 'You' : r.fromName}
                </AppText>
                <AppText variant="caption" className="font-sans text-ink-3">
                  {formatTimeAgo(r.createdAt)}
                </AppText>
              </View>
              <AppText variant="label" className="font-sans text-ink">
                {r.text}
              </AppText>
            </View>
            {r.fromUid === myUid ? (
              <AppIconButton
                Icon={Trash2}
                diameter={28}
                iconColor={palette.ink3}
                accessibilityLabel="Delete your reply"
                onPress={() => void state.deleteTakeawayReply(item.circleId, item.id, r.id)}
              />
            ) : null}
          </View>
        ))}
        <View className="flex-row items-end" style={{ gap: space(8) }}>
          <AppTextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={mine ? 'Reply' : `Reply to ${who}`}
            accessibilityLabel="Reply"
            variant="body"
            multiline
            maxLength={REPLY_MAX}
            className="flex-1 bg-surface border border-line rounded-btn text-ink font-sans"
            style={{ paddingHorizontal: space(12), paddingVertical: space(8), minHeight: space(40), maxHeight: 120 }}
          />
          <AppIconButton Icon={Send} variant="filled" diameter={40} onPress={() => void send()} disabled={!draft.trim() || sending} accessibilityLabel="Send reply" />
        </View>
      </View>
    </ScrollView>
  );
}

export default function TakeawaysScreen({ state }: { state: AppState }) {
  const { memoryQueue, sectionsForChapter, takeaways, handleBack, myCircles } = state;
  const space = useScaledSpace();
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<View_>('mine');
  const [circleId, setCircleId] = useState<string | null>(null);
  const [openShared, setOpenShared] = useState<string | null>(null);

  // Only circles the user is in now: leaving or being removed hides a circle's takeaways.
  const circle = myCircles.find((c) => c.id === circleId) ?? myCircles[0] ?? null;

  const dates = useMemo(() => heldDates(memoryQueue), [memoryQueue]);
  const next = nextLine(ladderPosition(dates.length));
  const entries = useMemo(
    () => buildPath(takeaways, sectionStatuses(memoryQueue, sectionsForChapter), sectionsForChapter, landmarkDates(dates)),
    // sectionsForChapter is remade each render; chapterSections is what it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [takeaways, memoryQueue, dates, state.chapterSections]
  );
  const opened = openId ? takeaways[openId] : null;
  if (view === 'mine' && opened) {
    return (
      <FadeInView style={{ flex: 1 }}>
        <Opened state={state} takeaway={opened} onClose={() => setOpenId(null)} />
      </FadeInView>
    );
  }
  const sharedItem = view === 'circle' && circle && openShared ? state.circleTakeaways[circle.id]?.items.find((t) => t.id === openShared) : null;
  if (sharedItem && circle) {
    return (
      <FadeInView style={{ flex: 1 }}>
        <OpenedShared state={state} item={sharedItem} circleName={circle.name} onClose={() => setOpenShared(null)} />
      </FadeInView>
    );
  }

  const written = Object.values(takeaways).filter((t) => t.status !== 'draft' && t.status !== 'later' && t.text.trim()).length;
  const subtitle =
    view === 'circle'
      ? 'What your circle took away. Open one to see replies.'
      : written === 0
        ? 'The main point of each section, in your own words.'
        : `${written} written. Newest on top.`;
  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(16) }}>
        <ScreenHeader title="Takeaways" onBack={handleBack} subtitle={subtitle} />
        <SegmentedControl<View_>
          options={[
            { id: 'mine', label: 'Mine' },
            { id: 'circle', label: 'With my circle' },
          ]}
          value={view}
          onChange={setView}
          accessibilityLabel="Whose takeaways"
        />
        {view === 'circle' ? (
          !circle ? (
            <EmptyState
              Icon={Users}
              title="You're not in a circle yet"
              message="Join or start a circle in Community. Then you can share takeaways there and see what others took away."
            />
          ) : (
            <>
              {myCircles.length > 1 && (
                <SegmentedControl<string>
                  options={myCircles.map((c) => ({ id: c.id, label: c.name }))}
                  value={circle.id}
                  onChange={(id) => setCircleId(id)}
                  accessibilityLabel="Which circle"
                  wrap
                />
              )}
              <CircleView state={state} circleId={circle.id} onOpen={setOpenShared} />
            </>
          )
        ) : entries.length === 0 ? (
          <EmptyState
            Icon={Bookmark}
            title="Nothing here yet"
            message="When every verse of a section is in weekly reviews, you'll be asked for its main point. It lands here, one stop at a time."
          />
        ) : (
          <>
            {next && dates.length > 0 ? (
              <AppText variant="label" className="font-sans text-ink-2">
                {next}
              </AppText>
            ) : null}
            <Path entries={entries} onOpen={setOpenId} />
          </>
        )}
      </ScrollView>
    </FadeInView>
  );
}
