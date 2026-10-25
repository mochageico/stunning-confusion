"""
Automated listening test for the finished timings: cuts each sampled verse's
clip (start..end) out of its file in memory, transcribes just that clip, and
reports how many of the verse's own words it contains. A clip cut in the wrong
place scores low. Run after build-timings.js:

  bakeoff/.venv/Scripts/python.exe scripts/hebrew-audio/spot-check.py [sample size | all]

With "all" it checks every verse and writes timings/clip-check.json, which
build-timings.js then uses to leave failing verses without audio. Resumable.
"""
import json, pathlib, random, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import align  # noqa: E402  (also sets up the CUDA DLL path)
from faster_whisper import WhisperModel, decode_audio  # noqa: E402

HERE = pathlib.Path(__file__).parent
check_all = len(sys.argv) > 1 and sys.argv[1] == "all"
n = 0 if check_all else int(sys.argv[1]) if len(sys.argv) > 1 else 150
english = json.loads((HERE / "work" / "english-map.json").read_text(encoding="utf-8"))["chapters"]
text = json.loads((HERE / "work" / "text.json").read_text(encoding="utf-8"))
by_ref = {v["ref"]: v["text"] for vs in text.values() for v in vs}
report = json.loads((HERE / "timings" / "report.json").read_text(encoding="utf-8"))
flagged = {f["verse"] for f in report["flags"] if not f.get("minor")}

items = []
for p in (HERE / "timings").glob("*_*.json"):
    doc = json.loads(p.read_text(encoding="utf-8"))
    for v, t in doc["verses"].items():
        label = f"{doc['book']} {doc['chapter']}:{v}"
        refs = english[p.stem]["verses"][v]
        items.append((label, t, " ".join(by_ref[r] for r in refs), label in flagged))
random.seed(1)
sample = items if check_all else random.sample([i for i in items if not i[3]], n) + [i for i in items if i[3]]
out = HERE / "timings" / ("clip-check.json" if check_all else "spot-check.json")
done = {}
if check_all and out.exists():
    done = {r["verse"]: r for r in json.loads(out.read_text(encoding="utf-8"))}
# Group by file so each MP3 is decoded once.
sample.sort(key=lambda i: i[1]["file"])

model = WhisperModel(align.MODEL, device="cuda", compute_type="float16")
audio_cache = {}
results = list(done.values())
for k, (label, t, verse_text, was_flagged) in enumerate(sample):
    if label in done:
        continue
    if t["file"] not in audio_cache:
        audio_cache.clear()
        audio_cache[t["file"]] = decode_audio(str(HERE / "sources" / t["file"]), sampling_rate=16000)
    a = audio_cache[t["file"]]
    clip = a[int(t["startSec"] * 16000) : int(t["endSec"] * 16000)]
    segs, _ = model.transcribe(clip, language="he", beam_size=5)
    heard = [align.skeleton(w) for s in segs for w in s.text.split() if align.skeleton(w)]
    ref = [align.skeleton(w) for w in align.split_words(verse_text) if align.skeleton(w)]
    m = align.align_words(ref, heard) if ref and heard else [None] * len(ref)
    recall = sum(x is not None for x in m) / max(len(ref), 1)
    extra = max(0, len(heard) - sum(x is not None for x in m))
    results.append({"verse": label, "flagged": was_flagged, "recall": round(recall, 2), "extraWords": extra})
    if check_all and k % 500 == 0:
        out.write_text(json.dumps(results, ensure_ascii=False), encoding="utf-8")
        print(f"{len(results)}/{len(sample)}", flush=True)

out.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
for group in (False, True):
    rs = [r for r in results if r["flagged"] == group]
    if not rs:
        continue
    good = sum(r["recall"] >= 0.7 and r["extraWords"] <= 3 for r in rs)
    print(f"{'flagged' if group else 'random'}: {good}/{len(rs)} clips hold their verse cleanly")
    for r in sorted(rs, key=lambda r: r["recall"])[:8]:
        print("   ", r)
