"""
Stage 4, part 1: re-encodes every chapter for the app into work/encoded/ --
mono, 24 kHz, 48 kbps MP3 (the stage 0 choice) -- with each chapter's volume
evened out, then checks that the timings still fit.

  bakeoff/.venv/Scripts/python.exe -I scripts/bsb-audio/encode.py [GEN_1 ...]

Volume: each chapter's speech level is measured the BS.1770 way (400 ms blocks,
silence and blocks 10 dB under the mean left out) and moved to the median
chapter's level, so most chapters change by well under 1 dB. A gain is cut back
if it would push a peak past -1 dBFS. Levels are cached in work/loudness.json.

Check: each new file is decoded again and must last as long as its source
within 50 ms, and its start must line up with the source's to within 5 ms
(an encoder delay would shift every verse). work/encoded/manifest.json lists
the results; upload.js uploads from it. Files already encoded are skipped, so
it's safe to re-run (delete a file to redo it).
"""

import concurrent.futures as cf
import hashlib
import json
import os
import pathlib
import sys

import av
import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
SOURCES = HERE / "sources"
WORK = HERE / "work"
OUT = WORK / "encoded"
LEVELS = WORK / "loudness.json"
RATE = 24000
KBPS = 48
PEAK_CEILING_DB = -1.0
MAX_DURATION_DIFF = 0.05
MAX_OFFSET = 0.005


def decode(path):
    """Whole file as mono float32 at RATE."""
    with av.open(str(path)) as c:
        rs = av.AudioResampler(format="flt", layout="mono", rate=RATE)
        parts = [f.to_ndarray().reshape(-1) for frame in c.decode(audio=0) for f in rs.resample(frame)]
        parts += [f.to_ndarray().reshape(-1) for f in rs.resample(None)]
    return np.concatenate(parts).astype(np.float32)


def speech_level_db(x):
    """Gated mean level in dB (BS.1770 gating, without the K-weighting: same voice and mic throughout)."""
    block, hop = int(0.4 * RATE), int(0.1 * RATE)
    n = 1 + max(0, (len(x) - block) // hop)
    sq = np.concatenate([[0.0], np.cumsum(x.astype(np.float64) ** 2)])
    starts = np.arange(n) * hop
    ms = (sq[np.minimum(starts + block, len(x))] - sq[starts]) / block
    ms = ms[ms > 10 ** (-70 / 10)]
    rel = ms[ms > ms.mean() * 10 ** (-10 / 10)]
    return float(10 * np.log10(rel.mean()))


def measure(name):
    x = decode(SOURCES / name)
    return name, speech_level_db(x), float(20 * np.log10(np.abs(x).max()))


def encode(x, dest):
    with av.open(str(dest), "w", format="mp3") as out:
        stream = out.add_stream("libmp3lame", rate=RATE)
        stream.layout = "mono"
        stream.bit_rate = KBPS * 1000
        chunk = 1152 * 64
        for i in range(0, len(x), chunk):
            frame = av.AudioFrame.from_ndarray(x[None, i : i + chunk], format="fltp", layout="mono")
            frame.sample_rate = RATE
            frame.pts = i
            out.mux(stream.encode(frame))
        out.mux(stream.encode(None))


def offset_sec(a, b, search=0.1):
    """How far b's speech sits after a's, from the first 20 s (cross-correlation, +-search s)."""
    n, lag = min(len(a), len(b), 20 * RATE), int(search * RATE)
    a, b = a[lag : n - lag], b[:n]
    best = max(range(-lag, lag + 1, 1), key=lambda k: float(np.dot(a, b[lag + k : lag + k + len(a)])))
    return best / RATE


def build(f, gain_db):
    src = SOURCES / f["name"]
    dest = OUT / f["name"]
    x = decode(src)
    y = np.clip(x * np.float32(10 ** (gain_db / 20)), -1.0, 1.0)
    part = dest.with_suffix(".part")
    encode(y, part)
    z = decode(part)
    dur_diff = (len(z) - len(x)) / RATE
    off = offset_sec(y, z)
    ok = abs(dur_diff) <= MAX_DURATION_DIFF and abs(off) <= MAX_OFFSET
    if ok:
        os.replace(part, dest)
    data = dest.read_bytes() if ok else b""
    return {
        "name": f["name"],
        "bookId": f["bookId"],
        "chapter": f["chapter"],
        "ok": ok,
        "gainDb": round(gain_db, 2),
        "seconds": round(len(z) / RATE, 3),
        "durationDiff": round(dur_diff, 3),
        "offset": round(off, 4),
        "bytes": len(data),
        "md5": hashlib.md5(data).hexdigest() if ok else None,
    }


def main():
    manifest = json.loads((SOURCES / "manifest.json").read_text(encoding="utf-8"))
    keys = set(sys.argv[1:])
    todo = [f for f in manifest if not keys or f"{f['bookId']}_{f['chapter']}" in keys]
    OUT.mkdir(parents=True, exist_ok=True)
    workers = max(1, (os.cpu_count() or 4) // 2)

    # Pass 1: every chapter's level (the median needs all of them).
    levels = json.loads(LEVELS.read_text(encoding="utf-8")) if LEVELS.exists() else {}
    missing = [f["name"] for f in manifest if f["name"] not in levels]
    if missing:
        print(f"Measuring {len(missing)} chapters' volume...", flush=True)
        with cf.ProcessPoolExecutor(workers) as pool:
            for k, (name, level, peak) in enumerate(pool.map(measure, missing, chunksize=4), 1):
                levels[name] = {"level": round(level, 2), "peak": round(peak, 2)}
                if k % 200 == 0:
                    print(f"  {k}/{len(missing)}", flush=True)
        LEVELS.write_text(json.dumps(levels, indent=0), encoding="utf-8")
    all_levels = np.array([v["level"] for v in levels.values()])
    target = float(np.median(all_levels))
    print(f"Speech level: median {target:.1f} dB, middle 90% {np.percentile(all_levels, 5):.1f} to {np.percentile(all_levels, 95):.1f} dB", flush=True)

    # Pass 2: encode.
    results_path = OUT / "manifest.json"
    results = {r["name"]: r for r in json.loads(results_path.read_text(encoding="utf-8"))} if results_path.exists() else {}
    jobs = []
    for f in todo:
        if f["name"] in results and results[f["name"]]["ok"] and (OUT / f["name"]).exists():
            continue
        lv = levels[f["name"]]
        gain = min(target - lv["level"], PEAK_CEILING_DB - lv["peak"])
        jobs.append((f, gain))
    print(f"Encoding {len(jobs)} chapters ({len(todo) - len(jobs)} already done) on {workers} processes...", flush=True)
    with cf.ProcessPoolExecutor(workers) as pool:
        futures = [pool.submit(build, f, g) for f, g in jobs]
        for k, fut in enumerate(cf.as_completed(futures), 1):
            r = fut.result()
            results[r["name"]] = r
            if not r["ok"]:
                print(f"  FAILED CHECK {r['name']}: duration {r['durationDiff']:+.3f} s, offset {r['offset']:+.4f} s", flush=True)
            if k % 100 == 0:
                results_path.write_text(json.dumps(sorted(results.values(), key=lambda r: r["name"]), indent=0), encoding="utf-8")
                print(f"  {k}/{len(jobs)}", flush=True)
    rows = sorted(results.values(), key=lambda r: r["name"])
    results_path.write_text(json.dumps(rows, indent=0), encoding="utf-8")

    good = [r for r in rows if r["ok"]]
    gains = np.array([r["gainDb"] for r in good]) if good else np.zeros(1)
    print(f"{len(good)}/{len(rows)} files pass the check, {sum(r['bytes'] for r in good) / 1e9:.2f} GB")
    print(f"Gain: {np.abs(gains).mean():.2f} dB average change, {gains.min():+.1f} to {gains.max():+.1f} dB")
    if good:
        print(f"Worst duration change {max(abs(r['durationDiff']) for r in good) * 1000:.0f} ms, worst offset {max(abs(r['offset']) for r in good) * 1000:.1f} ms")


if __name__ == "__main__":
    main()
