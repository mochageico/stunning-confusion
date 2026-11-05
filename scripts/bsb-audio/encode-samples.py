"""
Stage 0 bitrate samples: re-encodes a few chapters as mono MP3 at 32, 48 and
64 kbps into work/samples/, next to a copy of the original, so the bitrate can
be picked by ear. Uses PyAV's bundled libmp3lame (no ffmpeg install needed).

All samples are 24 kHz: speech has nothing worth keeping above 12 kHz, and a
lower rate leaves more of each bitrate for the voice.

  bakeoff/.venv/Scripts/python.exe -I scripts/bsb-audio/encode-samples.py [GEN_1 PSA_23 ...]
"""

import json
import pathlib
import shutil
import sys

import av

HERE = pathlib.Path(__file__).resolve().parent
SOURCES = HERE / "sources"
OUT = HERE / "work" / "samples"
BITRATES = [32, 48, 64]
RATE = 24000
DEFAULT = ["GEN_1", "PSA_23", "ROM_8"]


def encode(src, dest, kbps):
    with av.open(str(src)) as inp, av.open(str(dest), "w", format="mp3") as out:
        stream = out.add_stream("libmp3lame", rate=RATE)
        stream.layout = "mono"
        stream.bit_rate = kbps * 1000
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=RATE)
        for frame in inp.decode(audio=0):
            for f in resampler.resample(frame):
                out.mux(stream.encode(f))
        for f in resampler.resample(None):
            out.mux(stream.encode(f))
        out.mux(stream.encode(None))


def duration(path):
    with av.open(str(path)) as c:
        s = c.streams.audio[0]
        return float(s.duration * s.time_base) if s.duration else c.duration / 1e6


def main():
    keys = sys.argv[1:] or DEFAULT
    manifest = {f"{f['bookId']}_{f['chapter']}": f for f in json.loads((SOURCES / "manifest.json").read_text())}
    OUT.mkdir(parents=True, exist_ok=True)
    for key in keys:
        f = manifest[key]
        src = SOURCES / f["name"]
        shutil.copyfile(src, OUT / f"{key}_original_{f['kbps']}k.mp3")
        for kbps in BITRATES:
            dest = OUT / f"{key}_{kbps}k.mp3"
            encode(src, dest, kbps)
            print(f"{dest.name}: {dest.stat().st_size / 1e6:.2f} MB (original {f['bytes'] / 1e6:.2f} MB), "
                  f"{duration(dest):.2f} s vs {f['seconds']:.2f} s", flush=True)


if __name__ == "__main__":
    main()
