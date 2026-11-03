"""One-off: fill data/snapshots/ with past days from TCGCSV's daily archives, then rebuild data/history.json.

    tools/.venv/Scripts/python tools/backfill_history.py [--days 90]

Needs py7zr (pip install py7zr). Safe to re-run: days that already have a snapshot are skipped.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prices_lib as L
from update_prices import fill_missing


def main():
    days = int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else L.HISTORY_DAYS
    L.DOWNLOAD_TRIES = 40  # patient: the host rate-limits and recovers in minutes; this can run for hours
    owner = L.owner_map(L.load_cards())
    _, date, _ = L.live_snapshot(owner)  # only to learn the latest publish date
    snaps = L.read_snapshots()
    todo = len(L.missing_dates(snaps, date, days))
    print(f"latest data date {date}; {todo} day(s) to fetch")
    got = fill_missing(snaps, date, owner, days)
    hist = L.write_history(snaps)
    print(f"fetched {got} of {todo}; history now {len(hist['dates'])} days ({hist['dates'][0]} .. {hist['dates'][-1]})")


if __name__ == "__main__":
    main()
