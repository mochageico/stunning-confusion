// Downloads the DeepFilterNet CLI (the studio-mode denoiser) into bin/.
//
// Runs as `postinstall`, so it happens wherever `npm install` does — including
// the Cloud Build step of a deploy, which is how the Linux binary reaches the
// function without a 36MB file living in git. Same approach ffmpeg-static uses.
//
// The hash pins each binary: a release asset that changes under us fails the
// install loudly instead of shipping something nobody listened to.
//
// Never fails the install. A missing binary makes renders skip denoising (and
// log an error) rather than breaking `npm install` for unrelated work.
const { createHash } = require('crypto');
const { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const VERSION = '0.5.6';
const ASSETS = {
  'linux-x64': {
    name: `deep-filter-${VERSION}-x86_64-unknown-linux-musl`,
    sha256: '70775e251eee44c0f2451a1e833326cf8bcbbe304d3e7cd12851e6fce72ef7da',
  },
  'win32-x64': {
    name: `deep-filter-${VERSION}-x86_64-pc-windows-msvc.exe`,
    sha256: '75e11fa16445f560cb6b021521ddb89e89270d13b83089705d98776f58fd7915',
  },
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function main() {
  const asset = ASSETS[`${process.platform}-${process.arch}`];
  if (!asset) {
    console.warn(`[deep-filter] no binary for ${process.platform}-${process.arch}; studio renders will skip denoising`);
    return;
  }
  const binDir = join(__dirname, '..', 'bin');
  const dest = join(binDir, process.platform === 'win32' ? 'deep-filter.exe' : 'deep-filter');
  if (existsSync(dest) && sha256(readFileSync(dest)) === asset.sha256) return;

  const url = `https://github.com/Rikorose/DeepFilterNet/releases/download/v${VERSION}/${asset.name}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== asset.sha256) throw new Error(`hash mismatch for ${asset.name}: got ${got}`);

  mkdirSync(binDir, { recursive: true });
  writeFileSync(dest, buf);
  chmodSync(dest, 0o755);
  console.log(`[deep-filter] installed ${asset.name}`);
}

main().catch((err) => {
  console.error(`[deep-filter] ${err.message}; studio renders will skip denoising`);
});
