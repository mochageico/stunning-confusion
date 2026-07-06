// Inspects the raw JSON response's metadata fields (query, canonical, passage_meta,
// and passages array LENGTH) for a failing lookup — none of these are scripture text,
// just API bookkeeping, so safe to print directly.
const ESV_API_BASE = 'https://api.esv.org/v3/passage/text/';

(async () => {
  const book = process.argv[2];
  const chapter = process.argv[3];
  const apiKey = process.env.ESV_API_KEY;

  const params = new URLSearchParams({
    q: `${book} ${chapter}:1-200`,
    'include-verse-numbers': 'true',
  });

  const res = await fetch(`${ESV_API_BASE}?${params.toString()}`, {
    headers: { Authorization: `Token ${apiKey}` },
  });

  const data = await res.json();
  console.log('HTTP status:', res.status);
  console.log('query:', data.query);
  console.log('canonical:', data.canonical);
  console.log('parsed:', JSON.stringify(data.parsed));
  console.log('passage_meta:', JSON.stringify(data.passage_meta));
  console.log('passages array length:', data.passages ? data.passages.length : 'N/A');
  console.log('first passage text length:', data.passages && data.passages[0] ? data.passages[0].length : 0);
})();
