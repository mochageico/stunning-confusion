// Search on My Verses: a verse or passage matches when every word typed
// appears somewhere in its reference or its text. "john 3:16" finds John 3:16
// and John 3:16–18; "shepherd" finds Psalm 23:1 by its words. Case and the
// curly quotes in verse text don't matter.

const clean = (s: string) => s.toLowerCase().replace(/[“”"‘’']/g, '');

export function matchesVerseQuery(query: string, reference: string, texts: string[]): boolean {
  const words = clean(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const haystack = clean(`${reference} ${texts.join(' ')}`);
  return words.every((w) => haystack.includes(w));
}
