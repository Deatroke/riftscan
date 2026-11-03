"""Daily price update: today's TCGplayer prices (via TCGCSV) -> data/snapshots/, data/history.json, data/prices.json.

    python tools/update_prices.py [--no-catchup]

Run once a day, after TCGCSV's 20:00 UTC refresh (the GitHub workflow does it at 21:15 UTC). Idempotent: running twice
the same day rewrites the same snapshot. It also fills days it missed (up to the last 7) from the daily archives.
The snapshot is keyed by the date TCGCSV published, see prices_lib.py.
"""
import json, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prices_lib as L

CATCH_UP_DAYS = 7
PAUSE_S = 6  # between archive downloads


def fill_missing(snaps, upto, owner, days):
    """Fetch the archives for days without a snapshot, one at a time with a pause (the archive host rate-limits
    bursts). Each day is written the moment it arrives, so an interrupted run keeps its progress."""
    got = 0
    for d in sorted(L.missing_dates(snaps, upto, days), reverse=True):  # newest first: those matter most
        prices = L.archive_snapshot(d, owner)
        if prices:
            L.write_snapshot(d, prices)
            snaps[d] = {t: [None if v is None else round(v * 100) for v in row] for t, row in prices.items()}
            got += 1
            L.write_history(snaps)  # keep history.json usable while a long backfill is still running
            print(f"  {d}: {len(prices)} cards", flush=True)
        time.sleep(PAUSE_S)
    return got


def main():
    owner = L.owner_map(L.load_cards())
    prices, date, stamp = L.live_snapshot(owner)
    L.write_snapshot(date, prices)
    snaps = L.read_snapshots()
    caught = 0 if "--no-catchup" in sys.argv else fill_missing(snaps, date, owner, CATCH_UP_DAYS)
    hist = L.write_history(snaps)

    doc = {"updated": stamp, "date": date, "p": prices}
    (L.ROOT / "data" / "prices.json").write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")

    # the number the card screen shows must be the last history point, or the Preços page and the card would disagree
    assert hist["dates"][-1] == date, (hist["dates"][-1], date)
    for t, (n, f) in prices.items():
        for col, v in (("n", n), ("f", f)):
            last = hist[col].get(t, [None])[-1]
            assert (last is None and v is None) or (last is not None and v is not None and abs(last - round(v * 100)) <= 0), (t, col, last, v)
    print(f"{date}: {len(prices)} cards priced, {caught} missed day(s) filled, history {len(hist['dates'])} days")


if __name__ == "__main__":
    main()
