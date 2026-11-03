'use strict';
/* Riftscan core: collections store and the three exports (Liga CSV, MYP decklist, names).
   Pure functions, no DOM. Loaded as a classic script (window.Core) and by node for tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STORE_KEY = 'riftscan.collections';
  const LEGACY_LIST_KEY = 'riftscan.list';
  const DEFAULT_NAME = 'Minha coleção';

  const LIGA_HEADER = ['Edicao (PTBR)', 'Edicao (EN)', 'Edicao (Sigla)', 'Card (PT)', 'Card (EN)', 'Quantidade',
    'Qualidade (M NM SP MP HP D)', 'Idioma (BR EN DE ES FR IT JP KO RU TW)', 'Raridade',
    'Cor (C D O E Y F R G L M P W)', 'Extras', 'Card #', 'Comentario', '# Cards na Edicao'];

  /* ---------- items ---------- */
  const keyOf = it => [it.id, it.foil ? 1 : 0, it.q, it.lang].join('|');
  const copiesOf = list => list.reduce((n, it) => n + it.qty, 0);

  /* ---------- collections store ---------- */
  // store = { v: 2, active: id, items: [{ id, name, created, list: [item] }] }
  const newId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function makeCollection(name, list = [], id = newId(), now = Date.now()) {
    return { id, name: cleanName(name) || DEFAULT_NAME, created: now, list };
  }
  const cleanName = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);

  // storage: anything with getItem/setItem/removeItem (localStorage, or a stub in tests)
  function loadStore(storage) {
    let store = null;
    try { store = JSON.parse(storage.getItem(STORE_KEY) || 'null'); } catch { store = null; }
    if (!store || !Array.isArray(store.items) || !store.items.length) {
      // first run on this version: the old single list becomes the first collection
      let legacy = [];
      try { legacy = JSON.parse(storage.getItem(LEGACY_LIST_KEY) || '[]'); } catch { legacy = []; }
      const col = makeCollection(DEFAULT_NAME, Array.isArray(legacy) ? legacy : []);
      store = { v: 2, active: col.id, items: [col] };
      saveStore(storage, store);
      storage.removeItem(LEGACY_LIST_KEY);
    }
    if (!store.items.some(c => c.id === store.active)) store.active = store.items[0].id;
    return store;
  }
  function saveStore(storage, store) { storage.setItem(STORE_KEY, JSON.stringify(store)); }
  const activeOf = store => store.items.find(c => c.id === store.active);

  function addCollection(store, name) {
    const col = makeCollection(name || `Coleção ${store.items.length + 1}`);
    store.items.push(col); store.active = col.id;
    return col;
  }
  function duplicateCollection(store, id) {
    const src = store.items.find(c => c.id === id);
    if (!src) return null;
    const col = makeCollection(`${src.name} (cópia)`, src.list.map(it => ({ ...it })));
    store.items.splice(store.items.indexOf(src) + 1, 0, col); store.active = col.id;
    return col;
  }
  function renameCollection(store, id, name) {
    const col = store.items.find(c => c.id === id), n = cleanName(name);
    if (col && n) col.name = n;
    return col;
  }
  function deleteCollection(store, id) {
    store.items = store.items.filter(c => c.id !== id);
    if (!store.items.length) store.items.push(makeCollection(DEFAULT_NAME)); // never leave the app without a collection
    if (!store.items.some(c => c.id === store.active)) store.active = store.items[0].id;
  }

  /* ---------- exports ---------- */
  const csvCell = v => { const s = String(v ?? ''); return /[\s,"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  // cardOf(item) -> { n, s, c, r, k }; sets maps a set code to its English name
  function sortedItems(list, cardOf) {
    return [...list].sort((a, b) => cardOf(a).s.localeCompare(cardOf(b).s) || cardOf(a).n.localeCompare(cardOf(b).n) || a.foil - b.foil);
  }
  function ligaCsv(list, cardOf, sets) {
    const lines = [LIGA_HEADER.map(csvCell).join(',')];
    for (const it of sortedItems(list, cardOf)) {
      const c = cardOf(it);
      lines.push(['', sets[c.s] || c.s, c.s, '', c.n, it.qty, it.q, it.lang, c.r, c.k, it.foil ? 'Foil' : '', c.c, '', '']
        .map(csvCell).join(','));
    }
    return lines.join('\n') + '\n';
  }
  function namesText(list, cardOf, mode) {
    const items = sortedItems(list, cardOf);
    if (mode === 'prefix') return items.map(it => `${it.qty} ${cardOf(it).n}`).join('\n');
    if (mode === 'once') return [...new Set(items.map(it => cardOf(it).n))].join('\n');
    return items.flatMap(it => Array(it.qty).fill(cardOf(it).n)).join('\n');
  }
  // One "qty label" line per card. mypOf(item) -> { label } or null. The label is deck_labels[0] from the API:
  // the spelling MYP's importer resolves to one exact printing. Never build it from name + set code.
  // Cards without a label fall back to the plain name, which the importer may match to several printings.
  function mypDecklist(list, cardOf, mypOf) {
    const merged = new Map(); // foil/condition/language don't change the MYP line, so rows merge
    let fallback = 0;
    for (const it of sortedItems(list, cardOf)) {
      const label = mypOf(it)?.label || null;
      const text = label || cardOf(it).n;
      const hit = merged.get(text);
      if (hit) hit.qty += it.qty; else merged.set(text, { qty: it.qty, exact: !!label });
    }
    const lines = [];
    for (const [text, m] of merged) { lines.push(`${m.qty} ${text}`); if (!m.exact) fallback++; }
    return { text: lines.join('\n'), lines: lines.length, fallback };
  }

  /* ---------- set completion ---------- */
  // A card id ends in the set's printed size ('ogn-176-298'). The base print of a set is the numbered card whose
  // number is within that size; 'A' variants and overnumbered cards are extras and sit outside the denominator.
  // Promo and bundle sets have no single size, so they get a plain count and no percentage.
  const RARITIES = ['C', 'U', 'R', 'E'];
  const printedTotal = c => { const seg = String(c.id).split('-').pop(); return /^\d+$/.test(seg) ? +seg : 0; };
  const baseNumber = (c, total) => (/^\d+$/.test(String(c.c)) && printedTotal(c) === total && +c.c >= 1 && +c.c <= total ? +c.c : null);
  function setMeta(cards) {
    const bySet = {};
    for (const c of cards) { (bySet[c.s] = bySet[c.s] || []).push(c); }
    const meta = {};
    for (const [set, list] of Object.entries(bySet)) {
      const tally = {};
      for (const c of list) { const t = printedTotal(c); if (t) tally[t] = (tally[t] || 0) + 1; }
      const total = +(Object.entries(tally).sort((a, b) => b[1] - a[1])[0] || [0])[0];
      const base = new Map();
      if (total) for (const c of list) { const n = baseNumber(c, total); if (n != null) base.set(n, c.r); }
      meta[set] = total >= 20 && base.size === total ? { total, base } : { total: null, base: null };
    }
    return meta;
  }
  // list: collection items; cardOf(item) -> catalog card; meta: setMeta(catalog). Only sets with at least one card owned.
  function completion(list, cardOf, meta) {
    const acc = new Map();
    for (const it of list) {
      const c = cardOf(it);
      if (!c || !c.s) continue;
      const a = acc.get(c.s) || { ids: new Set(), nums: new Set(), copies: 0 };
      a.ids.add(c.id); a.copies += it.qty;
      const m = meta[c.s];
      if (m && m.total) { const n = baseNumber(c, m.total); if (n != null) a.nums.add(n); }
      acc.set(c.s, a);
    }
    const out = [];
    for (const [set, a] of acc) {
      const m = meta[set];
      if (!m || !m.total) { out.push({ set, total: null, owned: a.ids.size, copies: a.copies, pct: null, byRarity: null }); continue; }
      const byRarity = {};
      for (const r of RARITIES) byRarity[r] = { owned: 0, total: 0 };
      for (const [n, r] of m.base) if (byRarity[r]) byRarity[r].total++;
      for (const n of a.nums) { const r = m.base.get(n); if (byRarity[r]) byRarity[r].owned++; }
      out.push({ set, total: m.total, owned: a.nums.size, copies: a.copies, pct: a.nums.size / m.total, byRarity });
    }
    return out.sort((x, y) => (y.pct ?? -1) - (x.pct ?? -1) || y.owned - x.owned || y.copies - x.copies);
  }

  /* ---------- price variation (data/history.json: columnar, in cents, newest date last) ---------- */
  const shiftDate = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 864e5).toISOString().slice(0, 10);
  // Each card's price on the newest date against its price `days` calendar days earlier. When that exact date has no
  // snapshot, the nearest one before it is the base (and says so in `base`). Rules:
  //  - a card with no price now is left out;
  //  - a card with no price on the base date is `isNew` (pct and abs null), never an infinite percentage;
  //  - Normal ('n') and Foil ('f') are separate series;
  //  - minCents keeps a card when either of its two prices reaches it, so a fall from US$50 to US$0.60 still shows;
  //  - the percentage is in the stored currency (USD); showing BRL is the caller's job.
  // covered is false when the history does not reach back far enough for the window.
  function baseIndex(h, days) { // index of the snapshot to compare against, or -1 when the history does not reach back
    const dates = h.dates, L = dates.length - 1, target = shiftDate(dates[L], -days);
    for (let i = L - 1; i >= 0; i--) if (dates[i] <= target) return i;
    return -1;
  }
  const changeOf = (col, L, b) => { // one series: price on the newest date against the base snapshot
    const now = col[L];
    if (now == null || now <= 0) return null;
    const had = col[b] != null && col[b] > 0;
    return { now, prev: had ? col[b] : null, abs: had ? now - col[b] : null, pct: had ? ((now - col[b]) / col[b]) * 100 : null, isNew: !had };
  };
  function variation(h, { days = 1, finish = 'n', minCents = 0 } = {}) {
    const dates = (h && h.dates) || [];
    const L = dates.length - 1;
    if (L < 1) return { rows: [], latest: dates[L] || null, base: null, covered: false };
    const b = baseIndex(h, days);
    if (b < 0) return { rows: [], latest: dates[L], base: null, covered: false };
    const rows = [];
    for (const [t, col] of Object.entries(h[finish] || {})) {
      const c = changeOf(col, L, b);
      if (c && Math.max(c.now, c.prev || 0) >= minCents) rows.push({ t, ...c });
    }
    return { rows, latest: dates[L], base: dates[b], covered: true };
  }
  // the same numbers for one card (the card screen), or null when it has no price now or the history is too short
  function seriesChange(h, t, finish, days) {
    const dates = (h && h.dates) || [];
    const L = dates.length - 1, col = h && h[finish] && h[finish][t];
    if (L < 1 || !col) return null;
    const b = baseIndex(h, days);
    return b < 0 ? null : changeOf(col, L, b);
  }
  // show: 'queda' (price fell) or 'alta' (rose, plus cards newly priced, last); order: 'pct', 'abs' or 'price', largest first
  function rank(rows, { show = 'queda', order = 'pct' } = {}) {
    const keep = show === 'queda' ? r => !r.isNew && r.abs < 0 : r => r.isNew || r.abs > 0;
    const key = r => (order === 'price' ? r.now : order === 'abs' ? Math.abs(r.abs || 0) : Math.abs(r.pct || 0));
    return rows.filter(keep).sort((a, b) => key(b) - key(a) || b.now - a.now || (a.t < b.t ? -1 : 1));
  }

  return {
    RARITIES, setMeta, completion, variation, seriesChange, rank,
    STORE_KEY, LEGACY_LIST_KEY, DEFAULT_NAME, LIGA_HEADER,
    keyOf, copiesOf, csvCell, sortedItems, ligaCsv, namesText, mypDecklist,
    makeCollection, loadStore, saveStore, activeOf, addCollection, duplicateCollection, renameCollection, deleteCollection,
  };
});
