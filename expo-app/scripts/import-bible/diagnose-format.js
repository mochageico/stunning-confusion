// Safe structural diagnostic: fetches the raw ESV API response and redacts
// every letter to 'x', preserving only digits, punctuation, and whitespace.
// This reveals the verse-numbering marker convention (e.g. "[1]", "2 ", etc.)
// without ever displaying actual scripture words/text.
const { fetchRawChapterText } = require('./adapters/esv');

(async () => {
  const book = process.argv[2] || 'Obadiah';
  const chapter = Number(process.argv[3] || 1);
  const text = await fetchRawChapterText(book, chapter);

  const redacted = text.replace(/[A-Za-z]/g, 'x');
  console.log(`Total length: ${text.length}`);
  console.log('--- redacted structure (letters -> x) ---');
  console.log(redacted.slice(0, 600));
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
