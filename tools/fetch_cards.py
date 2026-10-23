import json, sys, urllib.request
BASE = "https://api.riftcodex.com/cards"
items, page = [], 1
while True:
    req = urllib.request.Request(f"{BASE}?size=100&page={page}&sort=set_id", headers={"User-Agent": "riftscan-dev"})
    d = json.load(urllib.request.urlopen(req))
    items += d["items"]
    print(page, d["pages"], len(items), file=sys.stderr)
    if page >= d["pages"]: break
    page += 1
json.dump(items, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False)
