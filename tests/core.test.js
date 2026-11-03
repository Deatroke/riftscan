'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');
const MYP = require('../myp.js');

const mem = (init = {}) => {
  const d = { ...init };
  return { getItem: k => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: k => { delete d[k]; }, d };
};
const CARDS = {
  a: { n: 'Abandon', s: 'OGN', c: '12', r: 'C', k: 'F' },
  b: { n: 'Zed, Shadow', s: 'OGN', c: '99', r: 'R', k: 'M' },
  m: { n: 'Manual Card', s: 'ROPP', c: 'R04', r: '', k: '' },
};
const cardOf = it => CARDS[it.id];
const item = (id, qty, over = {}) => ({ id, qty, foil: false, q: 'NM', lang: 'EN', ...over });

test('first run migrates the legacy list into a default collection and drops the old key', () => {
  const st = mem({ [Core.LEGACY_LIST_KEY]: JSON.stringify([item('a', 2)]) });
  const store = Core.loadStore(st);
  assert.equal(store.items.length, 1);
  assert.equal(store.items[0].name, Core.DEFAULT_NAME);
  assert.deepEqual(store.items[0].list, [item('a', 2)]);
  assert.equal(st.getItem(Core.LEGACY_LIST_KEY), null);
  assert.deepEqual(Core.loadStore(st), store); // second load reads the saved store
});

test('corrupt storage falls back to an empty default collection', () => {
  const store = Core.loadStore(mem({ [Core.STORE_KEY]: '{nope', [Core.LEGACY_LIST_KEY]: '[[' }));
  assert.equal(store.items.length, 1);
  assert.deepEqual(store.items[0].list, []);
});

test('collections: add, rename, duplicate (deep copy), delete never leaves zero', () => {
  const store = Core.loadStore(mem());
  const first = store.items[0];
  first.list.push(item('a', 1));
  const dup = Core.duplicateCollection(store, first.id);
  dup.list[0].qty = 9;
  assert.equal(first.list[0].qty, 1);
  assert.equal(store.active, dup.id);
  Core.renameCollection(store, dup.id, '  Trocas   2026 ');
  assert.equal(dup.name, 'Trocas 2026');
  Core.renameCollection(store, dup.id, '   '); // blank names are ignored
  assert.equal(dup.name, 'Trocas 2026');
  Core.deleteCollection(store, dup.id);
  assert.equal(store.active, first.id);
  Core.deleteCollection(store, first.id);
  assert.equal(store.items.length, 1);
  assert.deepEqual(store.items[0].list, []);
  assert.equal(Core.activeOf(store).id, store.active);
});

test('Liga CSV keeps the header, sorts, and quotes cells', () => {
  const csv = Core.ligaCsv([item('b', 1), item('a', 3, { foil: true })], cardOf, { OGN: 'Origins' });
  const lines = csv.trimEnd().split('\n');
  assert.equal(lines[0], Core.LIGA_HEADER.map(Core.csvCell).join(','));
  assert.equal(lines[1], ',Origins,OGN,,Abandon,3,NM,EN,C,F,Foil,12,,');
  assert.equal(lines[2], ',Origins,OGN,,"Zed, Shadow",1,NM,EN,R,M,,99,,');
});

test('MYP decklist uses the exact label, merges rows, and counts name-only fallbacks', () => {
  const labels = { a: { label: 'Abandon [OGN] 12' }, b: null };
  const out = Core.mypDecklist([item('a', 2), item('a', 1, { foil: true }), item('b', 4)], cardOf, it => labels[it.id]);
  assert.equal(out.text, '3 Abandon [OGN] 12\n4 Zed, Shadow');
  assert.equal(out.lines, 2);
  assert.equal(out.fallback, 1);
});

test('names export modes', () => {
  const list = [item('a', 2), item('b', 1)];
  assert.equal(Core.namesText(list, cardOf, 'repeat'), 'Abandon\nAbandon\nZed, Shadow');
  assert.equal(Core.namesText(list, cardOf, 'prefix'), '2 Abandon\n1 Zed, Shadow');
  assert.equal(Core.namesText([...list, item('a', 1, { foil: true })], cardOf, 'once'), 'Abandon\nZed, Shadow');
});

/* ---------- MYP client against a stubbed fetch ---------- */
const reply = (status, body, headers = {}) => ({
  ok: status < 200 || status >= 300 ? false : true, status,
  headers: { get: k => headers[k] ?? null },
  json: async () => { if (body === undefined) throw new SyntaxError('not json'); return body; },
});

test('client sends the token only when set, Base64-encodes the code, tracks rate headers', async () => {
  const calls = [];
  MYP.configure({ token: '', fetch: async (url, init) => { calls.push([url, init.headers]); return reply(200, { cards: [] }, { 'X-Rate-Limit-Limit': '10', 'X-Rate-Limit-Remaining': '9' }); } });
  await MYP.byCode('LOB-001');
  assert.ok(calls[0][0].endsWith('/riftbound/precos/TE9CLTAwMQ%3D%3D'));
  assert.equal(calls[0][1]['X-Api-Token'], undefined);
  assert.deepEqual({ ...MYP.rate }, { limit: 10, remaining: 9 });
  MYP.configure({ token: 'abc' });
  await MYP.product(12345);
  assert.equal(calls[1][1]['X-Api-Token'], 'abc');
});

test('client maps API errors, 429 and the Cloudflare HTML challenge to stable codes', async () => {
  const mk = r => MYP.configure({ fetch: async () => r });
  mk(reply(404, { error: 'x', code: 'card_not_found', status: 404 }));
  await assert.rejects(MYP.byCode('NOPE-1'), e => e.code === 'card_not_found' && e.status === 404);
  mk(reply(429, { error: 'x', code: 'rate_limited', status: 429 }));
  await assert.rejects(MYP.pricePage(1), e => e.code === 'rate_limited');
  mk(reply(403, undefined));
  await assert.rejects(MYP.pricePage(1), e => e.code === 'blocked');
  MYP.configure({ fetch: async () => { throw new TypeError('offline'); } });
  await assert.rejects(MYP.pricePage(1), e => e.code === 'network');
});

test('compact() keeps the first deck label and parses string prices', () => {
  assert.deepEqual(MYP.compact({ internal_code: 7, min_price: '15.00', avg_price: null, deck_labels: ['A [X] 1', 'B'], link: 'https://mypcards.com/x' }),
    { ic: 7, min: 15, avg: null, label: 'A [X] 1', link: 'https://mypcards.com/x' });
  assert.equal(MYP.compact({ internal_code: 8, deck_labels: [] }).label, null);
});

test('links from the API only survive as http(s), because they become an href', () => {
  assert.equal(MYP.webUrl('https://mypcards.com/x'), 'https://mypcards.com/x');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'JaVaScRiPt:alert(1)', '/relative', '', null, undefined]) assert.equal(MYP.webUrl(bad), null, String(bad));
  assert.equal(MYP.compact({ internal_code: 9, link: 'javascript:alert(1)' }).link, null);
});

/* ---------- set completion ---------- */
const CAT = [
  { id: 'xyz-1-4', s: 'XYZ', c: '1', r: 'C' }, { id: 'xyz-2-4', s: 'XYZ', c: '2', r: 'C' },
  { id: 'xyz-3-4', s: 'XYZ', c: '3', r: 'R' }, { id: 'xyz-4-4', s: 'XYZ', c: '4', r: 'E' },
  { id: 'xyz-2a-4', s: 'XYZ', c: '2A', r: 'AA' }, { id: 'xyz-5-4', s: 'XYZ', c: '5', r: 'E' }, // 5 is overnumbered
  { id: 'prm-1-9', s: 'PRM', c: '1', r: 'R' }, { id: 'prm-2-7', s: 'PRM', c: '2', r: 'R' },
];
// the real sets are 20+ cards; build one so the "total >= 20" rule is satisfied
const BIG = Array.from({ length: 20 }, (_, i) => ({ id: `big-${i + 1}-20`, s: 'BIG', c: String(i + 1), r: i < 12 ? 'C' : i < 17 ? 'U' : i < 19 ? 'R' : 'E' }));
const catalog = [...CAT, ...BIG];
const byId = Object.fromEntries(catalog.map(c => [c.id, c]));
const cardById = it => byId[it.id];

test('setMeta: a numbered set gets its printed size, tiny and mixed-size sets count only', () => {
  const meta = Core.setMeta(catalog);
  assert.equal(meta.BIG.total, 20);
  assert.equal(meta.XYZ.total, null); // size 4 < 20 is treated as a promo-style set
  assert.equal(meta.PRM.total, null);
});

test('completion: base numbers only, foil and duplicates collapse, A variants do not count', () => {
  const meta = Core.setMeta(catalog);
  const list = [item('big-1-20', 2), item('big-1-20', 1, { foil: true }), item('big-13-20', 1), item('big-20-20', 1), item('xyz-2a-4', 1), item('prm-1-9', 3)];
  const out = Core.completion(list, cardById, meta);
  const big = out.find(o => o.set === 'BIG');
  assert.equal(big.owned, 3);
  assert.equal(big.total, 20);
  assert.equal(big.pct, 0.15);
  assert.deepEqual(big.byRarity, { C: { owned: 1, total: 12 }, U: { owned: 1, total: 5 }, R: { owned: 0, total: 2 }, E: { owned: 1, total: 1 } });
  assert.equal(big.copies, 5);
  const prm = out.find(o => o.set === 'PRM');
  assert.deepEqual([prm.total, prm.owned, prm.pct, prm.byRarity], [null, 1, null, null]);
  assert.equal(out[0].set, 'BIG'); // sets with a percentage come first
  assert.equal(Core.completion([], cardById, meta).length, 0);
});

/* ---------- price variation ---------- */
// five days; one missing calendar day (11-03) to exercise the "nearest snapshot on or before" rule
const H = {
  dates: ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-04'],
  n: {
    UP: [1000, 1000, 1000, 1000, 1200],          // +20% over 2 days
    DOWN: [5000, 5000, 5000, 4000, 3000],        // falls
    NEW: [null, null, null, null, 500],          // priced for the first time
    GONE: [800, 800, 800, 800, null],            // no price now: left out
    PENNY: [10, 10, 10, 10, 20],                 // +100% but only cents
    CRASH: [5000, 5000, 5000, 5000, 60],         // US$50 -> US$0.60
  },
  f: { UP: [2000, 2000, 2000, 2000, 1000] },
};
const byT = rows => Object.fromEntries(rows.map(r => [r.t, r]));

test('variation: one-day window compares with the nearest snapshot on or before the target date', () => {
  const v = Core.variation(H, { days: 1 }); // target 11-03 has no snapshot -> base is 11-02
  assert.equal(v.latest, '2026-11-04');
  assert.equal(v.base, '2026-11-02');
  const r = byT(v.rows);
  assert.equal(r.UP.pct, 20);
  assert.equal(r.UP.abs, 200);
  assert.equal(r.DOWN.pct, -25);
  assert.equal(r.GONE, undefined);
});

test('variation: no price on the base date is "new", never an infinite percentage', () => {
  const r = byT(Core.variation(H, { days: 7 }).rows); // target 10-28 is before the first snapshot -> not covered
  assert.deepEqual(r, {});
  const n = byT(Core.variation(H, { days: 2 }).rows); // target 11-02
  assert.equal(n.NEW.isNew, true);
  assert.equal(n.NEW.pct, null);
  assert.equal(n.NEW.prev, null);
});

test('variation: window longer than the history is reported as not covered', () => {
  const v = Core.variation(H, { days: 30 });
  assert.equal(v.covered, false);
  assert.deepEqual(v.rows, []);
  assert.equal(Core.variation({ dates: ['2026-11-01'], n: {}, f: {} }).covered, false);
  assert.equal(Core.variation(null).covered, false);
});

test('variation: minimum price keeps a card if either side reaches it', () => {
  const t = Core.variation(H, { days: 1, minCents: 100 }).rows.map(r => r.t).sort();
  assert.ok(!t.includes('PENNY')); // 10 -> 20 cents, below US$1 on both sides
  assert.ok(t.includes('CRASH')); // was US$50, still shown although it is now 60 cents
});

test('variation: Normal and Foil are separate series', () => {
  const f = Core.variation(H, { days: 1, finish: 'f' }).rows;
  assert.equal(f.length, 1);
  assert.equal(f[0].pct, -50);
});

test('rank: queda and alta, ordered by percent, amount or price', () => {
  const rows = Core.variation(H, { days: 2 }).rows;
  assert.deepEqual(Core.rank(rows, { show: 'queda', order: 'pct' }).map(r => r.t), ['CRASH', 'DOWN']);
  assert.deepEqual(Core.rank(rows, { show: 'queda', order: 'abs' }).map(r => r.t), ['CRASH', 'DOWN']);
  assert.deepEqual(Core.rank(rows, { show: 'queda', order: 'price' }).map(r => r.t), ['DOWN', 'CRASH']);
  // alta: rises by percent (PENNY +100%, UP +20%), then the newly priced card last
  assert.deepEqual(Core.rank(rows, { show: 'alta', order: 'pct' }).map(r => r.t), ['PENNY', 'UP', 'NEW']);
});

test('seriesChange gives one card the same numbers the page shows for it', () => {
  const page = byT(Core.variation(H, { days: 2 }).rows);
  for (const t of ['UP', 'DOWN', 'NEW', 'CRASH']) {
    const one = Core.seriesChange(H, t, 'n', 2);
    assert.deepEqual(one, { now: page[t].now, prev: page[t].prev, abs: page[t].abs, pct: page[t].pct, isNew: page[t].isNew });
  }
  assert.equal(Core.seriesChange(H, 'GONE', 'n', 1), null); // no price now
  assert.equal(Core.seriesChange(H, 'UP', 'n', 30), null); // history too short
  assert.equal(Core.seriesChange(H, 'NOPE', 'n', 1), null);
});
