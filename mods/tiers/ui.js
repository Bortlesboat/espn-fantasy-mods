/* tiers: Boris Chen tier badge next to every player name (team, box score, players pages). Needs GM_xmlhttpRequest (S3 has no CORS). */
(function () {
  'use strict';
  const M = EspnMods, T = EspnTiers;
  M.registerMod('tiers', 'Boris Chen tier badges');
  if (!M.enabled('tiers')) return;
  if (typeof GM_xmlhttpRequest !== 'function') { console.warn(M.LOG, 'tiers: GM_xmlhttpRequest not available'); return; }
  const CACHE_KEY = 'espnmods.tiers.v1', TTL = 6 * 3600 * 1000;
  const colors = ['#1b7f3b', '#2e9e4f', '#7cb342', '#c0a000', '#e08a00', '#d9534f', '#b03a2e', '#7b241c', '#5b2c6f', '#2c3e50'];
  M.css(`.espnmods-tier{display:inline-block;min-width:22px;padding:0 4px;margin-left:5px;border-radius:9px;font-size:10px;line-height:15px;color:#fff;text-align:center;font-weight:700;vertical-align:middle}`);
  let tiers = null, posById = {}, fmt = '';

  const gmGet = url => new Promise((res, rej) => GM_xmlhttpRequest({ method: 'GET', url, onload: r => r.status === 200 ? res(r.responseText) : rej(new Error(url + ' ' + r.status)), onerror: rej }));

  async function loadTiers(format) {
    try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); if (c && c.fmt === format && Date.now() - c.at < TTL) return c.tiers; } catch (e) {}
    const out = {};
    await Promise.all(['QB', 'RB', 'WR', 'TE', 'K', 'DST'].map(async p => { try { out[p] = T.parse(await gmGet(T.fileFor(p, format))); } catch (e) { console.warn(M.LOG, 'tiers', e.message); } }));
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ fmt: format, at: Date.now(), tiers: out })); } catch (e) {}
    return out;
  }

  function posFromRow(row, pid) {
    if (pid && posById[pid]) return posById[pid];
    const labelled = row.querySelector('[aria-label]');
    const aria = labelled ? labelled.getAttribute('aria-label') : '';
    const m = (aria || '').match(/\b(Quarterback|Running Back|Wide Receiver|Tight End|Place Kicker|Kicker|D\/ST|Defense)/i);
    if (!m) return null;
    return { quarterback: 'QB', 'running back': 'RB', 'wide receiver': 'WR', 'tight end': 'TE', 'place kicker': 'K', kicker: 'K', 'd/st': 'DST', defense: 'DST' }[m[1].toLowerCase()] || null;
  }

  function patch() {
    if (!tiers) return;
    document.querySelectorAll('.player-column__athlete').forEach(ath => {
      if (ath.querySelector('.espnmods-tier')) return;
      const nameEl = ath.querySelector('a') || ath; const name = (ath.getAttribute('title') || nameEl.textContent || '').trim(); if (!name) return;
      const row = ath.closest('tr') || ath.closest('[class*="player-info"]') || ath.parentElement;
      const pid = row ? M.playerIdFromRow(row) : null;
      const pos = posFromRow(row || ath, pid); if (!pos || !tiers[pos]) return;
      const t = T.lookup(tiers[pos], name, pos); if (!t) return;
      const b = M.el('span', 'espnmods-tier', 'T' + t); b.style.background = colors[Math.min(t, colors.length) - 1];
      b.title = `Boris Chen ${pos}${fmt ? ' ' + fmt : ''} tier ${t} (borischen.co)`;
      (nameEl.parentElement || ath).appendChild(b);
    });
  }

  M.onData(d => {
    fmt = T.formatFor(d.league);
    for (const t of d.league.teams || []) for (const e of ((t.roster || {}).entries || [])) { const p = e.playerPoolEntry && e.playerPoolEntry.player; if (p) posById[p.id] = T.POS[p.defaultPositionId]; }
    if (!tiers) loadTiers(fmt).then(t => { tiers = t; patch(); });
    else patch();
  });
  M.observe(patch);
  M.load().catch(e => { console.warn(M.LOG, 'tiers: league load failed, using name-only matching', e); loadTiers('').then(t => { tiers = t; patch(); }); });
})();
