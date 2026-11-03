"""Shared price code for the Riftbound (TCGplayer category 89) data: build_data.py, update_prices.py and backfill_history.py.

One mapping, one price field, one date convention, so the card screen, prices.json and the history agree:

- product -> card: a card owns its own TCGplayer product id (`t`) and any alternate product ids (`a`); an alternate
  product's price counts for the owner only when the owner has none of its own for that finish.
- price: `marketPrice` only. No fallback to `midPrice`: a card flipping between the two fields would show a move that
  never happened. A missing marketPrice is None.
- date: a snapshot is keyed by the date TCGCSV published it (its daily 20:00 UTC run), the same date as the archive file
  `archive/tcgplayer/prices-YYYY-MM-DD.ppmd.7z`, never by the day this script happens to run.
"""
import json, shutil, tempfile, time, urllib.error, urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATEGORY = 89
BASE = "https://tcgcsv.com/tcgplayer"
ARCHIVE = "https://tcgcsv.com/archive/tcgplayer/prices-{date}.ppmd.7z"
HISTORY_DAYS = 90
DOWNLOAD_TRIES = 7  # the one-off backfill raises this: the archive host can refuse for a long while
MIN_FRESH_SHARE = 0.8  # share of groups that must carry the newest publish date


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "riftscan-build"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def load_cards():
    return json.load(open(ROOT / "data" / "cards.json", encoding="utf-8"))["cards"]


def owner_map(cards):
    """productId (str) -> the `t` of the card that owns it."""
    owner = {c["t"]: c["t"] for c in cards if c.get("t")}
    for c in cards:
        if not c.get("t"):  # a card with no product id of its own owns nothing
            continue
        for a in c.get("a", []):
            owner.setdefault(str(a), c["t"])
    return owner


def rows_from_results(results, owner, out=None):
    """Fold one group's price rows into {t: [normal, foil]} (dollars, marketPrice only)."""
    out = {} if out is None else out
    for r in results:
        pid = str(r["productId"])
        if pid not in owner or r.get("marketPrice") is None:
            continue
        slot = 1 if r["subTypeName"] == "Foil" else 0
        row = out.setdefault(owner[pid], [None, None])
        if row[slot] is None or pid == owner[pid]:  # the card's own product beats its alternates
            row[slot] = round(r["marketPrice"], 2)
    return out


def live_snapshot(owner):
    """Today's prices from the live API: ({t: [normal, foil]}, publish date, publish timestamp).
    Refuses a mixed answer: if the groups carry different publish dates the run landed in the middle of TCGCSV's daily
    refresh, and storing it would mix two days."""
    prices, stamps = {}, []
    for g in get(f"{BASE}/{CATEGORY}/groups")["results"]:
        req = urllib.request.Request(f"{BASE}/{CATEGORY}/{g['groupId']}/prices", headers={"User-Agent": "riftscan-build"})
        with urllib.request.urlopen(req, timeout=60) as r:
            lm = r.headers.get("Last-Modified")
            body = json.load(r)
        if lm:
            stamps.append(parsedate_to_datetime(lm))
        rows_from_results(body["results"], owner, prices)
    newest = max(stamps) if stamps else None
    # A lone group can lag a day (a bundle with 15 cards did on 2026-11-02), which is harmless. Most groups on an older
    # date means the run landed in the middle of the refresh, so refuse rather than store a mixed day.
    on_newest = sum(1 for t in stamps if data_date(t) == data_date(newest))
    if stamps and on_newest / len(stamps) < MIN_FRESH_SHARE:
        raise SystemExit(f"TCGCSV looks mid-refresh ({on_newest} of {len(stamps)} groups on {data_date(newest)}); run again in a few minutes.")
    return prices, data_date(newest), (newest.astimezone(timezone.utc).isoformat(timespec="seconds") if newest else None)


def data_date(last_modified):
    """The publish date of a live response: TCGCSV refreshes at ~20:00 UTC and names that day's archive by that date."""
    if last_modified is None:
        return datetime.now(timezone.utc).date().isoformat()
    return last_modified.astimezone(timezone.utc).date().isoformat()


# ---------- archives (backfill) ----------
def download(url, dest, tries=None):
    """Fetch url into dest. False when the file does not exist or the host keeps refusing; waits longer after each 429
    (CloudFront rate-limits bursts and sends no Retry-After), and retries server errors."""
    tries = tries or DOWNLOAD_TRIES
    delay = 20
    for attempt in range(tries):
        req = urllib.request.Request(url, headers={"User-Agent": "riftscan-build"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
                shutil.copyfileobj(r, f)
            return True
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                return False
            if e.code != 429 and e.code < 500:
                raise
        except (urllib.error.URLError, TimeoutError):
            pass
        if attempt < tries - 1:
            time.sleep(delay)
            delay = min(delay * 2, 120)
    print(f"  skipped {url}: the host kept refusing, it will be fetched on a later run", flush=True)
    return False


def archive_snapshot(date, owner):
    """{t: [normal, foil]} for one past day, read from that day's archive. Only category 89 is extracted, in a temp dir.
    Needs py7zr (pip install py7zr): the archives are 7z with PPMd, which the stdlib cannot open."""
    try:
        import py7zr
    except ImportError:
        raise SystemExit("py7zr is needed to read the daily archives: pip install py7zr (tools/.venv has it)")
    with tempfile.TemporaryDirectory(prefix="riftscan-arch-") as tmp:
        arc, out = Path(tmp) / "p.7z", Path(tmp) / "x"
        if not download(ARCHIVE.format(date=date), arc):
            return None  # no archive for that day
        prefix = f"{date}/{CATEGORY}/"
        with py7zr.SevenZipFile(arc) as z:
            targets = [n for n in z.getnames() if n.startswith(prefix) and n.endswith("/prices")]
            if not targets:
                return None
            z.extract(path=out, targets=targets)
        prices = {}
        for f in sorted((out / date / str(CATEGORY)).glob("*/prices")):
            rows_from_results(json.load(open(f, encoding="utf-8"))["results"], owner, prices)
        return prices


# ---------- history: append-only daily snapshots are the source of truth, history.json is derived ----------
SNAP_DIR = ROOT / "data" / "snapshots"


def snap_path(date):
    return SNAP_DIR / f"{date}.json"


def write_snapshot(date, prices):
    """One small file per day: {t: [normalCents|None, foilCents|None]}."""
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    doc = {t: [None if v is None else round(v * 100) for v in row] for t, row in sorted(prices.items())}
    snap_path(date).write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")


def read_snapshots():
    snaps = {}
    for f in sorted(SNAP_DIR.glob("*.json")) if SNAP_DIR.exists() else []:
        snaps[f.stem] = json.load(open(f, encoding="utf-8"))
    return snaps


def build_history(snaps, days=HISTORY_DAYS):
    """Columnar and aligned with `dates`, in cents: {"dates": [...], "n": {t: [..]}, "f": {t: [..]}}, newest `days` days."""
    dates = sorted(snaps)[-days:]
    n, f = {}, {}
    for i, d in enumerate(dates):
        for t, (vn, vf) in snaps[d].items():
            if vn is not None:
                n.setdefault(t, [None] * len(dates))[i] = vn
            if vf is not None:
                f.setdefault(t, [None] * len(dates))[i] = vf
    return {"dates": dates, "n": n, "f": f}


def write_history(snaps):
    doc = build_history(snaps)
    (ROOT / "data" / "history.json").write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    return doc


def missing_dates(snaps, upto, days=HISTORY_DAYS):
    """Dates in the last `days` days up to `upto` (inclusive, 'YYYY-MM-DD') that have no snapshot yet."""
    end = datetime.strptime(upto, "%Y-%m-%d").date()
    want = [(end - timedelta(days=i)).isoformat() for i in range(days)]
    return sorted(d for d in want if d not in snaps)
