#!/usr/bin/env python3
"""Fetch YouTube auto-captions + metadata for videos.txt and write <id>.md transcripts.
Usage: python3 fetch.py            (uses uvx yt-dlp; no project dependency)
Output: raw/<id>.en.json3, raw/<id>.info.json, <group>/<id>.md
"""
import json, re, subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).parent
RAW = HERE / "raw"
RAW.mkdir(exist_ok=True)

videos = []
for line in (HERE / "videos.txt").read_text().splitlines():
    if not line.strip() or line.startswith("#"):
        continue
    vid, group, title = [p.strip() for p in line.split("|", 2)]
    videos.append((vid, group, title))


def fetch(vid: str) -> None:
    have = lambda ext: (RAW / f"{vid}.en.{ext}").exists()
    if (have("json3") or have("vtt")) and (RAW / f"{vid}.info.json").exists():
        return
    base = ["uvx", "yt-dlp", "--skip-download", "--write-auto-subs", "--write-subs", "--sub-langs", "en",
            "--write-info-json", "--no-warnings", "-o", str(RAW / "%(id)s.%(ext)s")]
    url = f"https://www.youtube.com/watch?v={vid}"
    # Web client → json3. On 429 (timedtext rate limit) the android client + vtt usually still works.
    attempts = [base + ["--sub-format", "json3", url],
                base + ["--sub-format", "vtt", "--extractor-args", "youtube:player_client=android", url]]
    for cmd in attempts:
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0:
            break
        print(f"{vid}: yt-dlp failed: {r.stderr.strip().splitlines()[-1][:160]}", file=sys.stderr)
        time.sleep(10)
    time.sleep(2)


def fmt(ms: int) -> str:
    s = ms // 1000
    return f"{s // 60}:{s % 60:02d}"


def read_events(vid: str) -> list[tuple[int, str]] | None:
    """Return [(start_ms, text)] from json3 or vtt captions, or None."""
    j3 = RAW / f"{vid}.en.json3"
    if j3.exists():
        out = []
        for e in json.loads(j3.read_text())["events"]:
            if "segs" not in e:
                continue
            out.append((e.get("tStartMs", 0), "".join(s.get("utf8", "") for s in e["segs"])))
        return out
    vtt = RAW / f"{vid}.en.vtt"
    if not vtt.exists():
        return None
    # YouTube auto-VTT is roll-up: each cue = previous cue's last line + one new line (with <c> word tags).
    out, last = [], ""
    for block in vtt.read_text().split("\n\n"):
        lines = [l for l in block.splitlines() if l.strip()]
        if not lines or "-->" not in lines[0]:
            continue
        h, m, s = lines[0].split(" --> ")[0].split(":")
        start = int((int(h) * 3600 + int(m) * 60 + float(s)) * 1000)
        texts = [re.sub(r"<[^>]+>", "", l).strip() for l in lines[1:]]
        texts = [t for t in texts if t]
        new = [t for t in texts if t != last]
        if new:
            out.append((start, " ".join(new)))
            last = texts[-1]
    return out


def convert(vid: str, group: str, title: str) -> None:
    info = RAW / f"{vid}.info.json"
    events = read_events(vid)
    if events is None:
        print(f"{vid}: no captions", file=sys.stderr)
        return
    meta = json.loads(info.read_text()) if info.exists() else {}
    # Merge into ~30s paragraphs with a timestamp each.
    paras, cur, start = [], [], None
    for t, text in events:
        text = text.replace("\n", " ").strip()
        if not text:
            continue
        if start is None:
            start = t
        cur.append(text)
        if t - start >= 30000:
            paras.append((start, " ".join(cur)))
            cur, start = [], None
    if cur:
        paras.append((start, " ".join(cur)))
    out = [f"# {meta.get('title', title)}", "",
           f"- id: {vid}", f"- channel: {meta.get('channel') or meta.get('uploader', '')}",
           f"- date: {meta.get('upload_date', '')}", f"- duration: {fmt((meta.get('duration') or 0) * 1000)}",
           f"- url: https://www.youtube.com/watch?v={vid}", ""]
    if meta.get("chapters"):
        out.append("## Chapters")
        out += [f"- {fmt(int(c['start_time'] * 1000))} {c['title']}" for c in meta["chapters"]]
        out.append("")
    out.append("## Transcript")
    out += [f"[{fmt(t)}] {re.sub(r'\s+', ' ', p)}" for t, p in paras]
    d = HERE / group
    d.mkdir(exist_ok=True)
    (d / f"{vid}.md").write_text("\n".join(out) + "\n")
    print(f"{group}/{vid}.md  {len(paras)} paras  {meta.get('duration', '?')}s  chapters={len(meta.get('chapters') or [])}")


for vid, group, title in videos:
    fetch(vid)
    convert(vid, group, title)
