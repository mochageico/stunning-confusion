// Regression assertions for Hebrew/Greek word handling, run by
// `npm run check:textscript`.
//
// The failure these guard against is silent: when a Hebrew word normalizes to
// "" every drill treats it as punctuation, so a Hebrew verse simply has no
// words to recall -- nothing crashes. And the English half guards the other
// direction: textScript.ts took over helpers every English drill runs on.

import { classifyFirstLetterAttempt, firstLetterLine, firstLetterOnly, normalizeToken, tokenizeWords } from './recitation';
import { applyWordShape, joinWords, maskExceptFirstLetter, maskLetters, scriptOfVerse, splitWords, typedLetters } from './textScript';
import { buildSwapVerses, chunkIntoPhrases, splitIntoBites } from './drills';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

// Real verse text, as the importer stores it (vowel points, no accents).
const GEN_1_1 = 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ׃';
const GEN_1_2 =
  'וְהָאָרֶץ הָיְתָה תֹהוּ וָבֹהוּ וְחֹשֶׁךְ עַל־פְּנֵי תְהוֹם וְרוּחַ אֱלֹהִים מְרַחֶפֶת עַל־פְּנֵי הַמָּיִם׃';
const GEN_1_3 = 'וַיֹּאמֶר אֱלֹהִים יְהִי אוֹר וַיְהִי־אוֹר׃';
const JOHN_1_1 = 'Ἐν ἀρχῇ ἦν ὁ λόγος, καὶ ὁ λόγος ἦν πρὸς τὸν θεόν, καὶ θεὸς ἦν ὁ λόγος.';

// Any Hebrew vowel point (sheva..qubuts, holam, dagesh) -- how "this decoy
// is pointed" is detected below.
const hasHebrewVowel = (s: string) => Array.from(s).some((ch) => ch.charCodeAt(0) >= 0x05b0 && ch.charCodeAt(0) <= 0x05bc);

console.log('\nwhich script');
check('Hebrew/Greek in Genesis is Hebrew', scriptOfVerse({ book: 'Genesis', translationId: 'HEBGRK' }) === 'hebrew');
check('Hebrew/Greek in John is Greek', scriptOfVerse({ book: 'John', translationId: 'HEBGRK' }) === 'greek');
check('a verse with no translation is English', scriptOfVerse({ book: 'Genesis' }) === 'latin');

console.log('\nHebrew words');
check('Genesis 1:1 is 7 words', tokenizeWords(GEN_1_1, 'hebrew').length === 7, tokenizeWords(GEN_1_1, 'hebrew'));
check('Genesis 1:2 is 14 words (each maqaf splits)', tokenizeWords(GEN_1_2, 'hebrew').length === 14, splitWords(GEN_1_2, 'hebrew'));
check('a maqaf stays on the first piece', splitWords('עַל־פְּנֵי', 'hebrew')[0] === 'עַל־', splitWords('עַל־פְּנֵי', 'hebrew'));
check('joinWords puts maqaf-joined words back with no space', joinWords(splitWords(GEN_1_2, 'hebrew')) === GEN_1_2);
check('vowel points drop when comparing', normalizeToken('בְּרֵאשִׁית', 'hebrew') === 'בראשית', normalizeToken('בְּרֵאשִׁית', 'hebrew'));
check('final forms fold to regular letters', normalizeToken('הָאָרֶץ׃', 'hebrew') === 'הארצ', normalizeToken('הָאָרֶץ׃', 'hebrew'));
check('sof pasuq alone is not a word', normalizeToken('׃', 'hebrew') === '');
check('English normalization would have erased it (the bug)', normalizeToken('בְּרֵאשִׁית') === '');

console.log('\nHebrew hints');
check('first letter is the bare consonant', firstLetterOnly('בְּרֵאשִׁית', 'hebrew') === 'ב', firstLetterOnly('בְּרֵאשִׁית', 'hebrew'));
check('sof pasuq stays attached', firstLetterOnly('הָאָרֶץ׃', 'hebrew') === 'ה׃', firstLetterOnly('הָאָרֶץ׃', 'hebrew'));
check('a maqaf stays attached', firstLetterOnly('עַל־', 'hebrew') === 'ע־', firstLetterOnly('עַל־', 'hebrew'));
check('memory-grid line joins across a maqaf', firstLetterLine(GEN_1_3, 'hebrew') === 'ו א י א ו־א׃', firstLetterLine(GEN_1_3, 'hebrew'));
check('mask: one bullet per letter, points gone', maskLetters('הָאָרֶץ׃', 'hebrew') === '••••׃', maskLetters('הָאָרֶץ׃', 'hebrew'));
check('first-letter mask', maskExceptFirstLetter('הָאָרֶץ׃', 'hebrew') === 'ה•••׃', maskExceptFirstLetter('הָאָרֶץ׃', 'hebrew'));

console.log('\nHebrew typing (strict)');
check('the right letter is exact', classifyFirstLetterAttempt('ב', 'בְּרֵאשִׁית', 'hebrew') === 'exact');
check('a final-form key counts as its letter', classifyFirstLetterAttempt('ך', 'כִּי', 'hebrew') === 'exact');
check('a different letter is wrong, never "close"', classifyFirstLetterAttempt('מ', 'כִּי', 'hebrew') === 'wrong');
check('an English key is wrong', classifyFirstLetterAttempt('b', 'בְּרֵאשִׁית', 'hebrew') === 'wrong');

// What Hebrew keyboards actually send. Before typedLetters, every one of these
// extra characters was graded as a wrong guess (reported from a real iPhone:
// "typing with first letter basically doesn't work... it is requiring vowels").
const BET = String.fromCharCode(0x05d1);
const DAGESH = String.fromCharCode(0x05bc);
const PATAH = String.fromCharCode(0x05b7);
const RLM = String.fromCharCode(0x200f);
const BET_WITH_DAGESH = String.fromCharCode(0xfb31); // one precomposed character
check('typing: a bare consonant is one guess', typedLetters(BET, 'hebrew').join('') === BET);
check('typing: a consonant with a vowel point is one guess (the point is dropped)', typedLetters(BET + DAGESH + PATAH, 'hebrew').join('') === BET);
check('typing: a vowel point on its own is no guess at all', typedLetters(PATAH, 'hebrew').length === 0);
check('typing: an invisible direction mark is no guess at all', typedLetters(RLM + BET + RLM, 'hebrew').join('') === BET);
check('typing: a precomposed letter-with-dagesh counts as its letter', classifyFirstLetterAttempt(BET_WITH_DAGESH, 'בְּרֵאשִׁית', 'hebrew') === 'exact');
check('typing: two letters typed fast are two guesses', typedLetters('מל', 'hebrew').length === 2);
check('typing: Greek accents typed with a letter are dropped', typedLetters('ά', 'greek').length === 1 && typedLetters(String.fromCharCode(0x0301), 'greek').length === 0);
check('typing: English still treats every character as a guess', typedLetters('a ,', 'latin').length === 3);

console.log('\nGreek');
check('John 1:1 is 17 words', tokenizeWords(JOHN_1_1, 'greek').length === 17, tokenizeWords(JOHN_1_1, 'greek').length);
check('accents, breathing and case drop', normalizeToken('Ἐν', 'greek') === 'εν', normalizeToken('Ἐν', 'greek'));
check('iota subscript drops', normalizeToken('ἀρχῇ', 'greek') === 'αρχη', normalizeToken('ἀρχῇ', 'greek'));
check('final sigma is sigma', normalizeToken('λόγος,', 'greek') === 'λογοσ', normalizeToken('λόγος,', 'greek'));
check('first letter is bare lowercase', firstLetterOnly('Ἐν', 'greek') === 'ε', firstLetterOnly('Ἐν', 'greek'));
check('trailing punctuation stays', firstLetterOnly('θεόν,', 'greek') === 'θ,', firstLetterOnly('θεόν,', 'greek'));
check('mask keeps punctuation', maskLetters('λόγος,', 'greek') === '•••••,', maskLetters('λόγος,', 'greek'));
check('typing a capital counts', classifyFirstLetterAttempt('Ε', 'Ἐν', 'greek') === 'exact');
check('typing the plain letter counts', classifyFirstLetterAttempt('α', 'ἀρχῇ', 'greek') === 'exact');
check('final sigma key counts as sigma', classifyFirstLetterAttempt('ς', 'σάρξ', 'greek') === 'exact');

console.log('\nEnglish unchanged');
check('normalize', normalizeToken('Spirit,') === 'spirit');
check('first letter keeps quotes', firstLetterOnly('"Let') === '"L');
check('memory-grid line', firstLetterLine('In the beginning, God') === 'I t b, G', firstLetterLine('In the beginning, God'));
check('first-letter mask', maskExceptFirstLetter('beginning,') === 'b••••••••,', maskExceptFirstLetter('beginning,'));
check('near-key forgiveness still works', classifyFirstLetterAttempt('s', 'and') === 'close');
check('swap shape restores capitals', applyWordShape('"Light,', 'darkness') === '"Darkness,', applyWordShape('"Light,', 'darkness'));

console.log('\ndrills');
const phrases = chunkIntoPhrases(GEN_1_2, 'hebrew');
check('scramble phrases never leave a space after a maqaf', phrases.every((p) => !p.includes('־ ')), phrases);
check('scramble phrases rejoin to the verse', joinWords(phrases) === GEN_1_2);
const bites = splitIntoBites(GEN_1_2, 'short', 'hebrew');
check('build-up bites rejoin to the verse', joinWords(bites) === GEN_1_2, bites);
const hebrewVerses = [GEN_1_1, GEN_1_2, GEN_1_3].map((text, i) => ({
  book: 'Genesis',
  chapter: 1,
  verse: i + 1,
  text,
  translationId: 'HEBGRK',
}));
// Random, so run it a few times: every decoy must carry vowel points like its
// neighbours, or it gives itself away at a glance.
let decoys: string[] = [];
for (let run = 0; run < 20; run++) {
  decoys = decoys.concat(
    buildSwapVerses(hebrewVerses, 2)
      .flatMap((v) => v.tokens)
      .filter((t) => t.isDecoy)
      .map((t) => t.display)
  );
}
check('spot-the-swap finds Hebrew words to swap', decoys.length > 0);
check('every Hebrew decoy is pointed', decoys.every(hasHebrewVowel), decoys.filter((d) => !hasHebrewVowel(d)));

console.log(failures === 0 ? '\nall text-script checks passed\n' : `\n${failures} FAILED\n`);
if (failures > 0) process.exit(1);
