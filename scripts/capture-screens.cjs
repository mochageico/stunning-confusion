#!/usr/bin/env node
/**
 * shots — screenshot app screens from the web preview, with demo data.
 *
 * Needs the web preview running (launch.json "expo-web", port 8099) and uses
 * the demo mode in src/dev/DemoHarness.tsx, so no sign-in is involved. Drives
 * the installed Chrome over the DevTools Protocol with Node's built-in
 * WebSocket (Node 22+) -- nothing to npm install.
 *
 *   npm run shots -- --all                      every screen, iPhone font rendering
 *   npm run shots -- "s=home&ios=1" "s=settings&ios=1&max=1500"
 *   npm run shots -- --out=.shots/before --all  choose the folder (default .shots)
 *   npm run shots -- --overflow --all "w=375&scale=1.5"
 *       also list text that runs off the screen or is cut short with "...".
 *       Any query after --all is appended to every screen's query.
 *
 * Per-query options (the app ignores them): fixed=1 phone height only,
 * max=N cap the height, clipH=N keep only the top N points, noseg=1 skip the
 * 1300pt slices written for tall screens, w=N phone width in points (375 for
 * an iPhone SE; default 390). The app itself reads scale=1.5 (text size) and
 * accent=<id>, so those go in the query too.
 *
 * Full-length capture works by growing the emulated viewport until nothing
 * scrolls, so a long screen comes out whole instead of cut at the fold.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);
const CDP_PORT = 9333;
const DEFAULT_W = 390;
const H = 844;

// Every screen the demo mode knows, with the capture options that suit it.
const ALL = [
  'home&noseg=1', 'home&empty=1&noseg=1', 'modalLearn&fixed=1', 'modalListen&fixed=1',
  'books&max=1500&noseg=1', 'chapters&fixed=1', 'chapterLanding&max=1900&noseg=1',
  'memoryDesk&fixed=1', 'activePlan&noseg=1', 'memoryCalendar&noseg=1', 'fullHistory&max=1300&noseg=1',
  'referenceDrill&noseg=1', 'savedPlans&fixed=1', 'planDesigner&noseg=1', 'modalMissed&fixed=1',
  'record&max=1500&noseg=1', 'recordingDetail&noseg=1', 'modalSave&fixed=1', 'audioFeed&max=1500&noseg=1',
  'community&noseg=1', 'find&fixed=1', 'create&fixed=1', 'preview&fixed=1', 'groupDetail&noseg=1',
  'groupPlanDetail&noseg=1', 'profile&fixed=1', 'memberProfile&fixed=1', 'findFriends&fixed=1',
  'messages&fixed=1', 'dmThread&fixed=1', 'circleChat&fixed=1', 'dashboard&noseg=1', 'settings&noseg=1',
  'onboarding&noseg=1', 'tour&max=1500&noseg=1', 'auth&fixed=1', 'modalProgress&fixed=1',
].map((q) => `s=${q}&ios=1`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const opts = { out: path.join(ROOT, '.shots'), port: 8099, queries: [], overflow: false };
  const shared = [];
  for (const a of argv) {
    if (a === '--all') opts.queries.push(...ALL);
    else if (a === '--overflow') opts.overflow = true;
    else if (a.startsWith('--out=')) opts.out = path.resolve(ROOT, a.slice(6));
    else if (a.startsWith('--port=')) opts.port = Number(a.slice(7));
    else if (!new URLSearchParams(a.replace(/^\?/, '')).has('s')) shared.push(a.replace(/^\?/, ''));
    else opts.queries.push(a.replace(/^\?/, ''));
  }
  // A query with no screen (e.g. "w=375&scale=1.5") applies to every screen.
  if (shared.length) opts.queries = opts.queries.map((q) => [q, ...shared].join('&'));
  return opts;
}

// "s=home&empty=1&ios=1" -> "home_empty". Capture options stay out of the name.
function fileNameFor(q) {
  const p = new URLSearchParams(q);
  // A flag (=1) adds its name; anything else adds name+value, e.g. accent=plum -> "accentplum".
  const extras = [...p.keys()]
    .filter((k) => !['s', 'ios', 'fixed', 'max', 'clipH', 'noseg'].includes(k))
    .map((k) => (p.get(k) === '1' ? k : k + p.get(k)));
  return [p.get('s') || 'screen', ...extras].join('_') + (p.get('ios') === '1' ? '' : '_web') + '.jpg';
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.queries.length) {
    console.log('Nothing to capture. Try: npm run shots -- --all');
    return;
  }
  const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!chromePath) throw new Error('No Chrome or Edge found; set CHROME_PATH.');
  try {
    await fetch(`http://localhost:${opts.port}/`);
  } catch {
    throw new Error(`The web preview isn't running on port ${opts.port}. Start "expo-web" first.`);
  }
  fs.mkdirSync(opts.out, { recursive: true });

  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${path.join(os.tmpdir(), 'scripture-memory-shots')}`,
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  try {
    let page;
    for (let i = 0; i < 50 && !page; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        page = targets.find((t) => t.type === 'page');
      } catch {}
      if (!page) await sleep(200);
    }
    if (!page) throw new Error('Chrome did not start.');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    });
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const myId = ++id;
        pending.set(myId, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
        ws.send(JSON.stringify({ id: myId, method, params }));
      });
    const evaluate = async (expression) =>
      (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
    await send('Page.enable');

    // How much taller the viewport must be for the screen's scroller to stop scrolling.
    const MEASURE = `(() => {
      let extra = 0;
      for (const el of document.querySelectorAll('div')) {
        if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
        extra = Math.max(extra, el.scrollHeight - el.clientHeight);
      }
      return extra;
    })()`;

    // Text past the right/left edge (outside sideways scrollers), and text
    // cut short with an ellipsis. RN Web renders every Text as a div.
    const OVERFLOW = `(() => {
      const W = innerWidth, out = [];
      const inScroller = (el) => {
        for (let a = el.parentElement; a; a = a.parentElement)
          if (/(auto|scroll)/.test(getComputedStyle(a).overflowX)) return true;
        return false;
      };
      for (const el of document.querySelectorAll('div')) {
        if (el.childElementCount || !el.textContent.trim()) continue;
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const text = JSON.stringify(el.textContent.trim().slice(0, 40));
        if ((r.right > W + 1 || r.left < -1) && !inScroller(el)) out.push('off screen: ' + text);
        else if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow === 'ellipsis')
          out.push('cut short: ' + text);
      }
      return out;
    })()`;

    for (const q of opts.queries) {
      const p = new URLSearchParams(q);
      const cap = Number(p.get('max')) || 9000;
      const clipH = Number(p.get('clipH')) || 0;
      const W = Number(p.get('w')) || DEFAULT_W;
      const file = path.join(opts.out, fileNameFor(q));
      let height = H;
      await send('Emulation.setDeviceMetricsOverride', { width: W, height, deviceScaleFactor: 2, mobile: true });
      await send('Page.navigate', { url: `http://localhost:${opts.port}/?${q}` });
      // First load compiles the bundle; later ones are quick. Modals and the
      // chapter page wait on scripture text or entrance animations.
      await sleep(/chapterLanding|modal/.test(q) ? 6000 : 3500);
      if (p.get('fixed') !== '1') {
        for (let pass = 0; pass < 6; pass++) {
          const extra = await evaluate(MEASURE);
          if (!extra || extra < 2 || height >= cap) break;
          height = Math.min(cap, height + extra);
          await send('Emulation.setDeviceMetricsOverride', { width: W, height, deviceScaleFactor: 2, mobile: true });
          await sleep(700);
        }
      }
      const shot = await send(
        'Page.captureScreenshot',
        clipH
          ? { format: 'jpeg', quality: 82, clip: { x: 0, y: 0, width: W, height: clipH, scale: 1 } }
          : { format: 'jpeg', quality: 82 }
      );
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log(`${path.relative(ROOT, file)}  ${W}x${clipH || height}`);
      if (opts.overflow) for (const line of await evaluate(OVERFLOW)) console.log(`    ${line}`);

      // Readable slices of tall screens, for close review.
      const SEG = 1300;
      if (p.get('noseg') !== '1' && !clipH && height > SEG + 200) {
        for (let y = 0, n = 1; y < height; y += SEG, n++) {
          const part = await send('Page.captureScreenshot', {
            format: 'jpeg',
            quality: 82,
            clip: { x: 0, y, width: W, height: Math.min(SEG, height - y), scale: 1 },
            captureBeyondViewport: true,
          });
          fs.writeFileSync(file.replace(/\.jpg$/, `_p${n}.jpg`), Buffer.from(part.data, 'base64'));
        }
      }
    }
    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
