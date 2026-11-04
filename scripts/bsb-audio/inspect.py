"""
Stage 0 spot checks: what does Souer read besides the verses?

For each chapter it transcribes the reading with Whisper (no prompt, so the
transcript isn't nudged toward our text) and writes work/inspect/report.md:
the chapter's section headings, cross-references and Psalm title from the
BSB USFX, then the transcript with every pause of 0.5 s or more marked, so a
reader can see whether the headings, cross-references and a spoken chapter
title are read, and how long the pauses are. Also a summary of pause lengths.

  bakeoff/.venv/Scripts/python.exe -I scripts/bsb-audio/inspect.py [GEN_1 PSA_3 ...]
"""

import json
import os
import pathlib
import re
import statistics
import sys

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent

# pip's nvidia-* wheels put cuBLAS/cuDNN DLLs in site-packages; Windows only
# finds them if their bin folders are on the DLL search path (as hebrew-audio/align.py).
for pkg in ("cublas", "cudnn"):
    bin_dir = REPO / "bakeoff" / ".venv" / "Lib" / "site-packages" / "nvidia" / pkg / "bin"
    if bin_dir.is_dir():
        os.add_dll_directory(str(bin_dir))
        os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ["PATH"]

from faster_whisper import WhisperModel  # noqa: E402

SOURCES = HERE / "sources"
OUT = HERE / "work" / "inspect"
USFX = REPO / "scripts" / "import-bible" / "engbsb_usfx.xml"
MODEL = "large-v3-turbo"

SPOT = ["GEN_1", "PSA_3", "PSA_23", "PSA_119", "MAT_1", "JHN_1", "ROM_8", "PHM_1", "1CH_1", "ISA_53"]


def tag_text(s):
    s = re.sub(r"<f\b[^>]*>[\s\S]*?</f>", "", s)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s)).strip()


def extras(xml, book, ch):
    """Non-verse text in the chapter, in order: (kind, text, before verse n)."""
    m = re.search(rf'<book id="{book}">([\s\S]*?)</book>', xml)
    parts = re.split(r'<c id="(\d+)"[^>]*/>', m.group(1))
    body = parts[parts.index(str(ch)) + 1]
    out = []
    pat = re.compile(r'<s\b[^>]*>([\s\S]*?)</s>|<d\b[^>]*>([\s\S]*?)</d>|<p[^>]*style="r"[^>]*>([\s\S]*?)</p>|<v id="(\d+)"')
    pending = []
    for t in pat.finditer(body):
        if t.group(4):
            for kind, text in pending:
                out.append((kind, text, int(t.group(4))))
            pending = []
        elif t.group(1) is not None:
            pending.append(("heading", tag_text(t.group(1))))
        elif t.group(2) is not None:
            pending.append(("psalm title", tag_text(t.group(2))))
        else:
            pending.append(("cross-ref", tag_text(t.group(3))))
    return out


def main():
    keys = sys.argv[1:] or SPOT
    manifest = {f"{f['bookId']}_{f['chapter']}": f for f in json.loads((SOURCES / "manifest.json").read_text())}
    xml = USFX.read_text(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    model = WhisperModel(MODEL, device="cuda", compute_type="float16")
    report = ["# Souer spot checks", ""]
    all_gaps = []
    for key in keys:
        f = manifest[key]
        cache = OUT / f"{key}.json"
        if cache.exists():
            words = json.loads(cache.read_text(encoding="utf-8"))
        else:
            # VAD as in hebrew-audio/align.py: without it Whisper skipped John 1:1-5
            # and filled 1 Chronicles 1's opening with "2 Chronicles 1".
            segments, _ = model.transcribe(
                str(SOURCES / f["name"]),
                language="en",
                word_timestamps=True,
                beam_size=5,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 300, "speech_pad_ms": 200},
            )
            words = [{"w": w.word.strip(), "start": round(w.start, 2), "end": round(w.end, 2)} for s in segments for w in (s.words or [])]
            cache.write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")
        book, ch = key.split("_")
        report += [f"## {key} ({f['seconds']:.0f} s)", ""]
        for kind, text, v in extras(xml, book, int(ch)):
            report.append(f"- {kind} before v{v}: {text}")
        report += ["", f"First speech at {words[0]['start']:.2f} s. Pauses of 0.5 s+ marked [n.n].", ""]
        gaps = []
        line = []
        for i, w in enumerate(words):
            if i:
                gap = w["start"] - words[i - 1]["end"]
                gaps.append(gap)
                if gap >= 0.5:
                    line.append(f"[{gap:.1f}]")
            line.append(w["w"])
        report += ["> " + " ".join(line), ""]
        long_gaps = [g for g in gaps if g >= 0.5]
        if long_gaps:
            report.append(f"Pauses 0.5 s+: {len(long_gaps)}, median {statistics.median(long_gaps):.2f} s, max {max(long_gaps):.2f} s.")
            report.append("")
        all_gaps += long_gaps
        print(key, "done", flush=True)
    if all_gaps:
        qs = statistics.quantiles(all_gaps, n=10)
        report.append(f"All pauses 0.5 s+: {len(all_gaps)}; 10th/50th/90th percentile {qs[0]:.2f} / {statistics.median(all_gaps):.2f} / {qs[-1]:.2f} s.")
    (OUT / "report.md").write_text("\n".join(report) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
