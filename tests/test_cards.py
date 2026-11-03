import json, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import build_data as B

# what TCGCSV would answer: two groups, one already in the app and one new
GROUPS = [
    {"groupId": 1, "abbreviation": "OGN", "name": "Origins", "publishedOn": "2025-10-31T00:00:00"},
    {"groupId": 2, "abbreviation": "NEW", "name": "New Set", "publishedOn": "2027-03-01T00:00:00"},
    {"groupId": 3, "abbreviation": "FUT", "name": "Future Set", "publishedOn": "2027-09-01T00:00:00"},  # no cards yet
]


def product(pid, name, number, rarity="Common", extra=None):
    ext = [{"name": "Rarity", "value": rarity}, {"name": "Domain", "value": "Fury"}, {"name": "Description", "value": "<b>Hi</b>"}]
    if number:  # sealed products (boxes, bundles) carry no card number at all
        ext.insert(0, {"name": "Number", "value": number})
    return {"productId": pid, "name": name, "imageUrl": f"https://x/{pid}_200w.jpg", "extendedData": ext, **(extra or {})}


PRODUCTS = {
    1: [product(100, "Old Card", "001/298"), product(101, "Old Card", "001/298")],  # 101: another TCGplayer product of the same card
    2: [product(200, "Fresh Card", "001/50"), product(201, "Booster Box", "")],  # 201 has no number: sealed product, not a card
    3: [],
}


def fake_get(url):
    if url.endswith("/groups"):
        return {"results": GROUPS}
    gid = int(url.split("/")[-2])
    return {"results": PRODUCTS[gid]}


def seed():
    return {"sets": {"OGN": "Origins"}, "released": {"OGN": "2025-10-31"},
            "cards": [{"id": "ogn-001-298", "n": "Old Card", "s": "OGN", "c": "1", "r": "C", "k": "F", "t": "100", "im": "https://x/100_400w.jpg", "x": ""}]}


class Refresh(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "cards.json"
        self.path.write_text(json.dumps(seed(), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        self.real_get, B.get = B.get, fake_get

    def tearDown(self):
        B.get = self.real_get
        self.tmp.cleanup()

    def load(self):
        return json.loads(self.path.read_text(encoding="utf-8"))

    def test_new_edition_arrives_with_its_cards_and_date(self):
        self.assertTrue(B.refresh_cards(self.path))
        d = self.load()
        self.assertEqual(d["sets"]["NEW"], "New Set")
        self.assertEqual(d["released"]["NEW"], "2027-03-01")
        self.assertEqual([c["n"] for c in d["cards"] if c["s"] == "NEW"], ["Fresh Card"])  # the sealed product is not a card
        self.assertNotIn("FUT", d["sets"])  # a set without cards is not listed, and has no date either
        self.assertNotIn("FUT", d["released"])

    def test_existing_cards_are_kept_and_not_duplicated(self):
        B.refresh_cards(self.path)
        d = self.load()
        olds = [c for c in d["cards"] if c["s"] == "OGN"]
        self.assertEqual(len(olds), 1)
        self.assertEqual(olds[0]["id"], "ogn-001-298")
        self.assertEqual(olds[0]["a"], ["101"])  # the other product is only a price fallback

    def test_second_run_changes_nothing(self):
        self.assertTrue(B.refresh_cards(self.path))
        first = self.path.read_text(encoding="utf-8")
        self.assertFalse(B.refresh_cards(self.path))
        self.assertEqual(self.path.read_text(encoding="utf-8"), first)  # the alternates are not listed again

    def test_a_failed_download_leaves_the_file_alone(self):
        before = self.path.read_text(encoding="utf-8")
        def boom(url): raise OSError("offline")
        B.get = boom
        with self.assertRaises(OSError):
            B.refresh_cards(self.path)
        self.assertEqual(self.path.read_text(encoding="utf-8"), before)

    def test_ids_stay_unique(self):
        PRODUCTS[2].append(product(202, "Fresh Card Again", "001/50"))  # same id pattern as Fresh Card
        try:
            B.refresh_cards(self.path)
        finally:
            PRODUCTS[2].pop()
        ids = [c["id"] for c in self.load()["cards"]]
        self.assertEqual(len(ids), len(set(ids)))


class UniqueIds(unittest.TestCase):
    def test_the_last_card_keeps_a_repeated_id_and_the_others_get_the_product(self):
        cards = [{"id": "x-1", "t": "10"}, {"id": "x-1", "t": "11"}, {"id": "x-1", "t": "12"}, {"id": "y-2", "t": "20"}]
        B.unique_ids(cards)
        self.assertEqual([c["id"] for c in cards], ["x-1-10", "x-1-11", "x-1", "y-2"])  # "x-1" stays on the card the app already resolved it to

    def test_cards_without_a_product_get_a_name_tag_and_never_collide(self):
        cards = [{"id": "v-1", "t": None, "n": "Dune Surfer"}, {"id": "v-1", "t": "", "n": "Dune Surfer"}, {"id": "v-1", "t": "7", "n": "Other"}]
        B.unique_ids(cards)
        ids = [c["id"] for c in cards]
        self.assertEqual(len(set(ids)), 3)
        self.assertEqual(ids[2], "v-1")
        self.assertTrue(all("None" not in i for i in ids))

    def test_nothing_changes_when_ids_are_already_unique(self):
        cards = [{"id": "a", "t": "1"}, {"id": "b", "t": "2"}]
        B.unique_ids(cards)
        B.unique_ids(cards)
        self.assertEqual([c["id"] for c in cards], ["a", "b"])


if __name__ == "__main__":
    unittest.main()
