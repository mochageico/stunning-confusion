// Bob Souer's BSB reading on openbible.com, mapped to app book ids and
// chapters. The files use English numbering, the same as our BSB import, and
// the two-digit prefix is the book's place in the 66-book canon, so
// "BSB_19_Psa_119.mp3" is ALL_BIBLE_BOOKS[18], chapter 119.

const { ALL_BIBLE_BOOKS } = require('../import-bible/books');

const READER = 'souer';
const BASE_URL = `https://openbible.com/audio/${READER}/`;
const downloadUrl = (name) => BASE_URL + name;

/** "BSB_19_Psa_119.mp3" -> { bookId: 'PSA', chapter: 119 }; null for the zips or anything else. */
function parseFileName(name) {
  const m = /^BSB_(\d{2})_(\w{3})_(\d{3})\.mp3$/.exec(name);
  if (!m) return null;
  const book = ALL_BIBLE_BOOKS[Number(m[1]) - 1];
  if (!book) return null;
  return { bookId: book.id, chapter: Number(m[3]) };
}

module.exports = { READER, BASE_URL, downloadUrl, parseFileName };
