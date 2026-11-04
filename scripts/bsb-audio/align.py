"""
Finds where each verse starts and ends in Bob Souer's BSB reading.

For every chapter file it:
  1. transcribes it with Whisper, with a time for every word;
  2. lines the transcript's words up against what's read (work/text.json):
     the Psalm title, if any, then each verse, comparing normalised words
     (lower case, no punctuation, numbers as words, since Whisper writes
     "10,000" where Souer says "ten thousand");
  3. gives each verse a start and end at the middle of the pause between it
     and its neighbour. Stage 0 found nothing is read between verses
     (no section headings), so every join's pause is verse-to-verse. The
     spoken chapter title is skipped as free words before the first match.

Writes one work/align/{BOOK}_{ch}.json per chapter. Whisper's words are cached
in work/whisper/, so re-running only redoes the (fast) matching.

Run with the bakeoff venv (GPU), in chunks if you like:

  bakeoff/.venv/Scripts/python.exe -I scripts/bsb-audio/align.py --minutes 25
      next chapters not yet done, in Bible order, stopping before 25 minutes
  bakeoff/.venv/Scripts/python.exe -I scripts/bsb-audio/align.py GEN_1 PSA_23
      just these (always re-matched)
  bakeoff/.venv/Scripts/python.exe -I scripts/bsb-audio/align.py --realign
      re-match every chapter already transcribed (no GPU work)

With no arguments it does every chapter not yet done.
"""

import json
import os
import pathlib
import re
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent

# pip's nvidia-* wheels put cuBLAS/cuDNN DLLs in site-packages; Windows only
# finds them if their bin folders are on the DLL search path (as hebrew-audio/align.py).
for pkg in ("cublas", "cudnn"):
    bin_dir = REPO / "bakeoff" / ".venv" / "Lib" / "site-packages" / "nvidia" / pkg / "bin"
    if bin_dir.is_dir():
        os.add_dll_directory(str(bin_dir))
        os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ["PATH"]

import numpy as np  # noqa: E402
from faster_whisper import WhisperModel, decode_audio  # noqa: E402

SOURCES = HERE / "sources"
WORK = HERE / "work"
OUT = WORK / "align"
WHISPER = WORK / "whisper"
SAMPLE_RATE = 16000
MODEL = "large-v3-turbo"

# ── English word handling ─────────────────────────────────────────────────

ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
ORDINAL = {"one": "first", "two": "second", "three": "third", "five": "fifth", "eight": "eighth", "nine": "ninth", "twelve": "twelfth"}


def number_words(n):
    """1254 -> ['one', 'thousand', 'two', 'hundred', 'fifty', 'four'] (no "and")."""
    if n < 20:
        return [ONES[n]]
    if n < 100:
        return [TENS[n // 10]] + ([ONES[n % 10]] if n % 10 else [])
    for size, name in ((10**9, "billion"), (10**6, "million"), (1000, "thousand"), (100, "hundred")):
        if n >= size:
            return number_words(n // size) + [name] + (number_words(n % size) if n % size else [])


def ordinal_words(n):
    w = number_words(n)
    last = w[-1]
    if last in ORDINAL:
        w[-1] = ORDINAL[last]
    elif last.endswith("y"):
        w[-1] = last[:-1] + "ieth"
    else:
        w[-1] = last + "th"
    return w


FOLD = str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"', "—": " ", "–": " ", "-": " "})
NUMBER = re.compile(r"^(\d[\d,]*)(st|nd|rd|th)?$")


def split_words(text):
    """Normalised words: lower case, apostrophes dropped, numbers spelled out."""
    out = []
    for tok in text.translate(FOLD).lower().split():
        tok = tok.replace("'", "")
        core = re.sub(r"^[^a-z0-9]+|[^a-z0-9]+$", "", tok)
        m = NUMBER.match(core)
        if m and m.group(1).replace(",", "").isdigit():
            n = int(m.group(1).replace(",", ""))
            out += ordinal_words(n) if m.group(2) else number_words(n)
        else:
            out += [w for w in re.split(r"[^a-z0-9]+", core) if w]
    return out


def edit_distance(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def similarity(ref, hyp):
    """0..1 by edit distance, so a misspelt name ("Mahalalal") still matches."""
    if not ref or not hyp:
        return 0.0
    if ref == hyp:
        return 1.0
    return 1 - edit_distance(ref, hyp) / max(len(ref), len(hyp))


MATCH = 0.5  # below this, two words are not the same word

_sim_cache = {}


def sim(ref, hyp):
    key = (ref, hyp)
    v = _sim_cache.get(key)
    if v is None:
        v = _sim_cache[key] = similarity(ref, hyp)
    return v


def align_words(ref, hyp, band=200):
    """
    Global alignment of reference words against transcript words (as
    hebrew-audio/align.py). Returns, for each ref index, the hyp index it
    matched, or None. Gaps cost 0.4 per word; a match scores its similarity,
    a forced substitution scores below a gap pair so true matches win. Only
    cells within `band` words of the diagonal are scored.
    """
    n, m = len(ref), len(hyp)
    gap = -0.4
    NEG = -1e9
    ratio = m / n if n else 1.0
    score = [[NEG] * (m + 1) for _ in range(n + 1)]
    back = [[0] * (m + 1) for _ in range(n + 1)]  # 0 diag, 1 up (skip ref), 2 left (skip hyp)
    score[0][0] = 0.0
    # Skipping transcript words before the first ref word is free: that's the
    # spoken chapter title ("Genesis 1", "Psalms, Psalm 1").
    for j in range(1, min(m, band) + 1):
        score[0][j], back[0][j] = 0.0, 2
    for i in range(1, n + 1):
        centre = int(i * ratio)
        lo, hi = max(0, centre - band), min(m, centre + band)
        row, prow, brow = score[i], score[i - 1], back[i]
        if lo == 0:
            row[0], brow[0] = gap * i, 1
        for j in range(max(1, lo), hi + 1):
            s = sim(ref[i - 1], hyp[j - 1])
            diag = prow[j - 1] + (s if s >= MATCH else -0.9)
            up = prow[j] + gap
            left = row[j - 1] + gap
            if diag >= up and diag >= left:
                row[j], brow[j] = diag, 0
            elif up >= left:
                row[j], brow[j] = up, 1
            else:
                row[j], brow[j] = left, 2
    out = [None] * n
    i, j = n, m
    while i > 0 or j > 0:
        b = back[i][j] if i > 0 and j > 0 else (1 if j == 0 else 2)
        if b == 0:
            if sim(ref[i - 1], hyp[j - 1]) >= MATCH:
                out[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif b == 1:
            i -= 1
        else:
            j -= 1
    return out


def drop_stray_edge_matches(matches, seg_of, slack=2):
    """
    Un-match a segment's first (or last) word when the transcript jumps over
    several unmatched words to reach the next one: a word matched to the
    spoken title, or to a neighbouring verse, instead of its own reading.
    """
    by_seg = {}
    for k, si in enumerate(seg_of):
        by_seg.setdefault(si, []).append(k)
    for idxs in by_seg.values():
        for order in (idxs, idxs[::-1]):
            while True:
                hit = [k for k in order if matches[k] is not None][:2]
                if len(hit) < 2:
                    break
                a, b = hit
                if abs(matches[b] - matches[a]) - abs(b - a) > slack:
                    matches[a] = None
                else:
                    break


# ── Audio ─────────────────────────────────────────────────────────────────

FRAME = 0.02  # seconds per energy frame


def energy_frames(audio):
    hop = int(SAMPLE_RATE * FRAME)
    usable = len(audio) // hop * hop
    frames = audio[:usable].reshape(-1, hop)
    return np.sqrt((frames**2).mean(axis=1) + 1e-12)


def quietest(energy, lo, hi):
    """Time of the quietest 100 ms between lo and hi seconds (midpoint if the window is tiny)."""
    a, b = int(lo / FRAME), int(hi / FRAME)
    if b - a < 3:
        return (lo + hi) / 2
    win = 5
    seg = energy[a:b]
    if len(seg) <= win:
        return (lo + hi) / 2
    smooth = np.convolve(seg, np.ones(win) / win, mode="valid")
    k = int(np.argmin(smooth))
    return (a + k + win // 2) * FRAME


def pause_cut(energy, lo, hi, quiet_level):
    """Middle of the longest pause between lo and hi seconds, else the quietest point."""
    a, b = max(0, int(lo / FRAME)), min(len(energy), int(hi / FRAME))
    if b - a < 3:
        return (lo + hi) / 2
    quiet = energy[a:b] < quiet_level
    best_len, best_mid, run_start = 0, None, None
    for k in range(b - a + 1):
        if k < b - a and quiet[k]:
            if run_start is None:
                run_start = k
        elif run_start is not None:
            if k - run_start > best_len:
                best_len, best_mid = k - run_start, (a + (run_start + k) / 2) * FRAME
            run_start = None
    if best_len * FRAME < 0.06:
        return quietest(energy, lo, hi)
    return best_mid


# ── Per file ──────────────────────────────────────────────────────────────


def transcribe(model, audio):
    # No prompt: prompting with the chapter's opening text (as the Hebrew
    # build does) made Whisper skip that very text -- Psalm 1's first pass
    # began 8 s in -- and lost words in Romans 8:2-3 and Genesis 1:27. The
    # unprompted stage 0 runs were clean, and the matching tolerates misspelt names.
    segments, _ = model.transcribe(
        audio,
        language="en",
        word_timestamps=True,
        beam_size=5,
        # Without VAD, Whisper skipped John 1:1-5 and invented "2 Chronicles 1"
        # over 1 Chronicles 1's name list (stage 0).
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 300, "speech_pad_ms": 200},
    )
    return [{"text": w.word.strip(), "start": round(w.start, 2), "end": round(w.end, 2)} for s in segments for w in (s.words or [])]


GAP_SEC = 3.0  # a silence this long inside a reading means Whisper skipped speech


def speech_gaps(hyp_words, duration, energy):
    """Stretches of 3 s+ with no transcribed words that still contain speech."""
    edges = [0.0] + [t for w in hyp_words for t in (w["start"], min(w["end"], w["start"] + 1.5))] + [duration]
    gaps = []
    for lo, hi in zip(edges[0::2], edges[1::2]):
        if hi - lo < GAP_SEC:
            continue
        seg = energy[int(lo / FRAME) : int(hi / FRAME)]
        if len(seg) and (seg > 0.05 * energy.max()).mean() > 0.3:
            gaps.append((lo, hi))
    return gaps


def fill_gaps(model, audio, hyp_words):
    """Re-transcribe any stretch Whisper skipped on its own, and splice its words in."""
    duration = len(audio) / SAMPLE_RATE
    energy = energy_frames(audio)
    added = []
    for lo, hi in speech_gaps(hyp_words, duration, energy):
        a, b = min(lo + 0.05, hi), min(duration, hi + 0.2)
        segments, _ = model.transcribe(audio[int(a * SAMPLE_RATE) : int(b * SAMPLE_RATE)], language="en", word_timestamps=True, beam_size=5)
        for seg in segments:
            for w in seg.words or []:
                st, en = w.start + a, w.end + a
                if w.word.strip() and st >= lo - 0.1 and en <= hi + 0.1:
                    added.append({"text": w.word.strip(), "start": round(st, 2), "end": round(en, 2)})
    return sorted(hyp_words + added, key=lambda w: w["start"]), len(added)


def align_file(key, chapter, audio, hyp_words):
    duration = len(audio) / SAMPLE_RATE
    energy = energy_frames(audio)

    # Segments in reading order: the Psalm title (if any), then each verse.
    segs = ([{"title": True, "text": chapter["psalmTitle"]}] if chapter["psalmTitle"] else []) + [
        {"v": v["v"], "text": v["text"]} for v in chapter["verses"]
    ]
    ref = []  # (segment index, word)
    for si, s in enumerate(segs):
        ref += [(si, w) for w in split_words(s["text"])]

    # A transcript token like "10,000" becomes several words sharing its times.
    hyp = []
    for h in hyp_words:
        hyp += [(w, h["start"], h["end"]) for w in split_words(h["text"])]

    matches = align_words([w for _, w in ref], [w for w, _, _ in hyp])
    drop_stray_edge_matches(matches, [si for si, _ in ref])

    for si, s in enumerate(segs):
        idxs = [k for k, (wsi, _) in enumerate(ref) if wsi == si]
        timed = [(hyp[matches[k]][1], hyp[matches[k]][2]) for k in idxs if matches[k] is not None]
        s.update(words=len(idxs), matched=len(timed), first=timed[0][0] if timed else None, last=timed[-1][1] if timed else None)

    # Segments with no matched word: share out the gap between their
    # neighbours by word count. (Rare; flagged by stage 3 anyway.)
    n = len(segs)
    i = 0
    while i < n:
        if segs[i]["first"] is not None:
            i += 1
            continue
        j = i
        while j < n and segs[j]["first"] is None:
            j += 1
        lo = segs[i - 1]["last"] if i > 0 else 0.0
        hi = segs[j]["first"] if j < n else duration
        total = sum(max(segs[k]["words"], 1) for k in range(i, j))
        t = lo
        for k in range(i, j):
            span = (hi - lo) * max(segs[k]["words"], 1) / total
            segs[k]["first"], segs[k]["last"] = t, t + span
            segs[k]["interpolated"] = True
            t += span
        i = j

    # Boundaries: the middle of the longest pause at each join. The window
    # runs from a little before the earlier segment's last word ends to a
    # little after the next one's first word starts, since Whisper's word
    # edges can sit inside the pause or just past it. The first segment
    # starts in the pause after the spoken chapter title; the last ends at
    # the end of the file. "Quiet" is relative to the reader's level.
    quiet_level = 0.12 * float(np.percentile(energy, 95))
    for k, s in enumerate(segs):
        if k == 0:
            s["startSec"] = round(max(0.0, pause_cut(energy, s["first"] - 1.0, s["first"] + 0.3, quiet_level) - 0.05), 2)
        else:
            prev = segs[k - 1]
            lo, hi = min(prev["last"], s["first"]), max(prev["last"], s["first"])
            cut = round(pause_cut(energy, lo - 0.3, hi + 0.3, quiet_level), 2)
            prev["endSec"] = cut
            s["startSec"] = cut
    segs[-1]["endSec"] = round(duration, 2)

    keep = ("v", "startSec", "endSec", "words", "matched", "interpolated")
    title = segs[0] if chapter["psalmTitle"] else None
    return {
        "key": key,
        "file": chapter["file"],
        "duration": round(duration, 2),
        "transcript": " ".join(h["text"] for h in hyp_words),
        # The Psalm title's span, for the timings doc's headings["1"].
        "psalmTitle": {k2: title[k2] for k2 in keep if k2 in title and k2 != "v"} if title else None,
        "verses": [{k2: s[k2] for k2 in keep if k2 in s} for s in segs if "v" in s],
    }


def fmt(sec):
    return f"{int(sec // 60)}m{int(sec % 60):02d}s"


def main():
    args = sys.argv[1:]
    text = json.loads((WORK / "text.json").read_text(encoding="utf-8"))
    manifest = json.loads((SOURCES / "manifest.json").read_text(encoding="utf-8"))
    by_key = {f"{f['bookId']}_{f['chapter']}": f for f in manifest}
    budget = None
    if args[:1] == ["--minutes"]:
        budget, args = float(args[1]) * 60, args[2:]
    if args == ["--realign"]:
        keys = [k for k in by_key if (WHISPER / f"{k}.filled.json").exists()]
    else:
        keys = args or [k for k in by_key if not (OUT / f"{k}.json").exists()]
    OUT.mkdir(parents=True, exist_ok=True)
    WHISPER.mkdir(parents=True, exist_ok=True)
    model = None
    start = time.time()
    audio_done = 0.0  # seconds of audio transcribed this run, for the pace estimate
    for n, key in enumerate(keys, 1):
        f = by_key[key]
        cached = WHISPER / f"{key}.json"
        filled = WHISPER / f"{key}.filled.json"
        if budget is not None and not filled.exists():
            # Stop before a chapter that would run past the budget, at this
            # run's pace (assume ~25x real time until there's a measurement).
            elapsed = time.time() - start
            pace = elapsed / audio_done if audio_done else 1 / 25
            if elapsed + f["seconds"] * pace > budget:
                print(f"Stopping at the {budget / 60:.0f}-minute budget, before {key}.")
                break
        t0 = time.time()
        audio = decode_audio(str(SOURCES / f["name"]), sampling_rate=SAMPLE_RATE)
        # Whisper is the slow part, so its words are kept and only re-made when
        # those files are deleted; the matching is re-run every time.
        if filled.exists():
            hyp_words = json.loads(filled.read_text(encoding="utf-8"))
        else:
            if model is None:
                model = WhisperModel(MODEL, device="cuda", compute_type="float16")
            if cached.exists():
                hyp_words = json.loads(cached.read_text(encoding="utf-8"))
            else:
                hyp_words = transcribe(model, audio)
                cached.write_text(json.dumps(hyp_words, ensure_ascii=False), encoding="utf-8")
            hyp_words, n_added = fill_gaps(model, audio, hyp_words)
            filled.write_text(json.dumps(hyp_words, ensure_ascii=False), encoding="utf-8")
            audio_done += f["seconds"]
            if n_added:
                print(f"  {key}: {n_added} words recovered from skipped stretches", flush=True)
        result = align_file(key, text[key], audio, hyp_words)
        (OUT / f"{key}.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        words = sum(v["words"] for v in result["verses"])
        matched = sum(v["matched"] for v in result["verses"])
        print(f"[{n}/{len(keys)}] {key}: {matched}/{words} words matched, {time.time() - t0:.0f}s", flush=True)

    done = [k for k in by_key if (OUT / f"{k}.json").exists()]
    left = sum(by_key[k]["seconds"] for k in by_key if k not in set(done))
    msg = f"{len(done)}/{len(by_key)} chapters aligned; {left / 3600:.1f} hours of audio left."
    if audio_done:
        pace = (time.time() - start) / audio_done
        msg += f" This run: {fmt(time.time() - start)} for {audio_done / 3600:.2f} h of audio ({1 / pace:.0f}x real time), so about {fmt(left * pace)} to go."
    print(msg)


if __name__ == "__main__":
    main()
