import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Info, Plus } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, NumericInput } from '../components/ui';
import { AppButton, AppText, Card, useFontScale, useScaledSpace } from '../components/design';
import { ScreenHeader, SectionHeader } from '../components/blocks';
import { BookPicker } from '../components/BookPicker';
import { Dropdown } from '../components/Dropdown';
import { useThemeColors } from '../components/theme';
import { PICKER_TRANSLATIONS, getBookByName, textScriptFor, translationLabel } from '../data';
import { useChapterText } from '../state/useScripture';

const TRANSLATION_OPTIONS = PICKER_TRANSLATIONS.map((t) => ({ id: t.id, label: translationLabel(t.id) }));

/** "Romans 8:28" or "Romans 8:28-30". */
const refFor = (book: string, chapter: number, start: number, end: number) =>
  `${book} ${chapter}:${start}${end > start ? `-${end}` : ''}`;

/** Sorted verse numbers as a reference: "Romans 8:28-30", or "Romans 8:28, 30" when there are gaps. */
const refForVerses = (book: string, chapter: number, verses: number[]) =>
  verses.length > 0 && verses[verses.length - 1] - verses[0] === verses.length - 1
    ? refFor(book, chapter, verses[0], verses[verses.length - 1])
    : `${book} ${chapter}:${verses.join(', ')}`;

// ============================================================================
// ADD VERSES — its own screen, so Today's Coming up next card and My Verses
// can both open it and Back returns to whichever you came from. It used to be
// a form inline on My Verses, below two settings cards, and always added BSB.
//
// A full screen rather than a sheet: the verse fields use the shared keyboard
// Done bar, which a Modal would need its own copy of (see ui.tsx).
//
// The translation is your usual one (selectedTranslationId, remembered on the
// device), and changing it here changes it on the chapter page too -- one
// choice, not two that drift apart.
// ============================================================================
export default function AddVersesScreen({ state }: { state: AppState }) {
  const {
    handleBack,
    triggerToast,
    memoryQueue,
    addVerseRangeToQueue,
    selectedAddBook,
    setSelectedAddBook,
    selectedAddChapter,
    setSelectedAddChapter,
    selectedTranslationId,
    setSelectedTranslationId,
  } = state;
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();

  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');
  const [adding, setAdding] = useState(false);

  const book = selectedAddBook;
  const chapter = selectedAddChapter;
  const translation = selectedTranslationId;
  const bookMeta = getBookByName(book);
  const chapterOptions = bookMeta
    ? Array.from({ length: bookMeta.chapters }, (_, i) => ({ id: i + 1, label: String(i + 1) }))
    : [];
  const { data: chapterData } = useChapterText(translation, bookMeta?.id ?? null, chapter || null);
  const verseCount = chapterData?.verseCount ?? 0;

  // Blank last verse = just the first one. Both are kept inside the chapter,
  // and a backwards range is read the right way round.
  const clamp = (n: number) => Math.max(1, verseCount ? Math.min(n, verseCount) : n);
  const parsedStart = parseInt(startText, 10);
  const parsedEnd = parseInt(endText, 10);
  const hasStart = !Number.isNaN(parsedStart);
  const a = hasStart ? clamp(parsedStart) : 0;
  const b = Number.isNaN(parsedEnd) ? a : clamp(parsedEnd);
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  const range = hasStart ? Array.from({ length: end - start + 1 }, (_, i) => start + i) : [];

  // What's already on your list for this range. The same verse in the same
  // translation is skipped; in a different translation it's a separate copy
  // with its own progress (see buildVerseId), which is worth saying before
  // it happens rather than after.
  const onList = memoryQueue.filter(
    (q) => q.book === book && q.chapter === chapter && q.verseNumber >= start && q.verseNumber <= end
  );
  const sameTranslation = new Set(
    onList.filter((q) => (q.translationId || 'ESV') === translation).map((q) => q.verseNumber)
  );
  const otherCopies = onList.filter(
    (q) => (q.translationId || 'ESV') !== translation && !sameTranslation.has(q.verseNumber)
  );
  const otherTranslations = Array.from(new Set(otherCopies.map((q) => translationLabel(q.translationId || 'ESV'))));
  const otherVerses = Array.from(new Set(otherCopies.map((q) => q.verseNumber))).sort((x, y) => x - y);
  const newCount = range.filter((v) => !sameTranslation.has(v) && (!chapterData || chapterData.verses[String(v)])).length;

  const script = textScriptFor(translation, book);
  const previewVerses = chapterData ? range.filter((v) => chapterData.verses[String(v)]) : [];
  const trLabel = translationLabel(translation);

  const canAdd = !!bookMeta && chapter > 0 && hasStart && newCount > 0 && !adding;

  const add = async () => {
    if (!canAdd) return;
    setAdding(true);
    const result = await addVerseRangeToQueue(book, chapter, start, end, translation);
    setAdding(false);
    if (result.error) {
      triggerToast(result.error);
      return;
    }
    const skipped = [
      result.alreadyThere > 0 ? `${result.alreadyThere} already on your list` : null,
      result.missingText > 0 ? `${result.missingText} had no text available` : null,
    ].filter(Boolean);
    triggerToast(
      `Added ${refFor(book, chapter, start, end)} (${trLabel}) to My Verses.${skipped.length ? ` (${skipped.join(', ')}, skipped)` : ''}`
    );
    handleBack();
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
  // Chapter and translation share a row, as do the two verse fields; each pair
  // wraps when the text is big rather than squeezing.
  const half = { flexGrow: 1, flexBasis: space(120), gap: space(4) };

  const buttonLabel = adding
    ? 'Adding…'
    : newCount > 1
      ? `Add ${newCount} verses`
      : newCount === 1
        ? 'Add 1 verse'
        : 'Add verses';

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView
        className="flex-1 bg-canvas"
        contentContainerClassName="p-5 pb-12"
        contentContainerStyle={{ gap: space(20) }}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader title="Add verses" subtitle="They go to the end of My own verses." onBack={handleBack} />

        <Card gap={12}>
          <View style={{ gap: space(4) }}>
            {label('Book')}
            <BookPicker
              value={book}
              placeholder="Choose a book"
              onChange={(next) => {
                if (next === book) return;
                setSelectedAddBook(next);
                setSelectedAddChapter(1);
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
                  setSelectedAddChapter(n);
                  setStartText('');
                  setEndText('');
                }}
              />
            </View>
            <View style={half}>
              {label('Translation')}
              <Dropdown value={translation} options={TRANSLATION_OPTIONS} title="Translation" onChange={setSelectedTranslationId} />
            </View>
          </View>

          <View style={{ gap: space(4) }}>
            {label('Verses', verseCount ? `of ${verseCount}` : undefined)}
            <View className="flex-row items-center" style={{ gap: space(8) }}>
              <View className="flex-1">
                <NumericInput
                  value={startText}
                  onChangeText={setStartText}
                  accessibilityLabel="First verse"
                  placeholder="First"
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
                  accessibilityLabel="Last verse"
                  placeholder="Last"
                  className={numberInput}
                  style={numberStyle}
                />
              </View>
            </View>
            <AppText variant="caption" className="font-sans text-ink-3">
              For one verse, leave the last box empty.
            </AppText>
          </View>
        </Card>

        {otherVerses.length > 0 && (
          <View className="flex-row bg-accent-soft rounded-btn" style={{ gap: space(10), padding: space(12) }}>
            <View style={{ paddingTop: space(2) }}>
              <Info size={Math.round(18 * scale)} color={palette.accent} />
            </View>
            <AppText variant="caption" className="font-sans text-ink flex-1">
              {`${refForVerses(book, chapter, otherVerses)} ${
                otherVerses.length === 1 ? 'is' : 'are'
              } already on your list in ${otherTranslations.join(' and ')}. Adding ${trLabel} starts a separate copy with its own progress.`}
            </AppText>
          </View>
        )}

        {previewVerses.length > 0 && chapterData && (
          <View style={{ gap: space(6) }}>
            <SectionHeader title={`Preview · ${trLabel}`} />
            <Card gap={8}>
              {previewVerses.map((v) => (
                <View key={v} className="flex-row" style={{ gap: space(8) }}>
                  <AppText
                    variant="caption"
                    className="font-sans font-semibold text-ink-3"
                    style={{ minWidth: space(20), paddingTop: space(3), fontVariant: ['tabular-nums'] }}
                  >
                    {v}
                  </AppText>
                  <AppText variant="body" script={script} className="font-serif leading-relaxed text-ink flex-1">
                    {chapterData.verses[String(v)]}
                  </AppText>
                </View>
              ))}
            </Card>
          </View>
        )}

        <View style={{ gap: space(8) }}>
          <AppButton size="lg" variant="primary" Icon={Plus} label={buttonLabel} disabled={!canAdd} onPress={add} />
          <AppText variant="caption" className="font-sans text-ink-3 text-center">
            {hasStart && newCount === 0 && range.length > 0
              ? `${range.length === 1 ? 'This is' : 'These are'} already on your list in ${trLabel}.`
              : sameTranslation.size > 0
                ? `${refForVerses(book, chapter, [...sameTranslation].sort((x, y) => x - y))} ${
                    sameTranslation.size === 1 ? 'is' : 'are'
                  } already on your list in ${trLabel}, so ${sameTranslation.size === 1 ? 'it' : 'they'}'ll be skipped.`
                : `${trLabel} stays picked for next time.`}
          </AppText>
        </View>
      </ScrollView>
    </FadeInView>
  );
}
