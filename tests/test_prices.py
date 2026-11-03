import sys, unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import prices_lib as L

CARDS = [{"t": "100", "a": [101]}, {"t": "200"}]


def row(pid, market, sub="Normal", mid=9.99):
    return {"productId": pid, "marketPrice": market, "midPrice": mid, "subTypeName": sub}


class Prices(unittest.TestCase):
    def test_owner_map_includes_alternate_products(self):
        self.assertEqual(L.owner_map(CARDS), {"100": "100", "101": "100", "200": "200"})

    def test_card_without_its_own_product_id_owns_nothing(self):
        owner = L.owner_map([{"t": "", "a": [300]}, {"t": None, "a": [301]}, {"t": "100"}])
        self.assertEqual(owner, {"100": "100"})
        self.assertNotIn(None, owner.values())

    def test_market_price_only_never_mid(self):
        out = L.rows_from_results([row(100, None, mid=5.0), row(200, 1.234)], L.owner_map(CARDS))
        self.assertNotIn("100", out)  # no marketPrice -> no price, even though midPrice exists
        self.assertEqual(out["200"], [1.23, None])

    def test_own_product_beats_alternate_for_the_same_finish(self):
        owner = L.owner_map(CARDS)
        a = L.rows_from_results([row(101, 7.0), row(100, 3.0)], owner)
        b = L.rows_from_results([row(100, 3.0), row(101, 7.0)], owner)
        self.assertEqual(a["100"], [3.0, None])
        self.assertEqual(b["100"], [3.0, None])  # order of the rows does not matter
        self.assertEqual(L.rows_from_results([row(101, 7.0)], owner)["100"], [7.0, None])  # alternate fills when alone

    def test_foil_goes_to_the_second_slot(self):
        out = L.rows_from_results([row(100, 2.0), row(100, 9.5, "Foil")], L.owner_map(CARDS))
        self.assertEqual(out["100"], [2.0, 9.5])

    def test_history_is_columnar_aligned_and_in_cents(self):
        snaps = {"2026-11-01": {"100": [200, None]}, "2026-11-02": {"100": [250, 900], "200": [None, 5]}}
        h = L.build_history(snaps)
        self.assertEqual(h["dates"], ["2026-11-01", "2026-11-02"])
        self.assertEqual(h["n"], {"100": [200, 250]})
        self.assertEqual(h["f"], {"100": [None, 900], "200": [None, 5]})

    def test_history_keeps_only_the_newest_days(self):
        snaps = {f"2026-10-{d:02d}": {"1": [d, d]} for d in range(1, 11)}
        h = L.build_history(snaps, days=3)
        self.assertEqual(h["dates"], ["2026-10-08", "2026-10-09", "2026-10-10"])
        self.assertEqual(h["n"]["1"], [8, 9, 10])

    def test_missing_dates_counts_back_from_the_data_date(self):
        snaps = {"2026-11-02": {}, "2026-11-01": {}}
        self.assertEqual(L.missing_dates(snaps, "2026-11-02", days=4), ["2026-10-30", "2026-10-31"])

    def test_data_date_is_the_publish_date_not_the_run_date(self):
        published = datetime(2026, 11, 2, 20, 0, 19, tzinfo=timezone.utc)
        self.assertEqual(L.data_date(published), "2026-11-02")


if __name__ == "__main__":
    unittest.main()
