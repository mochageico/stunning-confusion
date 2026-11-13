import React, { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from 'lucide-react-native';

import type { ListenPlaylist, QueueItem } from '../../types';
import { AppButton, AppIconButton, AppText, AppTextInput, useFontScale, useScaledSpace } from '../design';
import { useThemeColors } from '../theme';
import { PickedTray, VerseSourcePicker, usePickedVerses, type Passage } from '../versePicker/VersePicker';

// ============================================================================
// PLAYLIST EDITOR
// ----------------------------------------------------------------------------
// Builds or edits a Listen playlist. Verses are picked with the shared verse
// picker (components/versePicker): My verses or Browse the Bible, one
// selection. The tray at the bottom lists what's in the playlist, by passage, in play
// order. Reorder swaps the picker for a list of those passages to drag (or
// nudge with the arrows) into the order they should play.
// ============================================================================

/** A default name from the first passages picked: "Romans 8 + Isaiah 55". */
function suggestedName(passages: Passage[]) {
  const chapters: string[] = [];
  for (const p of passages) {
    const c = `${p.verses[0].book} ${p.verses[0].chapter}`;
    if (!chapters.includes(c)) chapters.push(c);
  }
  if (chapters.length === 0) return 'My playlist';
  return chapters.length <= 2 ? chapters.join(' + ') : `${chapters[0]} + ${chapters.length - 1} more`;
}

export function PlaylistEditor({
  visible,
  playlist,
  memoryQueue,
  preferredTranslationId,
  onSave,
  onDelete,
  onClose,
}: {
  visible: boolean;
  /** The playlist being edited, or null for a new one. */
  playlist: ListenPlaylist | null;
  memoryQueue: QueueItem[];
  preferredTranslationId?: string;
  onSave: (playlist: ListenPlaylist) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const { picked, pickedPassages, addVerses, removeVerses, reset } = usePickedVerses();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reordering, setReordering] = useState(false);
  // Bumped on each open so the picker remounts with a fresh tab, search and
  // open passage.
  const [opened, setOpened] = useState(0);

  // Fresh state each time the editor opens.
  useEffect(() => {
    if (!visible) return;
    setName(playlist?.name ?? '');
    reset(playlist?.verses ?? []);
    setConfirmDelete(false);
    setReordering(false);
    setOpened((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Rebuilds `picked` in the given passage order, which is what play order
  // is read from.
  const setPassageOrder = (passages: Passage[]) => reset(passages.flatMap((p) => p.verses));
  const movePassage = (from: number, to: number) => {
    if (to < 0 || to >= pickedPassages.length) return;
    const next = [...pickedPassages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setPassageOrder(next);
  };

  const save = () => {
    const verses = pickedPassages.flatMap((p) => p.verses);
    if (verses.length === 0) return;
    onSave({
      id: playlist?.id ?? `pl_${Date.now().toString(36)}`,
      name: name.trim() || suggestedName(pickedPassages),
      verses,
      updatedAt: new Date().toISOString(),
    });
  };

  const verseCount = picked.size;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      {/* GestureHandlerRootView inside the Modal: on Android a Modal is its
          own window, and Browse's drag-select needs a gesture root there. */}
      <GestureHandlerRootView
        // A style, not className: GestureHandlerRootView isn't a styled
        // component, so flex-1 was dropped and the tray ran off the screen.
        style={{ flex: 1, backgroundColor: palette.surface, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }}
      >
        <View className="px-4 flex-1" style={{ gap: space(10) }}>
          {/* Header */}
          <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
            <AppButton size="sm" variant="quiet" label="Cancel" onPress={onClose} />
            <AppText variant="section" className="font-sans font-bold text-ink flex-1 text-center" numberOfLines={1}>
              {playlist ? 'Edit playlist' : 'New playlist'}
            </AppText>
            <AppButton
              size="sm"
              variant="primary"
              label="Save"
              onPress={save}
              accessibilityHint={verseCount === 0 ? 'Pick at least one verse first' : undefined}
              className={verseCount === 0 ? 'opacity-40' : ''}
            />
          </View>

          <AppTextInput
            value={name}
            onChangeText={setName}
            placeholder={pickedPassages.length > 0 ? suggestedName(pickedPassages) : 'Playlist name'}
            accessibilityLabel="Playlist name"
            className="bg-surface-2 border border-line rounded-btn text-ink font-sans"
            style={{ paddingHorizontal: space(12), paddingVertical: space(10) }}
            returnKeyType="done"
          />

          {/* The picker stays mounted while reordering (just hidden), so its
              tab and search survive a trip to Reorder and back. */}
          {reordering && <PassageOrder passages={pickedPassages} onReorder={setPassageOrder} onMove={movePassage} />}
          <View className="flex-1" style={{ display: reordering ? 'none' : 'flex' }}>
            <VerseSourcePicker
              key={opened}
              memoryQueue={memoryQueue}
              picked={picked}
              addVerses={addVerses}
              removeVerses={removeVerses}
              initialTab={memoryQueue.length > 0 ? 'mine' : 'browse'}
              startTranslationId={preferredTranslationId}
              startAt={pickedPassages[0]?.verses[0]}
            />
          </View>

          {/* Tray: what's in the playlist so far. */}
          <PickedTray
            pickedPassages={pickedPassages}
            verseCount={verseCount}
            removeVerses={removeVerses}
            hideChips={reordering}
            actions={
              <>
                {(pickedPassages.length > 1 || reordering) && (
                  <AppButton
                    size="sm"
                    variant={reordering ? 'primary' : 'quiet'}
                    Icon={reordering ? undefined : GripVertical}
                    label={reordering ? 'Done' : 'Reorder'}
                    onPress={() => setReordering(!reordering)}
                  />
                )}
                {playlist && onDelete && !reordering && (
                  <AppButton
                    size="sm"
                    variant={confirmDelete ? 'destructive' : 'quiet'}
                    Icon={Trash2}
                    label={confirmDelete ? 'Tap again to delete' : 'Delete'}
                    onPress={() => (confirmDelete ? onDelete(playlist.id) : setConfirmDelete(true))}
                  />
                )}
              </>
            }
          />
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

// ----------------------------------------------------------------------------
// Reorder: the playlist's passages in play order. Hold the grip to drag, or
// use the arrows (which also work where dragging is awkward, and with a
// screen reader).
// ----------------------------------------------------------------------------
function PassageOrder({
  passages,
  onReorder,
  onMove,
}: {
  passages: Passage[];
  onReorder: (passages: Passage[]) => void;
  onMove: (from: number, to: number) => void;
}) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const scale = useFontScale();
  const iconSize = Math.round(18 * scale);
  return (
    <View className="flex-1" style={{ gap: space(8) }}>
      <AppText variant="caption" className="font-sans text-ink-3">
        Plays top to bottom. Hold the handle to drag a passage, or use the arrows.
      </AppText>
      <DraggableFlatList
        data={passages}
        keyExtractor={(p) => p.key}
        containerStyle={{ flex: 1 }}
        contentContainerStyle={{ gap: space(6), paddingBottom: space(8) }}
        onDragEnd={({ data }) => onReorder(data)}
        renderItem={({ item, drag, isActive, getIndex }: RenderItemParams<Passage>) => {
          const index = getIndex() ?? 0;
          return (
            <View
              className={`rounded-btn border flex-row items-center ${isActive ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
              style={{ paddingVertical: space(6), paddingLeft: space(6), paddingRight: space(4), gap: space(6) }}
            >
              <Pressable
                onLongPress={drag}
                delayLongPress={200}
                hitSlop={10}
                accessibilityLabel={`Hold to move ${item.label}`}
                style={{ padding: space(6) }}
              >
                <GripVertical size={iconSize} color={palette.ink3} />
              </Pressable>
              <AppText
                variant="caption"
                className="font-sans font-semibold text-ink-3"
                style={{ minWidth: space(18), fontVariant: ['tabular-nums'] }}
              >
                {index + 1}
              </AppText>
              <AppText variant="label" className="font-sans font-semibold text-ink flex-1" numberOfLines={1}>
                {item.label}
              </AppText>
              <AppIconButton
                variant="bare"
                Icon={ArrowUp}
                diameter={iconSize + 22}
                iconColor={index === 0 ? palette.line : palette.ink2}
                accessibilityLabel={`Move ${item.label} up`}
                onPress={() => onMove(index, index - 1)}
              />
              <AppIconButton
                variant="bare"
                Icon={ArrowDown}
                diameter={iconSize + 22}
                iconColor={index === passages.length - 1 ? palette.line : palette.ink2}
                accessibilityLabel={`Move ${item.label} down`}
                onPress={() => onMove(index, index + 1)}
              />
            </View>
          );
        }}
      />
    </View>
  );
}
