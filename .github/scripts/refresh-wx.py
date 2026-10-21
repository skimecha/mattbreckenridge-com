#!/usr/bin/env python3
"""Refresh wx/data/reports.json with real METAR, TAF and PIREP reports.

Pulls from the aviationweather.gov data API (which blocks browser CORS,
so the site can't fetch it directly) and merges into the committed corpus
the /wx/ drill app reads. Run by .github/workflows/refresh-wx.yml on a
schedule; safe to run by hand:

    py -3 .github/scripts/refresh-wx.py

Keeps a capped pool per type, preferring reports with teachable content
(precipitation, low ceilings, gusts, TEMPO/PROB groups, turbulence, icing)
so the corpus stays varied even in quiet weather.
"""
import json
import random
import re
import sys
import time
import urllib.request
from pathlib import Path

API = "https://aviationweather.gov/api/data"
OUT = Path(__file__).resolve().parents[2] / "wx" / "data" / "reports.json"

# CONUS split into tiles: the API caps each response at 400 rows.
TILES = [
    "24,-125,37,-110", "37,-125,49,-110",
    "24,-110,37,-95", "37,-110,49,-95",
    "24,-95,37,-80", "37,-95,49,-80",
    "24,-80,37,-66", "37,-80,49,-66",
    "51,-170,72,-130",  # Alaska
    "18,-161,23,-154",  # Hawaii
]
CAPS = {"metars": 600, "tafs": 400, "pireps": 400}
US_PREFIX = ("K", "PA", "PH")


def get(url, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "mattbreckenridge.com wx drills"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            if i == retries - 1:
                raise
            print(f"retry {url}: {e}", file=sys.stderr)
            time.sleep(3)


def is_us(icao):
    return icao.startswith(US_PREFIX)


def metar_score(raw):
    s = 0
    if raw.startswith("SPECI"):
        s += 2
    if re.search(r" (\+|-|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+ ", raw):
        s += 3
    if re.search(r" (FZ|SN|GR|PL|TS|FC)", raw):
        s += 2
    if re.search(r"G\d{2,3}KT", raw):
        s += 1
    if re.search(r" (BKN|OVC)00\d", raw) or " VV0" in raw:
        s += 2
    if re.search(r" \d{3}V\d{3} ", raw):
        s += 1
    if re.search(r" R\d{2}[LRC]?/", raw):
        s += 2
    if re.search(r" (M)?\d/\dSM| M1/4SM", raw):
        s += 2
    if " RMK " in raw:
        s += 1
    if re.search(r"(PK WND|WSHFT|PRESRR|PRESFR|LTG|TSB|TSE|RAB|RAE|SNB|SNE|VIRGA|SNINCR|CIG \d)", raw):
        s += 1
    return s


def taf_score(raw):
    s = 0
    for kw, w in (("TEMPO", 2), ("PROB", 2), ("BECMG", 2), ("WS0", 3), ("VV0", 2), ("CB", 1), ("TS", 1), ("FZ", 2), ("SN", 1), ("FG", 1), ("BR", 1), ("G", 0)):
        if kw in raw:
            s += w
    s += min(raw.count(" FM"), 3)
    return s


def pirep_score(raw):
    s = 0
    if " UUA " in raw:
        s += 3
    for kw, w in (("/TB", 2), ("/IC", 3), ("/SK", 1), ("/WX", 1), ("/TA", 1), ("/WV", 1), ("/RM", 0)):
        if kw in raw and not re.search(re.escape(kw) + r" ?NEG", raw):
            s += w
    if re.search(r"/(TB|IC) ?NEG", raw):
        s -= 1
    return s


def fetch_metars():
    seen = {}
    for bbox in TILES:
        data = json.loads(get(f"{API}/metar?bbox={bbox}&format=json"))
        for ob in data:
            raw = (ob.get("rawOb") or "").strip()
            icao = ob.get("icaoId") or ""
            if not raw or not is_us(icao) or raw in seen:
                continue
            seen[raw] = {"raw": raw, "name": ob.get("name") or icao, "t": int(ob.get("obsTime") or 0)}
    return list(seen.values())


def fetch_tafs():
    seen = {}
    for bbox in TILES:
        data = json.loads(get(f"{API}/taf?bbox={bbox}&format=json"))
        for fc in data:
            raw = re.sub(r"\s+", " ", (fc.get("rawTAF") or "")).strip()
            icao = fc.get("icaoId") or ""
            if not raw or not is_us(icao) or raw in seen:
                continue
            if "INS" in raw and "QNH" in raw:
                continue  # US military format (metric visibility, QNH, TX/TN): not what the FAA written tests
            t = fc.get("issueTime") or ""
            try:
                ts = int(time.mktime(time.strptime(t[:19], "%Y-%m-%dT%H:%M:%S")))
            except Exception:  # noqa: BLE001
                ts = int(time.time())
            seen[raw] = {"raw": raw, "name": fc.get("name") or icao, "t": ts}
    return list(seen.values())


def fetch_pireps():
    text = get(f"{API}/pirep?format=raw&age=12&bbox=20,-170,72,-60")
    now = int(time.time())
    out = {}
    for line in text.splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        if not line:
            continue
        head = line.split(" ", 2)
        if len(head) < 3 or head[1] not in ("UA", "UUA"):
            continue  # AIREP / ARP lines use a different format
        st = head[0]
        if not (len(st) == 3 or (len(st) == 4 and st.startswith(("K", "P")))):
            continue
        if "/OV" not in line or "/TM" not in line:
            continue
        out[line] = {"raw": line, "name": "", "t": now}
    return list(out.values())


def merge(old, new, cap, score):
    pool = {}
    for item in old + new:
        if "QNH" in item["raw"] and "INS" in item["raw"]:
            continue
        pool[item["raw"]] = item
    items = list(pool.values())
    random.shuffle(items)
    # Keep teachable reports first, then newest, so the pool stays varied.
    items.sort(key=lambda x: (score(x["raw"]), x.get("t", 0)), reverse=True)
    keep = items[:cap]
    keep.sort(key=lambda x: x.get("t", 0), reverse=True)
    return keep


def main():
    old = {"metars": [], "tafs": [], "pireps": []}
    if OUT.exists():
        try:
            old.update(json.loads(OUT.read_text(encoding="utf-8")))
        except Exception as e:  # noqa: BLE001
            print(f"ignoring unreadable {OUT}: {e}", file=sys.stderr)

    new = {"metars": fetch_metars(), "tafs": fetch_tafs(), "pireps": fetch_pireps()}
    scores = {"metars": metar_score, "tafs": taf_score, "pireps": pirep_score}
    result = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    for k in ("metars", "tafs", "pireps"):
        result[k] = merge(old.get(k, []), new[k], CAPS[k], scores[k])
        print(f"{k}: fetched {len(new[k])}, pool now {len(result[k])}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, separators=(",", ":"), ensure_ascii=True) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
