import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Bookmark, Check, Eye, EyeOff, Mic, Play, RotateCcw, Square, X } from 'lucide-react-native';

import type { TextScript } from '../../types';
import {
  addDraft,
  DrillSection,
  makeTakeawayDraft,
  TakeawayDraft,
  TEACH_MS,
  teachProgress,
  teachSecondsLeft,
  teachTargets,
  TeachTarget,
  tidyTranscript,
  TEACH_SECONDS,
} from '../../lib/sectionDrills';
import { formatLabel, formatTag } from '../../lib/formatNames';
import { getSpeechRecognizer, SpeechRecognizer } from '../../lib/recitation';
import { isRtl } from '../../lib/textScript';
import { AppButton, AppText, AppTextInput, useFontScale, useScaledSpace } from '../design';
import { bracketColor, useThemeColors } from '../theme';

// ============================================================================
// TEACH-IT -- MIXED_REVIEW_PLAN.md, stage 3
// ----------------------------------------------------------------------------
// "Say it in your own words": pick a section (or a short stretch), start the
// one fixed 10-second timer, and explain what it says as if to someone else.
// Where this device has speech, the transcript shows as you talk; otherwise
// you can type a line afterwards. Then the verses are shown and you mark
// yourself Got it / Not really. Nothing here is graded by the app.
//
// Practice: explaining is not saying the words from memory, so it never
// credits a review. "Save as takeaway draft" keeps what you said, inside this
// drill only, until the takeaways path (stage 6) gives drafts a home.
// ============================================================================

type Phase = 'ready' | 'timing' | 'done';

const RING_STROKE = 8;

/** The countdown ring: fills as the ten seconds run, the seconds left in the middle. */
function TimerRing({ progress, label, size }: { progress: number; label: string; size: number }) {
  const palette = useThemeColors();
  const radius = (size - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    // layout-ok: a ring drawn at a fixed size, scaled by the caller; the number inside is one short word.
    <View style={{ width: size, height: size }} accessible accessibilityRole="timer" accessibilityLabel={`${label} seconds`}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={palette.fill} strokeWidth={RING_STROKE} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={palette.accent}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - progress)}
        />
      </Svg>
      <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
        <AppText variant="display" className="font-sans font-bold text-ink">{label}</AppText>
      </View>
    </View>
  );
}

const referenceOf = (target: TeachTarget) => {
  const first = target.verses[0];
  if (!first) return '';
  const range = target.start === target.end ? `${target.start}` : `${target.start}–${target.end}`;
  return `${first.book} ${first.chapter}:${range}`;
};

export default React.memo(function TeachItDrill({
  verses,
  sections,
  script = 'latin',
  active = true,
}: {
  verses: { book: string; chapter: number; verse: number; text: string; translationId?: string }[];
  /** The chapter's sections as the drills see them; empty when it has none (stretches are taught instead). */
  sections: DrillSection[];
  script?: TextScript;
  /** False while another Recall tab is showing: the timer and mic stop and the round goes back to ready. */
  active?: boolean;
}) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  // At large text the picker above leaves a phone almost no height, so the
  // buttons scroll with the rest instead of staying pinned below it.
  const compact = useFontScale() >= 1.3;
  const rtl = isRtl(script);

  const targets = useMemo(() => teachTargets(verses, sections), [verses, sections]);
  const targetsKey = targets.map((t) => t.key).join('|');
  const [targetKey, setTargetKey] = useState(() => targets[0]?.key ?? '');
  const target = targets.find((t) => t.key === targetKey) ?? targets[0];

  const [phase, setPhase] = useState<Phase>('ready');
  const [elapsed, setElapsed] = useState(0);
  const [heard, setHeard] = useState('');
  const [text, setText] = useState('');
  const [verdict, setVerdict] = useState<'got' | 'not' | null>(null);
  const [showVerses, setShowVerses] = useState(false);
  const [marks, setMarks] = useState<Record<string, 'got' | 'not'>>({});
  const [drafts, setDrafts] = useState<TakeawayDraft[]>([]);
  const [savedNow, setSavedNow] = useState(false);
  const [speechFailed, setSpeechFailed] = useState(false);

  const speakable = useMemo(() => getSpeechRecognizer() !== null, []);
  const listening = speakable && !speechFailed;

  // ---- Speech ---------------------------------------------------------------
  const engineRef = useRef<SpeechRecognizer | null>(null);
  const heardRef = useRef('');
  const stopEngine = useCallback(() => {
    const engine = engineRef.current;
    engineRef.current = null;
    try {
      engine?.stop();
    } catch {
      // Already stopped.
    }
  }, []);

  // ---- The round ------------------------------------------------------------
  const backToReady = useCallback(() => {
    stopEngine();
    setPhase('ready');
    setElapsed(0);
    setHeard('');
    heardRef.current = '';
    setText('');
    setVerdict(null);
    setShowVerses(false);
    setSavedNow(false);
  }, [stopEngine]);

  const finishTiming = useCallback(() => {
    stopEngine();
    setElapsed(TEACH_MS);
    setText(heardRef.current);
    setPhase('done');
    setShowVerses(true);
  }, [stopEngine]);

  const start = () => {
    heardRef.current = '';
    setHeard('');
    setText('');
    setVerdict(null);
    setSavedNow(false);
    setElapsed(0);
    setShowVerses(false);
    setPhase('timing');
    if (!listening) return;
    const engine = getSpeechRecognizer();
    if (!engine) return;
    engineRef.current = engine;
    const live = () => engineRef.current === engine;
    try {
      engine.start({
        onTranscript: (full) => {
          if (!live()) return;
          heardRef.current = tidyTranscript(full);
          setHeard(heardRef.current);
        },
        onEnd: () => undefined,
        onError: () => {
          if (!live()) return;
          // No mic permission or no engine here: keep timing, offer typing afterwards.
          engineRef.current = null;
          setSpeechFailed(true);
        },
      });
    } catch {
      engineRef.current = null;
      setSpeechFailed(true);
    }
  };

  useEffect(() => {
    if (phase !== 'timing') return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const ms = Date.now() - startedAt;
      if (ms >= TEACH_MS) {
        clearInterval(timer);
        finishTiming();
      } else {
        setElapsed(ms);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [phase, finishTiming]);

  // Another tab, or a different passage: nothing keeps listening in the background.
  useEffect(() => {
    if (!active) backToReady();
  }, [active, backToReady]);
  useEffect(() => stopEngine, [stopEngine]);
  useEffect(() => {
    setTargetKey((prev) => (targets.some((t) => t.key === prev) ? prev : targets[0]?.key ?? ''));
    backToReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey]);

  const choose = (key: string) => {
    if (phase === 'timing' || key === targetKey) return;
    setTargetKey(key);
    backToReady();
  };

  const mark = (v: 'got' | 'not') => {
    setVerdict(v);
    if (target) setMarks((prev) => ({ ...prev, [target.key]: v }));
  };

  const saveDraft = () => {
    if (!target) return;
    const draft = makeTakeawayDraft(target, text, Date.now());
    if (!draft) return;
    setDrafts((prev) => addDraft(prev, draft));
    setSavedNow(true);
  };

  const teachAnother = () => {
    const i = targets.findIndex((t) => t.key === target?.key);
    const nextTarget = targets[(i + 1) % targets.length];
    if (nextTarget) setTargetKey(nextTarget.key);
    backToReady();
  };

  if (!target) return null;

  const secondsLeft = teachSecondsLeft(elapsed);
  const ringLabel = phase === 'ready' ? String(TEACH_SECONDS) : phase === 'done' ? '0' : String(secondsLeft);
  const draftCount = drafts.length;
  const canSave = tidyTranscript(text).length > 0;

  const footer = (
    <View className="shrink-0" style={{ gap: space(8) }}>
      {phase === 'ready' && (
        <>
          <AppText variant="micro" className="font-sans text-ink-3 text-center">
            {formatLabel('teachIt')} is {formatTag('teachIt')}: it never counts as a review.
          </AppText>
          <AppButton variant="primary" Icon={Play} label={`Start ${TEACH_SECONDS} seconds`} onPress={start} />
        </>
      )}
      {phase === 'timing' && <AppButton variant="quiet" Icon={Square} label="Stop early" onPress={finishTiming} />}
      {phase === 'done' && (
        <>
          {verdict === null ? (
            <>
              <AppText variant="caption" className="font-sans font-semibold text-ink text-center">Did you get the idea across?</AppText>
              <View className="flex-row" style={{ gap: space(8) }}>
                <AppButton variant="quiet" Icon={X} label="Not really" onPress={() => mark('not')} className="flex-1" />
                <AppButton variant="primary" Icon={Check} label="Got it" onPress={() => mark('got')} className="flex-1" />
              </View>
            </>
          ) : (
            <>
              <AppText variant="caption" className={`font-sans font-bold text-center ${verdict === 'got' ? 'text-success' : 'text-ink-3'}`}>
                {verdict === 'got' ? 'Got it. Nothing logged, this is practice.' : 'Not really. Try the section again, or peek at the verses first.'}
              </AppText>
              <View className="flex-row" style={{ gap: space(8) }}>
                <AppButton variant="quiet" Icon={RotateCcw} label="Again" onPress={backToReady} className="flex-1" />
                {targets.length > 1 && <AppButton variant="primary" label="Next section" onPress={teachAnother} className="flex-1" />}
              </View>
            </>
          )}
        </>
      )}
    </View>
  );

  return (
    <View className="flex-1 justify-between">
      <ScrollView className="flex-1 mb-2" contentContainerStyle={{ gap: space(12), paddingBottom: space(8) }} keyboardShouldPersistTaps="handled">
        {/* What to teach. */}
        {targets.length > 1 && (
          <View className="flex-row flex-wrap" style={{ gap: space(6) }}>
            {targets.map((t) => {
              const selected = t.key === target.key;
              const m = marks[t.key];
              return (
                <Pressable
                  key={t.key}
                  onPress={() => choose(t.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${t.label ? `${t.label}, ` : ''}${t.start === t.end ? `verse ${t.start}` : `verses ${t.start} to ${t.end}`}${m === 'got' ? ', got it' : m === 'not' ? ', not really' : ''}`}
                  className={`flex-row items-center border rounded-full ${selected ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
                  style={{ paddingHorizontal: space(10), paddingVertical: space(5), gap: space(5) }}
                >
                  {t.sectionIndex !== null && (
                    // layout-ok: a color dot for the section's bracket.
                    <View style={{ width: space(8), height: space(8), borderRadius: space(4), backgroundColor: bracketColor(palette, t.sectionIndex) }} />
                  )}
                  <AppText variant="caption" className={`font-sans font-semibold ${selected ? 'text-accent' : 'text-ink-2'}`}>
                    {t.start === t.end ? t.start : `${t.start}–${t.end}`}
                  </AppText>
                  {m === 'got' && <Check size={Math.round(space(12))} color={palette.success} />}
                  {m === 'not' && <X size={Math.round(space(12))} color={palette.danger} />}
                </Pressable>
              );
            })}
          </View>
        )}

        <View className="bg-surface border border-line rounded-card items-center" style={{ padding: space(16), gap: space(10) }}>
          <AppText variant="caption" className="font-sans font-semibold text-ink-3 text-center">
            {referenceOf(target)}
            {target.label ? ` · ${target.label}` : ''}
          </AppText>
          <AppText variant="title" className="font-sans font-bold text-ink text-center">
            Say it in your own words
          </AppText>
          <TimerRing progress={phase === 'ready' ? 0 : teachProgress(elapsed)} label={ringLabel} size={Math.round(space(104))} />

          {phase === 'ready' && (
            <AppText variant="caption" className="font-sans text-ink-3 text-center">
              Explain what {target.start === target.end ? 'this verse says' : 'these verses say'} as if to a friend. You have {TEACH_SECONDS} seconds.
            </AppText>
          )}

          {/* The live transcript while it's running; the editable text afterwards. */}
          {phase === 'timing' && (
            <View className="self-stretch" style={{ gap: space(4) }}>
              {listening ? (
                <>
                  <View className="flex-row items-center justify-center" style={{ gap: space(6) }}>
                    <Mic size={Math.round(space(14))} color={palette.accent} />
                    <AppText variant="caption" className="font-sans font-semibold text-accent">Listening</AppText>
                  </View>
                  <AppText variant="label" className="font-sans text-ink-2 text-center">
                    {heard || ' '}
                  </AppText>
                </>
              ) : (
                <AppText variant="caption" className="font-sans text-ink-3 text-center">
                  Say it out loud. You can type a line when the time is up.
                </AppText>
              )}
            </View>
          )}
        </View>

        {phase === 'done' && (
          <View style={{ gap: space(8) }}>
            <AppText variant="caption" className="font-sans font-semibold text-ink-3">
              {listening && heardRef.current ? 'What you said (you can fix it)' : 'What you said, in a line (optional)'}
            </AppText>
            <AppTextInput
              value={text}
              onChangeText={(v) => {
                setText(v);
                setSavedNow(false);
              }}
              multiline
              variant="label"
              placeholder="In my own words, this says…"
              accessibilityLabel="What you said, in your own words"
              className="font-sans text-ink bg-surface border border-line rounded-card"
              style={{ padding: space(10), minHeight: space(64), textAlignVertical: 'top' }}
            />
            <AppButton
              variant="secondary"
              Icon={savedNow ? Check : Bookmark}
              label={savedNow ? 'Draft saved' : 'Save as takeaway draft'}
              onPress={saveDraft}
              disabled={!canSave || savedNow}
            />
          </View>
        )}

        {/* The verses: always a peek away before, shown once the time is up. */}
        {phase !== 'timing' && (
          <View style={{ gap: space(6) }}>
            <Pressable
              onPress={() => setShowVerses((s) => !s)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showVerses }}
              className="flex-row items-center self-start active:opacity-60"
              style={{ gap: space(6), paddingVertical: space(4) }}
            >
              {showVerses ? <EyeOff size={Math.round(space(14))} color={palette.ink3} /> : <Eye size={Math.round(space(14))} color={palette.ink3} />}
              <AppText variant="caption" className="font-sans font-semibold text-ink-3">
                {showVerses ? 'Hide the verses' : phase === 'done' ? 'Check it against the verses' : 'Peek at the verses'}
              </AppText>
            </Pressable>
            {showVerses && (
              <View className="bg-surface-2 border border-line rounded-card" style={{ padding: space(12), gap: space(6) }}>
                {target.verses.map((v) => (
                  <AppText key={v.verse} variant="label" script={script} className={`font-serif text-ink-2 ${rtl ? 'text-right' : ''}`}>
                    <AppText variant="caption" className="font-sans font-bold text-ink-3">{v.verse}  </AppText>
                    {v.text}
                  </AppText>
                ))}
              </View>
            )}
          </View>
        )}

        {draftCount > 0 && (
          <View className="border border-line rounded-card" style={{ padding: space(10), gap: space(4) }}>
            <View className="flex-row items-center" style={{ gap: space(6) }}>
              <Bookmark size={Math.round(space(13))} color={palette.ink3} />
              <AppText variant="caption" className="font-sans font-semibold text-ink-3 flex-1">
                Takeaway drafts ({draftCount}), kept here until you leave this practice
              </AppText>
            </View>
            {drafts.map((d) => (
              <AppText key={d.id} variant="caption" className="font-sans text-ink-2">
                {d.sectionStart === d.sectionEnd ? `${d.sectionStart}` : `${d.sectionStart}–${d.sectionEnd}`}
                {d.label ? ` ${d.label}` : ''}: {d.text}
              </AppText>
            ))}
          </View>
        )}
        {compact && footer}
      </ScrollView>

      {!compact && footer}
    </View>
  );
});
