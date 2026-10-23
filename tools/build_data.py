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


def norm_name(n):
    return re.sub(r"[^a-z0-9]+", " ", n.lower()).strip()


def strip_html(h):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h or "")).strip()


def add_tcgcsv_cards(out, sets, base_rar):
    """Cards that Riftcodex does not have yet (new sets, new promos), taken from TCGCSV product data."""
    known = {c["t"] for c in out}
    by_key = {(c["s"], c["c"].lower(), norm_name(c["n"])): c for c in out}
    added = {}
    for g in get("https://tcgcsv.com/tcgplayer/89/groups")["results"]:
        sigla = LIGA_SET.get(g["abbreviation"], g["abbreviation"])
        for p in get(f"https://tcgcsv.com/tcgplayer/89/{g['groupId']}/products")["results"]:
            ext = {e["name"]: e["value"] for e in p.get("extendedData", [])}
            if "Number" not in ext or str(p["productId"]) in known:
                continue
            num, _, total = ext["Number"].partition("/")
            name = p["name"].strip()
            alt = "(Alternate Art)" in name
            m = re.match(r"^0*(\d+)(.*)$", num)
            c = (m.group(1) + m.group(2)) if m else num
            key = (sigla, c.lower(), norm_name(name))
            if key in by_key:  # same card, another TCGplayer product: keep it only as a price fallback
                by_key[key].setdefault("a", []).append(str(p["productId"]))
                continue
            rar = RARITY.get(ext.get("Rarity", ""))
            if not rar and ext.get("Rarity") == "Showcase" and alt:
                rar = "AA"
            rar = rar or base_rar.get(clean(name), "")
            doms = [d.strip() for d in ext.get("Domain", "").split(";") if d.strip()]
            card = {
                "id": f"{g['abbreviation'].lower()}-{num.lower()}-{total or '0'}", "n": name, "s": sigla,
                "c": c.upper() if (alt or not m) else c, "r": rar,
                "k": COLOR.get(doms[0], "") if len(doms) == 1 else "",
                "t": str(p["productId"]), "im": p["imageUrl"].replace("_200w", "_400w"),
                "x": strip_html(ext.get("Description"))[:260],
            }
            out.append(card)
            by_key[key] = card
            sets[sigla] = g["name"]
            added[sigla] = added.get(sigla, 0) + 1
    print("from TCGCSV:", added)


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
    add_tcgcsv_cards(out, sets, base_rar)
    out.sort(key=lambda x: (x["s"], x["id"]))
    json.dump({"sets": sets, "cards": out}, open(ROOT / "data" / "cards.json", "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print("cards", len(out), "sets", sorted(sets))


def build_prices():
    cards = json.load(open(ROOT / "data" / "cards.json", encoding="utf-8"))["cards"]
    owner = {c["t"]: c["t"] for c in cards}
    for c in cards:
        for a in c.get("a", []):
            owner.setdefault(a, c["t"])
    known = set(owner)
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
            row = prices.setdefault(owner[pid], [None, None])
            if row[slot] is None or pid == owner[pid]:  # the card's own product beats its alternates
                row[slot] = round(v, 2)
    doc = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "p": prices}
    json.dump(doc, open(ROOT / "data" / "prices.json", "w"), separators=(",", ":"))
    print("prices", len(prices), "of", len(cards), "cards")


if __name__ == "__main__":
    flags = set(sys.argv[1:]) or {"--cards", "--prices"}
    if "--cards" in flags: build_cards()
    if "--prices" in flags: build_prices()
