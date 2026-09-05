// Lists every Bible your api.bible key can actually access.
//
// This is the definitive answer to "which translations do I have?" -- better
// than any documentation or plan card, because it reflects your key's real
// entitlements. Use it to get the `id` values that go into BIBLE_TRANSLATIONS
// in src/data.ts as `apiBibleId`.
//
// Reads only. Costs one API call against your monthly allowance.
//
// Usage (PowerShell):
//   $env:API_BIBLE_KEY = "your-key-here"; node scripts/list-api-bibles.cjs
//
// Usage (bash):
//   API_BIBLE_KEY=your-key-here node scripts/list-api-bibles.cjs
//
// Add --english to hide the couple of thousand non-English Bibles ABS also
// exposes, which otherwise bury the three you care about.

const key = process.env.API_BIBLE_KEY;
if (!key) {
  console.error(
    'API_BIBLE_KEY is not set.\n' +
      '  PowerShell:  $env:API_BIBLE_KEY = "your-key"; node scripts/list-api-bibles.cjs\n' +
      '  bash:        API_BIBLE_KEY=your-key node scripts/list-api-bibles.cjs'
  );
  process.exit(1);
}

const englishOnly = process.argv.includes('--english');

(async () => {
  const res = await fetch('https://api.scripture.api.bible/v1/bibles', {
    headers: { 'api-key': key },
  });

  if (res.status === 401) {
    console.error('401 Unauthorized -- the key was rejected. Check for stray quotes or whitespace.');
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`Request failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const body = await res.json();
  let bibles = body.data || [];
  if (englishOnly) {
    bibles = bibles.filter((b) => (b.language && b.language.id) === 'eng');
  }

  bibles.sort((a, b) => (a.abbreviation || '').localeCompare(b.abbreviation || ''));

  console.log(`\n${bibles.length} Bible(s) available to this key${englishOnly ? ' (English only)' : ''}:\n`);
  for (const b of bibles) {
    // The id is the UUID that goes into `apiBibleId`. Everything else is here
    // to help you recognise which row is which.
    console.log(`  ${(b.abbreviation || '?').padEnd(10)} ${b.id}`);
    console.log(`  ${''.padEnd(10)} ${b.name}${b.language && b.language.name ? `  [${b.language.name}]` : ''}`);
    console.log('');
  }

  console.log('Copy the UUID into `apiBibleId` on the matching BIBLE_TRANSLATIONS entry in src/data.ts.\n');
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
