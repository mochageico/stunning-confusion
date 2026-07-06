import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Pause, X, RefreshCw, Sparkles, Sliders, Volume2, Eye, EyeOff, Check, Info, Repeat, Keyboard, Mic, MicOff } from 'lucide-react';
import { VerseState, QueueItem } from '../types';

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

export default function PracticeModals({ 
  type, 
  verses, 
  allVerses, 
  onClose, 
  onUpdateStatus,
  memoryQueue,
  primingLookahead = 30,
  setPrimingLookahead
}: PracticeModalsProps) {
  if (!verses || verses.length === 0) return null;

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
          status: item.status === 'retained' ? 'memorized' : 'learning'
        });

        dbLearning = memoryQueue.filter(item => item.status === 'learning').map(mapQueueItemToVerse);
        dbReviewing = memoryQueue.filter(
          item => item.status === 'reviewing' && (!item.nextReviewDueDate || new Date(item.nextReviewDueDate) <= new Date())
        ).map(mapQueueItemToVerse);
        dbPriming = memoryQueue.filter(item => item.status === 'queued').slice(0, primingLookahead).map(mapQueueItemToVerse);
      } else {
        // Fallback
        dbLearning = (allVerses || []).filter(v => v.book === 'Genesis' && v.chapter === 1 && (v.verse === 3 || v.verse === 4 || v.verse === 5 || v.verse === 6));
        dbReviewing = (allVerses || []).filter(v => (v.book === 'Romans' && v.chapter === 8 && (v.verse === 1 || v.verse === 2)) || (v.book === 'John' && v.chapter === 15));
        dbPriming = (allVerses || []).filter(v => (v.book === 'Genesis' && v.chapter === 1 && v.verse >= 7) || (v.book === 'Genesis' && v.chapter === 2));
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
  }, [playSource, verses, allVerses, memoryQueue, primingLookahead]);

  // Header reference text
  const referenceText = useMemo(() => {
    const targetVerses = (type === 'type' || type === 'reveal') ? verses : activePlayVerses;

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
  const listenTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Map each word to its containing verse object and index
  const wordObjects = useMemo(() => {
    const list: { word: string; verseObj: VerseState; indexInVerse: number }[] = [];
    activePlayVerses.forEach((verseObj) => {
      const words = `${verseObj.verse} ${verseObj.text}`.split(/\s+/);
      words.forEach((w, idx) => {
        list.push({
          word: w,
          verseObj,
          indexInVerse: idx,
        });
      });
    });
    return list;
  }, [activePlayVerses]);

  useEffect(() => {
    if (type !== 'listen') return;
    
    if (listenPlaying && wordObjects.length > 0) {
      const delay = (60000 / 125) / listenSpeed; // ~125 words per minute base rate, adjusted by speed
      listenTimerRef.current = setInterval(() => {
        setListenWordIndex(prev => {
          const actualStart = (playSource === 'selection' && selectionStart !== null) ? selectionStart : 0;
          const actualEnd = (playSource === 'selection' && selectionEnd !== null) ? selectionEnd : wordObjects.length - 1;

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
    const actualStart = (playSource === 'selection' && selectionStart !== null) ? selectionStart : 0;
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
      setLocalToast(prev => prev === msg ? null : prev);
    }, 2500);
  };

  const activeVerseToType = verses[currentTypeVerseIdx];
  const typeWords = activeVerseToType ? activeVerseToType.text.split(/\s+/) : [];

  const getCleanFirstChar = (word: string) => {
    if (!word) return '';
    const clean = word.replace(/[^a-zA-Z0-9]/g, '');
    return clean.length > 0 ? clean.charAt(0).toLowerCase() : '';
  };

  const handleTypeChar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
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
          setCurrentTypeVerseIdx(prev => prev + 1);
          setTypeWordIdx(0);
          setVerseStrikes(0); // reset strikes on new verse
        }
      } else {
        setTypeWordIdx(prev => prev + 1);
      }
      setTypedInput('');
    } else {
      const nextStrikes = verseStrikes + 1;
      setTypeErrors(prev => prev + 1);
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
        setCurrentTypeVerseIdx(prev => prev + 1);
        setTypeWordIdx(0);
        setVerseStrikes(0);
      }
    } else {
      setTypeWordIdx(prev => prev + 1);
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

  const renderMaskedText = (v: VerseState) => {
    const words = v.text.split(/\s+/);
    return (
      <p className="font-serif text-[15px] leading-relaxed text-neutral-800 tracking-wide text-left mb-3">
        <span className="font-sans text-[10px] font-bold text-neutral-400 mr-1 align-super">{v.verse}</span>
        {words.map((w, idx) => {
          const isHidden = shouldHideWord(w, idx);
          const wordKey = `${v.book}-${v.chapter}-${v.verse}-${idx}`;
          const isWordPeeked = peekActive || singlePeekedWords[wordKey];

          if (isHidden) {
            return (
              <React.Fragment key={idx}>
                <span 
                  className="relative inline-block mx-0.5 select-none align-baseline cursor-pointer transition-all"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSinglePeekedWords(prev => ({
                      ...prev,
                      [wordKey]: !prev[wordKey]
                    }));
                  }}
                >
                  {/* Invisible copy to preserve EXACT width and line wrapping */}
                  <span className="invisible font-serif text-[15px] break-keep select-none">{w}</span>
                  {/* Absolute overlay container */}
                  <span className={`absolute inset-0 flex items-center justify-center rounded transition-all select-none font-serif text-[15px] leading-none px-1 ${
                    isWordPeeked 
                      ? 'bg-amber-100 text-neutral-900 border-b border-amber-400 font-medium' 
                      : 'bg-neutral-100 text-neutral-400 font-mono font-bold hover:bg-neutral-200'
                  }`}>
                    {isWordPeeked ? w : maskLetters(w)}
                  </span>
                </span>
                {' '}
              </React.Fragment>
            );
          }

          // Unhidden word
          return (
            <React.Fragment key={idx}>
              <span className="inline-block mx-0.5 font-serif text-[15px] text-neutral-800 align-baseline select-none">
                {w}
              </span>
              {' '}
            </React.Fragment>
          );
        })}
      </p>
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
    <div 
      className="absolute inset-0 bg-white z-50 flex flex-col pt-11 pb-4 px-4 overflow-hidden" 
      id="practice_overlay"
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-[#1A1A1A] pb-2 mb-3">
        <div>
          <span className="text-[9px] uppercase tracking-wider text-neutral-500 font-sans font-bold">
            {type === 'listen' ? 'Audio Player & Looper' : type === 'type' ? 'Keyboard Recall practice' : 'Active Reveal practice'}
          </span>
          <h2 className="text-base font-serif font-bold text-neutral-900 leading-tight truncate max-w-[280px]">
            {referenceText}
          </h2>
        </div>
        <button 
          onClick={onClose} 
          className="w-7 h-7 rounded-full border border-neutral-300 hover:border-[#1A1A1A] flex items-center justify-center text-neutral-800 hover:bg-neutral-50 transition cursor-pointer shrink-0"
          id="close_practice_btn"
        >
          <X size={14} />
        </button>
      </div>

      {/* Main Panel - Dynamic containment, never overflows the phone frame */}
      <div className="flex-1 min-h-0 flex flex-col justify-between py-1">
        
        {/* ======================================================== */}
        {/* LISTEN MODE VIEW */}
        {/* ======================================================== */}
        {type === 'listen' && (
          <div className="flex-1 min-h-0 flex flex-col justify-between">
            {/* Word Highlight Box */}
            <div className="bg-neutral-50 border border-neutral-200 rounded-2xl flex-1 min-h-0 relative mb-3 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
                <div className="font-serif text-[15px] leading-relaxed text-neutral-800 text-left pb-12 space-y-3">
                  {wordObjects.map((item, index) => {
                    const isActive = index === listenWordIndex && listenPlaying;
                    const isRead = index < listenWordIndex;
                    
                    // Detect if this is the first word of a new verse
                    const isFirstWordOfVerse = index === 0 || wordObjects[index - 1].verseObj.id !== item.verseObj.id;
                    
                    // In selection mode, is this word in the selected range?
                    const inSelectionRange = playSource === 'selection' && 
                      selectionStart !== null && 
                      (selectionEnd !== null ? (index >= selectionStart && index <= selectionEnd) : (index === selectionStart));

                    let wordClass = "inline-block mx-0.5 cursor-pointer transition-all duration-150 rounded px-0.5 select-none ";
                    if (isActive) {
                      wordClass += "bg-[#1A1A1A] text-white font-extrabold scale-105 shadow-xs px-1";
                    } else if (playSource === 'selection' && selectionStart !== null) {
                      if (inSelectionRange) {
                        wordClass += "bg-amber-100 text-amber-900 font-bold border-b-2 border-amber-400 hover:bg-amber-200";
                      } else {
                        wordClass += "opacity-35 text-neutral-400 hover:text-neutral-600";
                      }
                    } else {
                      if (isRead) {
                        wordClass += "text-neutral-900 font-semibold bg-neutral-200/50 hover:bg-neutral-300/40";
                      } else {
                        wordClass += "text-neutral-400 hover:text-neutral-700";
                      }
                    }

                    return (
                      <React.Fragment key={index}>
                        {isFirstWordOfVerse && (
                          <span className="block mt-3 first:mt-0 mb-1 font-sans text-[10px] font-extrabold text-[#444] bg-neutral-150 border border-neutral-200 rounded px-2 py-0.5 w-max tracking-wide uppercase">
                            {item.verseObj.book} {item.verseObj.chapter}:{item.verseObj.verse}
                          </span>
                        )}
                        <span 
                          onClick={() => handleWordClick(index)}
                          className={wordClass}
                        >
                          {item.word}{' '}
                        </span>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>

              {/* Selection Mode Instructions overlay */}
              {playSource === 'selection' && (
                <div className="absolute top-2 right-2 text-[8.5px] font-sans font-bold bg-amber-500/10 text-amber-850 px-2 py-1 rounded border border-amber-200 flex items-center gap-1 shadow-2xs z-10 pointer-events-none">
                  <span>{selectionStart === null ? "Tap word to set start" : selectionEnd === null ? "Tap word to set end" : "Segment active"}</span>
                </div>
              )}

              {/* Static Segment control and Audio wave indicator footer bar */}
              <div className="bg-neutral-100 border-t border-neutral-200 px-3 py-2 flex justify-between items-center shrink-0 z-10">
                <div className="flex items-center gap-2">
                  {playSource === 'selection' && selectionStart !== null ? (
                    <button 
                      onClick={() => {
                        setSelectionStart(null);
                        setSelectionEnd(null);
                        setListenWordIndex(0);
                      }}
                      className="text-[8.5px] font-sans font-extrabold bg-white hover:bg-neutral-50 border border-neutral-300 text-neutral-800 px-2.5 py-1 rounded-lg shadow-3xs cursor-pointer flex items-center gap-1.5 transition-all"
                    >
                      <RefreshCw size={10} />
                      <span>Reset Segment</span>
                    </button>
                  ) : (
                    <span className="text-[8.5px] font-sans font-bold text-neutral-450 uppercase tracking-wider">
                      {playSource === 'selection' ? "Tap word to select segment" : "Playlist Auto-playback"}
                    </span>
                  )}
                </div>

                {/* Sound Wave dynamic indicator */}
                <div className="flex items-end space-x-0.5 h-5 bg-white border border-neutral-200 px-2 py-1 rounded-lg shadow-3xs">
                  {[1, 2, 3, 4, 5].map((bar) => {
                    const delay = (bar * 0.18).toFixed(2);
                    return (
                      <div 
                        key={bar} 
                        className="w-0.5 bg-[#1A1A1A] rounded-full"
                        style={{
                          height: listenPlaying ? '100%' : '15%',
                          animationName: listenPlaying ? 'listenWave' : 'none',
                          animationDuration: listenPlaying ? '1s' : '0s',
                          animationTimingFunction: listenPlaying ? 'ease-in-out' : 'ease',
                          animationIterationCount: listenPlaying ? 'infinite' : '1',
                          animationDirection: listenPlaying ? 'alternate' : 'normal',
                          animationDelay: `${delay}s`
                        }}
                      />
                    );
                  })}
                </div>
                <style>{`
                  @keyframes listenWave {
                    0% { height: 10%; }
                    100% { height: 100%; }
                  }
                `}</style>
              </div>
            </div>

            {/* Custom Control and Audio Looping Panel */}
            <div className="space-y-3.5 bg-white pt-2">
              
              {/* playlist / source options */}
              {allVerses && allVerses.length > 0 && (
                <div className="space-y-1 bg-neutral-50 p-2 rounded-xl border border-neutral-150">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-[9px] font-sans font-extrabold text-neutral-400 tracking-wider uppercase">
                      Loop Target / Playlist
                    </span>
                    <span className="text-[9px] font-mono font-bold text-neutral-500 bg-neutral-200 px-1.5 py-0.2 rounded-full">
                      {activePlayVerses.length} verses
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-1 pt-0.5">
                    {[
                      { id: 'all', label: 'All verses' },
                      { id: 'memorization', label: 'Learning' },
                      { id: 'reviewing', label: 'Review' },
                      { id: 'priming', label: 'Priming' },
                      { id: 'selection', label: 'Selected' },
                    ].map((src) => (
                      <button
                        key={src.id}
                        onClick={() => setPlaySource(src.id as any)}
                        className={`text-[9.5px] py-1 px-0.5 rounded-lg font-bold border transition-all cursor-pointer truncate text-center ${
                          playSource === src.id
                            ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                            : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'
                        }`}
                        title={`Loop ${src.label} verses`}
                      >
                        {src.label}
                      </button>
                    ))}
                  </div>

                  {playSource === 'priming' && setPrimingLookahead && (
                    <div className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-lg p-2 mt-2 text-left transition-all">
                      <div className="space-y-0.5">
                        <span className="text-[9px] font-sans font-bold text-amber-850 uppercase tracking-wider block">
                          ⚡ Priming Window Size
                        </span>
                        <p className="text-[8.5px] font-sans text-amber-700 leading-none">
                          Set lookahead priming size
                        </p>
                      </div>
                      <select
                        value={primingLookahead}
                        onChange={(e) => setPrimingLookahead(Number(e.target.value))}
                        className="bg-white border border-amber-200 rounded px-1.5 py-0.5 text-[10px] font-mono font-bold text-amber-900 focus:outline-none cursor-pointer hover:border-amber-400"
                      >
                        <option value="10">10 verses</option>
                        <option value="20">20 verses</option>
                        <option value="30">30 verses</option>
                        <option value="40">40 verses</option>
                        <option value="50">50 verses</option>
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Adjusters: Speed (.2 steps) and Repeat mode */}
              <div className="grid grid-cols-2 gap-2">
                {/* 1. Playback Speed Selector (.2 increments) */}
                <div className="flex flex-col justify-center bg-neutral-50 p-2.5 rounded-xl border border-neutral-200 space-y-1">
                  <span className="text-[9px] font-sans font-bold text-neutral-500 uppercase tracking-wider pl-1 flex items-center gap-1">
                    <Sliders size={10} /> Speed (±0.2)
                  </span>
                  <div className="flex items-center justify-between bg-white px-2 py-1 rounded-lg border border-neutral-150">
                    <button
                      onClick={() => setListenSpeed(s => Math.max(0.4, Number((s - 0.2).toFixed(1))))}
                      className="w-5 h-5 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 rounded font-black text-xs flex items-center justify-center cursor-pointer select-none text-neutral-800"
                    >
                      -
                    </button>
                    <span className="text-xs font-mono font-bold text-neutral-900">{listenSpeed.toFixed(1)}x</span>
                    <button
                      onClick={() => setListenSpeed(s => Math.min(2.4, Number((s + 0.2).toFixed(1))))}
                      className="w-5 h-5 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 rounded font-black text-xs flex items-center justify-center cursor-pointer select-none text-neutral-800"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* 2. Audio Repeat Control */}
                <div className="flex flex-col justify-center bg-neutral-50 p-2.5 rounded-xl border border-neutral-200 space-y-1">
                  <span className="text-[9px] font-sans font-bold text-neutral-500 uppercase tracking-wider pl-1 flex items-center gap-1">
                    <Repeat size={10} /> Repeat Setting
                  </span>
                  <div className="flex space-x-0.5 bg-white p-0.5 rounded-lg border border-neutral-150">
                    {[
                      { id: 'off', label: 'Off' },
                      { id: 'playlist', label: 'Loop' },
                    ].map((mode) => (
                      <button
                        key={mode.id}
                        onClick={() => setRepeatMode(mode.id as any)}
                        className={`text-[9.5px] py-1 px-1 flex-1 rounded-md font-bold transition-all cursor-pointer ${
                          repeatMode === mode.id
                            ? 'bg-[#1A1A1A] text-white font-black'
                            : 'bg-white text-neutral-500 hover:text-neutral-850'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Progress Slider bar */}
              <div className="space-y-0.5">
                <div className="flex justify-between text-[8px] font-bold text-neutral-400 font-mono px-1">
                  <span>START</span>
                  <span>{wordObjects.length > 0 ? Math.round((listenWordIndex / wordObjects.length) * 100) : 0}%</span>
                  <span>END</span>
                </div>
                <div className="w-full bg-neutral-150 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-[#1A1A1A] h-full transition-all duration-150"
                    style={{ width: `${wordObjects.length > 0 ? (listenWordIndex / wordObjects.length) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {/* Main player controls row */}
              <div className="flex space-x-2.5 pb-1">
                <button
                  onClick={restartListen}
                  className="flex-1 py-2.5 px-3 border-2 border-[#1A1A1A] rounded-xl font-sans font-bold text-xs text-[#1A1A1A] hover:bg-neutral-50 active:bg-neutral-100 flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <RefreshCw size={12} /> Restart
                </button>
                <button
                  onClick={() => setListenPlaying(!listenPlaying)}
                  className={`flex-[2] py-2.5 px-3 rounded-xl font-sans font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm text-white ${
                    listenPlaying ? 'bg-neutral-900 hover:bg-black text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  }`}
                >
                  {listenPlaying ? <Pause size={12} className="text-white" /> : <Play size={12} className="text-white" />}
                  <span className="text-white">{listenPlaying ? 'Pause Audio' : 'Start Looping'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TYPE MODE VIEW */}
        {/* ======================================================== */}
        {type === 'type' && (
          <div className="flex-1 min-h-0 flex flex-col justify-between relative">
            {/* Local custom toast alert */}
            {localToast && (
              <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-[#1A1A1A] text-white text-[10px] font-sans font-bold px-3.5 py-1.5 rounded-full shadow-lg z-30 animate-bounce tracking-wide shrink-0">
                {localToast}
              </div>
            )}

            {/* Sub Mode Selection Tab bar */}
            <div className="flex bg-neutral-100 p-1 rounded-xl mb-3.5 border border-neutral-200 shrink-0">
              <button
                onClick={() => {
                  setTypeSubMode('type');
                  resetTypeGame();
                }}
                className={`flex-1 py-1.5 rounded-lg text-[10px] uppercase tracking-wider font-sans font-extrabold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  typeSubMode === 'type'
                    ? 'bg-[#1A1A1A] text-white shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                <Keyboard size={12} />
                <span>Type Practice</span>
              </button>
              <button
                onClick={() => {
                  setTypeSubMode('speak');
                  resetTypeGame();
                }}
                className={`flex-1 py-1.5 rounded-lg text-[10px] uppercase tracking-wider font-sans font-extrabold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  typeSubMode === 'speak'
                    ? 'bg-[#1A1A1A] text-white shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                <Mic size={12} />
                <span>Speak Practice</span>
              </button>
            </div>

            {!isFinishedTyping ? (
              typeSubMode === 'type' ? (
                <div className="flex-1 min-h-0 flex flex-col justify-between">
                  {/* Typing card frame */}
                  <div className={`border-2 rounded-2xl p-4 flex-1 min-h-0 flex flex-col justify-between transition-colors duration-150 relative ${
                    flashError ? 'border-red-500 bg-red-50' : 'border-[#1A1A1A] bg-white'
                  }`}>
                    {/* Strike Reset Alert Overlay */}
                    {showStrikeResetAlert && (
                      <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center text-center p-4 rounded-xl z-20 animate-fade-in">
                        <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 mb-2">
                          <RefreshCw size={20} className="animate-spin" />
                        </div>
                        <h4 className="text-sm font-sans font-extrabold text-red-900">Verse Restarting!</h4>
                        <p className="text-[10px] text-red-700/85 font-medium px-4">
                          You reached the strike limit. Let's try this verse again from the beginning!
                        </p>
                      </div>
                    )}

                    <div className="overflow-y-auto flex-1 mb-2 scrollbar-thin text-left">
                      <span className="text-[9px] font-sans font-bold text-neutral-400 tracking-wider block mb-1">
                        Typing Practice Passage — {verses.length} {verses.length === 1 ? 'verse' : 'verses'} ({referenceText})
                      </span>
                      
                      <div className="font-serif text-[15px] leading-relaxed text-neutral-800 text-left space-y-3">
                        {verses.map((v, vIdx) => {
                          const isPastVerse = vIdx < currentTypeVerseIdx;
                          const isCurrentVerse = vIdx === currentTypeVerseIdx;
                          const words = v.text.split(/\s+/);

                          return (
                            <div key={`${v.book}-${v.chapter}-${v.verse}`} className="mb-2">
                              <p className="font-serif text-[15px] leading-relaxed text-neutral-800 tracking-wide">
                                <span className="font-sans text-[10px] font-bold text-neutral-400 mr-1 align-super">
                                  {v.verse}
                                </span>
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
                                      <React.Fragment key={idx}>
                                        <span className="inline-block mx-0.5 font-serif text-[15px] text-neutral-900 font-semibold align-baseline">
                                          {w}
                                        </span>
                                        {' '}
                                      </React.Fragment>
                                    );
                                  }

                                  return (
                                    <React.Fragment key={idx}>
                                      <span 
                                        className={`relative inline-block mx-0.5 select-none align-baseline transition-all rounded ${
                                          isWordCurrent ? 'ring-2 ring-neutral-400' : ''
                                        }`}
                                      >
                                        {/* Invisible copy to preserve exact dimension stability */}
                                        <span className="invisible font-serif text-[15px] break-keep select-none">{w}</span>
                                        {/* Absolute masked dots overlay */}
                                        <span className={`absolute inset-0 flex items-center justify-center rounded transition-all select-none font-serif text-[15px] leading-none px-1 ${
                                          isWordCurrent 
                                            ? 'bg-amber-50 text-neutral-500 font-mono font-bold animate-pulse' 
                                            : 'bg-neutral-50/50 text-neutral-300 font-mono font-bold'
                                        }`}>
                                          {maskLetters(w)}
                                        </span>
                                      </span>
                                      {' '}
                                    </React.Fragment>
                                  );
                                })}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Input row */}
                    <div className="space-y-2.5 pt-2">
                      <div className="flex justify-between items-center text-[10px] text-neutral-450 font-bold px-1">
                        <div className="flex items-center gap-2">
                          <span>STRIKES: <span className={typeErrors > 0 ? 'text-red-600' : ''}>{typeErrors}</span></span>
                          {strikeLimit !== 'unlimited' && (
                            <>
                              <span className="text-neutral-300">|</span>
                              <span className="text-red-500 font-medium">Verse errors: {verseStrikes}/{strikeLimit}</span>
                            </>
                          )}
                        </div>
                        <span>{typeWordIdx} of {typeWords.length} words</span>
                      </div>

                      <div className="relative">
                        <input
                          type="text"
                          value={typedInput}
                          onChange={handleTypeChar}
                          placeholder={showStrikeResetAlert ? "Resetting..." : "Type first letter of each word..."}
                          className="w-full bg-neutral-50 border border-neutral-300 rounded-xl py-2 px-3 text-center font-sans font-semibold text-xs focus:outline-none focus:ring-2 focus:ring-[#1A1A1A] text-neutral-900"
                          autoFocus
                          disabled={showStrikeResetAlert}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Accuracy Settings Bar */}
                  <div className="mt-2.5 bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 space-y-1.5 text-left">
                    <div className="flex justify-between items-center px-1">
                      <span className="text-[9px] font-sans font-extrabold text-neutral-400 tracking-wider uppercase">
                        Strike Reset Limit (Accuracy Assist)
                      </span>
                      <span className="text-[9px] font-mono font-bold text-neutral-500">
                        {strikeLimit === 'unlimited' ? 'No Reset' : `${strikeLimit} Max Strikes`}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {([3, 5, 10, 'unlimited'] as const).map((limit) => (
                        <button
                          key={limit}
                          onClick={() => {
                            setStrikeLimit(limit);
                            setVerseStrikes(0);
                          }}
                          className={`text-[9.5px] py-1 rounded-lg font-bold border transition-all cursor-pointer text-center ${
                            strikeLimit === limit
                              ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                              : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'
                          }`}
                        >
                          {limit === 'unlimited' ? 'Off' : `${limit} errors`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Keyboard Game Options */}
                  <div className="mt-2 flex space-x-2.5">
                    <button
                      onClick={resetTypeGame}
                      className="flex-1 py-2 px-3 border border-neutral-300 rounded-xl font-sans font-bold text-xs text-neutral-600 hover:bg-neutral-50 flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <RefreshCw size={12} /> Reset Passage
                    </button>
                    <button
                      onClick={handleHint}
                      className="flex-1 py-2 px-3 border-2 border-[#1A1A1A] rounded-xl font-sans font-bold text-xs text-neutral-900 hover:bg-neutral-50 flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      Reveal Word
                    </button>
                  </div>
                </div>
              ) : (
                /* SPEAK SUB-MODE SKELETON */
                <div className="flex-1 min-h-0 flex flex-col justify-between">
                  <div className="border border-neutral-200 rounded-2xl p-4 flex-1 min-h-0 flex flex-col justify-between bg-white relative">
                    <div className="overflow-y-auto flex-1 mb-2 scrollbar-thin text-left">
                      <span className="text-[9px] font-sans font-bold text-[#1A1A1A] tracking-wider block mb-1">
                        Spoken Practice Passage — {verses.length} {verses.length === 1 ? 'verse' : 'verses'} ({referenceText})
                      </span>
                      
                      <div className="font-serif text-[15px] leading-relaxed text-neutral-800 text-left space-y-3">
                        {verses.map((v, vIdx) => {
                          const words = v.text.split(/\s+/);
                          const isPastVerse = vIdx < currentTypeVerseIdx;
                          const isCurrentVerse = vIdx === currentTypeVerseIdx;

                          return (
                            <div key={`${v.book}-${v.chapter}-${v.verse}`} className="mb-2">
                              <p className="font-serif text-[15px] leading-relaxed text-neutral-800 tracking-wide">
                                <span className="font-sans text-[10px] font-bold text-neutral-400 mr-1 align-super">
                                  {v.verse}
                                </span>
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
                                      <span key={idx} className="inline-block mx-0.5 text-emerald-600 font-semibold transition-all">
                                        {w}{' '}
                                      </span>
                                    );
                                  }

                                  return (
                                    <span 
                                      key={idx} 
                                      className={`relative inline-block mx-0.5 select-none align-baseline transition-all rounded ${
                                        isWordCurrent ? 'ring-2 ring-indigo-500 bg-indigo-50/50' : ''
                                      }`}
                                    >
                                      <span className="invisible font-serif text-[15px] break-keep select-none">{w}</span>
                                      <span className={`absolute inset-0 flex items-center justify-center rounded transition-all select-none font-serif text-[15px] leading-none px-1 ${
                                        isWordCurrent 
                                          ? 'bg-indigo-50 text-indigo-600 font-bold animate-pulse' 
                                          : 'bg-neutral-50/50 text-neutral-300 font-mono font-bold'
                                      }`}>
                                        {maskLetters(w)}
                                      </span>
                                    </span>
                                  );
                                })}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Microphone waveform visualization card */}
                    <div className="bg-neutral-50 border border-neutral-150 rounded-xl p-3.5 space-y-3 mt-2">
                      <div className="flex justify-between items-center text-[10px] text-neutral-550 font-bold font-sans">
                        <span className="text-neutral-450 uppercase tracking-wider">Voice Assist Status</span>
                        <span className="font-mono font-extrabold text-neutral-600">
                          {isListeningSpeak ? 'LISTENING...' : 'MIC STANDBY'}
                        </span>
                      </div>

                      {/* Animated audio wave or standby text */}
                      <div className="h-9 flex items-center justify-center bg-white rounded-lg border border-neutral-150 px-3 relative overflow-hidden">
                        {isListeningSpeak ? (
                          <div className="flex items-center gap-[3px]">
                            {Array.from({ length: 18 }).map((_, idx) => (
                              <div
                                key={idx}
                                className="w-0.5 bg-indigo-600 rounded-full animate-pulse"
                                style={{
                                  height: `${Math.floor(Math.random() * 22) + 6}px`,
                                  animationDelay: `${idx * 0.04}s`,
                                  animationDuration: '0.65s'
                                }}
                              />
                            ))}
                          </div>
                        ) : (
                          <span className="text-[10px] text-neutral-400 font-sans font-semibold">
                            Tap microphone below to speak and recite
                          </span>
                        )}
                      </div>

                      {/* Microphone control button */}
                      <div className="flex justify-center py-0.5">
                        <button
                          onClick={() => {
                            const next = !isListeningSpeak;
                            setIsListeningSpeak(next);
                            if (next) {
                              triggerLocalToast("Microphone active! Speak now... 🎙️");
                            } else {
                              triggerLocalToast("Microphone in standby.");
                            }
                          }}
                          className={`w-11 h-11 rounded-full flex items-center justify-center transition shadow-md cursor-pointer ${
                            isListeningSpeak 
                              ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse' 
                              : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                          }`}
                        >
                          {isListeningSpeak ? <MicOff size={18} /> : <Mic size={18} />}
                        </button>
                      </div>

                      {/* Simulate speech button for high-fidelity evaluation interaction */}
                      <div className="flex justify-between items-center border-t border-neutral-150 pt-2.5">
                        <span className="text-[9px] text-neutral-400 font-bold font-sans uppercase">
                          Recital Simulation
                        </span>
                        <button
                          onClick={() => {
                            if (currentTypeVerseIdx >= verses.length) return;
                            if (typeWordIdx < typeWords.length - 1) {
                              const spokenWord = typeWords[typeWordIdx];
                              setTypeWordIdx(prev => prev + 1);
                              triggerLocalToast(`Spoken word: "${spokenWord}" ✓`);
                            } else {
                              if (currentTypeVerseIdx < verses.length - 1) {
                                setCurrentTypeVerseIdx(prev => prev + 1);
                                setTypeWordIdx(0);
                                triggerLocalToast("Great! Next verse ➔");
                              } else {
                                setIsFinishedTyping(true);
                                triggerLocalToast("Perfect recital completed! 🎉");
                              }
                            }
                          }}
                          className="px-2.5 py-1 text-[9px] font-sans font-extrabold uppercase bg-white border border-neutral-250 hover:bg-neutral-50 text-neutral-700 rounded-lg transition-all shadow-3xs flex items-center gap-1 cursor-pointer"
                        >
                          <span>Simulate Voice Word ➔</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Reset controls */}
                  <div className="mt-2.5 flex gap-2">
                    <button
                      onClick={() => {
                        resetTypeGame();
                        setIsListeningSpeak(false);
                        triggerLocalToast("Recital practice reset.");
                      }}
                      className="flex-1 py-2 px-3 border border-neutral-300 rounded-xl font-sans font-bold text-xs text-neutral-600 hover:bg-neutral-50 flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <RefreshCw size={12} /> Reset Recital
                    </button>
                  </div>
                </div>
              )
            ) : (
              /* Success panel - ensures everything fits */
              <div className="flex-1 flex flex-col justify-center items-center text-center p-4 space-y-4 overflow-y-auto scrollbar-thin">
                <div className="w-12 h-12 bg-neutral-100 border-2 border-[#1A1A1A] rounded-full flex items-center justify-center text-neutral-900 shrink-0">
                  <Sparkles size={24} className="animate-bounce" />
                </div>
                <div>
                  <h3 className="text-lg font-serif font-bold text-neutral-900 leading-tight">Excellent Memory Recall!</h3>
                  <p className="text-xs text-neutral-500 font-sans mt-0.5">
                    Completed typing with {typeErrors} {typeErrors === 1 ? 'mistake' : 'mistakes'}.
                  </p>
                </div>

                <div className="w-full bg-neutral-50 border border-neutral-200 rounded-xl p-3 text-left font-serif italic text-xs text-neutral-600 space-y-1.5 max-h-[110px] overflow-y-auto scrollbar-thin">
                  {verses.map(v => (
                    <p key={v.verse}>
                      <span className="font-sans text-[9px] font-bold text-neutral-400 not-italic mr-1">{v.verse}</span>
                      {v.text}
                    </p>
                  ))}
                </div>

                <div className="w-full space-y-2 shrink-0">
                  <button
                    onClick={() => {
                      onUpdateStatus(verses, 'memorized', 'type');
                      onClose();
                    }}
                    className="w-full py-2.5 px-3 bg-emerald-600 text-white rounded-xl font-sans font-bold text-xs hover:bg-emerald-700 flex items-center justify-center gap-1.5 transition shadow-xs cursor-pointer"
                  >
                    <Check size={14} /> Mark as Memorized
                  </button>
                  <button
                    onClick={() => {
                      onUpdateStatus(verses, 'learning');
                      onClose();
                    }}
                    className="w-full py-2.5 px-3 bg-[#1A1A1A] text-white rounded-xl font-sans font-bold text-xs hover:bg-neutral-800 transition cursor-pointer"
                  >
                    Mark as Practiced
                  </button>
                  <button
                    onClick={resetTypeGame}
                    className="w-full py-1 text-[10.5px] text-neutral-500 hover:text-neutral-900 font-bold transition cursor-pointer"
                  >
                    Practice Again
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* REVEAL MODE VIEW */}
        {/* ======================================================== */}
        {type === 'reveal' && (
          <div className="flex-1 min-h-0 flex flex-col justify-between">
            {/* Reading Box */}
            <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-4 flex-1 overflow-y-auto min-h-0 flex flex-col justify-start relative scrollbar-thin mb-3">
              <div className="space-y-3 pb-8">
                {verses.map((v) => (
                  <div key={v.verse}>
                    {renderMaskedText(v)}
                  </div>
                ))}
              </div>

              <div className="absolute bottom-3 left-3 flex items-center gap-1 text-[9px] text-neutral-400 font-bold font-sans bg-white/90 p-1 rounded border border-neutral-100">
                <Info size={10} />
                <span>Tap dots to peek, or use slider below</span>
              </div>
            </div>

            {/* Bottom Slider & Feedback buttons */}
            <div className="space-y-3 shrink-0">
              {/* Slider Control */}
              <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-sans font-bold text-neutral-600">Masking Strength</span>
                  <span className="text-[10px] font-mono font-bold text-neutral-900">{maskLevel}% Hidden</span>
                </div>
                
                <div className="flex items-center space-x-2.5">
                  <button
                    onClick={() => setMaskLevel(0)}
                    className="text-[9px] font-sans font-extrabold text-neutral-400 hover:text-[#1A1A1A] transition cursor-pointer"
                  >
                    VISIBLE
                  </button>
                  
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="25"
                    value={maskLevel}
                    onChange={(e) => setMaskLevel(Number(e.target.value))}
                    className="flex-1 h-1.5 bg-neutral-300 rounded-lg appearance-none cursor-pointer accent-[#1A1A1A] focus:outline-none"
                  />
                  
                  <button
                    onClick={() => setMaskLevel(100)}
                    className="text-[9px] font-sans font-extrabold text-neutral-400 hover:text-[#1A1A1A] transition cursor-pointer"
                  >
                    BLANK
                  </button>
                </div>

                <button
                  onMouseDown={() => setPeekActive(true)}
                  onMouseUp={() => setPeekActive(false)}
                  onMouseLeave={() => setPeekActive(false)}
                  onTouchStart={() => setPeekActive(true)}
                  onTouchEnd={() => setPeekActive(false)}
                  className={`w-full py-1.5 border rounded-lg flex items-center justify-center gap-1.5 font-sans font-bold text-[11px] transition cursor-pointer ${
                    peekActive 
                      ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' 
                      : 'bg-white text-neutral-800 border-neutral-300 hover:bg-neutral-50'
                  }`}
                >
                  {peekActive ? <EyeOff size={12} /> : <Eye size={12} />}
                  {peekActive ? 'Peeking (release to hide)' : 'Hold to Peek All'}
                </button>
              </div>

              {/* Assessment Panel */}
              <div>
                <p className="text-center text-[9px] font-sans font-bold text-neutral-400 tracking-wider mb-1.5 uppercase">
                  How well did you recall this passage?
                </p>
                <div className="flex flex-col space-y-2">
                  <div className="flex space-x-2">
                    <button
                      onClick={() => {
                        onUpdateStatus(verses, 'memorized', 'reveal');
                        onClose();
                      }}
                      className="flex-1 py-2 px-1 bg-emerald-600 text-white rounded-xl font-sans font-bold text-[10.5px] hover:bg-emerald-700 flex items-center justify-center gap-1 transition shadow-xs cursor-pointer"
                    >
                      I Got It! (Log Reveal) 🌟
                    </button>
                    <button
                      onClick={() => {
                        onUpdateStatus(verses, 'memorized', 'speak');
                        onClose();
                      }}
                      className="flex-1 py-2 px-1 bg-indigo-600 text-white rounded-xl font-sans font-bold text-[10.5px] hover:bg-indigo-700 flex items-center justify-center gap-1 transition shadow-xs cursor-pointer"
                    >
                      Perfect Recital! (Voice) 🎙️
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      onUpdateStatus(verses, 'learning');
                      onClose();
                    }}
                    className="w-full py-1.5 border border-dashed border-neutral-300 hover:border-neutral-800 rounded-xl font-sans font-bold text-[10.5px] text-neutral-500 hover:text-neutral-900 transition cursor-pointer"
                  >
                    Need Practice 🔄
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
