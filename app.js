'use strict';
/* Riftscan: scan or search a Riftbound card, keep counted collections, export for the Liga and MYP Cards.
   Data: data/cards.json (Riftcodex), data/prices.json (TCGCSV, USD) and data/myp.json (MYP Cards, BRL).
   Collections live in localStorage (core.js). Needs core.js and myp.js loaded first. */

const $ = (s, root = document) => root.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid);
  return n;
};

const LS = { manual: 'riftscan.manual', rate: 'riftscan.rate', mypLive: 'riftscan.mypLive', mypToken: 'riftscan.mypToken', listView: 'riftscan.listView', priceFilters: 'riftscan.priceFilters' };
const CONDITIONS = ['M', 'NM', 'SP', 'MP', 'HP', 'D'];
const LANGS = ['BR', 'EN', 'DE', 'ES', 'FR', 'IT', 'JP', 'KO', 'RU', 'TW'];
const FALLBACK_RATE = 5.5; // BRL per USD when the rate cannot be fetched
const keyOf = Core.keyOf;
const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

// myp: data/myp.json rows by TCGplayer productId; mypLive: rows refreshed from the API in this device, they win over myp
const state = { cards: [], sets: {}, released: {}, byId: new Map(), prices: {}, pricesUpdated: null, rate: null, manual: {},
  store: null, myp: { p: {}, updated: null, mock: false }, mypLive: {},
  meta: {}, view: 'scan', cardId: null, backScroll: null, listView: 'grid',
  byT: new Map(), priceDate: null, loadedAt: 0, history: null, historyFailed: false,
  pf: { show: 'queda', days: 1, finish: 'n', set: '', min: 1, order: 'pct', shown: 40 } };
Object.defineProperty(state, 'list', { // the active collection's cards
  get() { return Core.activeOf(state.store).list; },
  set(v) { Core.activeOf(state.store).list = v; },
});

/* ---------- text helpers ---------- */
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['the', 'of', 'and', 'for']);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdText = v => (v == null ? '—' : usd.format(v).replace('$', 'US$ '));
const brlText = v => (v == null ? '—' : brl.format(v).replace(/ /g, ' '));

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); }
  return out;
}
function dice(a, b) { // a, b: bigram maps
  let inter = 0, na = 0, nb = 0;
  for (const v of a.values()) na += v;
  for (const v of b.values()) nb += v;
  if (!na || !nb) return 0;
  for (const [g, v] of a) if (b.has(g)) inter += Math.min(v, b.get(g));
  return (2 * inter) / (na + nb);
}
function editDistance(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const close = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && Math.abs(a.length - b.length) <= 1 && editDistance(a, b) <= 1);

/* ---------- data ---------- */
function prep(c) {
  const base = c.n.replace(/\s*\(.*?\)\s*$/, '');
  c.nn = norm(base);
  c.full = norm(c.n);
  c.toks = c.nn.split(' ').filter(t => t.length >= 3 && !STOP.has(t));
  c.grams = bigrams(c.nn);
  c.xt = new Set(norm(c.x || '').split(' ').filter(t => t.length >= 4 && !STOP.has(t)));
  c.px = c.id.split('-')[0];
  c.num = c.c.toLowerCase();
  return c;
}
const DATA_BASE = (window.RIFTSCAN && window.RIFTSCAN.DATA_BASE) || '';
const DATA_TTL_MS = 24 * 3600e3;
const DATA_CACHE = 'riftscan-data-v1';
// The daily files (prices.json, history.json). With DATA_BASE set (the native app) a copy younger than 24 h is used as is,
// an older one is downloaded again, and an offline device keeps the last copy it has. With it empty the web app reads
// its own data/ (redeployed with every daily update) and the native app its bundled copy. `force` skips the 24 h wait.
async function dataJson(name, { force = false } = {}) {
  if (DATA_BASE && 'caches' in window) {
    const url = `${DATA_BASE}data/${name}`;
    const cache = await caches.open(DATA_CACHE);
    const hit = await cache.match(url);
    const age = hit ? Date.now() - Number(hit.headers.get('x-fetched-at') || 0) : Infinity;
    if (hit && age < DATA_TTL_MS && !force) return hit.clone().json();
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const text = await res.text();
      const body = JSON.parse(text);
      await cache.put(url, new Response(text, { headers: { 'content-type': 'application/json', 'x-fetched-at': String(Date.now()) } }));
      return body;
    } catch { if (hit) return hit.json(); } // an old copy beats none
  }
  const res = await fetch(`data/${name}`, { cache: force ? 'no-store' : 'default' });
  if (!res.ok) throw new Error(`${name} ${res.status}`);
  return res.json();
}
function applyPrices(doc) {
  state.prices = doc.p || {};
  state.pricesUpdated = doc.updated || null;
  state.priceDate = doc.date || (doc.updated ? doc.updated.slice(0, 10) : null);
  state.loadedAt = Date.now();
}
async function ensureHistory(force = false) {
  if ((state.history && !force) || (state.historyFailed && !force)) return state.history;
  try { state.history = await dataJson('history.json', { force }); state.historyFailed = false; }
  catch { state.historyFailed = true; }
  return state.history;
}
// how old the prices are, by the publish time TCGCSV stamped on them (not by when this device downloaded them)
function freshness() {
  const t = state.pricesUpdated ? Date.parse(state.pricesUpdated) : NaN;
  const hours = Number.isNaN(t) ? null : (Date.now() - t) / 3600e3;
  return { date: state.priceDate, hours, stale: hours != null && hours > 36 };
}
const dayText = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
const ageText = h => (h == null ? '' : h < 1 ? 'há menos de 1 h' : h < 48 ? `há ${Math.round(h)} h` : `há ${Math.floor(h / 24)} dias`);
async function refreshPrices({ force = false } = {}) {
  const before = state.priceDate;
  applyPrices(await dataJson('prices.json', { force }));
  if (state.history || force) await ensureHistory(force);
  renderList();
  return before !== state.priceDate;
}

async function loadData() {
  const [cards, prices, myp] = await Promise.all([
    dataJson('cards.json'), // from the data host when there is one (new editions arrive with the daily refresh), else the bundled file
    dataJson('prices.json').catch(() => ({ p: {}, updated: null })),
    fetch('data/myp.json').then(r => r.json()).catch(() => ({ p: {}, updated: null, mock: false })),
  ]);
  state.sets = cards.sets;
  state.released = cards.released || {};
  state.cards = cards.cards.map(prep);
  applyPrices(prices);
  state.myp = myp;
  state.meta = Core.setMeta(state.cards);
  state.byT = new Map();
  for (const c of state.cards) if (c.t && !state.byT.has(c.t)) state.byT.set(c.t, c);
  state.byId = new Map(state.cards.map(c => [c.id, c]));
  for (const [id, c] of Object.entries(state.manual)) state.byId.set(id, prep(c));
}
const setLabel = c => state.sets[c.s] || c.s;
// edition codes in the order the editions came out (data/cards.json `released`); undated ones go last, in the data's own order
function byRelease(codes) {
  const keys = Object.keys(state.sets);
  return [...codes].sort((a, b) => (state.released[a] || '9999').localeCompare(state.released[b] || '9999') || keys.indexOf(a) - keys.indexOf(b));
}
function unitPrices(c) {
  const p = c.t && state.prices[c.t];
  return p ? { normal: p[0], foil: p[1] } : { normal: null, foil: null };
}
// MYP Cards row for a card: { ic, min, avg, label, link } in BRL, or null (no TCGplayer id, or MYP has no stock/listing)
const mypRow = c => (c.t && (state.mypLive[c.t] || state.myp.p[c.t])) || null;
const mypOf = it => mypRow(cardOf(it));
async function loadRate() {
  const cached = JSON.parse(localStorage.getItem(LS.rate) || 'null');
  if (cached && Date.now() - cached.t < 12 * 3600e3) { state.rate = cached; return; }
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const v = (await r.json()).rates.BRL;
    if (!(v > 0)) throw new Error('bad rate');
    state.rate = { v, t: Date.now(), live: true };
    localStorage.setItem(LS.rate, JSON.stringify(state.rate));
  } catch {
    state.rate = cached || { v: FALLBACK_RATE, t: 0, live: false };
  }
}

/* ---------- list state ---------- */
const activeName = () => Core.activeOf(state.store).name;
function save() { Core.saveStore(localStorage, state.store); }
function addCard(card, foil) {
  const next = { id: card.id, qty: 1, foil, q: 'NM', lang: 'EN' };
  const hit = state.list.find(it => keyOf(it) === keyOf(next));
  if (hit) hit.qty++; else state.list.push(next);
  (hit || next).at = Date.now(); // orders the recent-additions panel
  save(); renderList();
  toast(`Adicionada: ${card.n}${foil ? ' (foil)' : ''} · ${(hit || next).qty}x em ${activeName()}`);
}
function itemValue(it) { // TCGplayer, USD
  const c = state.byId.get(it.id);
  if (!c) return null;
  const u = unitPrices(c)[it.foil ? 'foil' : 'normal'];
  return u == null ? null : u;
}
// MYP's min_price is the cheapest loose copy for sale, whatever the finish, so foil does not change it
const itemMypBrl = it => { const r = mypOf(it); return r && r.min != null ? r.min : null; };
const rateNow = () => (state.rate ? state.rate.v : FALLBACK_RATE);
// the BRL figure shown for one unit: MYP when it has a price, else TCGplayer converted (marked as an estimate)
function itemBrl(it) {
  const m = itemMypBrl(it);
  if (m != null) return { v: m, src: 'myp' };
  const u = itemValue(it);
  return u == null ? null : { v: u * rateNow(), src: 'tcg' };
}

/* ---------- MYP Cards credit: required wherever its data shows ---------- */
const mypName = () => (state.myp.mock ? 'MYP Cards (exemplo)' : 'MYP Cards'); // mock prices must never read as real MYP data
const mypCredit = () => el('a', { class: 'credit', href: MYP.SITE, target: '_blank', rel: 'noopener' }, state.myp.mock ? 'Preços de exemplo, não são do MYP Cards' : 'Dados de preço: MYP Cards');
const hasMypData = () => Object.keys(state.myp.p).length > 0 || Object.keys(state.mypLive).length > 0;

/* ---------- rendering ---------- */
function priceLine(c) {
  const u = unitPrices(c), r = mypRow(c);
  const tcg = el('div', { class: 'price' }, 'TCGplayer  Normal ', el('b', { text: usdText(u.normal) }), '  ·  Foil ', el('b', { text: usdText(u.foil) }));
  if (!r || r.min == null) return tcg;
  const name = MYP.webUrl(r.link) ? el('a', { href: MYP.webUrl(r.link), target: '_blank', rel: 'noopener', text: mypName() }) : mypName();
  return el('div', {}, el('div', { class: 'price' }, name, ' a partir de ', el('b', { text: brlText(r.min) })), tcg);
}
// the art lives on a Sanity CDN that resizes and re-encodes on request: ~860 KB PNG -> ~20-80 KB WebP
// only the Riot CDN takes the resize parameters; the TCGplayer CDN (used for newer cards) is left as it is
const imgUrl = (c, w) => (!c.im ? '' : c.im.includes('cmsassets.rgpub.io') ? `${c.im}?w=${w}&fm=webp&q=78` : c.im);
// <img> for a card's art; a missing file (the TCGplayer CDN answers 403 for products it has no art for yet)
// turns into `blank()` instead of a broken-image icon
// signature/promo printings the TCGplayer CDN has no art for borrow the art of another printing of the same
// card from the Riot CDN, so the list shows the card instead of an empty box
let printingsByName = null;
function otherPrintingsArt(c) {
  if (!printingsByName) {
    printingsByName = new Map();
    for (const o of state.cards) if (o.im) (printingsByName.get(o.nn) || printingsByName.set(o.nn, []).get(o.nn)).push(o);
  }
  // Riot CDN first (always has the art), then whatever else shares the name; at most 3 tries
  const rank = o => (o.im.includes('cmsassets.rgpub.io') ? 0 : 1);
  return (printingsByName.get(c.nn) || []).filter(o => o.id !== c.id && o.im !== c.im).sort((a, b) => rank(a) - rank(b)).slice(0, 3);
}
function artImg(c, w, props, blank) {
  const img = el('img', { src: imgUrl(c, w), alt: '', decoding: 'async', ...props });
  let fallbacks = null;
  // each failure moves to the next printing; when none is left the placeholder replaces the image
  img.addEventListener('error', () => {
    fallbacks = fallbacks || otherPrintingsArt(c);
    const next = fallbacks.shift();
    if (next) img.src = imgUrl(next, w); else img.replaceWith(blank());
  });
  return img;
}
// the small art opens the card screen too. The name next to it is already a button, so this one stays out of the
// tab order and the screen reader list (it would announce the same card twice)
function thumb(c) {
  const blank = () => el('span', { class: 'thumb blank', text: c.s });
  const img = c.im ? artImg(c, 132, { class: 'thumb', loading: 'lazy', width: 44, height: 62 }, blank) : blank();
  return el('button', { class: 'thumb-btn', type: 'button', tabindex: '-1', 'aria-hidden': 'true', onclick: () => openCard(c.id) }, img);
}
const nameLink = c => el('button', { class: 'rname link', type: 'button', onclick: () => openCard(c.id) }, c.n);
function renderResults(cards, title) {
  $('#results-wrap').hidden = false;
  $('#results-title').textContent = title;
  const ul = $('#results'); ul.replaceChildren();
  if (!cards.length) { ul.append(el('li', { class: 'meta', text: 'Nada encontrado. Tente outro trecho do nome ou o código, como OGN 108.' })); return; }
  for (const c of cards) {
    const meta = [setLabel(c), `#${c.c}`, c.r || null].filter(Boolean).join(' · ');
    ul.append(el('li', { class: 'result' }, thumb(c),
      nameLink(c),
      el('div', { class: 'rmeta', text: meta }),
      priceLine(c),
      el('div', { class: 'ract' },
        el('button', { class: 'btn', type: 'button', onclick: () => addCard(c, false) }, '+ Normal'),
        el('button', { class: 'btn', type: 'button', onclick: () => addCard(c, true) }, '+ Foil'))));
  }
  if (hasMypData()) ul.append(el('li', { class: 'meta' }, mypCredit()));
}

function renderRecent() {
  const ul = $('#recent-list'); ul.replaceChildren();
  const recent = [...state.list].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 5);
  $('#recent-all').textContent = state.list.length > recent.length ? `Ver as ${state.list.length} linhas` : '';
  if (!recent.length) {
    ul.append(el('li', { class: 'recent-empty', text: `Nada escaneado em ${activeName()} ainda. Fotografe uma carta ou busque pelo nome.` }));
    return;
  }
  for (const it of recent) {
    const c = cardOf(it);
    ul.append(el('li', { class: 'recent-item' }, thumb(c),
      nameLink(c),
      el('div', { class: 'rmeta', text: [setLabel(c), c.c && `#${c.c}`, it.foil && 'Foil'].filter(Boolean).join(' · ') }),
      el('div', { class: 'qty-tag', text: `×${it.qty}` })));
  }
}

function renderList() {
  const rows = $('#rows'), grid = $('#grid'); rows.replaceChildren(); grid.replaceChildren();
  const copies = Core.copiesOf(state.list);
  $('#list-empty').hidden = state.list.length > 0;
  if (state.list.length && state.listView === 'grid') wantHistory();
  // the collection pickers on Escanear and Lista list every collection, so creating, renaming or deleting one updates them
  menus.scan.set(collectionOptions(), state.store.active);
  renderRecent();

  let totalUsd = 0, noUsd = 0, totalMyp = 0, noMyp = 0;
  for (const it of state.list) {
    const v = itemValue(it); if (v == null) noUsd++; else totalUsd += v * it.qty;
    const m = itemMypBrl(it); if (m == null) noMyp++; else totalMyp += m * it.qty;
  }
  const summary = $('#summary'); summary.replaceChildren();
  if (state.list.length) {
    const rate = rateNow();
    const myp = hasMypData() && noMyp < state.list.length;
    summary.append(
      el('div', { class: 'big' }, String(copies), ' ', el('small', { text: copies === 1 ? 'carta' : 'cartas' })),
      el('div', { class: 'meta', text: `${state.list.length} ${state.list.length === 1 ? 'linha' : 'linhas'} no arquivo da Liga` }),
      el('div', { class: 'vals' },
        myp && el('span', {}, el('b', { text: brlText(totalMyp) }), ` menor preço no ${mypName()}`),
        el('span', {}, el('b', { text: usdText(totalUsd) }), ' TCGplayer'),
        el('span', {}, el('b', { text: brlText(totalUsd * rate) }), ` a ${rate.toFixed(2).replace('.', ',')} por dólar`)),
      el('div', { class: 'meta', text: [myp && noMyp && `${noMyp} sem preço no MYP, fora da soma.`, noUsd && `${noUsd} sem preço no TCGplayer, fora da soma.`, 'Estimativas, não são o preço da Liga.'].filter(Boolean).join(' ') }),
      myp && el('div', { class: 'meta' }, mypCredit()),
      el('div', { class: 'tools' },
        el('button', { class: 'btn primary', type: 'button', 'data-go': 'export' }, 'Exportar'),
        el('button', { class: 'btn text danger', type: 'button', onclick: clearList }, 'Limpar lista')));
    for (const b of summary.querySelectorAll('[data-go]')) b.addEventListener('click', () => show(b.dataset.go));
  }

  const sorted = Core.sortedItems(state.list, cardOf);
  const asGrid = state.listView === 'grid';
  rows.hidden = asGrid || !sorted.length; grid.hidden = !asGrid || !sorted.length;
  $('#list-tools').hidden = !sorted.length;
  for (const b of document.querySelectorAll('[data-list-view]')) b.setAttribute('aria-pressed', String(b.dataset.listView === state.listView));
  for (const it of sorted) (asGrid ? grid : rows).append(asGrid ? tileFor(it) : rowFor(it));
  renderCompletion();
  renderExport();
  renderCollections();
  if (state.view === 'card') renderCard(state.cardId);
  else if (state.view === 'prices') renderPrices(); // the page opens before the data arrives; this redraws it once it has
  else if (state.view === 'cards') renderCatalog();
}
const cardOf = it => state.byId.get(it.id) || { n: it.id, s: '', c: '', r: '', t: '' };

// qty, foil, condition, language and remove for one line of the collection (used by the row and by the card screen)
function controlsFor(it) {
  const c = cardOf(it);
  const change = patch => { // editing may merge this row into an identical one
    Object.assign(it, patch);
    const dup = state.list.find(o => o !== it && keyOf(o) === keyOf(it));
    if (dup) { dup.qty += it.qty; state.list.splice(state.list.indexOf(it), 1); }
    save(); renderList();
  };
  const sel = (opts, cur, label, key) => el('select', { 'aria-label': `${label} de ${c.n}`, onchange: e => change({ [key]: e.target.value }) },
    opts.map(o => el('option', { value: o, text: o, selected: o === cur })));
  return el('div', { class: 'rctl' },
    el('div', { class: 'stepper' },
      el('button', { type: 'button', 'aria-label': `Menos uma ${c.n}`, onclick: () => it.qty > 1 ? change({ qty: it.qty - 1 }) : removeItem(it) }, '−'),
      el('span', { class: 'qty', text: it.qty }),
      el('button', { type: 'button', 'aria-label': `Mais uma ${c.n}`, onclick: () => change({ qty: it.qty + 1 }) }, '+')),
    el('button', { class: 'chip', type: 'button', 'aria-pressed': String(it.foil), onclick: () => change({ foil: !it.foil }) }, 'Foil'),
    sel(CONDITIONS, it.q, 'Qualidade', 'q'),
    sel(LANGS, it.lang, 'Idioma', 'lang'),
    el('button', { class: 'btn text', type: 'button', onclick: () => removeItem(it) }, 'Remover'));
}
const lineBrl = it => { const b = itemBrl(it); return b == null ? '—' : (b.src === 'tcg' ? '≈ ' : '') + brlText(b.v * it.qty); };
function rowFor(it) {
  const c = cardOf(it);
  return el('li', { class: 'row' }, thumb(c),
    el('div', { class: 'rline' },
      nameLink(c),
      el('div', { class: 'price' }, el('b', { text: lineBrl(it) }))),
    el('div', { class: 'rmeta', text: [setLabel(c), c.c && `#${c.c}`, c.r].filter(Boolean).join(' · ') }),
    controlsFor(it));
}

/* ---------- filter menu: a field that opens a panel with one row per option (mark, name, count) ---------- */
const menus = {};
let openMenu = null; // only one panel is open at a time
document.addEventListener('click', e => { if (openMenu && !openMenu.host.contains(e.target)) openMenu.close(); });
// host: an empty element with an id; label: the small title in the field; onPick(value): runs when another option is chosen.
// menu.set(options, value): options are { value, name, n (count), code (edition code, draws its badge) }
function filterMenu(host, label, onPick) {
  const id = host.id;
  const valueEl = el('span', { class: 'fmenu-value', id: `${id}-value` });
  const field = el('button', { class: 'fmenu-field', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': `${id}-list`, 'aria-labelledby': `${id}-label ${id}-value` },
    valueEl, el('span', { class: 'fmenu-chevron', 'aria-hidden': 'true' }));
  const panel = el('div', { class: 'fmenu-panel', id: `${id}-list`, role: 'listbox', 'aria-labelledby': `${id}-label`, hidden: true });
  host.classList.add('fmenu');
  host.replaceChildren(el('span', { class: 'fmenu-label', id: `${id}-label`, text: label }), field, panel);
  let value = '';
  const menu = {
    host,
    close(refocus) { panel.hidden = true; field.setAttribute('aria-expanded', 'false'); if (openMenu === menu) openMenu = null; if (refocus) field.focus(); },
  };
  const open = () => {
    if (openMenu) openMenu.close();
    panel.hidden = false; field.setAttribute('aria-expanded', 'true'); openMenu = menu;
    (panel.querySelector('[aria-selected="true"]') || panel.firstElementChild)?.focus();
    panel.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };
  field.addEventListener('click', () => (panel.hidden ? open() : menu.close()));
  host.addEventListener('keydown', e => {
    const items = [...panel.children];
    if (e.key === 'Escape' && !panel.hidden) { e.preventDefault(); menu.close(true); }
    else if (e.key === 'ArrowDown' && panel.hidden && document.activeElement === field) { e.preventDefault(); open(); }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !panel.hidden) {
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
    }
  });
  host.addEventListener('focusout', e => { if (!panel.hidden && e.relatedTarget && !host.contains(e.relatedTarget)) menu.close(); }); // Tab leaves the panel
  menu.set = (options, v) => {
    value = v;
    const cur = options.find(o => o.value === v) || options[0];
    valueEl.replaceChildren(...(cur ? [cur.code && setBadge(cur.code), el('span', { class: 'fmenu-name', text: cur.name })].filter(Boolean) : []));
    panel.replaceChildren(...options.map(o => el('button', {
      class: 'fmenu-opt', type: 'button', role: 'option', 'aria-selected': String(o.value === v), style: o.code ? `--h:${hueOf(o.code)}` : null,
      onclick: () => { menu.close(true); if (o.value !== value) onPick(o.value); },
    }, el('span', { class: 'fmenu-mark', 'aria-hidden': 'true' }),
    o.code ? setBadge(o.code) : null,
    el('span', { class: 'fmenu-name', text: o.name }),
    o.n != null ? el('span', { class: 'fmenu-n', text: o.n }) : null)));
  };
  return menu;
}

/* ---------- card tiles: art, price now and the colored change beside it ---------- */
// the history is a separate file; screens that show changes ask for it once and draw again when it arrives
function wantHistory() {
  if (state.history || state.historyFailed || state.histPending) return;
  state.histPending = true;
  ensureHistory().finally(() => { state.histPending = false; if (state.history) renderList(); });
}
// 24 h change of one unit; null without history, without a TCGplayer id or without a price on both days
const dayChange = (c, finish) => (state.history && c.t ? Core.seriesChange(state.history, c.t, finish, 1) : null);
const arrowText = ch => (ch.isNew ? 'novo' : `${ch.abs > 0 ? '▲ ' : ch.abs < 0 ? '▼ ' : ''}${pctFmt.format(Math.abs(ch.pct))}%`);
const changeWords = (ch, label) => (ch.isNew ? 'preço novo' : ch.abs === 0 ? `sem variação em ${label}` : `${ch.abs > 0 ? 'subiu' : 'caiu'} ${pctFmt.format(Math.abs(ch.pct))}% em ${label}`);
const sumOf = (c, it) => `${c.n}${it ? `, ${it.qty} ${it.qty === 1 ? 'cópia' : 'cópias'}` : ''}`;

// the edition's mark: its code in a small pill whose tint comes from the code, so one edition always looks the same
function hueOf(code) {
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
function setBadge(code) {
  return el('span', { class: 'set-badge', style: `--h:${hueOf(code)}`, 'aria-hidden': 'true', text: code });
}
// One card as art with a footer: its name with the edition mark, the price now with its change beside it, and a line of detail.
// o: { qty (badge), price (text), change ({abs,pct,isNew}), changeLabel ('24 h'), sub (text), aria (extra words) }
function cardTile(c, o = {}) {
  const blank = () => el('span', { class: 'tile-blank', text: c.n });
  const art = c.im ? artImg(c, 360, { loading: 'lazy', width: 744, height: 1039 }, blank) : blank();
  const ch = o.change;
  const label = [c.n, o.qty != null && `${o.qty} ${o.qty === 1 ? 'cópia' : 'cópias'}`, o.price, ch && changeWords(ch, o.changeLabel || '24 h'), o.aria].filter(Boolean).join(', ');
  return el('li', {}, el('button', { class: 'tile', type: 'button', 'aria-label': label, onclick: () => openCard(c.id) },
    art,
    o.qty != null && el('span', { class: 'tile-badge', text: `×${o.qty}` }),
    el('span', { class: 'tile-foot' },
      el('span', { class: 'tile-name' }, setBadge(c.s), el('span', { text: c.n })),
      el('span', { class: 'tile-line' },
        el('span', { class: 'tile-price', text: o.price || '—' }),
        ch && el('span', { class: `delta ${deltaClass(ch)}`, text: arrowText(ch) })),
      o.sub && el('span', { class: 'tile-sub', text: o.sub }))));
}
const unitBrlText = it => { const b = itemBrl(it); return b == null ? null : (b.src === 'tcg' ? '≈ ' : '') + brlText(b.v); };
// Lista: unit price (the line total is in the row view and the summary), finish and quality as in the cards apps
function tileFor(it) {
  const c = cardOf(it);
  return cardTile(c, { qty: it.qty, price: unitBrlText(it), change: dayChange(c, it.foil ? 'f' : 'n'),
    sub: [it.q, it.foil ? 'Foil' : 'Normal'].join(' · ') });
}

/* ---------- completion: how much of each set the collection holds ---------- */
function ringSvg(pct) {
  const C = 2 * Math.PI * 16;
  return `<svg viewBox="0 0 36 36" width="52" height="52" aria-hidden="true"><circle cx="18" cy="18" r="16" fill="none" stroke="var(--raised)" stroke-width="3.5"/>`
    + `<circle cx="18" cy="18" r="16" fill="none" stroke="var(--data)" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${(pct * C).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 18 18)"/></svg>`;
}
const pctText = p => (p > 0 && p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`);
function renderCompletion() {
  const box = $('#completion'); box.replaceChildren();
  const rows = Core.completion(state.list, cardOf, state.meta);
  box.hidden = !rows.length;
  if (!rows.length) return;
  const shown = rows.slice(0, 6);
  box.append(el('h2', { text: 'Progresso por edição' }),
    el('ul', { class: 'progress' }, shown.map(r => {
      const ring = el('div', { class: 'ring' });
      if (r.pct != null) { ring.innerHTML = ringSvg(r.pct); ring.append(el('span', { text: pctText(r.pct) })); }
      else { ring.classList.add('none'); ring.append(el('span', { text: String(r.owned) })); }
      return el('li', { class: 'progress-row' }, ring,
        el('div', {},
          el('div', { class: 'rname', text: state.sets[r.set] || r.set }),
          el('div', { class: 'rmeta', text: r.total ? `${r.owned} de ${r.total} cartas` : `${r.owned} ${r.owned === 1 ? 'carta diferente' : 'cartas diferentes'} · só contagem` }),
          r.byRarity && el('div', { class: 'rmeta rar', text: Core.RARITIES.map(k => `${k} ${r.byRarity[k].owned}/${r.byRarity[k].total}`).join('  ·  ') })));
    })),
    el('p', { class: 'meta', text: `${rows.length > shown.length ? `Mostrando 6 de ${rows.length} edições. ` : ''}Conta só a impressão numerada de cada edição: versões A, cartas além do total e foil repetido não entram.` }));
}

/* ---------- Preços do dia: biggest falls and rises ---------- */
function loadFilters() {
  try { Object.assign(state.pf, JSON.parse(localStorage.getItem(LS.priceFilters) || '{}')); } catch { /* keep defaults */ }
  state.pf.shown = 40;
}
function syncFilterControls() {
  const f = state.pf;
  const pressed = (attr, value) => { for (const b of document.querySelectorAll(`[data-${attr}]`)) b.setAttribute('aria-pressed', String(b.dataset[attr.replace(/-./g, m => m[1].toUpperCase())] === String(value))); };
  pressed('pf-show', f.show); pressed('pf-finish', f.finish); pressed('pf-days', f.days); pressed('pf-min', f.min);
  menus.pfOrder.set([{ value: 'pct', name: 'Variação %' }, { value: 'abs', name: 'Variação em US$' }, { value: 'price', name: 'Preço' }], f.order);
  // the collapsed "Mais filtros" still says what is set, so nothing is hidden without a trace
  const minLabel = f.min > 0 ? `mín. US$ ${f.min.toLocaleString('pt-BR', { minimumFractionDigits: f.min % 1 ? 2 : 0 })}` : 'sem mínimo';
  const orderLabel = { pct: 'por variação %', abs: 'por variação em US$', price: 'por preço' }[f.order];
  $('#pf-summary').textContent = `· ${[minLabel, f.set ? (state.sets[f.set] || f.set) : 'todas as edições', orderLabel].join(' · ')}`;
}
const DAYS_LABEL = { 1: '24 h', 7: '7 dias', 30: '30 dias' };
// one mover as a tile: the price in reais, the change over the chosen period beside it, and what it was before in dollars
function moverTile(r) {
  const c = state.byT.get(r.t);
  const days = DAYS_LABEL[state.pf.days] || `${state.pf.days} dias`;
  return cardTile(c, { price: `≈ ${brlText((r.now / 100) * rateNow())}`, change: r, changeLabel: days,
    sub: r.isNew ? 'sem preço antes' : `era ${usdText(r.prev / 100)}`,
    aria: state.pf.finish === 'f' ? 'foil' : null });
}
async function renderPrices() {
  const list = $('#prices-list'), more = $('#prices-more'), notice = $('#prices-notice');
  const fr = freshness();
  const stamp = fr.date ? `Preços de ${dayText(fr.date)}${fr.hours != null ? `, ${ageText(fr.hours)}` : ''}.` : '';
  notice.hidden = !fr.stale;
  if (fr.stale) notice.textContent = `Os preços têm ${ageText(fr.hours).replace('há ', '')}. A atualização diária não chegou: toque em "Atualizar agora".`;
  syncFilterControls();
  const h = await ensureHistory();
  if (state.view !== 'prices') return;
  list.replaceChildren(); more.hidden = true;
  if (!h || h.dates.length < 2) {
    $('#prices-lead').textContent = stamp;
    $('#prices-count').textContent = h ? 'O histórico ainda tem um dia só: a variação aparece a partir do segundo dia.' : 'Não consegui carregar o histórico de preços.';
    return;
  }
  const f = state.pf;
  const v = Core.variation(h, { days: f.days, finish: f.finish, minCents: f.min * 100 });
  $('#prices-lead').textContent = v.covered ? `${stamp} Compara ${dayText(v.latest)} com ${dayText(v.base)}.` : stamp;
  if (!v.covered) {
    $('#prices-count').textContent = `O histórico cobre ${h.dates.length - 1} dias; escolha um período menor.`;
    return;
  }
  const inCatalog = v.rows.filter(r => state.byT.has(r.t));
  // the edition filter lists the editions that have rows, and falls back to "Todas" when the chosen one has none
  const present = byRelease(new Set(inCatalog.map(r => state.byT.get(r.t).s)));
  if (f.set && !present.includes(f.set)) f.set = '';
  menus.pfSet.set([{ value: '', name: 'Todas as edições' }, ...present.map(s => ({ value: s, name: state.sets[s] || s, code: s }))], f.set);
  const ranked = Core.rank(inCatalog.filter(r => !f.set || state.byT.get(r.t).s === f.set), { show: f.show, order: f.order });
  $('#prices-count').textContent = `${ranked.length} ${ranked.length === 1 ? 'carta' : 'cartas'} em ${f.show === 'queda' ? 'queda' : 'alta'}`;
  if (!ranked.length) { list.append(el('li', { class: 'meta', text: 'Nenhuma carta com esses filtros. Tente um preço mínimo menor.' })); return; }
  for (const r of ranked.slice(0, f.shown)) list.append(moverTile(r));
  if (ranked.length > f.shown) {
    more.hidden = false;
    more.textContent = `Mostrar mais (${ranked.length - f.shown} restantes)`;
    more.onclick = () => { state.pf.shown += 40; renderPrices(); };
  }
}
function setFilter(patch) {
  Object.assign(state.pf, patch, { shown: 40 });
  localStorage.setItem(LS.priceFilters, JSON.stringify({ ...state.pf, shown: undefined }));
  renderPrices();
}

/* ---------- card screen ---------- */
const RARITY = { C: 'Comum', U: 'Incomum', R: 'Rara', E: 'Épica', AA: 'Arte alternativa' };
const DOMAIN = { B: 'Body', C: 'Calm', F: 'Fury', M: 'Mind', O: 'Order', H: 'Chaos' };
function openCard(id) {
  state.backScroll = window.scrollY;
  history.pushState({ card: true }, '', '#card/' + id); // a real history entry: Back (and the Android button) returns here
  show('card/' + id);
}
function closeCard() {
  if (history.state && history.state.card) history.back(); else show('collections');
}
const row2 = (label, ...value) => el('div', { class: 'kv' }, el('span', { text: label }), el('span', { class: 'num' }, ...value));
const pctFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pctSigned = p => `${p > 0 ? '+' : p < 0 ? '−' : ''}${pctFmt.format(Math.abs(p))}%`;
const deltaClass = c => (c.isNew ? 'new' : c.abs > 0 ? 'up' : c.abs < 0 ? 'down' : 'flat');
const deltaText = c => (c.isNew ? 'novo' : pctSigned(c.pct));
// "Normal  24 h +3,0%  7 d -5,2%  30 d -12,0%" from the history, for the windows that history reaches
function varLine(label, t, finish) {
  if (!state.history || !t) return null;
  const parts = [[1, '24 h'], [7, '7 d'], [30, '30 d']].map(([d, name]) => [name, Core.seriesChange(state.history, t, finish, d)]).filter(([, c]) => c);
  if (!parts.length) return null;
  return el('div', { class: 'kv' }, el('span', { text: `Variação ${label}` }),
    el('span', { class: 'windows' }, parts.map(([name, c]) => el('span', {}, `${name} `, el('b', { class: `delta ${deltaClass(c)}`, text: deltaText(c) })))));
}
function renderCard(id) {
  const body = $('#card-body'); body.replaceChildren();
  if (!state.cards.length) return; // data still loading; renderList() draws this again
  const c = state.byId.get(id);
  if (!state.history && !state.historyFailed) ensureHistory().then(h => { if (h && state.view === 'card' && state.cardId === id) renderCard(id); });
  $('#card-title').textContent = c ? c.n : 'Carta';
  if (!c) { body.append(el('p', { class: 'lead', text: 'Não encontrei esta carta no catálogo.' })); return; }

  const blank = () => el('div', { class: 'card-art blank', text: c.n });
  const art = c.im ? artImg(c, 640, { class: 'card-art', alt: c.n, width: 744, height: 1039 }, blank) : blank();
  const facts = el('dl', { class: 'facts' },
    [['Edição', `${setLabel(c)} (${c.s})`], ['Número', c.c && `#${c.c}`], ['Raridade', RARITY[c.r] || c.r], ['Domínio', DOMAIN[c.k]]]
      .filter(f => f[1]).map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { text: v }))));

  // prices, one block per source, each with its own unit; nothing here is a change over time (there is no history yet)
  const u = unitPrices(c), r = mypRow(c), rate = rateNow();
  const conv = v => (v == null ? '' : `  ≈ ${brlText(v * rate)}`);
  const prices = el('section', { class: 'panel', 'aria-labelledby': 'h-prices' },
    el('h2', { id: 'h-prices', text: 'Preços' }),
    el('div', { class: 'src' },
      el('div', { class: 'src-head' }, el('b', { text: mypName() }), r && MYP.webUrl(r.link) && el('a', { href: MYP.webUrl(r.link), target: '_blank', rel: 'noopener', text: 'Ver no MYP Cards' })),
      r && r.min != null
        ? [row2('Menor preço', el('b', { text: brlText(r.min) })), row2('Preço médio', brlText(r.avg))]
        : el('p', { class: 'meta', text: 'Sem anúncios desta carta no catálogo do MYP Cards.' })),
    el('div', { class: 'src' },
      el('div', { class: 'src-head' }, el('b', { text: 'TCGplayer' }), el('span', { class: 'meta', text: `${freshness().date ? `dados de ${dayText(freshness().date)} · ` : ''}US$ a ${rate.toFixed(2).replace('.', ',')}` })),
      row2('Normal', el('b', { text: usdText(u.normal) }), conv(u.normal)),
      row2('Foil', el('b', { text: usdText(u.foil) }), conv(u.foil)),
      varLine('Normal', c.t, 'n'), varLine('Foil', c.t, 'f')),
    hasMypData() && el('p', { class: 'meta' }, mypCredit()));

  const mine = Core.sortedItems(state.list.filter(it => it.id === c.id), cardOf);
  const owned = el('section', { class: 'panel owned', 'aria-labelledby': 'h-owned' },
    el('h2', { id: 'h-owned', text: `Em ${activeName()}` }),
    mine.length ? mine.map(it => el('div', { class: 'owned-item' },
      el('div', { class: 'rline' }, el('b', { text: it.foil ? 'Foil' : 'Normal' }), el('span', { class: 'price' }, el('b', { text: lineBrl(it) }))),
      controlsFor(it))) : el('p', { class: 'meta', text: 'Esta carta ainda não está nesta coleção.' }),
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary', type: 'button', onclick: () => addCard(c, false) }, '+ Normal'),
      el('button', { class: 'btn', type: 'button', onclick: () => addCard(c, true) }, '+ Foil')));

  // other printings: same card name in another set or number (alternate arts, promos, reprints)
  const others = state.cards.filter(o => o.nn === c.nn && o.id !== c.id).slice(0, 12);
  const printings = others.length ? el('section', { class: 'panel', 'aria-labelledby': 'h-others' },
    el('h2', { id: 'h-others', text: 'Outras versões' }),
    el('ul', { class: 'others' }, others.map(o => el('li', {}, el('button', { class: 'other', type: 'button', 'aria-label': `${o.n}, ${state.sets[o.s] || o.s} número ${o.c}`, onclick: () => openCard(o.id) },
      o.im ? artImg(o, 220, { loading: 'lazy', width: 744, height: 1039 }, () => el('span', { class: 'tile-blank', text: o.n })) : el('span', { class: 'tile-blank', text: o.n }),
      el('span', { class: 'meta', text: `${o.s} #${o.c}` })))))) : null;

  body.append(el('div', { class: 'card-hero' }, art, facts), el('div', { class: 'card-side' }, prices, owned, printings));
}

function removeItem(it) {
  state.list.splice(state.list.indexOf(it), 1);
  save(); renderList();
}
function clearList() {
  if (!state.list.length || !confirm(`Apagar todas as cartas de "${activeName()}"?`)) return;
  state.list = []; save(); renderList();
}

/* ---------- export ---------- */
const mypList = () => Core.mypDecklist(state.list, cardOf, mypOf);
const ligaCsv = () => Core.ligaCsv(state.list, cardOf, state.sets);
const namesList = mode => Core.namesText(state.list, cardOf, mode);
function renderExport() {
  const copies = Core.copiesOf(state.list);
  const empty = !state.list.length;
  $('#export-collection').textContent = activeName();
  $('#csv-meta').textContent = empty ? 'A lista está vazia.' : `${state.list.length} linhas · ${copies} cartas`;
  $('#csv-preview').textContent = empty ? '' : ligaCsv();
  const m = empty ? null : mypList();
  $('#myp-meta').textContent = empty ? 'A lista está vazia.'
    : `${m.lines} linhas` + (m.fallback ? ` · ${m.fallback} só com o nome, sem a grafia exata do MYP` : '') + (state.myp.mock ? ' · grafias de exemplo, não vieram da API' : '');
  $('#myp-preview').textContent = empty ? '' : m.text;
  $('#names-preview').textContent = empty ? '' : namesList($('#names-mode').value);
  for (const id of ['csv-download', 'csv-copy', 'myp-copy', 'myp-download', 'names-copy', 'names-download']) $('#' + id).disabled = empty;
  $('#myp-credit').replaceChildren(...(hasMypData() ? [mypCredit()] : []));
}
// Browser: a blob download. Native app: the WebView ignores a[download], so write to cache and open the share sheet.
async function saveFile(name, text, type) {
  if (isNative) {
    const { Filesystem, Share } = window.Capacitor.Plugins;
    try {
      const r = await Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
      await Share.share({ title: name, files: [r.uri], dialogTitle: 'Enviar arquivo' });
    } catch (err) { if (!/cancel/i.test(String(err && err.message))) toast('Não consegui salvar o arquivo.'); }
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function copyText(text, what) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = el('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text;
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast(`${what} copiado`);
}
const stamp = () => new Date().toISOString().slice(0, 10);
const fileSlug = () => activeName().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'colecao';

/* ---------- collections: the list of lists and the open one, on a single screen ---------- */
// opening a collection makes it the active one: that is where Escanear adds from now on
function openCollection(id) {
  state.store.active = id; save(); renderList();
  if (state.view !== 'collections') toast(`Coleção ativa: ${activeName()}`); // on its own screen the pressed chip already says it
}
const collectionOptions = () => state.store.items.map(c => ({ value: c.id, name: c.name, n: Core.copiesOf(c.list) }));
function renderCollections() {
  menus.coll.set(collectionOptions(), state.store.active); // choosing one opens it right below

  const col = Core.activeOf(state.store), copies = Core.copiesOf(col.list);
  $('#coll-head').replaceChildren(
    el('div', { class: 'coll-title' },
      el('h2', { text: col.name }),
      el('span', { class: 'meta', text: `${copies} ${copies === 1 ? 'carta' : 'cartas'} · ${col.list.length} ${col.list.length === 1 ? 'linha' : 'linhas'}` })),
    el('div', { class: 'rctl' },
      el('button', { class: 'btn small', type: 'button', onclick: () => {
        const n = prompt('Novo nome da coleção', col.name);
        if (n != null) { Core.renameCollection(state.store, col.id, n); save(); renderList(); }
      } }, 'Renomear'),
      el('button', { class: 'btn small', type: 'button', onclick: () => { Core.duplicateCollection(state.store, col.id); save(); renderList(); toast('Coleção duplicada'); } }, 'Duplicar'),
      // there is always one collection selected: the last one cannot be deleted, only emptied
      state.store.items.length === 1
        ? el('button', { class: 'btn small text danger', type: 'button', onclick: () => {
          if (!copies || !confirm(`Apagar as ${copies} cartas de "${col.name}"? A coleção continua aqui, vazia.`)) return;
          col.list = []; save(); renderList();
        } }, 'Zerar')
        : el('button', { class: 'btn small text danger', type: 'button', onclick: () => {
          if (!confirm(`Excluir "${col.name}" e as ${copies} cartas dela? A primeira coleção da lista fica aberta.`)) return;
          Core.deleteCollection(state.store, col.id); save(); renderList();
        } }, 'Excluir')));

  const info = state.myp.updated ? new Date(state.myp.updated).toLocaleDateString('pt-BR') : null;
  $('#myp-status').textContent = !hasMypData() ? 'Sem preços do MYP Cards neste aparelho; o app usa só o TCGplayer.'
    : `Catálogo do MYP Cards de ${info || '—'}${state.myp.mock ? ' · DADOS DE EXEMPLO (fictícios), a API real ainda não foi conectada' : ''}.`;
}

/* ---------- Cartas: the whole game by edition, with a search bar ---------- */
const CAT_PAGE = 60;
const cat = { set: '', q: '', shown: CAT_PAGE };
function catalogList() {
  const q = cat.q.trim();
  let list = q ? search(q, 1000) : state.cards;
  if (cat.set) list = list.filter(c => c.s === cat.set);
  if (!q) { // by edition, biggest first so the promos come last; inside one edition the data order (by number) stays
    const order = catalogSets();
    list = list.slice().sort((a, b) => order.indexOf(a.s) - order.indexOf(b.s));
  }
  return list;
}
// edition codes that have cards, in release order
function catalogSets() {
  return byRelease(new Set(state.cards.map(c => c.s)));
}
function catalogTile(c) {
  const it = { id: c.id, foil: false };
  const owned = state.list.reduce((n, o) => n + (o.id === c.id ? o.qty : 0), 0);
  return cardTile(c, { qty: owned || null, price: unitBrlText(it), change: dayChange(c, 'n'), sub: `#${c.c}${c.r ? ` · ${c.r}` : ''}` });
}
function renderCatalog() {
  if (!state.cards.length) return; // data still loading; renderList() draws this again
  wantHistory();
  const counts = {};
  for (const c of state.cards) counts[c.s] = (counts[c.s] || 0) + 1;
  if (cat.set && !counts[cat.set]) cat.set = ''; // the filter always has one option selected: back to "Todas" if the chosen edition is gone
  menus.cat.set([{ value: '', name: 'Todas as edições', n: state.cards.length }, ...catalogSets().map(c => ({ value: c, name: state.sets[c] || c, n: counts[c], code: c }))], cat.set);
  const q = cat.q.trim(), all = catalogList();
  $('#catalog-count').textContent = `${all.length} ${all.length === 1 ? 'carta' : 'cartas'}${q ? ` para “${q}”` : ''}${cat.set ? ` em ${state.sets[cat.set] || cat.set}` : ''}`;
  const grid = $('#catalog-grid'); grid.replaceChildren();
  if (!all.length) grid.append(el('li', { class: 'meta group-head', text: 'Nada encontrado. Tente outro trecho do nome ou o código, como OGN 108.' }));
  let last = null;
  for (const c of all.slice(0, cat.shown)) {
    if (!q && c.s !== last) { // headings only when browsing; a search is ranked by relevance, not by edition
      last = c.s;
      grid.append(el('li', { class: 'group-head' }, el('h2', {}, setBadge(c.s), setLabel(c)), el('span', { class: 'meta', text: `${counts[c.s]} cartas` })));
    }
    grid.append(catalogTile(c));
  }
  const more = $('#catalog-more');
  more.hidden = all.length <= cat.shown;
  more.textContent = `Mostrar mais (${all.length - cat.shown} restantes)`;
}

// Refresh the active collection's prices from GET /produto/{id}. Cards never refreshed on this device go first,
// so repeated runs make progress when the per-minute limit (10 without a token, 60 with) cuts one short.
async function refreshMyp() {
  const btn = $('#myp-refresh');
  const seen = new Map();
  for (const it of state.list) { const c = cardOf(it), r = mypRow(c); if (r && !seen.has(c.t)) seen.set(c.t, r.ic); }
  const todo = [...seen].sort((a, b) => (a[0] in state.mypLive) - (b[0] in state.mypLive));
  if (!todo.length) { toast('Nenhuma carta desta coleção tem código do MYP Cards.'); return; }
  btn.disabled = true;
  let done = 0, stopped = null;
  for (const [t, ic] of todo) {
    btn.textContent = `Atualizando ${done + 1} de ${todo.length}…`;
    try { state.mypLive[t] = MYP.compact(await MYP.product(ic)); done++; }
    catch (err) {
      if (err.code === 'product_not_found') continue;
      stopped = err; break;
    }
  }
  localStorage.setItem(LS.mypLive, JSON.stringify(state.mypLive));
  btn.disabled = false; btn.textContent = 'Atualizar preços desta coleção';
  renderList();
  if (stopped) toast(`${done} de ${todo.length} atualizadas. ${stopped.message}`);
  else toast(`${done} de ${todo.length} preços atualizados pelo MYP Cards`);
}

/* ---------- search ---------- */
const CODE_RE = /^([a-z]{2,4})[\s\-#•.·]*0*(\d{1,3}[a-z]?)$/i;
function search(q, limit = 30) {
  q = q.trim();
  if (!q) return [];
  const m = q.match(CODE_RE);
  if (m) {
    const px = m[1].toLowerCase() === 'ropp' ? 'opp' : m[1].toLowerCase(), num = m[2].toLowerCase();
    const hits = state.cards.filter(c => c.px === px && (c.num === num || c.num.replace(/[a-z]+$/, '') === num));
    if (hits.length) return hits.slice(0, limit);
  }
  const toks = norm(q).split(' ').filter(Boolean);
  if (!toks.length) return [];
  const nq = toks.join(' ');
  return state.cards.filter(c => toks.every(t => c.full.includes(t)))
    .sort((a, b) => (b.full.startsWith(nq) - a.full.startsWith(nq)) || a.n.length - b.n.length)
    .slice(0, limit);
}

/* ---------- OCR ---------- */
// the printed code, e.g. "OGN • 117/298": set prefix, number, and the set size after the slash
let numRe = null;
function numberRegex() {
  if (!numRe) {
    const px = [...new Set(state.cards.map(c => c.px)), 'ropp'].join('|');
    numRe = new RegExp(`\\b(${px})\\b[^a-z0-9]{0,4}0*(\\d{1,3}[a-z*]?)(?:\\s*/\\s*0*(\\d{2,3}))?`, 'gi');
  }
  return numRe;
}
let ocrWorker = null;
// third-party script: exact version + SRI hash, so a changed or hijacked CDN file is refused by the browser
function loadScript(src, integrity) {
  return new Promise((ok, fail) => {
    const s = el('script', { src, onload: ok, onerror: () => fail(new Error('Não foi possível carregar o leitor de texto. Ele precisa de internet na primeira vez.')) });
    if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
    document.head.append(s);
  });
}
async function getWorker(onProgress) {
  if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js', 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F');
  if (!ocrWorker) {
    ocrWorker = await Tesseract.createWorker('eng', 1, { logger: m => onProgress(m) });
    await ocrWorker.setParameters({ tessedit_pageseg_mode: '11' }); // sparse text: card names, numbers, rules
  }
  return ocrWorker;
}
async function fileToCanvas(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const cv = el('canvas'); cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv;
}
function rankByText(text) {
  const nt = norm(text);
  const padded = ` ${nt} `;
  const lines = text.split(/\n+/).map(norm).filter(l => l.length >= 3);
  const otoks = [...new Set(nt.split(' ').filter(t => t.length >= 3))];
  const obig = new Set(otoks.filter(t => t.length >= 4));
  const nums = [...text.matchAll(numberRegex())].map(m => [m[1].toLowerCase() === 'ropp' ? 'opp' : m[1].toLowerCase(), m[2].toLowerCase(), m[3]]);
  const scored = [];
  for (const c of state.cards) {
    let s = 0;
    // 1. the name, read exactly or nearly
    if (c.nn.length >= 4 && padded.includes(` ${c.nn} `)) s = 1;
    else {
      if (c.toks.length) {
        let hit = 0, tot = 0;
        for (const t of c.toks) { tot += t.length; if (otoks.some(o => close(o, t))) hit += t.length; }
        if (hit === tot || (c.toks.length > 1 && hit / tot >= 0.8)) s = 0.95 * hit / tot;
      }
      if (s < 0.9) for (const L of lines) {
        const words = L.split(' '), nw = c.nn.split(' ').length;
        for (const w of new Set([nw - 1, nw, nw + 1])) {
          if (w < 1 || w > words.length) continue;
          for (let i = 0; i + w <= words.length; i++) {
            const d = dice(bigrams(words.slice(i, i + w).join(' ')), c.grams);
            if (d >= 0.8) s = Math.max(s, d * 0.92);
          }
        }
      }
    }
    // 2. the rules text: most of this card's words show up in the photo
    if (c.xt.size >= 5) {
      let hit = 0;
      for (const t of c.xt) if (obig.has(t) || otoks.some(o => close(o, t))) hit++;
      const cov = hit / c.xt.size;
      if (cov >= 0.6) s = Math.max(s, 0.5 + 0.45 * cov);
    }
    // 3. the printed set code and number
    // Works in any language: a Chinese or Japanese card still prints its set code and number in Latin letters.
    const total = c.id.split('-').pop();
    if (nums.some(([p, n, t]) => p === c.px && (n === c.num || n === c.num.replace(/[a-z*]+$/, '')) && (!t || t === total.replace(/^0+/, '')))) s = s > 0.3 ? s + 0.4 : 0.75;
    if (s >= 0.6) scored.push([s, c]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].n.length - b[1].n.length);
  return scored.slice(0, 6).map(x => x[1]);
}
async function scanCanvas(cv) {
  const box = $('#ocr'), msg = $('#ocr-text'), bar = $('#ocr-bar');
  box.hidden = false; bar.hidden = false; bar.value = 0;
  $('#ocr-preview').src = cv.toDataURL('image/jpeg', 0.6);
  msg.textContent = 'Preparando o leitor…';
  try {
    const worker = await getWorker(m => {
      if (m.status === 'recognizing text') { msg.textContent = 'Lendo a carta…'; bar.value = m.progress; }
      else msg.textContent = 'Preparando o leitor…';
    });
    msg.textContent = 'Lendo a carta…';
    const { data } = await worker.recognize(cv);
    const cands = rankByText(data.text);
    bar.hidden = true;
    msg.textContent = cands.length ? 'Confira qual é a sua carta e adicione.' : 'Não consegui identificar. Busque pelo nome ou código abaixo.';
    renderResults(cands, cands.length ? 'Parece ser uma destas' : 'Sem resultado da foto');
  } catch (err) {
    bar.hidden = true; msg.textContent = err.message || 'A leitura falhou. Busque pelo nome ou código.';
  }
}
async function onFile(e) {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  scanCanvas(await fileToCanvas(f));
}

/* live camera: needs HTTPS (or localhost) */
let stream = null;
async function openLive() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } } });
  } catch { toast('Sem acesso à câmera. Use "Fotografar carta".'); return; }
  const v = $('#live-video'); v.srcObject = stream; await v.play();
  $('#live').hidden = false;
}
function closeLive() {
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  $('#live').hidden = true;
}
function shootLive() {
  const v = $('#live-video');
  const scale = Math.min(1, 1800 / Math.max(v.videoWidth, v.videoHeight));
  const cv = el('canvas'); cv.width = Math.round(v.videoWidth * scale); cv.height = Math.round(v.videoHeight * scale);
  cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
  closeLive(); scanCanvas(cv);
}

/* ---------- manual card ---------- */
function onManual(e) {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const card = { id: 'manual-' + Date.now().toString(36), n: f.n.trim(), s: f.s.trim().toUpperCase(), c: f.c.trim(), r: f.r, k: f.k, t: '', im: '' };
  state.manual[card.id] = card;
  localStorage.setItem(LS.manual, JSON.stringify(state.manual));
  state.byId.set(card.id, prep({ ...card }));
  addCard(state.byId.get(card.id), false);
  e.target.reset();
}

/* ---------- shell ---------- */
let toastTimer;
function toast(text) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
}
function show(view) {
  let cardId = null;
  if (view.startsWith('card/')) { cardId = decodeURIComponent(view.slice(5)); view = 'card'; }
  if (view === 'list') view = 'collections'; // old links and bookmarks: the list now lives with the collections
  if (!['scan', 'prices', 'collections', 'export', 'card', 'cards', 'settings'].includes(view)) view = 'scan';
  const fromCard = state.view === 'card';
  state.view = view; state.cardId = cardId;
  for (const s of document.querySelectorAll('.view')) s.hidden = s.id !== 'view-' + view;
  for (const b of document.querySelectorAll('[data-view]')) { // the bottom bar and the side menu share the data-view buttons
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  if (view !== 'scan') closeLive();
  if (view === 'card') renderCard(cardId);
  else if (view === 'prices') renderPrices();
  else if (view === 'cards') renderCatalog();
  else if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  // coming back from a card, return to where the list was
  window.scrollTo(0, fromCard && view !== 'card' && state.backScroll != null ? state.backScroll : 0);
}

async function init() {
  state.store = Core.loadStore(localStorage);
  state.mypLive = JSON.parse(localStorage.getItem(LS.mypLive) || '{}');
  state.manual = JSON.parse(localStorage.getItem(LS.manual) || '{}');
  // side menu: a modal <dialog> (focus stays inside, Esc closes, focus goes back to the Menu button)
  const side = $('#side');
  $('#menu-open').addEventListener('click', () => side.showModal());
  $('#menu-close').addEventListener('click', () => side.close());
  side.addEventListener('click', e => { if (e.target === side) side.close(); }); // a click on the dimmed area
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => { if (side.open) side.close(); show(b.dataset.view); });
  // Cartas: the search box and "Mostrar mais"
  let catTimer;
  $('#catalog-search').addEventListener('submit', e => e.preventDefault());  $('#catalog-q').addEventListener('input', e => {
    clearTimeout(catTimer);
    catTimer = setTimeout(() => { cat.q = e.target.value; cat.shown = CAT_PAGE; renderCatalog(); }, 150);
  });
  $('#catalog-more').addEventListener('click', () => { cat.shown += CAT_PAGE; renderCatalog(); });
  for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => show(b.dataset.go));
  // scroll indicator for phones: a pill whose height is the visible share of the page and whose position follows the scroll
  const pill = $('#scrollpill');
  let pillFrame = 0, pillTimer;
  const drawPill = () => {
    pillFrame = 0;
    const doc = document.documentElement, vh = window.innerHeight, total = doc.scrollHeight;
    pill.classList.toggle('on', total > vh + 2);
    if (total <= vh + 2) return;
    const h = Math.max(40, Math.round(vh * vh / total));
    const y = Math.round((window.scrollY / (total - vh)) * (vh - h));
    pill.style.height = `${h}px`;
    pill.style.transform = `translateY(${Math.max(0, Math.min(vh - h, y))}px)`;
  };
  const queuePill = () => { if (!pillFrame) pillFrame = requestAnimationFrame(drawPill); };
  window.addEventListener('scroll', () => {
    queuePill(); pill.classList.add('moving'); clearTimeout(pillTimer);
    pillTimer = setTimeout(() => pill.classList.remove('moving'), 700);
  }, { passive: true });
  window.addEventListener('resize', queuePill);
  new ResizeObserver(queuePill).observe(document.body); // the page grows as cards and lists render
  queuePill();
  // the router lives in the hash, so the skip link focuses <main> itself instead of navigating to #main
  $('.skip').addEventListener('click', e => { e.preventDefault(); $('#main').focus(); });
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  $('#file-camera').addEventListener('change', onFile);
  $('#file-pick').addEventListener('change', onFile);
  if (navigator.mediaDevices?.getUserMedia && window.isSecureContext) {
    $('#live-open').hidden = false;
    $('#live-open').addEventListener('click', openLive);
    $('#live-close').addEventListener('click', closeLive);
    $('#live-shot').addEventListener('click', shootLive);
  }
  const q = $('#q');
  $('#search-form').addEventListener('submit', e => e.preventDefault());
  q.addEventListener('input', () => {
    const v = q.value.trim();
    if (!v) { $('#results-wrap').hidden = true; return; }
    const hits = search(v);
    renderResults(hits, hits.length ? `${hits.length === 30 ? '30+' : hits.length} ${hits.length === 1 ? 'resultado' : 'resultados'}` : 'Sem resultados');
  });
  $('#manual-form').addEventListener('submit', onManual);

  $('#names-mode').addEventListener('change', renderExport);
  $('#csv-download').addEventListener('click', () => saveFile(`riftscan-${fileSlug()}-${stamp()}.csv`, ligaCsv(), 'text/csv;charset=utf-8'));
  $('#csv-copy').addEventListener('click', () => copyText(ligaCsv(), 'CSV'));
  $('#myp-copy').addEventListener('click', () => copyText(mypList().text, 'Lista do MYP Cards'));
  $('#myp-download').addEventListener('click', () => saveFile(`riftscan-myp-${fileSlug()}-${stamp()}.txt`, mypList().text + '\n', 'text/plain;charset=utf-8'));
  $('#names-copy').addEventListener('click', () => copyText(namesList($('#names-mode').value), 'Lista de nomes'));
  $('#names-download').addEventListener('click', () => saveFile(`riftscan-nomes-${fileSlug()}-${stamp()}.txt`, namesList($('#names-mode').value) + '\n', 'text/plain;charset=utf-8'));

  $('#collection-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = e.target.elements.name;
    Core.addCollection(state.store, input.value); save(); renderList();
    input.value = ''; e.target.closest('details').open = false; toast(`Coleção criada: ${activeName()}`);
  });
  const tokenInput = $('#myp-token');
  tokenInput.value = localStorage.getItem(LS.mypToken) || '';
  MYP.configure({ token: tokenInput.value.trim() });
  tokenInput.addEventListener('change', () => {
    const t = tokenInput.value.trim();
    if (t) localStorage.setItem(LS.mypToken, t); else localStorage.removeItem(LS.mypToken);
    MYP.configure({ token: t });
    toast(t ? 'Token do MYP Cards salvo neste aparelho' : 'Token removido');
  });
  // from a browser the API call is cross-origin and likely blocked by CORS; the native app goes through CapacitorHttp
  $('#myp-refresh').hidden = !isNative;
  $('#myp-refresh').addEventListener('click', refreshMyp);

  // theme: the header button flips light/dark, the Aparência panel can return to "follow the device"
  const syncTheme = () => {
    const dark = Theme.effective() === 'dark', btn = $('#theme-toggle');
    $('#icon-moon').toggleAttribute('hidden', dark); $('#icon-sun').toggleAttribute('hidden', !dark); // SVG has no .hidden property
    btn.setAttribute('aria-label', dark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro');
    btn.title = btn.getAttribute('aria-label');
    for (const b of document.querySelectorAll('[data-theme-mode]')) b.setAttribute('aria-pressed', String(b.dataset.themeMode === Theme.mode()));
  };
  $('#theme-toggle').addEventListener('click', () => Theme.set(Theme.effective() === 'dark' ? 'light' : 'dark'));
  for (const b of document.querySelectorAll('[data-theme-mode]')) b.addEventListener('click', () => Theme.set(b.dataset.themeMode));
  window.addEventListener('themechange', syncTheme);
  syncTheme();

  state.listView = localStorage.getItem(LS.listView) === 'rows' ? 'rows' : 'grid';
  for (const b of document.querySelectorAll('[data-list-view]')) b.addEventListener('click', () => {
    state.listView = b.dataset.listView; localStorage.setItem(LS.listView, state.listView); renderList();
  });
  $('#card-back').addEventListener('click', closeCard);

  loadFilters();
  if (window.matchMedia('(min-width: 768px)').matches) $('.more-filters').open = true; // room for it on tablets and desktops
  for (const b of document.querySelectorAll('[data-pf-show]')) b.addEventListener('click', () => setFilter({ show: b.dataset.pfShow }));
  for (const b of document.querySelectorAll('[data-pf-finish]')) b.addEventListener('click', () => setFilter({ finish: b.dataset.pfFinish }));
  for (const b of document.querySelectorAll('[data-pf-days]')) b.addEventListener('click', () => setFilter({ days: +b.dataset.pfDays }));
  for (const b of document.querySelectorAll('[data-pf-min]')) b.addEventListener('click', () => setFilter({ min: +b.dataset.pfMin }));
  // the filter menus exist before the first screen is drawn
  Object.assign(menus, {
    scan: filterMenu($('#scan-coll-menu'), 'Adicionando em', id => openCollection(id)),
    coll: filterMenu($('#coll-menu'), 'Coleção', id => openCollection(id)),
    cat: filterMenu($('#cat-set-menu'), 'Edição', v => { cat.set = v; cat.shown = CAT_PAGE; renderCatalog(); }),
    pfSet: filterMenu($('#pf-set-menu'), 'Edição', v => setFilter({ set: v })),
    pfOrder: filterMenu($('#pf-order-menu'), 'Ordenar por', v => setFilter({ order: v })),
  });
  $('#prices-refresh').addEventListener('click', async () => {
    const btn = $('#prices-refresh'); btn.disabled = true; btn.textContent = 'Atualizando…';
    try { toast((await refreshPrices({ force: true })) ? `Preços de ${dayText(state.priceDate)} baixados` : 'Os preços já estão no dia mais recente'); }
    catch { toast('Não consegui atualizar agora. Tente de novo com internet.'); }
    btn.disabled = false; btn.textContent = 'Atualizar agora';
  });
  // a session that stays open for a day picks up the new daily files when the app comes back to the front
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.loadedAt && Date.now() - state.loadedAt > DATA_TTL_MS) refreshPrices().catch(() => {});
  });

  show(location.hash.slice(1) || 'scan');
  try { await loadData(); } catch { toast('Não consegui carregar a base de cartas.'); }
  await loadRate();
  renderList();
  // the native app bundles its files, so it needs no service worker
  if ('serviceWorker' in navigator && window.isSecureContext && !isNative) navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
