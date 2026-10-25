"""
Finds where each Hebrew verse starts and ends in the Shmuelof recordings.

For every audio file (one per Hebrew chapter) it:
  1. transcribes it with Whisper, with a time for every word;
  2. lines the transcript's words up against the WLC words the file should
     contain (work/text.json), comparing bare consonants, because Whisper
     writes modern unvowelled spelling (אלוהים for אֱלֹהִים);
  3. gives each WLC verse a start and end, moving each boundary to the
     quietest moment of the pause between verses so no clip cuts a word.

Writes one work/align/{BOOK}_{ch}.json per file. Files already done are
skipped, so it can be stopped and restarted. Run with the bakeoff venv (GPU):

  bakeoff/.venv/Scripts/python.exe scripts/hebrew-audio/align.py [GEN_1 JOL_3 ...]

With no arguments it does every file in sources/manifest.json.
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
# finds them if their bin folders are on the DLL search path (as bakeoff/transcribe.py).
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

# ── Hebrew word handling ──────────────────────────────────────────────────

POINTS = re.compile(r"[֑-ׇ]")  # vowels, accents, dagesh, maqaf, sof pasuq...
NON_LETTERS = re.compile(r"[^א-ת]")
FINALS = str.maketrans("ךםןףץ", "כמנפצ")


def split_words(text):
    """The app's cut: whitespace and maqaf both separate words."""
    return [w for w in re.split(r"[\s־]+", text) if w]


def skeleton(word):
    """Bare consonants without ו/י, which modern spelling adds and drops freely."""
    s = NON_LETTERS.sub("", POINTS.sub("", word)).translate(FINALS)
    return s.replace("ו", "").replace("י", "")


# The divine name is read aloud as Adonai (or Elohim where it's pointed that way).
DIVINE_NAME = skeleton("יהוה")
DIVINE_READINGS = [skeleton("אדוני"), skeleton("אלוהים")]


def edit_distance(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def similarity(ref, hyp):
    """0..1. Prefix-tolerant: Whisper sometimes writes a prefix (ו, ה, ל) as its own word."""
    if not ref or not hyp:
        return 0.0
    cands = DIVINE_READINGS if ref == DIVINE_NAME else [ref]
    best = 0.0
    for r in cands:
        d = edit_distance(r, hyp)
        best = max(best, 1 - d / max(len(r), len(hyp)))
    return best


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
    Global alignment of reference skeletons against transcript skeletons.
    Returns, for each ref index, the hyp index it matched, or None.
    Gaps cost 0.4 per word; a match scores its similarity, a forced
    substitution scores below a gap pair so true matches win. Only cells
    within `band` words of the diagonal are scored -- the reading runs
    straight through the text, so the true path never strays far from it
    (and Psalm 119 would otherwise be ~6M cells).
    """
    n, m = len(ref), len(hyp)
    gap = -0.4
    NEG = -1e9
    ratio = m / n if n else 1.0
    score = [[NEG] * (m + 1) for _ in range(n + 1)]
    back = [[0] * (m + 1) for _ in range(n + 1)]  # 0 diag, 1 up (skip ref), 2 left (skip hyp)
    score[0][0] = 0.0
    # Skipping transcript words before the first verse word is free: that's
    # the spoken title. So the verse's first word matches its own reading,
    # never an identical word in the title ("Bereshit").
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


def drop_stray_edge_matches(matches, verse_of, slack=2):
    """
    Un-match a verse's first (or last) word when the transcript jumps over
    several unmatched words to reach the next one. That pattern is a word
    that also appears in the spoken title -- "the book of Bereshit" before
    Genesis 1:1 "Bereshit bara..." -- matched to the title instead of the verse.
    """
    by_verse = {}
    for k, vi in enumerate(verse_of):
        by_verse.setdefault(vi, []).append(k)
    for idxs in by_verse.values():
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
    """
    Middle of the longest pause between lo and hi seconds -- where one verse
    really ends and the next begins. Whisper's word times can run ~1 s early
    after a pause (Lev 24:1's first word sits on the title's "dalet"), so the
    windows passed in reach past them and the audio decides.
    """
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


def transcribe(model, verses, mp3):
    # Prompt with the opening of the chapter's text, unvowelled, so Whisper
    # leans toward the words actually read (as in the speech bake-off).
    prompt = POINTS.sub("", " ".join(v["text"] for v in verses[:3]))[:200]
    segments, _ = model.transcribe(
        str(mp3),
        language="he",
        word_timestamps=True,
        initial_prompt=prompt,
        beam_size=5,
        # Transcribing speech chunk by chunk stops Whisper skipping ~20 s of
        # reading after a spoken title (seen in Deuteronomy 1).
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 300, "speech_pad_ms": 200},
    )
    hyp_words = []
    for seg in segments:
        for w in seg.words or []:
            sk = skeleton(w.word)
            if sk:
                hyp_words.append({"sk": sk, "start": round(w.start, 2), "end": round(w.end, 2), "text": w.word.strip()})
    return hyp_words


GAP_SEC = 3.0  # a silence this long inside a reading means Whisper skipped speech


def speech_gaps(hyp_words, duration, energy):
    """Stretches of 3 s+ with no transcribed words that still contain speech."""
    # A "word" over 1.5 s long is Whisper stretching a title word across the
    # stretch it skipped (Deut 21: "chapter alef" 0-32 s); only its first 1.5 s counts.
    edges = [0.0] + [t for w in hyp_words for t in (w["start"], min(w["end"], w["start"] + 1.5))] + [duration]
    gaps = []
    for lo, hi in zip(edges[0::2], edges[1::2]):
        if hi - lo < GAP_SEC:
            continue
        seg = energy[int(lo / FRAME) : int(hi / FRAME)]
        # Speech, not a long pause: a fair share of loud frames.
        if len(seg) and (seg > 0.05 * energy.max()).mean() > 0.3:
            gaps.append((lo, hi))
    return gaps


def fill_gaps(model, mp3, hyp_words):
    """
    Whisper sometimes hears "chapter N" and then jumps ~30 s (Num 10, Isa 60).
    Re-transcribe each such gap on its own and splice its words in.
    """
    audio = decode_audio(str(mp3), sampling_rate=SAMPLE_RATE)
    duration = len(audio) / SAMPLE_RATE
    energy = energy_frames(audio)
    added = []
    for lo, hi in speech_gaps(hyp_words, duration, energy):
        # Start just AFTER the last word heard: a window that catches even the
        # tail of a spoken title ("...chapter alef") makes Whisper transcribe
        # only that and give up again (Deut 21).
        a, b = min(lo + 0.05, hi), min(duration, hi + 0.2)
        segments, _ = model.transcribe(
            audio[int(a * SAMPLE_RATE) : int(b * SAMPLE_RATE)], language="he", word_timestamps=True, beam_size=5
        )
        for seg in segments:
            for w in seg.words or []:
                st, en = w.start + a, w.end + a
                if skeleton(w.word) and st >= lo - 0.1 and en <= hi + 0.1:
                    added.append({"sk": skeleton(w.word), "start": round(st, 2), "end": round(en, 2), "text": w.word.strip()})
    return sorted(hyp_words + added, key=lambda w: w["start"]), len(added)


def align_file(key, verses, mp3, hyp_words):
    audio = decode_audio(str(mp3), sampling_rate=SAMPLE_RATE)
    duration = len(audio) / SAMPLE_RATE
    energy = energy_frames(audio)

    ref_words = []  # (verse index, skeleton)
    for vi, v in enumerate(verses):
        for w in split_words(v["text"]):
            sk = skeleton(w)
            if sk:
                ref_words.append((vi, sk))

    matches = align_words([sk for _, sk in ref_words], [h["sk"] for h in hyp_words])
    drop_stray_edge_matches(matches, [vi for vi, _ in ref_words])

    # Word times for every ref word (None where unmatched).
    word_times = [
        (hyp_words[j]["start"], hyp_words[j]["end"]) if j is not None else None for j in matches
    ]

    out_verses = []
    for vi, v in enumerate(verses):
        idxs = [k for k, (wvi, _) in enumerate(ref_words) if wvi == vi]
        timed = [word_times[k] for k in idxs if word_times[k] is not None]
        out_verses.append(
            {
                "ref": v["ref"],
                "words": len(idxs),
                "matched": len(timed),
                "first": timed[0][0] if timed else None,
                "last": timed[-1][1] if timed else None,
                # Per-word starts (None = unmatched): needed for the two mid-verse splits.
                "wordStarts": [word_times[k][0] if word_times[k] else None for k in idxs],
            }
        )

    # Verses with no matched word: share out the gap between their neighbours
    # by word count. (Should be rare; they're flagged in the report anyway.)
    n = len(out_verses)
    i = 0
    while i < n:
        if out_verses[i]["first"] is not None:
            i += 1
            continue
        j = i
        while j < n and out_verses[j]["first"] is None:
            j += 1
        lo = out_verses[i - 1]["last"] if i > 0 else 0.0
        hi = out_verses[j]["first"] if j < n else duration
        total = sum(max(out_verses[k]["words"], 1) for k in range(i, j))
        t = lo
        for k in range(i, j):
            span = (hi - lo) * max(out_verses[k]["words"], 1) / total
            out_verses[k]["first"], out_verses[k]["last"] = t, t + span
            out_verses[k]["interpolated"] = True
            t += span
        i = j

    # Boundaries: the middle of the longest real pause near each verse join.
    # The windows reach 0.8-0.9 s past Whisper's first-word time, since that
    # time can be early. The first verse's window starts 1 s before its first
    # word, which skips past a spoken title; the last verse ends at the end
    # of the file. "Quiet" is relative to this reader's speaking level.
    quiet_level = 0.12 * float(np.percentile(energy, 95))
    for k, v in enumerate(out_verses):
        if k == 0:
            v["startSec"] = round(max(0.0, pause_cut(energy, v["first"] - 1.0, v["first"] + 0.9, quiet_level) - 0.05), 2)
        else:
            prev = out_verses[k - 1]
            lo, hi = min(prev["last"], v["first"]), max(prev["last"], v["first"])
            cut = round(pause_cut(energy, lo - 0.4, hi + 0.8, quiet_level), 2)
            prev["endSec"] = cut
            v["startSec"] = cut
    out_verses[-1]["endSec"] = round(duration, 2)

    return {
        "key": key,
        "file": mp3.name,
        "duration": round(duration, 2),
        "transcript": " ".join(h["text"] for h in hyp_words),
        "verses": [
            {k2: v[k2] for k2 in ("ref", "startSec", "endSec", "words", "matched", "wordStarts", "interpolated") if k2 in v}
            for v in out_verses
        ],
    }


def main():
    text = json.loads((WORK / "text.json").read_text(encoding="utf-8"))
    manifest = json.loads((SOURCES / "manifest.json").read_text(encoding="utf-8"))
    by_key = {f"{f['bookId']}_{f['hebChapter']}": f for f in manifest}
    keys = sys.argv[1:] or list(by_key)
    OUT.mkdir(parents=True, exist_ok=True)
    WHISPER.mkdir(parents=True, exist_ok=True)
    model = None
    for n, key in enumerate(keys, 1):
        t0 = time.time()
        mp3 = SOURCES / by_key[key]["name"]
        # Whisper is the slow part (~10 s a chapter), so its words are kept and
        # only re-made when that file is deleted; the alignment is re-run every time.
        cached = WHISPER / f"{key}.json"
        if cached.exists():
            hyp_words = json.loads(cached.read_text(encoding="utf-8"))
        else:
            if model is None:
                model = WhisperModel(MODEL, device="cuda", compute_type="float16")
            hyp_words = transcribe(model, text[key], mp3)
            cached.write_text(json.dumps(hyp_words, ensure_ascii=False), encoding="utf-8")
        # Second pass over any skipped stretch, cached separately so the first
        # pass is never redone.
        filled = WHISPER / f"{key}.filled.json"
        if filled.exists():
            hyp_words = json.loads(filled.read_text(encoding="utf-8"))
        else:
            if model is None:
                model = WhisperModel(MODEL, device="cuda", compute_type="float16")
            hyp_words, n_added = fill_gaps(model, mp3, hyp_words)
            filled.write_text(json.dumps(hyp_words, ensure_ascii=False), encoding="utf-8")
            if n_added:
                print(f"  {key}: {n_added} words recovered from skipped stretches", flush=True)
        result = align_file(key, text[key], mp3, hyp_words)
        dest = OUT / f"{key}.json"
        dest.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        words = sum(v["words"] for v in result["verses"])
        matched = sum(v["matched"] for v in result["verses"])
        print(f"[{n}/{len(keys)}] {key}: {matched}/{words} words matched, {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
