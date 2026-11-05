"""
Automated listening test for the verse timings: cuts each verse's clip
(startSec..endSec, exactly what the app will play) out of its file in memory,
transcribes just that clip, and lines its words up against the verse's own
words. A clip cut in the wrong place scores low recall, or holds extra words
from a neighbouring verse. Run after align.py:

  bakeoff/.venv/Scripts/python.exe -I scripts/bsb-audio/spot-check.py [sample size | all | GEN_1 ...]

With "all" it checks every verse and every Psalm title, and writes
timings/clip-check.json, which build-timings.js uses to leave failing verses
without audio. Resumable: verses already checked are kept. A sample size (the
default is 150) checks that many random verses into timings/spot-check.json;
chapter keys check just those chapters, also into spot-check.json.
"""

import json
import pathlib
import random
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import align  # noqa: E402  (also sets up the CUDA DLL path)
from faster_whisper import WhisperModel, decode_audio  # noqa: E402

args = sys.argv[1:]
check_all = args == ["all"]
keys = [a for a in args if "_" in a]
n = 0 if check_all or keys else int(args[0]) if args else 150

text = json.loads((align.WORK / "text.json").read_text(encoding="utf-8"))

items = []  # (label, file, startSec, endSec, words to hear)
for p in sorted(align.OUT.glob("*_*.json")):
    if keys and p.stem not in keys:
        continue
    a = json.loads(p.read_text(encoding="utf-8"))
    book, ch = p.stem.split("_")
    chapter = text[p.stem]
    if a["psalmTitle"]:
        t = a["psalmTitle"]
        items.append((f"{book} {ch} title", a["file"], t["startSec"], t["endSec"], chapter["psalmTitle"]))
    by_v = {v["v"]: v["text"] for v in chapter["verses"]}
    for v in a["verses"]:
        items.append((f"{book} {ch}:{v['v']}", a["file"], v["startSec"], v["endSec"], by_v[v["v"]]))

random.seed(1)
sample = items if (check_all or keys) else random.sample(items, min(n, len(items)))
out = pathlib.Path(HERE / "timings" / ("clip-check.json" if check_all else "spot-check.json"))
out.parent.mkdir(parents=True, exist_ok=True)
done = {}
if check_all and out.exists():
    done = {r["verse"]: r for r in json.loads(out.read_text(encoding="utf-8"))}
# Group by file so each MP3 is decoded once.
sample.sort(key=lambda i: i[1])

model = WhisperModel(align.MODEL, device="cuda", compute_type="float16")
audio_cache = {}
results = list(done.values())
todo = [i for i in sample if i[0] not in done]
start = time.time()
for k, (label, file, s, e, verse_text) in enumerate(todo, 1):
    if file not in audio_cache:
        audio_cache.clear()
        audio_cache[file] = decode_audio(str(align.SOURCES / file), sampling_rate=align.SAMPLE_RATE)
    clip = audio_cache[file][int(s * align.SAMPLE_RATE) : int(e * align.SAMPLE_RATE)]
    # VAD stops Whisper inventing words over a clip's quiet edges.
    segs, _ = model.transcribe(clip, language="en", beam_size=5, vad_filter=True, vad_parameters={"speech_pad_ms": 200})
    heard = align.split_words(" ".join(seg.text for seg in segs))
    # Score against the text with hyphens splitting words and with them
    # joining, and keep the better: Whisper writes "seed -bearing" but
    # "Enganim" for "En-gannim" (Joshua 19:21 scored 38% on the split form alone).
    best = None
    for ref in (align.split_words(verse_text), align.split_words(verse_text.replace("-", ""))):
        m = align.align_words(ref, heard) if ref and heard else [None] * len(ref)
        hit = sum(x is not None for x in m)
        score = (hit / max(len(ref), 1), max(0, len(heard) - hit))
        if best is None or score[0] > best[0]:
            best = score
    r = {"verse": label, "recall": round(best[0], 2), "extraWords": best[1]}
    if r["recall"] < 0.9 or r["extraWords"] > 3:
        r["heard"] = " ".join(heard)  # kept only for clips worth a look, so the file stays small
    results.append(r)
    if k % 500 == 0:
        if check_all:
            out.write_text(json.dumps(results, ensure_ascii=False), encoding="utf-8")
        rate = (time.time() - start) / k
        print(f"{len(results)}/{len(sample)} clips, about {(len(todo) - k) * rate / 60:.0f} min to go", flush=True)

out.write_text(json.dumps(results, ensure_ascii=False, indent=0), encoding="utf-8")
good = sum(r["recall"] >= 0.7 and r["extraWords"] <= 3 for r in results)
print(f"{good}/{len(results)} clips hold their verse cleanly (70%+ of its words, at most 3 extra)")
for r in sorted(results, key=lambda r: (r["recall"], -r["extraWords"]))[:8]:
    print("   ", {k2: r[k2] for k2 in ("verse", "recall", "extraWords")})
