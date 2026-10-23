import csv, json, re, sys
cards = json.load(open("tools/cards_raw.json", encoding="utf-8"))
rows = list(csv.DictReader(open(sys.argv[1], encoding="utf-8-sig")))
def num(s):
    m = re.match(r"(\d+)", s); return int(m.group(1)) if m else None
for r in rows:
    sig, n, name = r["Edicao (Sigla)"], r["Card #"], r["Card (EN)"]
    cands = [c for c in cards if c["set"]["set_id"] == sig and c["collector_number"] == num(n)]
    byname = [c for c in cards if c["name"].lower() == name.lower()]
    print(f'{sig} #{n:6} {name!r} rar={r["Raridade"]} cor={r["Cor (C D O E Y F R G L M P W)"] if False else list(r.values())[9]!r} extras={r["Extras"]!r}')
    for c in cands:
        print(f'     by-num : {c["name"]!r} {c["riftbound_id"]} {c["classification"]["rarity"]} {c["classification"]["domain"]} aa={c["metadata"]["alternate_art"]} on={c["metadata"]["overnumbered"]} sig={c["metadata"]["signature"]}')
    if not cands:
        for c in byname: print(f'     by-name: {c["name"]!r} {c["set"]["set_id"]} {c["riftbound_id"]} #{c["collector_number"]}')
        if not byname: print("     NOT FOUND")
