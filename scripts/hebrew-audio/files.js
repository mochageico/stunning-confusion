// The Shmuelof reading's files on archive.org, mapped to app book ids and
// HEBREW chapter numbers (the files follow the Hebrew Bible's chapters, so
// Joel has 4 and Malachi 3 -- see HEBREW_AUDIO_PLAN.md).

const ITEM = 'HebBible_AShmuelof';
const METADATA_URL = `https://archive.org/metadata/${ITEM}`;
const downloadUrl = (name) => `https://archive.org/download/${ITEM}/${name}`;

// archive.org file prefix (after "hbof") -> app book id.
const BOOK_BY_CODE = {
  Gen: 'GEN', Exo: 'EXO', Lev: 'LEV', Num: 'NUM', Deu: 'DEU', Jos: 'JOS', Jdg: 'JDG',
  Rut: 'RUT', '1Sa': '1SA', '2Sa': '2SA', '1Ki': '1KI', '2Ki': '2KI', '1Ch': '1CH',
  '2Ch': '2CH', Ezr: 'EZR', Neh: 'NEH', Est: 'EST', Job: 'JOB', Psa: 'PSA', Pro: 'PRO',
  Ecc: 'ECC', Sng: 'SNG', Isa: 'ISA', Jer: 'JER', Lam: 'LAM', Ezk: 'EZK', Dan: 'DAN',
  Hos: 'HOS', Jol: 'JOL', Amo: 'AMO', Oba: 'OBA', Jon: 'JON', Mic: 'MIC', Nam: 'NAM',
  Hab: 'HAB', Zep: 'ZEP', Hag: 'HAG', Zec: 'ZEC', Mal: 'MAL',
};

/** "hbofJol_03.mp3" -> { bookId: 'JOL', hebChapter: 3 }; Obadiah's one file has no suffix. */
function parseFileName(name) {
  const m = /^hbof(\w{3})(?:_(\d+))?\.mp3$/.exec(name);
  if (!m || !BOOK_BY_CODE[m[1]]) return null;
  return { bookId: BOOK_BY_CODE[m[1]], hebChapter: m[2] ? Number(m[2]) : 1 };
}

module.exports = { ITEM, METADATA_URL, downloadUrl, BOOK_BY_CODE, parseFileName };
