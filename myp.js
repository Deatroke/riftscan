'use strict';
/* MYP Cards API client (https://mypcards.github.io/mypcards-api/). Read-only: catalog and prices, no user data.
   The token is optional; it only raises the rate limit from 10 to 60 requests/minute (per IP and route).
   Any app screen that shows MYP data must credit MYP Cards with a link to https://mypcards.com. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MYP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const GAME = 'riftbound';
  const SITE = 'https://mypcards.com';
  const cfg = { base: SITE + '/api/v1', token: '', fetch: null };
  const rate = { limit: null, remaining: null };

  class MypError extends Error {
    constructor(code, status, message) { super(message || code); this.name = 'MypError'; this.code = code; this.status = status; }
  }
  const MESSAGES = {
    rate_limited: 'Limite de requisições do MYP Cards atingido. Espere um minuto ou use um token.',
    blocked: 'O MYP Cards bloqueou a requisição (verificação do Cloudflare).',
    network: 'Sem conexão com o MYP Cards.',
    card_not_found: 'Carta não encontrada no MYP Cards.',
    product_not_found: 'Produto não encontrado no MYP Cards.',
  };

  function configure(opts) { Object.assign(cfg, opts); }

  async function request(path, signal) {
    const headers = { Accept: 'application/json' };
    if (cfg.token) headers['X-Api-Token'] = cfg.token; // an invalid token counts as none, so sending it is harmless
    let res;
    try { res = await (cfg.fetch || fetch)(cfg.base + path, { headers, signal }); }
    catch (err) { if (err.name === 'AbortError') throw err; throw new MypError('network', 0, MESSAGES.network); }
    const lim = res.headers.get('X-Rate-Limit-Limit'), rem = res.headers.get('X-Rate-Limit-Remaining');
    if (lim != null) { rate.limit = +lim; rate.remaining = +rem; }
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    if (res.ok && body) return body;
    if (!body) {
      // A Cloudflare challenge and the documented HTML 404 both arrive here as non-JSON.
      throw new MypError(res.status === 403 ? 'blocked' : 'http_error', res.status, res.status === 403 ? MESSAGES.blocked : `Resposta inesperada (${res.status}).`);
    }
    const code = body.code || (res.status === 429 ? 'rate_limited' : 'http_error');
    throw new MypError(code, res.status, MESSAGES[code] || body.error);
  }

  const b64 = s => (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'latin1').toString('base64'));

  /* ---------- endpoints ---------- */
  const games = signal => request('/jogos', signal);
  const editions = (game = GAME, signal) => request(`/${game}/edicoes`, signal);
  // Lists only cards that have stock for sale; paginate until `cards` comes back empty (no total is returned).
  const pricePage = (page, size = 50, game = GAME, signal) => request(`/${game}/precos?page_number=${page}&page_size=${size}`, signal);
  // `code` is the MYP card_code (e.g. "LOB-001"); the API wants it Base64-encoded. Works for cards with no stock too.
  const byCode = (code, game = GAME, signal) => request(`/${game}/precos/${encodeURIComponent(b64(code))}`, signal);
  const byName = (name, game = GAME, signal) => request(`/${game}/carta/${encodeURIComponent(name)}`, signal);
  const product = (internalCode, signal) => request(`/produto/${encodeURIComponent(internalCode)}`, signal);
  const history = (internalCode, signal) => request(`/produto/${encodeURIComponent(internalCode)}/historico`, signal);

  /* ---------- shaping ---------- */
  const num = v => (v == null || v === '' ? null : +v);
  // Produto -> the compact row stored in data/myp.json, keyed by tcg_productId:
  // { ic: internal_code, min, avg (BRL, null without stock), label: deck_labels[0], link }
  // the link becomes an href, so anything but http(s) (javascript:, data:) is dropped
  function webUrl(u) {
    try { const x = new URL(String(u)); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; }
  }
  function compact(p) {
    return { ic: p.internal_code, min: num(p.min_price), avg: num(p.avg_price), label: (p.deck_labels && p.deck_labels[0]) || null, link: webUrl(p.link) };
  }

  return { GAME, SITE, rate, MypError, configure, request, b64, games, editions, pricePage, byCode, byName, product, history, compact, webUrl };
});
