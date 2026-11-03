"""Build data/myp.json: MYP Cards prices and deck labels, keyed by TCGplayer productId (the `t` in cards.json).

    python tools/sync_myp.py          # pages GET /riftbound/precos on the real API
    python tools/sync_myp.py --mock   # fake data derived from cards.json/prices.json, for demos while access is pending

Token: MYP_API_TOKEN in the environment or in a .env.local file at the repo root (untracked). It is optional
but raises the limit from 10 to 60 requests/minute. MYP_BASE_URL overrides the server (used by the tests).

/precos lists only cards that have stock for sale, so cards without stock are missing from the file; the app falls
back to TCGplayer prices for them. Rows are matched by `tcg_productId`; rows without one are counted and skipped.
"""
import json, os, sys, time, urllib.error, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'myp.json'
BASE = os.environ.get('MYP_BASE_URL', 'https://mypcards.com/api/v1')
MOCK_RATE = 5.5  # BRL per USD, mock only


def token():
    t = os.environ.get('MYP_API_TOKEN')
    env = ROOT / '.env.local'
    if not t and env.exists():
        for line in env.read_text(encoding='utf-8').splitlines():
            if line.startswith('MYP_API_TOKEN='):
                t = line.split('=', 1)[1].strip().strip('"\'')
    return t or ''


def num(v):
    return None if v in (None, '') else float(v)


def compact(p):
    labels = p.get('deck_labels') or []
    return {'ic': p['internal_code'], 'min': num(p.get('min_price')), 'avg': num(p.get('avg_price')),
            'label': labels[0] if labels else None, 'link': p.get('link')}


def get(path, tok):
    req = urllib.request.Request(BASE + path, headers={'Accept': 'application/json', **({'X-Api-Token': tok} if tok else {})})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r), r.headers
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 15 * (attempt + 1)
                print(f'  rate limited, waiting {wait}s', file=sys.stderr)
                time.sleep(wait)
                continue
            body = e.read()[:200]
            if e.code == 403 and b'<html' in body.lower():
                sys.exit('403 from Cloudflare (HTML challenge), not from the API. Ask MYP to allow API clients.')
            sys.exit(f'HTTP {e.code} on {path}: {body!r}')
    sys.exit('gave up after repeated 429s')


def sync():
    tok = token()
    # Be gentle: 10/min without a token, 60/min with one. Header X-Rate-Limit-Remaining refines this below.
    pause = 1.1 if tok else 6.5
    rows, skipped, page = {}, 0, 1
    while True:
        data, headers = get(f'/riftbound/precos?page_number={page}&page_size=50', tok)
        cards = data.get('cards') or []
        if not cards:
            break
        for p in cards:
            tid = p.get('tcg_productId')
            if tid is None:
                skipped += 1
            else:
                rows[str(tid)] = compact(p)
        print(f'page {page}: {len(cards)} cards ({len(rows)} matched so far)', file=sys.stderr)
        page += 1
        remaining = headers.get('X-Rate-Limit-Remaining')
        time.sleep(pause if remaining is None or int(remaining) < 3 else 0.2)
    if skipped:
        print(f'{skipped} rows had no tcg_productId and were skipped', file=sys.stderr)
    return {'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'mock': False, 'p': rows}


def mock():
    cards = json.loads((ROOT / 'data' / 'cards.json').read_text(encoding='utf-8'))['cards']
    prices = json.loads((ROOT / 'data' / 'prices.json').read_text(encoding='utf-8'))['p']
    rows = {}
    for i, c in enumerate(cards):
        if not c.get('t'):
            continue
        usd = (prices.get(c['t']) or [None, None])[0]
        brl = round(usd * MOCK_RATE * 1.15, 2) if usd else None  # pretend MYP is a bit above TCGplayer
        rows[c['t']] = {'ic': 900000 + i, 'min': brl, 'avg': round(brl * 1.2, 2) if brl else None,
                        'label': f"{c['n']} [{c['s']}] {c['c']}", 'link': 'https://mypcards.com/riftbound'}
    return {'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'mock': True, 'p': rows}


if __name__ == '__main__':
    out = mock() if '--mock' in sys.argv else sync()
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f"wrote {OUT.relative_to(ROOT)}: {len(out['p'])} cards{' (MOCK)' if out['mock'] else ''}")
