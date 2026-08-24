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
  capabilityWarningsFor,
  copyrightFor,
  getTranslation,
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

// ESV is the worked example of a licensed translation: it must be listed (old
// queue items reference it) but must announce real work before being enabled.
const esvWarnings = capabilityWarningsFor('ESV');
check('a licensed translation reports the work required to enable it', esvWarnings.length > 0, esvWarnings);

console.log(failures === 0 ? '\nall translation checks passed\n' : `\n${failures} FAILED\n`);
if (failures > 0) process.exit(1);
