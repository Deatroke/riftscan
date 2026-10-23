'use strict';
/* Riftscan: scan or search a Riftbound card, keep a counted list, export the Liga import file.
   Data: data/cards.json (Riftcodex) and data/prices.json (TCGCSV, USD). The list lives in localStorage. */

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
  for (const kid of kids.flat()) if (kid != null) n.append(kid);
  return n;
};

const LS = { list: 'riftscan.list', manual: 'riftscan.manual', rate: 'riftscan.rate' };
const CONDITIONS = ['M', 'NM', 'SP', 'MP', 'HP', 'D'];
const LANGS = ['BR', 'EN', 'DE', 'ES', 'FR', 'IT', 'JP', 'KO', 'RU', 'TW'];
const CSV_HEADER = ['Edicao (PTBR)', 'Edicao (EN)', 'Edicao (Sigla)', 'Card (PT)', 'Card (EN)', 'Quantidade',
  'Qualidade (M NM SP MP HP D)', 'Idioma (BR EN DE ES FR IT JP KO RU TW)', 'Raridade',
  'Cor (C D O E Y F R G L M P W)', 'Extras', 'Card #', 'Comentario', '# Cards na Edicao'];
const FALLBACK_RATE = 5.5; // BRL per USD when the rate cannot be fetched

const state = { cards: [], sets: {}, byId: new Map(), prices: {}, pricesUpdated: null, rate: null, list: [], manual: {} };

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
async function loadData() {
  const [cards, prices] = await Promise.all([
    fetch('data/cards.json').then(r => r.json()),
    fetch('data/prices.json').then(r => r.json()).catch(() => ({ p: {}, updated: null })),
  ]);
  state.sets = cards.sets;
  state.cards = cards.cards.map(prep);
  state.prices = prices.p;
  state.pricesUpdated = prices.updated;
  state.byId = new Map(state.cards.map(c => [c.id, c]));
  for (const [id, c] of Object.entries(state.manual)) state.byId.set(id, prep(c));
}
const setLabel = c => state.sets[c.s] || c.s;
function unitPrices(c) {
  const p = c.t && state.prices[c.t];
  return p ? { normal: p[0], foil: p[1] } : { normal: null, foil: null };
}
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
const keyOf = it => [it.id, it.foil ? 1 : 0, it.q, it.lang].join('|');
function save() { localStorage.setItem(LS.list, JSON.stringify(state.list)); }
function addCard(card, foil) {
  const next = { id: card.id, qty: 1, foil, q: 'NM', lang: 'EN' };
  const hit = state.list.find(it => keyOf(it) === keyOf(next));
  if (hit) hit.qty++; else state.list.push(next);
  save(); renderList();
  toast(`Adicionada: ${card.n}${foil ? ' (foil)' : ''} · ${(hit || next).qty}x na lista`);
}
function itemValue(it) {
  const c = state.byId.get(it.id);
  if (!c) return null;
  const u = unitPrices(c)[it.foil ? 'foil' : 'normal'];
  return u == null ? null : u;
}

/* ---------- rendering ---------- */
function priceLine(c) {
  const u = unitPrices(c);
  return el('div', { class: 'price' }, 'Normal ', el('b', { text: usdText(u.normal) }), '  ·  Foil ', el('b', { text: usdText(u.foil) }));
}
function thumb(c) {
  return c.im ? el('img', { class: 'thumb', src: c.im, alt: '', loading: 'lazy', width: 44, height: 62 })
    : el('div', { class: 'thumb blank', text: c.s });
}
function renderResults(cards, title) {
  $('#results-wrap').hidden = false;
  $('#results-title').textContent = title;
  const ul = $('#results'); ul.replaceChildren();
  if (!cards.length) { ul.append(el('li', { class: 'meta', text: 'Nada encontrado. Tente outro trecho do nome ou o código, como OGN 108.' })); return; }
  for (const c of cards) {
    const meta = [setLabel(c), `#${c.c}`, c.r || null].filter(Boolean).join(' · ');
    ul.append(el('li', { class: 'result' }, thumb(c),
      el('div', { class: 'rname', text: c.n }),
      el('div', { class: 'rmeta', text: meta }),
      priceLine(c),
      el('div', { class: 'ract' },
        el('button', { class: 'btn', type: 'button', onclick: () => addCard(c, false) }, '+ Normal'),
        el('button', { class: 'btn', type: 'button', onclick: () => addCard(c, true) }, '+ Foil'))));
  }
}

function renderList() {
  const rows = $('#rows'); rows.replaceChildren();
  const copies = state.list.reduce((n, it) => n + it.qty, 0);
  const tc = $('#tab-count'); tc.hidden = !copies; tc.textContent = copies;
  $('#list-empty').hidden = state.list.length > 0;

  let totalUsd = 0, unpriced = 0;
  for (const it of state.list) { const v = itemValue(it); if (v == null) unpriced++; else totalUsd += v * it.qty; }
  const summary = $('#summary'); summary.replaceChildren();
  if (state.list.length) {
    const rate = state.rate ? state.rate.v : FALLBACK_RATE;
    summary.append(
      el('div', { class: 'big' }, String(copies), ' ', el('small', { text: copies === 1 ? 'carta' : 'cartas' })),
      el('div', { class: 'meta', text: `${state.list.length} ${state.list.length === 1 ? 'linha' : 'linhas'} no arquivo da Liga` }),
      el('div', { class: 'vals' },
        el('span', {}, el('b', { text: usdText(totalUsd) }), ' TCGplayer'),
        el('span', {}, el('b', { text: brlText(totalUsd * rate) }), ` a ${rate.toFixed(2).replace('.', ',')} por dólar`)),
      el('div', { class: 'meta', text: (unpriced ? `${unpriced} sem preço, fora da soma. ` : '') + 'Estimativa em dólar, não é o preço da Liga.' }),
      el('div', { class: 'tools' },
        el('button', { class: 'btn primary', type: 'button', 'data-go': 'export' }, 'Exportar para a Liga'),
        el('button', { class: 'btn text danger', type: 'button', onclick: clearList }, 'Limpar lista')));
    for (const b of summary.querySelectorAll('[data-go]')) b.addEventListener('click', () => show(b.dataset.go));
  }

  const sorted = [...state.list].sort((a, b) => cardOf(a).s.localeCompare(cardOf(b).s) || cardOf(a).n.localeCompare(cardOf(b).n));
  for (const it of sorted) rows.append(rowFor(it));
  renderExport();
}
const cardOf = it => state.byId.get(it.id) || { n: it.id, s: '', c: '', r: '', t: '' };

function rowFor(it) {
  const c = cardOf(it);
  const v = itemValue(it);
  const change = patch => { // editing may merge this row into an identical one
    Object.assign(it, patch);
    const dup = state.list.find(o => o !== it && keyOf(o) === keyOf(it));
    if (dup) { dup.qty += it.qty; state.list.splice(state.list.indexOf(it), 1); }
    save(); renderList();
  };
  const sel = (opts, cur, label, key) => {
    const s = el('select', { 'aria-label': `${label} de ${c.n}`, onchange: e => change({ [key]: e.target.value }) },
      opts.map(o => el('option', { value: o, text: o, selected: o === cur })));
    return s;
  };
  return el('li', { class: 'row' }, thumb(c),
    el('div', { class: 'rline' },
      el('div', { class: 'rname', text: c.n }),
      el('div', { class: 'price' }, v == null ? '—' : el('b', { text: usdText(v * it.qty) }))),
    el('div', { class: 'rmeta', text: [setLabel(c), c.c && `#${c.c}`, c.r].filter(Boolean).join(' · ') }),
    el('div', { class: 'rctl' },
      el('div', { class: 'stepper' },
        el('button', { type: 'button', 'aria-label': `Menos uma ${c.n}`, onclick: () => it.qty > 1 ? change({ qty: it.qty - 1 }) : removeItem(it) }, '−'),
        el('span', { class: 'qty', text: it.qty }),
        el('button', { type: 'button', 'aria-label': `Mais uma ${c.n}`, onclick: () => change({ qty: it.qty + 1 }) }, '+')),
      el('button', { class: 'chip', type: 'button', 'aria-pressed': String(it.foil), onclick: () => change({ foil: !it.foil }) }, 'Foil'),
      sel(CONDITIONS, it.q, 'Qualidade', 'q'),
      sel(LANGS, it.lang, 'Idioma', 'lang'),
      el('button', { class: 'btn text', type: 'button', onclick: () => removeItem(it) }, 'Remover')));
}
function removeItem(it) {
  state.list.splice(state.list.indexOf(it), 1);
  save(); renderList();
}
function clearList() {
  if (!state.list.length || !confirm('Apagar todas as cartas da lista?')) return;
  state.list = []; save(); renderList();
}

/* ---------- export ---------- */
const csvCell = v => { const s = String(v ?? ''); return /[\s,"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function sortedItems() {
  return [...state.list].sort((a, b) => cardOf(a).s.localeCompare(cardOf(b).s) || cardOf(a).n.localeCompare(cardOf(b).n) || a.foil - b.foil);
}
function buildCsv() {
  const lines = [CSV_HEADER.map(csvCell).join(',')];
  for (const it of sortedItems()) {
    const c = cardOf(it);
    lines.push(['', state.sets[c.s] || c.s, c.s, '', c.n, it.qty, it.q, it.lang, c.r, c.k, it.foil ? 'Foil' : '', c.c, '', '']
      .map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}
function buildNames(mode) {
  const items = sortedItems();
  if (mode === 'prefix') return items.map(it => `${it.qty} ${cardOf(it).n}`).join('\n');
  if (mode === 'once') return [...new Set(items.map(it => cardOf(it).n))].join('\n');
  return items.flatMap(it => Array(it.qty).fill(cardOf(it).n)).join('\n');
}
function renderExport() {
  const copies = state.list.reduce((n, it) => n + it.qty, 0);
  const empty = !state.list.length;
  $('#csv-meta').textContent = empty ? 'A lista está vazia.' : `${state.list.length} linhas · ${copies} cartas`;
  $('#csv-preview').textContent = empty ? '' : buildCsv();
  $('#names-preview').textContent = empty ? '' : buildNames($('#names-mode').value);
  for (const id of ['csv-download', 'csv-copy', 'names-copy', 'names-download']) $('#' + id).disabled = empty;
}
function download(name, text, type) {
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

/* ---------- search ---------- */
const CODE_RE = /^([a-z]{2,4})[\s\-#•.·]*0*(\d{1,3}[a-z]?)$/i;
function search(q) {
  q = q.trim();
  if (!q) return [];
  const m = q.match(CODE_RE);
  if (m) {
    const px = m[1].toLowerCase() === 'ropp' ? 'opp' : m[1].toLowerCase(), num = m[2].toLowerCase();
    const hits = state.cards.filter(c => c.px === px && (c.num === num || c.num.replace(/[a-z]+$/, '') === num));
    if (hits.length) return hits.slice(0, 30);
  }
  const toks = norm(q).split(' ').filter(Boolean);
  if (!toks.length) return [];
  const nq = toks.join(' ');
  return state.cards.filter(c => toks.every(t => c.full.includes(t)))
    .sort((a, b) => (b.full.startsWith(nq) - a.full.startsWith(nq)) || a.n.length - b.n.length)
    .slice(0, 30);
}

/* ---------- OCR ---------- */
const NUM_RE = /\b(ogn|ogs|sfd|unl|ven|opp|pr|jdg)\b[^a-z0-9]{0,4}0*(\d{1,3}[a-z]?)/gi;
let ocrWorker = null;
function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = el('script', { src, onload: ok, onerror: () => fail(new Error('Não foi possível carregar o leitor de texto. Ele precisa de internet na primeira vez.')) });
    document.head.append(s);
  });
}
async function getWorker(onProgress) {
  if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
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
  const nums = [...text.matchAll(NUM_RE)].map(m => [m[1].toLowerCase(), m[2].toLowerCase()]);
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
    if (s > 0.3 && nums.some(([p, n]) => p === c.px && (n === c.num || n === c.num.replace(/[a-z]+$/, '')))) s += 0.4;
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
  if (!['scan', 'list', 'export'].includes(view)) view = 'scan';
  for (const s of document.querySelectorAll('.view')) s.hidden = s.id !== 'view-' + view;
  for (const b of document.querySelectorAll('.tabs button')) {
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  if (view !== 'scan') closeLive();
  if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  window.scrollTo(0, 0);
}

async function init() {
  state.list = JSON.parse(localStorage.getItem(LS.list) || '[]');
  state.manual = JSON.parse(localStorage.getItem(LS.manual) || '{}');
  for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => show(b.dataset.view));
  for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => show(b.dataset.go));
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
  $('#csv-download').addEventListener('click', () => download(`riftscan-${stamp()}.csv`, buildCsv(), 'text/csv;charset=utf-8'));
  $('#csv-copy').addEventListener('click', () => copyText(buildCsv(), 'CSV'));
  $('#names-copy').addEventListener('click', () => copyText(buildNames($('#names-mode').value), 'Lista de nomes'));
  $('#names-download').addEventListener('click', () => download(`riftscan-nomes-${stamp()}.txt`, buildNames($('#names-mode').value) + '\n', 'text/plain;charset=utf-8'));

  show(location.hash.slice(1) || 'scan');
  try { await loadData(); } catch { toast('Não consegui carregar a base de cartas.'); }
  await loadRate();
  renderList();
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
