// One-off diagnostic: verifies the ESV adapter's verse-splitting logic against
// a real API response, WITHOUT printing any actual verse text — only
// structural facts (verse count, verse number sequence, per-verse character
// length) so this can be checked without reproducing scripture text.
const { fetchChapter } = require('./adapters/esv');

(async () => {
  const book = process.argv[2] || 'Obadiah';
  const chapter = Number(process.argv[3] || 1);
  const verses = await fetchChapter(book, chapter);
  const numbers = Object.keys(verses)
    .map(Number)
    .sort((a, b) => a - b);

  console.log(`Book/chapter: ${book} ${chapter}`);
  console.log(`Verse count: ${numbers.length}`);
  console.log(`Verse numbers: ${numbers.join(',')}`);
  console.log(`Numbers consecutive from 1? ${numbers.every((n, i) => n === i + 1)}`);
  console.log(`Per-verse character lengths: ${numbers.map((n) => verses[n].length).join(',')}`);
  console.log(`Any empty verse text? ${numbers.some((n) => !verses[n] || verses[n].trim().length === 0)}`);
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
