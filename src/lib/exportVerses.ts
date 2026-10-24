import { Platform, Share } from 'react-native';

import type { QueueItem } from '../types';
import { copyrightFor, translationLabel } from '../data';
import { STAGE_LABEL, canonicalCompare, verseStage } from './stageProgress';

// ============================================================================
// EXPORT MY VERSES (Settings > Account)
// ----------------------------------------------------------------------------
// Everything on My Verses, in Bible order, with its translation and stage:
// as plain text through the phone's share sheet, or as a printable page the
// print sheet can save as a PDF. Each licensed translation's notice goes at
// the end, as on any page that shows its text.
// ============================================================================

const sorted = (queue: QueueItem[]) => [...queue].sort(canonicalCompare);

const referenceOf = (q: QueueItem) => `${q.book} ${q.chapter}:${q.verseNumber}`;

/** Each translation's notice, once, for the translations (and books) on the list. */
function notices(queue: QueueItem[]): string[] {
  const seen = new Set<string>();
  queue.forEach((q) => {
    const n = copyrightFor(q.translationId || 'ESV', q.book);
    if (n) seen.add(n);
  });
  return [...seen];
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function versesAsText(queue: QueueItem[]): string {
  const lines = sorted(queue).map(
    (q) => `${referenceOf(q)} (${translationLabel(q.translationId || 'ESV')}) · ${STAGE_LABEL[verseStage(q)]}\n${q.text}`
  );
  return [`My Verses (${queue.length})`, '', lines.join('\n\n'), '', ...notices(queue)].join('\n').trim();
}

function versesAsHtml(queue: QueueItem[]): string {
  let lastBook = '';
  const rows = sorted(queue)
    .map((q) => {
      const heading = q.book !== lastBook ? `<h2>${escapeHtml(q.book)}</h2>` : '';
      lastBook = q.book;
      return `${heading}<div class="v"><div class="ref">${escapeHtml(referenceOf(q))} <span>${escapeHtml(
        translationLabel(q.translationId || 'ESV')
      )} · ${STAGE_LABEL[verseStage(q)]}</span></div><div class="t">${escapeHtml(q.text)}</div></div>`;
    })
    .join('');
  const foot = notices(queue)
    .map((n) => `<p class="n">${escapeHtml(n)}</p>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>My Verses</title><style>
body{font-family:Georgia,serif;margin:32px;color:#1E1C19}
h1{font-family:-apple-system,Helvetica,sans-serif;font-size:22px;margin:0 0 4px}
h2{font-family:-apple-system,Helvetica,sans-serif;font-size:15px;margin:22px 0 6px;border-bottom:1px solid #ddd;padding-bottom:4px}
.v{margin:0 0 10px;break-inside:avoid}.ref{font-family:-apple-system,Helvetica,sans-serif;font-size:12px;font-weight:600}
.ref span{font-weight:400;color:#6E675E}.t{font-size:13px;line-height:1.5}.n{font-size:10px;color:#6E675E;margin-top:24px}
</style></head><body><h1>My Verses</h1><div style="font-size:12px;color:#6E675E">${queue.length} verses</div>${rows}${foot}</body></html>`;
}

/** The phone's share sheet with the list as text (Notes, Messages, email...). */
export async function shareVersesAsText(queue: QueueItem[]): Promise<void> {
  const message = versesAsText(queue);
  if (Platform.OS === 'web') {
    // Web has no share sheet everywhere: copy instead, where allowed.
    await navigator.clipboard?.writeText(message).catch(() => undefined);
    return;
  }
  await Share.share({ message, title: 'My Verses' }).catch(() => undefined);
}

/** The print sheet, which saves as a PDF too. */
export async function printVerses(queue: QueueItem[]): Promise<void> {
  const html = versesAsHtml(queue);
  if (Platform.OS === 'web') {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    return;
  }
  // Lazy, as in printMemoryGrid: a build without expo-print's module just can't print.
  try {
    const Print = require('expo-print');
    await Print.printAsync({ html });
  } catch (err) {
    console.error('Print failed:', err);
  }
}
