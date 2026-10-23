"""Builds data/cards.json (Riftcodex) and data/prices.json (TCGCSV) for the app.

Usage: python tools/build_data.py [--cards] [--prices]
No flag builds both. cards_raw.json is cached by tools/fetch_cards.py.
"""
import json, re, sys, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RARITY = {"Common": "C", "Uncommon": "U", "Rare": "R", "Epic": "E"}
COLOR = {"Body": "B", "Calm": "C", "Fury": "F", "Mind": "M", "Order": "O", "Chaos": "H"}
LIGA_SET = {"OPP": "ROPP"}  # Riftcodex set id -> Liga edition code


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "riftscan-build"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def number(rid, alt):
    mid = rid.split("-")[1]
    m = re.match(r"^0*(\d+)(.*)$", mid)
    n = (m.group(1) + m.group(2)) if m else mid
    return n.upper() if (alt or not m) else n


def clean(name):
    return re.sub(r"\s*\(.*?\)\s*$", "", name).strip().lower()


def build_cards():
    raw = json.load(open(ROOT / "tools" / "cards_raw.json", encoding="utf-8"))
    best = {}
    for c in raw:  # Riftcodex repeats cards; keep the most descriptive record per id
        k = c["riftbound_id"]
        score = (len(c["name"]), c["metadata"]["alternate_art"] or c["metadata"]["overnumbered"])
        if k not in best or score > best[k][0]:
            best[k] = (score, c)
    cards = [v[1] for v in best.values()]
    base_rar = {}
    for c in cards:
        r = RARITY.get(c["classification"]["rarity"])
        if r:
            base_rar.setdefault(clean(c["name"]), r)
    sets, out = {}, []
    for c in cards:
        sid = c["set"]["set_id"]
        sigla = LIGA_SET.get(sid, sid)
        sets[sigla] = c["set"]["label"]
        m, cl = c["metadata"], c["classification"]
        rar = "AA" if (cl["rarity"] == "Showcase" and m["alternate_art"]) else \
            RARITY.get(cl["rarity"]) or base_rar.get(clean(c["name"]), "")
        dom = cl["domain"]
        out.append({
            "id": c["riftbound_id"], "n": c["name"], "s": sigla,
            "c": number(c["riftbound_id"], m["alternate_art"]), "r": rar,
            "k": COLOR.get(dom[0], "") if len(dom) == 1 else "",
            "t": c["tcgplayer_id"], "im": c["media"]["image_url"].split("?")[0],
            "x": re.sub(r"\s+", " ", re.sub(r":rb_\w+:", " ", c["text"]["plain"] or "")).strip()[:260],  # rules text, used to recognise photos
        })
    out.sort(key=lambda x: (x["s"], x["id"]))
    json.dump({"sets": sets, "cards": out}, open(ROOT / "data" / "cards.json", "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print("cards", len(out), "sets", sorted(sets))


def build_prices():
    known = {c["t"] for c in json.load(open(ROOT / "data" / "cards.json", encoding="utf-8"))["cards"]}
    prices = {}
    for g in get("https://tcgcsv.com/tcgplayer/89/groups")["results"]:
        for r in get(f"https://tcgcsv.com/tcgplayer/89/{g['groupId']}/prices")["results"]:
            pid = str(r["productId"])
            if pid not in known:
                continue
            v = r["marketPrice"] if r["marketPrice"] is not None else r["midPrice"]
            if v is None:
                continue
            slot = 1 if r["subTypeName"] == "Foil" else 0
            prices.setdefault(pid, [None, None])[slot] = round(v, 2)
    doc = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "p": prices}
    json.dump(doc, open(ROOT / "data" / "prices.json", "w"), separators=(",", ":"))
    print("prices", len(prices), "of", len(known))


if __name__ == "__main__":
    flags = set(sys.argv[1:]) or {"--cards", "--prices"}
    if "--cards" in flags: build_cards()
    if "--prices" in flags: build_prices()
