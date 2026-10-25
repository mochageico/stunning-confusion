import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { BookPicker } from './BookPicker';
import { Dropdown } from './Dropdown';
import { NumericInput, NumericKeyboardAccessory } from './ui';
import { AppButton, AppText, useScaledSpace } from './design';
import { Dialog } from './blocks';
import { getBookByName, translationLabel } from '../data';
import { useChapterText } from '../state/useScripture';
import { usePickerTranslations } from '../state/usePickerTranslations';

const ACCESSORY_ID = 'recordPassageSheet';

export type RecordPassage = {
  book: string;
  chapter: number;
  translation: string;
  /** null = from verse 1. */
  start: number | null;
  /** null = to the chapter's last verse. */
  end: number | null;
};

/**
 * What the Record tab is about to record, picked in a sheet so the page itself
 * can give its room to the text. Edits are a draft until Done.
 *
 * A new book clears the chapter and the verses; a new chapter clears the
 * verses. A range picked for one chapter never carries over to another, and
 * the empty fields make it obvious what still needs choosing.
 */
export function RecordPassageSheet({
  visible,
  initial,
  onClose,
  onApply,
}: {
  visible: boolean;
  initial: RecordPassage;
  onClose: () => void;
  onApply: (passage: RecordPassage) => void;
}) {
  const space = useScaledSpace();
  const translationOptions = usePickerTranslations().map((t) => ({ id: t.id, label: translationLabel(t.id) }));
  const [book, setBook] = useState(initial.book);
  const [chapter, setChapter] = useState(initial.chapter);
  const [translation, setTranslation] = useState(initial.translation);
  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');

  // Start each opening from what's currently set, not from an abandoned draft.
  useEffect(() => {
    if (!visible) return;
    setBook(initial.book);
    setChapter(initial.book ? initial.chapter : 0);
    setTranslation(initial.translation);
    setStartText(initial.start != null ? String(initial.start) : '');
    setEndText(initial.end != null ? String(initial.end) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const bookMeta = getBookByName(book);
  const chapterOptions = bookMeta
    ? Array.from({ length: bookMeta.chapters }, (_, i) => ({ id: i + 1, label: String(i + 1) }))
    : [];
  const { data: chapterData } = useChapterText(translation, bookMeta?.id ?? null, chapter || null);
  const verseCount = chapterData?.verseCount ?? 0;

  const canApply = !!book && chapter > 0;

  const apply = () => {
    if (!canApply) return;
    const max = verseCount || Infinity;
    const parse = (text: string) => {
      const n = parseInt(text, 10);
      return Number.isNaN(n) ? null : Math.max(1, Math.min(n, max));
    };
    let start = parse(startText);
    let end = parse(endText);
    if (start != null && end != null && end < start) [start, end] = [end, start];
    // A range that is the whole chapter is stored as "whole chapter".
    if (start === 1 && (end == null || end === verseCount)) start = null;
    if (end === verseCount && start == null) end = null;
    onApply({ book, chapter, translation, start, end });
  };

  const label = (text: string, extra?: string) => (
    <View className="flex-row items-center justify-between">
      <AppText variant="caption" className="font-sans font-medium text-ink-2">
        {text}
      </AppText>
      {extra ? (
        <AppText variant="caption" className="font-sans text-ink-3">
          {extra}
        </AppText>
      ) : null}
    </View>
  );
  const numberInput = 'bg-surface border border-line rounded-btn text-ink font-sans font-semibold text-center';
  const numberStyle = { paddingHorizontal: space(8), paddingVertical: space(10) };
  // The chapter and translation share a row, as do the two verse fields, and
  // each pair wraps when the text is big rather than squeezing.
  const half = { flexGrow: 1, flexBasis: space(120), gap: space(4) };

  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      placement="sheet"
      title="What you're reciting"
      actions={
        <>
          <AppButton variant="quiet" label="Cancel" onPress={onClose} />
          <AppButton variant="primary" label="Done" disabled={!canApply} onPress={apply} />
        </>
      }
    >
      <View style={{ gap: space(12) }}>
        <View style={{ gap: space(4) }}>
          {label('Book')}
          <BookPicker
            value={book}
            placeholder="Choose a book"
            onChange={(next) => {
              if (next === book) return;
              setBook(next);
              setChapter(0);
              setStartText('');
              setEndText('');
            }}
          />
        </View>

        <View className="flex-row flex-wrap" style={{ gap: space(10) }}>
          <View style={half}>
            {label('Chapter')}
            <Dropdown
              value={chapter}
              options={chapterOptions}
              title="Chapter"
              placeholder={book ? 'Choose' : 'Pick a book first'}
              onChange={(next) => {
                const n = Number(next);
                if (n === chapter) return;
                setChapter(n);
                setStartText('');
                setEndText('');
              }}
            />
          </View>
          <View style={half}>
            {label('Translation')}
            <Dropdown value={translation} options={translationOptions} title="Translation" onChange={setTranslation} />
          </View>
        </View>

        <View style={{ gap: space(4) }}>
          {label('Verses', verseCount ? `of ${verseCount}` : undefined)}
          <View className="flex-row items-center" style={{ gap: space(8) }}>
            <View className="flex-1">
              <NumericInput
                value={startText}
                onChangeText={setStartText}
                editable={chapter > 0}
                accessoryID={ACCESSORY_ID}
                accessibilityLabel="First verse"
                placeholder="1"
                className={numberInput}
                style={numberStyle}
              />
            </View>
            <AppText variant="label" className="text-ink-3 font-sans shrink-0">
              to
            </AppText>
            <View className="flex-1">
              <NumericInput
                value={endText}
                onChangeText={setEndText}
                editable={chapter > 0}
                accessoryID={ACCESSORY_ID}
                accessibilityLabel="Last verse"
                placeholder={verseCount ? String(verseCount) : 'end'}
                className={numberInput}
                style={numberStyle}
              />
            </View>
          </View>
          <AppText variant="caption" className="font-sans text-ink-3">
            Leave these blank to record the whole chapter.
          </AppText>
        </View>
      </View>
      <NumericKeyboardAccessory nativeID={ACCESSORY_ID} />
    </Dialog>
  );
}
