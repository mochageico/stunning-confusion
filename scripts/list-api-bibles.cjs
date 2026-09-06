// Lists every Bible your api.bible key can actually access.
//
// This is the definitive answer to "which translations do I have?" -- better
// than any documentation or plan card, because it reflects your key's real
// entitlements. Use it to get the `id` values that go into BIBLE_TRANSLATIONS
// in src/data.ts as `apiBibleId`.
//
// Reads only. Costs one API call against your monthly allowance.
//
// Usage -- identical in Command Prompt, PowerShell and bash:
//   node scripts/list-api-bibles.cjs --key=YOUR_KEY --english
//
// The key can also come from an API_BIBLE_KEY environment variable, but --key
// is the reason this flag exists: setting an env var needs different syntax in
// every shell (`set` in cmd, `$env:` in PowerShell, `VAR=x cmd` in bash), and
// getting it wrong fails in confusing ways -- cmd in particular folds a
// trailing space into the value and silently corrupts the key.
//
// Add --english to hide the couple of thousand non-English Bibles ABS also
// exposes, which otherwise bury the ones you care about.

const keyArg = process.argv.find((a) => a.startsWith('--key='));
// Trimmed because a key pasted from a dashboard very often brings whitespace
// or a stray quote with it, and the resulting 401 looks like a bad key.
const key = (keyArg ? keyArg.slice('--key='.length) : process.env.API_BIBLE_KEY || '')
  .trim()
  .replace(/^["']|["']$/g, '');

if (!key) {
  console.error(
    'No API key given.\n\n' +
      '  node scripts/list-api-bibles.cjs --key=YOUR_KEY --english\n\n' +
      'Find your key at https://api.bible under your application.'
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
