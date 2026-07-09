import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { Check, Eye, EyeOff, Info, Keyboard, Mic, MicOff, Pause, Play, RefreshCw, Repeat, Sliders, Sparkles, X } from 'lucide-react-native';

import { VerseState, QueueItem } from '../types';
import { BounceView, ChipRow, FadeInView, SpinView, WaveBars } from './ui';
import { Dropdown } from './Dropdown';

interface PracticeModalsProps {
  type: 'listen' | 'type' | 'reveal';
  verses: VerseState[];
  allVerses?: VerseState[];
  onClose: () => void;
  onUpdateStatus: (versesToUpdate: VerseState[], newStatus: 'memorized' | 'learning', customDrillType?: 'speak' | 'type' | 'reveal') => void;
  memoryQueue?: QueueItem[];
  primingLookahead?: number;
  setPrimingLookahead?: (val: number) => void;
}

// Guard wrapper: the early "nothing to practice" return must happen OUTSIDE
// the component that declares hooks. Returning before the useState/useEffect
// calls below meant that if `verses` ever became empty while the modal was
// mounted, React would see fewer hooks than the previous render and crash
// ("Rendered fewer hooks than expected").
export default function PracticeModals(props: PracticeModalsProps) {
  if (!props.verses || props.verses.length === 0) return null;
  return <PracticeModalsInner {...props} />;
}

function PracticeModalsInner({
  type,
  verses,
  allVerses,
  onClose,
  onUpdateStatus,
  memoryQueue,
  primingLookahead = 30,
  setPrimingLookahead,
}: PracticeModalsProps) {
  // ==========================================
  // PLAYLIST / PLAY-SOURCE STATE
  // ==========================================
  const [playSource, setPlaySource] = useState<'selection' | 'memorization' | 'reviewing' | 'priming' | 'all'>('selection');
  const [activePlayVerses, setActivePlayVerses] = useState<VerseState[]>(verses);

  // Segment selection states (indices in the wordObjects array)
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);

  // Sync / load different playlists based on selected source
  useEffect(() => {
    if (playSource === 'selection') {
      setActivePlayVerses(verses);
    } else {
      let dbLearning: VerseState[] = [];
      let dbReviewing: VerseState[] = [];
      let dbPriming: VerseState[] = [];

      if (memoryQueue && memoryQueue.length > 0) {
        const mapQueueItemToVerse = (item: QueueItem): VerseState => ({
          book: item.book,
          chapter: item.chapter,
          verse: item.verseNumber,
          text: item.text,
          status: item.status === 'retained' ? 'memorized' : 'learning',
        });

        dbLearning = memoryQueue.filter((item) => item.status === 'learning').map(mapQueueItemToVerse);
        dbReviewing = memoryQueue
          .filter((item) => item.status === 'reviewing' && (!item.nextReviewDueDate || new Date(item.nextReviewDueDate) <= new Date()))
          .map(mapQueueItemToVerse);
        dbPriming = memoryQueue.filter((item) => item.status === 'queued').slice(0, primingLookahead).map(mapQueueItemToVerse);
      } else {
        // Fallback
        dbLearning = (allVerses || []).filter((v) => v.book === 'Genesis' && v.chapter === 1 && (v.verse === 3 || v.verse === 4 || v.verse === 5 || v.verse === 6));
        dbReviewing = (allVerses || []).filter((v) => (v.book === 'Romans' && v.chapter === 8 && (v.verse === 1 || v.verse === 2)) || (v.book === 'John' && v.chapter === 15));
        dbPriming = (allVerses || []).filter((v) => (v.book === 'Genesis' && v.chapter === 1 && v.verse >= 7) || (v.book === 'Genesis' && v.chapter === 2));
      }

      if (playSource === 'memorization') {
        setActivePlayVerses(dbLearning.length > 0 ? dbLearning : verses);
      } else if (playSource === 'reviewing') {
        setActivePlayVerses(dbReviewing.length > 0 ? dbReviewing : verses);
      } else if (playSource === 'priming') {
        setActivePlayVerses(dbPriming.length > 0 ? dbPriming : verses);
      } else if (playSource === 'all') {
        setActivePlayVerses(allVerses && allVerses.length > 0 ? allVerses : verses);
      }
    }
    // Reset word highlight position back to start
    setListenWordIndex(0);
    setSelectionStart(null);
    setSelectionEnd(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playSource, verses, allVerses, memoryQueue, primingLookahead]);

  // Header reference text
  const referenceText = useMemo(() => {
    const targetVerses = type === 'type' || type === 'reveal' ? verses : activePlayVerses;

    if (targetVerses.length === 0) return 'No verses selected';
    if (targetVerses.length === 1) {
      return `${targetVerses[0].book} ${targetVerses[0].chapter}:${targetVerses[0].verse}`;
    }
    const first = targetVerses[0];
    const last = targetVerses[targetVerses.length - 1];

    // Check if they are in the same chapter
    if (first.book === last.book && first.chapter === last.chapter) {
      return `${first.book} ${first.chapter}:${first.verse}-${last.verse}`;
    }
    return `${first.book} ${first.chapter}:${first.verse} - ${last.book} ${last.chapter}:${last.verse}`;
  }, [type, verses, activePlayVerses]);

  // ==========================================
  // 1. LISTEN MODE STATE & LOGIC
  // ==========================================
  const [listenPlaying, setListenPlaying] = useState(false);
  const [listenSpeed, setListenSpeed] = useState(1.0); // Increments of 0.2: 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, etc.
  const [listenWordIndex, setListenWordIndex] = useState(0);
  const [repeatMode, setRepeatMode] = useState<'off' | 'playlist'>('playlist'); // default to loop playlist
  const listenTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Map each word to its containing verse object and index
  const wordObjects = useMemo(() => {
    const list: { word: string; verseObj: VerseState; verseKey: string; indexInVerse: number }[] = [];
    activePlayVerses.forEach((verseObj) => {
      const verseKey = `${verseObj.book}-${verseObj.chapter}-${verseObj.verse}`;
      const words = `${verseObj.verse} ${verseObj.text}`.split(/\s+/);
      words.forEach((w, idx) => {
        list.push({
          word: w,
          verseObj,
          verseKey,
          indexInVerse: idx,
        });
      });
    });
    return list;
  }, [activePlayVerses]);

  useEffect(() => {
    if (type !== 'listen') return;

    if (listenPlaying && wordObjects.length > 0) {
      const delay = 60000 / 125 / listenSpeed; // ~125 words per minute base rate, adjusted by speed
      listenTimerRef.current = setInterval(() => {
        setListenWordIndex((prev) => {
          const actualStart = playSource === 'selection' && selectionStart !== null ? selectionStart : 0;
          const actualEnd = playSource === 'selection' && selectionEnd !== null ? selectionEnd : wordObjects.length - 1;

          // End of segment/playlist reached
          if (prev >= actualEnd) {
            if (repeatMode === 'playlist') {
              // Loop back to start (or selection start)
              return actualStart;
            } else {
              // Repeat is off
              setListenPlaying(false);
              if (listenTimerRef.current) clearInterval(listenTimerRef.current);
              return prev;
            }
          }

          // If somehow prev is outside the selection range, snap it back
          if (prev < actualStart) {
            return actualStart;
          }

          return prev + 1;
        });
      }, delay);
    } else {
      if (listenTimerRef.current) {
        clearInterval(listenTimerRef.current);
      }
    }

    return () => {
      if (listenTimerRef.current) clearInterval(listenTimerRef.current);
    };
  }, [listenPlaying, listenSpeed, wordObjects, type, repeatMode, playSource, selectionStart, selectionEnd]);

  const restartListen = () => {
    setListenPlaying(false);
    const actualStart = playSource === 'selection' && selectionStart !== null ? selectionStart : 0;
    setListenWordIndex(actualStart);
    setTimeout(() => setListenPlaying(true), 150);
  };

  // ==========================================
  // Helper to mask alphabetical characters but keep punctuation
  // ==========================================
  const maskLetters = (word: string) => {
    return word.replace(/[a-zA-Z0-9]/g, '•');
  };

  // ==========================================
  // 2. TYPE MODE STATE & LOGIC
  // ==========================================
  const [currentTypeVerseIdx, setCurrentTypeVerseIdx] = useState(0);
  const [typeWordIdx, setTypeWordIdx] = useState(0);
  const [typeErrors, setTypeErrors] = useState(0);
  const [verseStrikes, setVerseStrikes] = useState(0);
  const [strikeLimit, setStrikeLimit] = useState<number | 'unlimited'>(5);
  const [showStrikeResetAlert, setShowStrikeResetAlert] = useState(false);
  const [typedInput, setTypedInput] = useState('');
  const [isFinishedTyping, setIsFinishedTyping] = useState(false);
  const [flashError, setFlashError] = useState(false);

  // New Voice Recital / Speak Practice skeleton states
  const [typeSubMode, setTypeSubMode] = useState<'type' | 'speak'>('type');
  const [isListeningSpeak, setIsListeningSpeak] = useState(false);
  const [localToast, setLocalToast] = useState<string | null>(null);

  const triggerLocalToast = (msg: string) => {
    setLocalToast(msg);
    setTimeout(() => {
      setLocalToast((prev) => (prev === msg ? null : prev));
    }, 2500);
  };

  const activeVerseToType = verses[currentTypeVerseIdx];
  const typeWords = activeVerseToType ? activeVerseToType.text.split(/\s+/) : [];

  const getCleanFirstChar = (word: string) => {
    if (!word) return '';
    const clean = word.replace(/[^a-zA-Z0-9]/g, '');
    return clean.length > 0 ? clean.charAt(0).toLowerCase() : '';
  };

  // NOTE: onChangeText passes the string directly (unlike web's onChange event).
  const handleTypeChar = (val: string) => {
    if (isFinishedTyping || !activeVerseToType || showStrikeResetAlert) return;

    if (val.length === 0) {
      setTypedInput('');
      return;
    }

    const lastChar = val.charAt(val.length - 1).toLowerCase();
    const currentWord = typeWords[typeWordIdx];
    const targetChar = getCleanFirstChar(currentWord);

    if (targetChar === '' || lastChar === targetChar) {
      if (typeWordIdx >= typeWords.length - 1) {
        if (currentTypeVerseIdx >= verses.length - 1) {
          setIsFinishedTyping(true);
        } else {
          setCurrentTypeVerseIdx((prev) => prev + 1);
          setTypeWordIdx(0);
          setVerseStrikes(0); // reset strikes on new verse
        }
      } else {
        setTypeWordIdx((prev) => prev + 1);
      }
      setTypedInput('');
    } else {
      const nextStrikes = verseStrikes + 1;
      setTypeErrors((prev) => prev + 1);
      setVerseStrikes(nextStrikes);
      setFlashError(true);
      setTypedInput(''); // Clear on error so user doesn't have to backspace

      if (strikeLimit !== 'unlimited' && nextStrikes >= strikeLimit) {
        setShowStrikeResetAlert(true);
        setTypeWordIdx(0);
        setVerseStrikes(0);
        setTimeout(() => {
          setShowStrikeResetAlert(false);
        }, 1500);
      }

      setTimeout(() => setFlashError(false), 200);
    }
  };

  const handleHint = () => {
    if (typeWordIdx >= typeWords.length - 1) {
      if (currentTypeVerseIdx >= verses.length - 1) {
        setIsFinishedTyping(true);
      } else {
        setCurrentTypeVerseIdx((prev) => prev + 1);
        setTypeWordIdx(0);
        setVerseStrikes(0);
      }
    } else {
      setTypeWordIdx((prev) => prev + 1);
    }
  };

  const resetTypeGame = () => {
    setCurrentTypeVerseIdx(0);
    setTypeWordIdx(0);
    setTypeErrors(0);
    setVerseStrikes(0);
    setTypedInput('');
    setIsFinishedTyping(false);
    setShowStrikeResetAlert(false);
  };

  // ==========================================
  // 3. REVEAL MODE STATE & LOGIC
  // ==========================================
  const [maskLevel, setMaskLevel] = useState(50); // 0, 25, 50, 75, 100
  const [peekActive, setPeekActive] = useState(false);
  const [singlePeekedWords, setSinglePeekedWords] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setSinglePeekedWords({});
  }, [maskLevel, verses]);

  const shouldHideWord = (word: string, index: number) => {
    if (maskLevel === 0) return false;
    if (maskLevel === 100) return true;
    const hash = (index * 19 + word.length * 3) % 100;
    return hash < maskLevel;
  };

  // Renders one verse's masked text. NOTE: the web original used an
  // invisible-sizer + absolute-overlay trick to keep word width perfectly
  // stable when toggling between masked dots and the real word (which use
  // different fonts). RN's text layout model doesn't support that overlay
  // compositing the same way, and `maskLetters` already produces a
  // same-length string, so we render one or the other directly as nested
  // <Text> — width may shift very slightly on peek, which is an acceptable
  // simplification.
  const renderMaskedText = (v: VerseState) => {
    const words = v.text.split(/\s+/);
    return (
      <Text className="font-serif text-[15px] leading-relaxed text-neutral-800 mb-3">
        <Text className="font-sans text-[10px] font-bold text-neutral-400">{v.verse} </Text>
        {words.map((w, idx) => {
          const isHidden = shouldHideWord(w, idx);
          const wordKey = `${v.book}-${v.chapter}-${v.verse}-${idx}`;
          const isWordPeeked = peekActive || singlePeekedWords[wordKey];

          if (isHidden) {
            return (
              <Text
                key={idx}
                onPress={() =>
                  setSinglePeekedWords((prev) => ({
                    ...prev,
                    [wordKey]: !prev[wordKey],
                  }))
                }
                className={`font-serif text-[15px] rounded px-1 ${
                  isWordPeeked ? 'bg-amber-100 text-neutral-900 font-medium' : 'bg-neutral-100 text-neutral-400 font-mono font-bold'
                }`}
              >
                {isWordPeeked ? w : maskLetters(w)}{' '}
              </Text>
            );
          }

          return (
            <Text key={idx} className="font-serif text-[15px] text-neutral-800">
              {w}{' '}
            </Text>
          );
        })}
      </Text>
    );
  };

  const handleWordClick = (index: number) => {
    if (playSource !== 'selection') {
      setListenWordIndex(index);
      return;
    }

    if (selectionStart === null || (selectionStart !== null && selectionEnd !== null)) {
      setSelectionStart(index);
      setSelectionEnd(null);
      setListenWordIndex(index);
    } else {
      if (index < selectionStart) {
        setSelectionStart(index);
        setListenWordIndex(index);
      } else {
        setSelectionEnd(index);
      }
    }
  };

  return (
    <View className="absolute inset-0 bg-white z-50 pt-11 pb-4 px-4" id="practice_overlay">
      {/* Header Bar */}
      <View className="flex-row items-center justify-between border-b border-[#1A1A1A] pb-2 mb-3">
        <View>
          <Text className="text-[9px] uppercase tracking-wider text-neutral-500 font-sans font-bold">
            {type === 'listen' ? 'Audio Player & Looper' : type === 'type' ? 'Keyboard Recall practice' : 'Active Reveal practice'}
          </Text>
          <Text className="text-base font-serif font-bold text-neutral-900 leading-tight max-w-[280px]" numberOfLines={1}>
            {referenceText}
          </Text>
        </View>
        <Pressable onPress={onClose} className="w-7 h-7 rounded-full border border-neutral-300 items-center justify-center shrink-0">
          <X size={14} color="#262626" />
        </Pressable>
      </View>

      {/* Main Panel */}
      <View className="flex-1 justify-between py-1">
        {/* ======================================================== */}
        {/* LISTEN MODE VIEW */}
        {/* ======================================================== */}
        {type === 'listen' && (
          <View className="flex-1 justify-between">
            {/* Word Highlight Box */}
            <View className="bg-neutral-50 border border-neutral-200 rounded-2xl flex-1 mb-3 overflow-hidden">
              <ScrollView className="flex-1 p-4">
                <Text className="font-serif text-[15px] leading-relaxed text-neutral-800 pb-12">
                  {wordObjects.map((item, index) => {
                    const isActive = index === listenWordIndex && listenPlaying;
                    const isRead = index < listenWordIndex;
                    const isFirstWordOfVerse = index === 0 || wordObjects[index - 1].verseKey !== item.verseKey;

                    const inSelectionRange =
                      playSource === 'selection' &&
                      selectionStart !== null &&
                      (selectionEnd !== null ? index >= selectionStart && index <= selectionEnd : index === selectionStart);

                    let wordClassName = 'mx-0.5 rounded px-0.5 ';
                    if (isActive) {
                      wordClassName += 'bg-[#1A1A1A] text-white font-extrabold px-1';
                    } else if (playSource === 'selection' && selectionStart !== null) {
                      if (inSelectionRange) {
                        wordClassName += 'bg-amber-100 text-amber-900 font-bold';
                      } else {
                        wordClassName += 'opacity-35 text-neutral-400';
                      }
                    } else {
                      if (isRead) {
                        wordClassName += 'text-neutral-900 font-semibold bg-neutral-200/50';
                      } else {
                        wordClassName += 'text-neutral-400';
                      }
                    }

                    return (
                      <Text key={index}>
                        {isFirstWordOfVerse && (
                          <Text className="mt-3 mb-1 font-sans text-[10px] font-extrabold text-[#444] bg-neutral-100 border border-neutral-200 rounded px-2 py-0.5 tracking-wide uppercase">
                            {'\n'}
                            {item.verseObj.book} {item.verseObj.chapter}:{item.verseObj.verse}
                            {'\n'}
                          </Text>
                        )}
                        <Text onPress={() => handleWordClick(index)} className={wordClassName}>
                          {item.word}{' '}
                        </Text>
                      </Text>
                    );
                  })}
                </Text>
              </ScrollView>

              {/* Selection Mode Instructions overlay */}
              {playSource === 'selection' && (
                <View className="absolute top-2 right-2 bg-amber-500/10 px-2 py-1 rounded border border-amber-200 z-10" pointerEvents="none">
                  <Text className="text-[8.5px] font-sans font-bold text-amber-800">
                    {selectionStart === null ? 'Tap word to set start' : selectionEnd === null ? 'Tap word to set end' : 'Segment active'}
                  </Text>
                </View>
              )}

              {/* Static Segment control and Audio wave indicator footer bar */}
              <View className="bg-neutral-100 border-t border-neutral-200 px-3 py-2 flex-row justify-between items-center z-10">
                <View className="flex-row items-center gap-2">
                  {playSource === 'selection' && selectionStart !== null ? (
                    <Pressable
                      onPress={() => {
                        setSelectionStart(null);
                        setSelectionEnd(null);
                        setListenWordIndex(0);
                      }}
                      className="flex-row items-center gap-1.5 bg-white border border-neutral-300 px-2.5 py-1 rounded-lg"
                    >
                      <RefreshCw size={10} color="#262626" />
                      <Text className="text-[8.5px] font-sans font-extrabold text-neutral-800">Reset Segment</Text>
                    </Pressable>
                  ) : (
                    <Text className="text-[8.5px] font-sans font-bold text-neutral-400 uppercase tracking-wider">
                      {playSource === 'selection' ? 'Tap word to select segment' : 'Playlist Auto-playback'}
                    </Text>
                  )}
                </View>

                <View className="bg-white border border-neutral-200 px-2 py-1 rounded-lg">
                  <WaveBars active={listenPlaying} count={5} />
                </View>
              </View>
            </View>

            {/* Custom Control and Audio Looping Panel */}
            <View className="gap-3.5 bg-white pt-2">
              {/* playlist / source options */}
              {allVerses && allVerses.length > 0 && (
                <View className="gap-1 bg-neutral-50 p-2 rounded-xl border border-neutral-200">
                  <View className="flex-row justify-between items-center px-1">
                    <Text className="text-[9px] font-sans font-extrabold text-neutral-400 tracking-wider uppercase">Loop Target / Playlist</Text>
                    <Text className="text-[9px] font-mono font-bold text-neutral-500 bg-neutral-200 px-1.5 rounded-full">
                      {activePlayVerses.length} verses
                    </Text>
                  </View>
                  <ChipRow
                    columns={5}
                    value={playSource}
                    onChange={(id) => setPlaySource(id)}
                    options={[
                      { id: 'all', label: 'All verses' },
                      { id: 'memorization', label: 'Learning' },
                      { id: 'reviewing', label: 'Review' },
                      { id: 'priming', label: 'Priming' },
                      { id: 'selection', label: 'Selected' },
                    ]}
                  />

                  {playSource === 'priming' && setPrimingLookahead && (
                    <View className="flex-row items-center justify-between bg-amber-50 border border-amber-100 rounded-lg p-2 mt-2">
                      <View>
                        <Text className="text-[9px] font-sans font-bold text-amber-800 uppercase tracking-wider">⚡ Priming Window Size</Text>
                        <Text className="text-[8.5px] font-sans text-amber-700 leading-none">Set lookahead priming size</Text>
                      </View>
                      <View style={{ width: 90 }}>
                        <Dropdown
                          value={primingLookahead}
                          onChange={(v) => setPrimingLookahead(Number(v))}
                          options={[10, 20, 30, 40, 50].map((n) => ({ id: n, label: `${n}` }))}
                          title="Priming Window Size"
                        />
                      </View>
                    </View>
                  )}
                </View>
              )}

              {/* Adjusters: Speed (.2 steps) and Repeat mode */}
              <View className="flex-row gap-2">
                {/* 1. Playback Speed Selector (.2 increments) */}
                <View className="flex-1 justify-center bg-neutral-50 p-2.5 rounded-xl border border-neutral-200 gap-1">
                  <View className="flex-row items-center gap-1">
                    <Sliders size={10} color="#737373" />
                    <Text className="text-[9px] font-sans font-bold text-neutral-500 uppercase tracking-wider">Speed (±0.2)</Text>
                  </View>
                  <View className="flex-row items-center justify-between bg-white px-2 py-1 rounded-lg border border-neutral-200">
                    <Pressable
                      onPress={() => setListenSpeed((s) => Math.max(0.4, Number((s - 0.2).toFixed(1))))}
                      className="w-5 h-5 bg-neutral-100 border border-neutral-300 rounded items-center justify-center"
                    >
                      <Text className="font-black text-xs text-neutral-800">-</Text>
                    </Pressable>
                    <Text className="text-xs font-mono font-bold text-neutral-900">{listenSpeed.toFixed(1)}x</Text>
                    <Pressable
                      onPress={() => setListenSpeed((s) => Math.min(2.4, Number((s + 0.2).toFixed(1))))}
                      className="w-5 h-5 bg-neutral-100 border border-neutral-300 rounded items-center justify-center"
                    >
                      <Text className="font-black text-xs text-neutral-800">+</Text>
                    </Pressable>
                  </View>
                </View>

                {/* 2. Audio Repeat Control */}
                <View className="flex-1 justify-center bg-neutral-50 p-2.5 rounded-xl border border-neutral-200 gap-1">
                  <View className="flex-row items-center gap-1">
                    <Repeat size={10} color="#737373" />
                    <Text className="text-[9px] font-sans font-bold text-neutral-500 uppercase tracking-wider">Repeat Setting</Text>
                  </View>
                  <ChipRow
                    value={repeatMode}
                    onChange={(id) => setRepeatMode(id)}
                    options={[
                      { id: 'off', label: 'Off' },
                      { id: 'playlist', label: 'Loop' },
                    ]}
                  />
                </View>
              </View>

              {/* Progress Slider bar */}
              <View className="gap-0.5">
                <View className="flex-row justify-between px-1">
                  <Text className="text-[8px] font-bold text-neutral-400 font-mono">START</Text>
                  <Text className="text-[8px] font-bold text-neutral-400 font-mono">
                    {wordObjects.length > 0 ? Math.round((listenWordIndex / wordObjects.length) * 100) : 0}%
                  </Text>
                  <Text className="text-[8px] font-bold text-neutral-400 font-mono">END</Text>
                </View>
                <View className="w-full bg-neutral-200 h-1.5 rounded-full overflow-hidden">
                  <View
                    className="bg-[#1A1A1A] h-full"
                    style={{ width: `${wordObjects.length > 0 ? (listenWordIndex / wordObjects.length) * 100 : 0}%` }}
                  />
                </View>
              </View>

              {/* Main player controls row */}
              <View className="flex-row gap-2.5 pb-1">
                <Pressable onPress={restartListen} className="flex-1 py-2.5 px-3 border-2 border-[#1A1A1A] rounded-xl flex-row items-center justify-center gap-1.5">
                  <RefreshCw size={12} color="#1A1A1A" />
                  <Text className="font-sans font-bold text-xs text-[#1A1A1A]">Restart</Text>
                </Pressable>
                <Pressable
                  onPress={() => setListenPlaying(!listenPlaying)}
                  className={`flex-[2] py-2.5 px-3 rounded-xl flex-row items-center justify-center gap-1.5 ${
                    listenPlaying ? 'bg-neutral-900' : 'bg-emerald-600'
                  }`}
                >
                  {listenPlaying ? <Pause size={12} color="#ffffff" /> : <Play size={12} color="#ffffff" />}
                  <Text className="font-sans font-bold text-xs text-white">{listenPlaying ? 'Pause Audio' : 'Start Looping'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {/* ======================================================== */}
        {/* TYPE MODE VIEW */}
        {/* ======================================================== */}
        {type === 'type' && (
          <View className="flex-1 justify-between relative">
            {/* Local custom toast alert */}
            {localToast && (
              <BounceView style={{ position: 'absolute', top: 56, left: '50%', marginLeft: -100, zIndex: 30 }}>
                <View className="bg-[#1A1A1A] px-3.5 py-1.5 rounded-full">
                  <Text className="text-white text-[10px] font-sans font-bold">{localToast}</Text>
                </View>
              </BounceView>
            )}

            {/* Sub Mode Selection Tab bar */}
            <View className="flex-row bg-neutral-100 p-1 rounded-xl mb-3.5 border border-neutral-200 shrink-0">
              <Pressable
                onPress={() => {
                  setTypeSubMode('type');
                  resetTypeGame();
                }}
                className={`flex-1 py-1.5 rounded-lg flex-row items-center justify-center gap-1.5 ${typeSubMode === 'type' ? 'bg-[#1A1A1A]' : ''}`}
              >
                <Keyboard size={12} color={typeSubMode === 'type' ? '#ffffff' : '#737373'} />
                <Text className={`text-[10px] uppercase tracking-wider font-sans font-extrabold ${typeSubMode === 'type' ? 'text-white' : 'text-neutral-500'}`}>
                  Type Practice
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setTypeSubMode('speak');
                  resetTypeGame();
                }}
                className={`flex-1 py-1.5 rounded-lg flex-row items-center justify-center gap-1.5 ${typeSubMode === 'speak' ? 'bg-[#1A1A1A]' : ''}`}
              >
                <Mic size={12} color={typeSubMode === 'speak' ? '#ffffff' : '#737373'} />
                <Text className={`text-[10px] uppercase tracking-wider font-sans font-extrabold ${typeSubMode === 'speak' ? 'text-white' : 'text-neutral-500'}`}>
                  Speak Practice
                </Text>
              </Pressable>
            </View>

            {!isFinishedTyping ? (
              typeSubMode === 'type' ? (
                <View className="flex-1 justify-between">
                  {/* Typing card frame */}
                  <View className={`border-2 rounded-2xl p-4 flex-1 justify-between relative ${flashError ? 'border-red-500 bg-red-50' : 'border-[#1A1A1A] bg-white'}`}>
                    {/* Strike Reset Alert Overlay */}
                    {showStrikeResetAlert && (
                      <FadeInView style={{ position: 'absolute', inset: 0, zIndex: 20 }}>
                        <View className="flex-1 bg-white/95 items-center justify-center p-4 rounded-xl">
                          <SpinView>
                            <View className="w-10 h-10 rounded-full bg-red-100 items-center justify-center mb-2">
                              <RefreshCw size={20} color="#dc2626" />
                            </View>
                          </SpinView>
                          <Text className="text-sm font-sans font-extrabold text-red-900">Verse Restarting!</Text>
                          <Text className="text-[10px] text-red-700/85 font-medium px-4 text-center">
                            You reached the strike limit. Let's try this verse again from the beginning!
                          </Text>
                        </View>
                      </FadeInView>
                    )}

                    <ScrollView className="flex-1 mb-2">
                      <Text className="text-[9px] font-sans font-bold text-neutral-400 tracking-wider mb-1">
                        Typing Practice Passage — {verses.length} {verses.length === 1 ? 'verse' : 'verses'} ({referenceText})
                      </Text>

                      <View className="gap-3">
                        {verses.map((v, vIdx) => {
                          const isPastVerse = vIdx < currentTypeVerseIdx;
                          const isCurrentVerse = vIdx === currentTypeVerseIdx;
                          const words = v.text.split(/\s+/);

                          return (
                            <Text key={`${v.book}-${v.chapter}-${v.verse}`} className="font-serif text-[15px] leading-relaxed text-neutral-800">
                              <Text className="font-sans text-[10px] font-bold text-neutral-400">{v.verse} </Text>
                              {words.map((w, idx) => {
                                let isWordTyped = false;
                                let isWordCurrent = false;

                                if (isPastVerse) {
                                  isWordTyped = true;
                                } else if (isCurrentVerse) {
                                  if (idx < typeWordIdx) {
                                    isWordTyped = true;
                                  } else if (idx === typeWordIdx) {
                                    isWordCurrent = true;
                                  }
                                }

                                if (isWordTyped) {
                                  return (
                                    <Text key={idx} className="font-serif text-[15px] text-neutral-900 font-semibold">
                                      {w}{' '}
                                    </Text>
                                  );
                                }

                                return (
                                  <Text
                                    key={idx}
                                    className={`font-serif text-[15px] rounded px-1 font-mono font-bold ${
                                      isWordCurrent ? 'bg-amber-50 text-neutral-500' : 'bg-neutral-50 text-neutral-300'
                                    }`}
                                  >
                                    {maskLetters(w)}{' '}
                                  </Text>
                                );
                              })}
                            </Text>
                          );
                        })}
                      </View>
                    </ScrollView>

                    {/* Input row */}
                    <View className="gap-2.5 pt-2">
                      <View className="flex-row justify-between items-center px-1">
                        <View className="flex-row items-center gap-2">
                          <Text className="text-[10px] text-neutral-400 font-bold">
                            STRIKES: <Text className={typeErrors > 0 ? 'text-red-600' : ''}>{typeErrors}</Text>
                          </Text>
                          {strikeLimit !== 'unlimited' && (
                            <Text className="text-[10px] text-red-500 font-medium">Verse errors: {verseStrikes}/{strikeLimit}</Text>
                          )}
                        </View>
                        <Text className="text-[10px] text-neutral-400 font-bold">{typeWordIdx} of {typeWords.length} words</Text>
                      </View>

                      <TextInput
                        value={typedInput}
                        onChangeText={handleTypeChar}
                        placeholder={showStrikeResetAlert ? 'Resetting...' : 'Type first letter of each word...'}
                        className="w-full bg-neutral-50 border border-neutral-300 rounded-xl py-2 px-3 text-center font-sans font-semibold text-xs text-neutral-900"
                        autoFocus
                        editable={!showStrikeResetAlert}
                      />
                    </View>
                  </View>

                  {/* Accuracy Settings Bar */}
                  <View className="mt-2.5 bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 gap-1.5">
                    <View className="flex-row justify-between items-center px-1">
                      <Text className="text-[9px] font-sans font-extrabold text-neutral-400 tracking-wider uppercase">Strike Reset Limit (Accuracy Assist)</Text>
                      <Text className="text-[9px] font-mono font-bold text-neutral-500">
                        {strikeLimit === 'unlimited' ? 'No Reset' : `${strikeLimit} Max Strikes`}
                      </Text>
                    </View>
                    <ChipRow
                      columns={4}
                      value={strikeLimit === 'unlimited' ? 'unlimited' : strikeLimit}
                      onChange={(id) => {
                        const limit = id === 'unlimited' ? 'unlimited' : Number(id);
                        setStrikeLimit(limit as number | 'unlimited');
                        setVerseStrikes(0);
                      }}
                      options={[3, 5, 10, 'unlimited'].map((limit) => ({
                        id: limit as number | 'unlimited',
                        label: limit === 'unlimited' ? 'Off' : `${limit} errors`,
                      }))}
                    />
                  </View>

                  {/* Keyboard Game Options */}
                  <View className="mt-2 flex-row gap-2.5">
                    <Pressable onPress={resetTypeGame} className="flex-1 py-2 px-3 border border-neutral-300 rounded-xl flex-row items-center justify-center gap-1.5">
                      <RefreshCw size={12} color="#525252" />
                      <Text className="font-sans font-bold text-xs text-neutral-600">Reset Passage</Text>
                    </Pressable>
                    <Pressable onPress={handleHint} className="flex-1 py-2 px-3 border-2 border-[#1A1A1A] rounded-xl items-center justify-center">
                      <Text className="font-sans font-bold text-xs text-neutral-900">Reveal Word</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                /* SPEAK SUB-MODE SKELETON */
                <View className="flex-1 justify-between">
                  <View className="border border-neutral-200 rounded-2xl p-4 flex-1 justify-between bg-white relative">
                    <ScrollView className="flex-1 mb-2">
                      <Text className="text-[9px] font-sans font-bold text-[#1A1A1A] tracking-wider mb-1">
                        Spoken Practice Passage — {verses.length} {verses.length === 1 ? 'verse' : 'verses'} ({referenceText})
                      </Text>

                      <View className="gap-3">
                        {verses.map((v, vIdx) => {
                          const words = v.text.split(/\s+/);
                          const isPastVerse = vIdx < currentTypeVerseIdx;
                          const isCurrentVerse = vIdx === currentTypeVerseIdx;

                          return (
                            <Text key={`${v.book}-${v.chapter}-${v.verse}`} className="font-serif text-[15px] leading-relaxed text-neutral-800">
                              <Text className="font-sans text-[10px] font-bold text-neutral-400">{v.verse} </Text>
                              {words.map((w, idx) => {
                                let isWordSpoken = false;
                                let isWordCurrent = false;

                                if (isPastVerse) {
                                  isWordSpoken = true;
                                } else if (isCurrentVerse) {
                                  if (idx < typeWordIdx) {
                                    isWordSpoken = true;
                                  } else if (idx === typeWordIdx) {
                                    isWordCurrent = true;
                                  }
                                }

                                if (isWordSpoken) {
                                  return (
                                    <Text key={idx} className="text-emerald-600 font-semibold">
                                      {w}{' '}
                                    </Text>
                                  );
                                }

                                return (
                                  <Text
                                    key={idx}
                                    className={`rounded px-1 font-mono font-bold ${
                                      isWordCurrent ? 'bg-indigo-50 text-indigo-600' : 'bg-neutral-50 text-neutral-300'
                                    }`}
                                  >
                                    {maskLetters(w)}{' '}
                                  </Text>
                                );
                              })}
                            </Text>
                          );
                        })}
                      </View>
                    </ScrollView>

                    {/* Microphone waveform visualization card */}
                    <View className="bg-neutral-50 border border-neutral-200 rounded-xl p-3.5 gap-3 mt-2">
                      <View className="flex-row justify-between items-center">
                        <Text className="text-[10px] text-neutral-400 font-bold font-sans uppercase tracking-wider">Voice Assist Status</Text>
                        <Text className="text-[10px] font-mono font-extrabold text-neutral-600">{isListeningSpeak ? 'LISTENING...' : 'MIC STANDBY'}</Text>
                      </View>

                      <View className="h-9 items-center justify-center bg-white rounded-lg border border-neutral-200 px-3">
                        {isListeningSpeak ? (
                          <WaveBars active count={18} />
                        ) : (
                          <Text className="text-[10px] text-neutral-400 font-sans font-semibold">Tap microphone below to speak and recite</Text>
                        )}
                      </View>

                      {/* Microphone control button */}
                      <View className="items-center py-0.5">
                        <Pressable
                          onPress={() => {
                            const next = !isListeningSpeak;
                            setIsListeningSpeak(next);
                            if (next) {
                              triggerLocalToast('Microphone active! Speak now... 🎙️');
                            } else {
                              triggerLocalToast('Microphone in standby.');
                            }
                          }}
                          className={`w-11 h-11 rounded-full items-center justify-center ${isListeningSpeak ? 'bg-red-500' : 'bg-indigo-600'}`}
                        >
                          {isListeningSpeak ? <MicOff size={18} color="#ffffff" /> : <Mic size={18} color="#ffffff" />}
                        </Pressable>
                      </View>

                      {/* Simulate speech button for high-fidelity evaluation interaction */}
                      <View className="flex-row justify-between items-center border-t border-neutral-200 pt-2.5">
                        <Text className="text-[9px] text-neutral-400 font-bold font-sans uppercase">Recital Simulation</Text>
                        <Pressable
                          onPress={() => {
                            if (currentTypeVerseIdx >= verses.length) return;
                            if (typeWordIdx < typeWords.length - 1) {
                              const spokenWord = typeWords[typeWordIdx];
                              setTypeWordIdx((prev) => prev + 1);
                              triggerLocalToast(`Spoken word: "${spokenWord}" ✓`);
                            } else {
                              if (currentTypeVerseIdx < verses.length - 1) {
                                setCurrentTypeVerseIdx((prev) => prev + 1);
                                setTypeWordIdx(0);
                                triggerLocalToast('Great! Next verse ➔');
                              } else {
                                setIsFinishedTyping(true);
                                triggerLocalToast('Perfect recital completed! 🎉');
                              }
                            }
                          }}
                          className="px-2.5 py-1 bg-white border border-neutral-200 rounded-lg"
                        >
                          <Text className="text-[9px] font-sans font-extrabold uppercase text-neutral-700">Simulate Voice Word ➔</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>

                  {/* Reset controls */}
                  <View className="mt-2.5 flex-row gap-2">
                    <Pressable
                      onPress={() => {
                        resetTypeGame();
                        setIsListeningSpeak(false);
                        triggerLocalToast('Recital practice reset.');
                      }}
                      className="flex-1 py-2 px-3 border border-neutral-300 rounded-xl flex-row items-center justify-center gap-1.5"
                    >
                      <RefreshCw size={12} color="#525252" />
                      <Text className="font-sans font-bold text-xs text-neutral-600">Reset Recital</Text>
                    </Pressable>
                  </View>
                </View>
              )
            ) : (
              /* Success panel */
              <ScrollView className="flex-1" contentContainerClassName="items-center justify-center p-4 gap-4" contentContainerStyle={{ flexGrow: 1 }}>
                <BounceView>
                  <View className="w-12 h-12 bg-neutral-100 border-2 border-[#1A1A1A] rounded-full items-center justify-center">
                    <Sparkles size={24} color="#171717" />
                  </View>
                </BounceView>
                <View className="items-center">
                  <Text className="text-lg font-serif font-bold text-neutral-900 leading-tight">Excellent Memory Recall!</Text>
                  <Text className="text-xs text-neutral-500 font-sans mt-0.5">
                    Completed typing with {typeErrors} {typeErrors === 1 ? 'mistake' : 'mistakes'}.
                  </Text>
                </View>

                <View className="w-full bg-neutral-50 border border-neutral-200 rounded-xl p-3 gap-1.5 max-h-[110px]">
                  <ScrollView>
                    {verses.map((v) => (
                      <Text key={v.verse} className="font-serif italic text-xs text-neutral-600">
                        <Text className="font-sans text-[9px] font-bold text-neutral-400 not-italic">{v.verse} </Text>
                        {v.text}
                      </Text>
                    ))}
                  </ScrollView>
                </View>

                <View className="w-full gap-2">
                  <Pressable
                    onPress={() => {
                      onUpdateStatus(verses, 'memorized', 'type');
                      onClose();
                    }}
                    className="w-full py-2.5 px-3 bg-emerald-600 rounded-xl flex-row items-center justify-center gap-1.5"
                  >
                    <Check size={14} color="#ffffff" />
                    <Text className="font-sans font-bold text-xs text-white">Mark as Memorized</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      onUpdateStatus(verses, 'learning');
                      onClose();
                    }}
                    className="w-full py-2.5 px-3 bg-[#1A1A1A] rounded-xl items-center"
                  >
                    <Text className="font-sans font-bold text-xs text-white">Mark as Practiced</Text>
                  </Pressable>
                  <Pressable onPress={resetTypeGame} className="w-full py-1 items-center">
                    <Text className="text-[10.5px] text-neutral-500 font-bold">Practice Again</Text>
                  </Pressable>
                </View>
              </ScrollView>
            )}
          </View>
        )}

        {/* ======================================================== */}
        {/* REVEAL MODE VIEW */}
        {/* ======================================================== */}
        {type === 'reveal' && (
          <View className="flex-1 justify-between">
            {/* Reading Box */}
            <ScrollView className="bg-neutral-50 border border-neutral-200 rounded-2xl flex-1 mb-3" contentContainerClassName="p-4 gap-3 pb-8">
              {verses.map((v) => (
                <View key={v.verse}>{renderMaskedText(v)}</View>
              ))}
              <View className="flex-row items-center gap-1 bg-white/90 p-1 rounded border border-neutral-100 self-start">
                <Info size={10} color="#a3a3a3" />
                <Text className="text-[9px] text-neutral-400 font-bold font-sans">Tap dots to peek, or use slider below</Text>
              </View>
            </ScrollView>

            {/* Bottom Slider & Feedback buttons */}
            <View className="gap-3 shrink-0">
              {/* Slider Control */}
              <View className="bg-neutral-50 border border-neutral-200 rounded-xl p-3 gap-2">
                <View className="flex-row justify-between items-center">
                  <Text className="text-[10px] font-sans font-bold text-neutral-600">Masking Strength</Text>
                  <Text className="text-[10px] font-mono font-bold text-neutral-900">{maskLevel}% Hidden</Text>
                </View>

                <View className="flex-row items-center gap-2.5">
                  <Pressable onPress={() => setMaskLevel(0)}>
                    <Text className="text-[9px] font-sans font-extrabold text-neutral-400">VISIBLE</Text>
                  </Pressable>

                  <Slider
                    style={{ flex: 1, height: 24 }}
                    minimumValue={0}
                    maximumValue={100}
                    step={25}
                    value={maskLevel}
                    onValueChange={setMaskLevel}
                    minimumTrackTintColor="#1A1A1A"
                    maximumTrackTintColor="#d4d4d4"
                  />

                  <Pressable onPress={() => setMaskLevel(100)}>
                    <Text className="text-[9px] font-sans font-extrabold text-neutral-400">BLANK</Text>
                  </Pressable>
                </View>

                <Pressable
                  onPressIn={() => setPeekActive(true)}
                  onPressOut={() => setPeekActive(false)}
                  className={`w-full py-1.5 border rounded-lg flex-row items-center justify-center gap-1.5 ${
                    peekActive ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-neutral-300'
                  }`}
                >
                  {peekActive ? <EyeOff size={12} color="#ffffff" /> : <Eye size={12} color="#262626" />}
                  <Text className={`font-sans font-bold text-[11px] ${peekActive ? 'text-white' : 'text-neutral-800'}`}>
                    {peekActive ? 'Peeking (release to hide)' : 'Hold to Peek All'}
                  </Text>
                </Pressable>
              </View>

              {/* Assessment Panel */}
              <View>
                <Text className="text-center text-[9px] font-sans font-bold text-neutral-400 tracking-wider mb-1.5 uppercase">
                  How well did you recall this passage?
                </Text>
                <View className="gap-2">
                  <View className="flex-row gap-2">
                    <Pressable
                      onPress={() => {
                        onUpdateStatus(verses, 'memorized', 'reveal');
                        onClose();
                      }}
                      className="flex-1 py-2 px-1 bg-emerald-600 rounded-xl items-center"
                    >
                      <Text className="font-sans font-bold text-[10.5px] text-white">I Got It! (Log Reveal) 🌟</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        onUpdateStatus(verses, 'memorized', 'speak');
                        onClose();
                      }}
                      className="flex-1 py-2 px-1 bg-indigo-600 rounded-xl items-center"
                    >
                      <Text className="font-sans font-bold text-[10.5px] text-white">Perfect Recital! (Voice) 🎙️</Text>
                    </Pressable>
                  </View>
                  <Pressable
                    onPress={() => {
                      onUpdateStatus(verses, 'learning');
                      onClose();
                    }}
                    className="w-full py-1.5 border border-dashed border-neutral-300 rounded-xl items-center"
                  >
                    <Text className="font-sans font-bold text-[10.5px] text-neutral-500">Need Practice 🔄</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
