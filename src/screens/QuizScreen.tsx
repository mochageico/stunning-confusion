import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Target } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { fetchChapterText } from '../state/useScripture';
import { threadSpan } from '../lib/drills';
import { normalizeToken, scriptOfVerse } from '../lib/textScript';
import { summarizeOutcomes, WordOutcome } from '../lib/recitation';
import { quizShownWords } from '../lib/chatAttachments';
import GradedRecitation, { canSpeakVerses, RecitationMode, RecitationVerse } from '../components/GradedRecitation';
import { FadeInView } from '../components/ui';
import { AppButton, AppText, useScaledSpace } from '../components/design';
import { EmptyState, ScreenHeader } from '../components/blocks';

/**
 * A friend's quiz (sent from a DM, see chatAttachments.ts): one of my own
 * verses with some words hidden, recited by voice or typed, graded word by
 * word, and the score sent back to the chat. Practice only -- it never calls
 * the review engine, so it can't move a verse forward or back.
 */
export default function QuizScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const { activeQuiz, closeQuiz, handleBack, finishQuiz } = state;
  const [verse, setVerse] = useState<RecitationVerse | null | undefined>(undefined);
  const [mode, setMode] = useState<RecitationMode | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [score, setScore] = useState<number | null>(null);

  const a = activeQuiz?.attachment;

  useEffect(() => {
    if (!a) return;
    let live = true;
    fetchChapterText(a.translationId, a.bookId, a.chapter)
      .then((ch) => {
        const text = ch?.verses[String(a.verse)];
        if (live) setVerse(text ? { book: a.book, chapter: a.chapter, verse: a.verse, text, translationId: a.translationId } : null);
      })
      .catch(() => live && setVerse(null));
    return () => {
      live = false;
    };
  }, [a?.translationId, a?.bookId, a?.chapter, a?.verse]);

  const verses = useMemo(() => (verse ? [verse] : []), [verse]);

  // Same hidden words every time this quiz is opened (seeded by the message).
  const shown = useMemo(() => {
    if (!verse || !a || !activeQuiz) return undefined;
    const script = scriptOfVerse(verse);
    const span = threadSpan(verses, { startVerse: 0, startWord: 0, endVerse: 0, cueWords: [] });
    const count = span.reduce((n, sv) => n + sv.words.filter((w) => normalizeToken(w, script).length > 0).length, 0);
    return quizShownWords(count, a.hidePercent, activeQuiz.messageId);
  }, [verse, verses, a?.hidePercent, activeQuiz?.messageId]);

  if (!activeQuiz || !a) return null;

  const goBack = () => {
    closeQuiz();
    handleBack();
  };

  const ref = `${a.book} ${a.chapter}:${a.verse}`;
  const hidden = a.hidePercent >= 100 ? 'every word hidden' : `${a.hidePercent}% of the words hidden`;

  const onResult = (perVerse: WordOutcome[][]) => {
    const pct = Math.round(summarizeOutcomes(perVerse.flat()).accuracy * 100);
    setScore(pct);
    void finishQuiz(pct);
  };

  return (
    <FadeInView style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas" style={{ padding: space(20), gap: space(16) }}>
        <ScreenHeader title={ref} subtitle={`${activeQuiz.fromName.split(' ')[0]}'s quiz · ${a.translationId}`} onBack={goBack} backLabel="Chat" />

        {verse === undefined ? (
          <AppText variant="label" className="font-sans text-ink-3">
            Loading the verse…
          </AppText>
        ) : verse === null ? (
          <EmptyState Icon={Target} title="Couldn't load this verse" message="Check your connection and try again." />
        ) : score !== null ? (
          <View style={{ gap: space(16) }}>
            <View className="bg-surface border border-line rounded-card items-center" style={{ padding: space(20), gap: space(6) }}>
              <AppText variant="display" className="font-sans font-bold text-ink">
                {score}%
              </AppText>
              <AppText variant="body" className="font-sans text-ink-2 text-center">
                {score >= 90 ? 'Well done.' : score >= 60 ? 'Nearly there.' : 'Good practice.'} Your score was sent to {activeQuiz.fromName.split(' ')[0]}.
              </AppText>
            </View>
            <AppButton
              variant="secondary"
              label="Try again"
              onPress={() => {
                setScore(null);
                setMode(null);
                setAttempt((n) => n + 1);
              }}
            />
            <AppButton variant="primary" label="Back to the chat" onPress={goBack} />
          </View>
        ) : mode === null ? (
          <View style={{ gap: space(12) }}>
            <AppText variant="body" className="font-sans text-ink-2">
              Recite {ref} with {hidden}. This is just practice. It won't change when the verse comes up for review.
            </AppText>
            {canSpeakVerses(verses) ? <AppButton size="lg" variant="primary" label="Say it" onPress={() => setMode('speak')} /> : null}
            <AppButton size="lg" variant={canSpeakVerses(verses) ? 'secondary' : 'primary'} label="Type first letters" onPress={() => setMode('type')} />
          </View>
        ) : (
          <GradedRecitation
            key={`${mode}:${attempt}`}
            verses={verses}
            startVerse={0}
            startWord={0}
            endVerse={0}
            mode={mode}
            shownWords={shown}
            showHeard
            continueLabel="Send my score"
            onCancel={() => setMode(null)}
            onSwitchMode={(to) => {
              setMode(to);
              setAttempt((n) => n + 1);
            }}
            onResult={onResult}
          />
        )}
      </View>
    </FadeInView>
  );
}
