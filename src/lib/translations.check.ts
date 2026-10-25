// Regression assertions for the translation registry, run by
// `npm run check:translations`.
//
// These guard the licensing decisions encoded in data.ts, which are the kind
// of thing that breaks silently: nothing crashes if the default translation
// quietly reverts to one the app has no licence for, or if a public-domain
// export starts carrying Crossway's copyright notice. The app just ships
// wrong.

import {
  BIBLE_TRANSLATIONS,
  DEFAULT_TRANSLATION_ID,
  PICKER_TRANSLATIONS,
  capabilityWarningsFor,
  copyrightFor,
  copyrightUrlFor,
  getTranslation,
  textScriptFor,
  translationLabel,
  UNRELEASED_TRANSLATION_TESTERS,
} from '../data';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

console.log('\ntranslation registry');

// ── The shipping default must be safe to ship ───────────────────────────────
const def = getTranslation(DEFAULT_TRANSLATION_ID);
check('default translation exists in the registry', !!def, DEFAULT_TRANSLATION_ID);
check(
  'default translation is public domain (no licence needed to ship it)',
  !!def?.isPublicDomain,
  { id: DEFAULT_TRANSLATION_ID, isPublicDomain: def?.isPublicDomain }
);
check('default translation requires no attribution', copyrightFor(DEFAULT_TRANSLATION_ID) === null);
check(
  'default translation raises no capability warnings',
  capabilityWarningsFor(DEFAULT_TRANSLATION_ID).length === 0,
  capabilityWarningsFor(DEFAULT_TRANSLATION_ID)
);

// ChapterLandingScreen falls back to BIBLE_TRANSLATIONS[0] when a selected id
// doesn't resolve, so a reordering that pushed a licensed translation to the
// front would make it the silent fallback.
check('registry is ordered with the default first', BIBLE_TRANSLATIONS[0]?.id === DEFAULT_TRANSLATION_ID, {
  first: BIBLE_TRANSLATIONS[0]?.id,
  default: DEFAULT_TRANSLATION_ID,
});

// ── Attribution follows the translation, not a hardcoded constant ───────────
check('public-domain translations carry no copyright notice',
  BIBLE_TRANSLATIONS.filter((t) => t.isPublicDomain).every((t) => !t.copyright),
  BIBLE_TRANSLATIONS.filter((t) => t.isPublicDomain && !!t.copyright).map((t) => t.id)
);
check('non-public-domain translations all carry a copyright notice',
  BIBLE_TRANSLATIONS.filter((t) => !t.isPublicDomain).every((t) => !!t.copyright),
  BIBLE_TRANSLATIONS.filter((t) => !t.isPublicDomain && !t.copyright).map((t) => t.id)
);
check('an unknown translation id yields no notice rather than throwing', copyrightFor('NOPE') === null);

// ── Attribution links ───────────────────────────────────────────────────────
// The NASB's licence requires a clickable link to lockman.org beside the
// notice. Losing it is a licence breach that nothing else would surface.
check('the NASB carries its required lockman.org link', copyrightUrlFor('NASB') === 'https://www.lockman.org', {
  actual: copyrightUrlFor('NASB'),
});
check(
  'no translation declares a link without a notice to attach it to',
  BIBLE_TRANSLATIONS.every((t) => !t.copyrightUrl || !!t.copyright),
  BIBLE_TRANSLATIONS.filter((t) => t.copyrightUrl && !t.copyright).map((t) => t.id)
);
check(
  'every attribution link is a real https URL',
  BIBLE_TRANSLATIONS.every((t) => !t.copyrightUrl || /^https:\/\/\S+$/.test(t.copyrightUrl)),
  BIBLE_TRANSLATIONS.filter((t) => t.copyrightUrl && !/^https:\/\/\S+$/.test(t.copyrightUrl)).map((t) => t.id)
);

// ── NIV stays out until Biblica says otherwise ──────────────────────────────
// Biblica's licence forbids altering the text or producing derivative works,
// which is what every drill in this app does. Re-adding it must be a deliberate
// decision, so this fails loudly if it reappears.
check(
  'NIV is absent pending written permission from Biblica',
  getTranslation('NIV') === undefined,
  'NIV was re-added -- confirm Biblica has permitted first-letter, blanked-word and scramble drills before removing this check.'
);

// ── Source wiring ───────────────────────────────────────────────────────────
// A translation fetched from api.bible without its Bible id is a runtime
// throw in lib/apiBible.ts, not a type error -- worth catching here.
check(
  "every source:'apiBible' translation has an apiBibleId",
  BIBLE_TRANSLATIONS.filter((t) => t.source === 'apiBible').every((t) => !!t.apiBibleId),
  BIBLE_TRANSLATIONS.filter((t) => t.source === 'apiBible' && !t.apiBibleId).map((t) => t.id)
);

// ── The capability block is descriptive, and must stay honest ───────────────
// Public domain means genuinely unrestricted; if one of these ever flips, the
// warning text it produces is what someone will act on.
check(
  'public-domain translations are unrestricted in every capability',
  BIBLE_TRANSLATIONS.filter((t) => t.isPublicDomain).every(
    (t) => t.capabilities.persistText && t.capabilities.print && t.capabilities.publishAudio && t.capabilities.cacheTtlMs === null
  ),
  BIBLE_TRANSLATIONS.filter((t) => t.isPublicDomain).map((t) => ({ id: t.id, ...t.capabilities }))
);

// ── Hebrew/Greek: one id, two texts ─────────────────────────────────────────
// The id is a Firestore path segment and the first field of underscore-joined
// queue item ids, so a '/' or '_' in it would corrupt both.
check(
  'no translation id contains "/" or "_"',
  BIBLE_TRANSLATIONS.every((t) => !/[/_]/.test(t.id)),
  BIBLE_TRANSLATIONS.filter((t) => /[/_]/.test(t.id)).map((t) => t.id)
);
check('Hebrew/Greek is listed', !!getTranslation('HEBGRK'));
check("Hebrew/Greek shows as 'Hebrew/Greek', not its id", translationLabel('HEBGRK') === 'Hebrew/Greek', {
  actual: translationLabel('HEBGRK'),
});
check('a translation without a shortLabel shows its id', translationLabel('BSB') === 'BSB');
check('an unknown id shows as itself (old recordings)', translationLabel('NOPE') === 'NOPE');
check('Hebrew/Greek: Old Testament is Hebrew', textScriptFor('HEBGRK', 'Genesis') === 'hebrew');
check('Hebrew/Greek: New Testament is Greek', textScriptFor('HEBGRK', 'John') === 'greek');
check('English translations are latin', textScriptFor('BSB', 'Genesis') === 'latin' && textScriptFor('KJV', 'John') === 'latin');
// SBLGNT is CC BY 4.0: its credit must appear on Greek chapters, and the
// public-domain WLC must not be stamped with it.
check('Hebrew/Greek credits SBLGNT on New Testament books', /SBL Greek New Testament/.test(copyrightFor('HEBGRK', 'Romans') ?? ''), {
  actual: copyrightFor('HEBGRK', 'Romans'),
});
check('Hebrew/Greek carries no credit on Old Testament books', copyrightFor('HEBGRK', 'Psalms') === null, {
  actual: copyrightFor('HEBGRK', 'Psalms'),
});
check('book-specific lookup leaves other translations unchanged', copyrightFor('NASB', 'John') === copyrightFor('NASB'));
// Pickers hide in-development translations only outside dev builds; this
// check runs as plain Node, which counts as development.
check(
  'every translation is pickable in a development build',
  PICKER_TRANSLATIONS.length === BIBLE_TRANSLATIONS.length,
  { picker: PICKER_TRANSLATIONS.length, all: BIBLE_TRANSLATIONS.length }
);

// Outside a dev build, an unreleased translation is offered to the testers
// list and nobody else. This check runs as plain Node (a dev build), so it
// tests the hidden flag and the testers list directly.
check('ESV is unreleased (hidden outside testers)', getTranslation('ESV')?.inDevelopment === true);
check('testers list is not empty while a translation is unreleased', UNRELEASED_TRANSLATION_TESTERS.length > 0);

// ESV is the worked example of a licensed translation: it must be listed (old
// queue items reference it) but must announce real work before being enabled.
const esvWarnings = capabilityWarningsFor('ESV');
check('a licensed translation reports the work required to enable it', esvWarnings.length > 0, esvWarnings);

console.log(failures === 0 ? '\nall translation checks passed\n' : `\n${failures} FAILED\n`);
if (failures > 0) process.exit(1);
