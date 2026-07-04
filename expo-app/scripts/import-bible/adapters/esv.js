// Adapter for the official Crossway ESV API (https://api.esv.org).
// Requires your own API key: sign up at https://api.esv.org/account/create-application/
// (free tier available; review Crossway's current terms of use before production use —
// they require displaying the ESV copyright/permission notice and may cap usage).
//
// Fetches one chapter at a time (the endpoint returns a formatted text blob, not
// structured per-verse JSON) and splits it into individual verses.

const ESV_API_BASE = 'https://api.esv.org/v3/passage/text/';
const MAX_RETRIES = 6;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchRawChapterText(bookName, chapterNumber) {
  const apiKey = process.env.ESV_API_KEY;
  if (!apiKey) {
    throw new Error('ESV_API_KEY environment variable is not set. Get one at https://api.esv.org/account/create-application/');
  }

  // Use an explicit chapter:verse-range reference (not just "Book N"), and
  // over-request through verse 200 — no Bible chapter has more than 176
  // verses (Psalm 119), so this always safely captures the whole chapter.
  // Plain "Book N" is ambiguous for single-chapter books (Obadiah, Philemon,
  // 2 John, 3 John, Jude), where the API's reference parser reads "N" as a
  // VERSE number instead of a chapter number.
  const params = new URLSearchParams({
    q: `${bookName} ${chapterNumber}:1-200`,
    'include-passage-references': 'false',
    'include-verse-numbers': 'true',
    'include-first-verse-numbers': 'true',
    'include-headings': 'false',
    'include-footnotes': 'false',
    'include-footnote-body': 'false',
    'include-selahs': 'false',
    'include-passage-horizontal-lines': 'false',
    'include-heading-horizontal-lines': 'false',
    'indent-paragraphs': '0',
    'indent-poetry-lines': '0',
    'indent-declares': '0',
    'indent-psalm-doxology': '0',
    'line-length': '0',
  });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${ESV_API_BASE}?${params.toString()}`, {
      headers: { Authorization: `Token ${apiKey}` },
    });

    if (res.ok) {
      const data = await res.json();
      return (data.passages && data.passages[0]) || '';
    }

    if (res.status === 429) {
      const body = await res.text();
      // The API's 429 body looks like {"detail": "...Try again in N seconds."} —
      // parse that hint when present, otherwise back off exponentially.
      const hintMatch = body.match(/try again in (\d+(?:\.\d+)?) seconds?/i);
      const waitMs = hintMatch ? Math.ceil(parseFloat(hintMatch[1]) * 1000) + 250 : 1000 * 2 ** attempt;

      // A short wait (a few seconds) is a normal burst throttle — worth
      // retrying automatically. A long wait (this crossed 30s once, all the
      // way up to ~41 minutes) means we've hit a different, much stricter
      // limit (hourly/daily quota, not a burst window) — don't silently
      // block the whole import on that; surface it immediately instead so
      // it can be handled deliberately (wait for quota reset, contact
      // Crossway about the tier, etc.) rather than discovered by staring at
      // a process that looks hung.
      const MAX_AUTO_RETRY_WAIT_MS = 20_000;
      if (waitMs > MAX_AUTO_RETRY_WAIT_MS) {
        throw new Error(
          `ESV API rate limit for ${bookName} ${chapterNumber} suggests waiting ${Math.round(waitMs / 1000)}s — ` +
            `that's long enough to indicate a stricter quota (not a short burst throttle), so stopping here instead ` +
            `of blocking. Raw response: ${body}`
        );
      }

      if (attempt < MAX_RETRIES) {
        console.warn(`  (rate limited on ${bookName} ${chapterNumber}, waiting ${waitMs}ms — attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(waitMs);
        continue;
      }
    }

    throw new Error(`ESV API request failed (${res.status}) for ${bookName} ${chapterNumber}: ${await res.text()}`);
  }

  throw new Error(`ESV API still rate-limited after ${MAX_RETRIES} retries for ${bookName} ${chapterNumber}`);
}

async function fetchChapter(bookName, chapterNumber) {
  const text = await fetchRawChapterText(bookName, chapterNumber);
  return parseVersesFromBlob(text);
}

// The ESV API returns verse-numbered plain text with each verse prefixed by
// "[N] " (bracketed verse number) — verified against live responses across
// several chapters, including edge cases (single-chapter books, Psalm 119 —
// the longest chapter, and Song of Solomon, which has speaker-label headings
// like "She"/"He" that survive even with include-headings=false).
//
// Some chapters have leading text before the first "[1]" marker (e.g. those
// speaker labels), so this can't assume a clean alternating split starting at
// index 0 — instead it finds every "[N]" match by position and takes each
// verse's text as the span between that match and the next one (or the end
// of the string for the last verse). Any text before the first match is
// discarded as non-verse content.
function parseVersesFromBlob(text) {
  const verses = {};
  const matches = [...text.matchAll(/\[(\d+)\]\s*/g)];
  for (let i = 0; i < matches.length; i++) {
    const verseNum = matches[i][1];
    const startIdx = matches[i].index + matches[i][0].length;
    const endIdx = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const verseText = text.slice(startIdx, endIdx).trim();
    if (verseText) {
      verses[verseNum] = verseText;
    }
  }
  return verses;
}

module.exports = {
  fetchChapter,
  fetchRawChapterText,
  parseVersesFromBlob,
  id: 'ESV',
  name: 'English Standard Version',
  isPublicDomain: false,
};
