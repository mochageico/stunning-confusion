import { useEffect, useRef, useState } from 'react';

/**
 * A search box's text, kept in the screen while typing and handed to the app
 * state only after a short pause. Written straight to app state, every
 * keystroke redrew the whole app; this way a keystroke redraws only the
 * screen with the box, and the app hears about it once typing stops.
 *
 * `value` is the app-state copy and `commit` its setter. Returns the text to
 * show and the function to call from onChangeText. Clearing the box, and
 * leaving the screen, hand the text over at once.
 */
export function useDebouncedText(
  value: string,
  commit: (next: string) => void,
  ms = 250
): [string, (next: string) => void] {
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Text typed but not handed over yet; null when the app state is up to date.
  const pending = useRef<string | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current === null) return;
    const next = pending.current;
    pending.current = null;
    commitRef.current(next);
  };

  const change = (next: string) => {
    setText(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    if (next === '') flush();
    else timer.current = setTimeout(flush, ms);
  };

  // Leaving the screen mid-pause still saves what was typed.
  useEffect(() => flush, []);

  // Follow the app state if something else changes it (never mid-typing).
  useEffect(() => {
    if (pending.current === null) setText(value);
  }, [value]);

  return [text, change];
}
