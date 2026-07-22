import { Platform } from 'react-native';

import { firstLetterOnly } from './recitation';
import { ESV_COPYRIGHT_NOTICE } from '../data';

// ============================================================================
// PRINTABLE MEMORY GRID
// ----------------------------------------------------------------------------
// Matches Scripture Memory Fellowship's "Printable PDF" feature: a static,
// full-passage HTML rendering of the grid (every verse, no scroll/pagination)
// that the OS turns into a real PDF -- window.print() on web (a "Save as
// PDF" destination is a standard browser print option, no extra dependency),
// expo-print's native print sheet on iOS/Android (same "Save as PDF" via the
// OS print dialog). Deliberately plain inline-styled HTML, independent of
// the app's NativeWind styling -- this never renders inside the RN tree.
// ============================================================================

export interface PrintableVerse {
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

function buildGridHtml(verses: PrintableVerse[], reference: string): string {
  const boxes = verses
    .map((v) => {
      const words = v.text
        .split(/\s+/)
        .filter((w) => w.length > 0)
        .map(firstLetterOnly)
        .join(' ');
      return `<div class="box"><div class="vnum">${v.verse}</div><div class="letters">${words}</div></div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${reference} — Memory Grid</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; margin: 24px; color: #1A1A1A; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .subtitle { font-size: 11px; color: #888; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.08em; }
  .grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .box { width: 23%; min-width: 140px; border: 1px solid #d4d4d4; border-radius: 8px; padding: 8px; box-sizing: border-box; break-inside: avoid; }
  .vnum { font-family: monospace; font-size: 9px; font-weight: bold; background: #f3f2f1; display: inline-block; padding: 1px 4px; border-radius: 3px; margin-bottom: 4px; }
  .letters { font-family: monospace; font-size: 11px; line-height: 1.5; letter-spacing: 0.3px; }
  .copyright { font-size: 8px; color: #999; margin-top: 20px; text-align: center; line-height: 1.4; }
  @media print {
    .box { break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>${reference}</h1>
  <div class="subtitle">Memory Grid</div>
  <div class="grid">${boxes}</div>
  <div class="copyright">${ESV_COPYRIGHT_NOTICE}</div>
</body>
</html>`;
}

export async function printMemoryGrid(verses: PrintableVerse[], reference: string): Promise<void> {
  const html = buildGridHtml(verses, reference);

  if (Platform.OS === 'web') {
    const win = window.open('', '_blank');
    if (!win) return; // popup blocked -- nothing more we can do without a user gesture retry
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    return;
  }

  // Native: lazy require, same guarded pattern as other native-only modules
  // in this codebase (useGoogleSignIn.ts, NativeSpeechRecognizer) -- avoids
  // crashing Expo Go if expo-print's native module isn't compiled in there.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Print = require('expo-print');
    await Print.printAsync({ html });
  } catch (err) {
    console.error('Print failed:', err);
  }
}
