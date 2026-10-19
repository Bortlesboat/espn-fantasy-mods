/* Shared runtime for all mods: settings, ESPN data layer, DOM helpers. */
(function (root) {
  'use strict';
  if (root.EspnMods) return;
  const API = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';
  const GAMES = 'https://site.api.espn.com/apis/fantasy/v2/games/ffl/games';
  const LOG = '[espn-mods]';
  const SETTINGS_KEY = 'espnmods.settings';

  // ---- settings (per-mod on/off), persisted in localStorage, toggled via Tampermonkey menu
  const defaults = {};
  function settings() { try { return Object.assign({}, defaults, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { return Object.assign({}, defaults); } }
  function setSetting(k, v) { const s = settings(); s[k] = v; localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
  function enabled(mod) { return settings()[mod] !== false; }
  function registerMod(mod, label, defaultOn) {
    defaults[mod] = defaultOn !== false;
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand(`${enabled(mod) ? '✓' : '✗'} ${label}`, () => { setSetting(mod, !enabled(mod)); location.reload(); });
    }
  }

  // ---- URL helpers
  const q = name => new URL(location.href).searchParams.get(name);
  const page = () => (location.pathname.match(/\/football\/(?:league\/)?([a-z]+)/) || [])[1] || '';

  // ---- data layer: league JSON + NFL games JSON, cached, shared by all mods
  const cache = {};
  const listeners = [];
  let liveTimer = null;

  function weekDates() {
    const d = new Date(); const back = (d.getDay() + 5) % 7; // days since Tuesday
    const start = new Date(d); start.setDate(d.getDate() - back);
    const end = new Date(start); end.setDate(start.getDate() + 7);
    const fmt = x => x.toISOString().slice(0, 10).replace(/-/g, '');
    return fmt(start) + '-' + fmt(end);
  }

  async function fetchLeague(scoringPeriodId) {
    const leagueId = q('leagueId'); if (!leagueId) return null;
    const season = q('seasonId') || new Date().getFullYear();
    const sp = scoringPeriodId ? `scoringPeriodId=${scoringPeriodId}&` : '';
    const r = await fetch(`${API}/${season}/segments/0/leagues/${leagueId}?${sp}view=mMatchupScore&view=mBoxscore&view=mRoster&view=mSettings&view=mStatus&view=mTeam`, { credentials: 'include' });
    if (!r.ok) throw new Error('league fetch ' + r.status);
    return r.json();
  }
  async function fetchGames() {
    const r = await fetch(`${GAMES}?useMap=true&dates=${weekDates()}&pbpOnly=true`); // public endpoint; wildcard CORS => no credentials
    if (!r.ok) throw new Error('games fetch ' + r.status);
    return r.json();
  }

  async function load(opts) {
    opts = opts || {};
    const key = String(opts.scoringPeriodId || 'current');
    const now = Date.now();
    if (!opts.force && cache[key] && cache[key].data && now - cache[key].at < 30 * 1000) return cache[key].data;
    if (cache[key] && cache[key].inflight) return cache[key].inflight;
    const p = (async () => {
      const [league, games] = await Promise.all([fetchLeague(opts.scoringPeriodId), fetchGames()]);
      const data = { league, games, at: now };
      cache[key] = { at: now, data };
      listeners.forEach(fn => { try { fn(data, key); } catch (e) { console.warn(LOG, e); } });
      return data;
    })();
    cache[key] = Object.assign(cache[key] || {}, { inflight: p });
    try { return await p; } finally { if (cache[key]) delete cache[key].inflight; }
  }

  function anyLive(games) { return ((games && games.events) || []).some(e => e.fullStatus && e.fullStatus.type && e.fullStatus.type.state === 'in'); }
  function startAutoRefresh(opts) {
    if (liveTimer) return;
    liveTimer = setInterval(async () => {
      const key = String((opts && opts.scoringPeriodId) || 'current');
      const c = cache[key]; const live = c && c.data && anyLive(c.data.games);
      if (!c || live || Date.now() - c.at > 5 * 60 * 1000) { try { await load(Object.assign({ force: true }, opts)); } catch (e) { console.warn(LOG, e); } }
    }, 60 * 1000);
  }

  // ---- misc helpers
  const names = league => { const n = {}; for (const t of (league && league.teams) || []) n[t.id] = t.name || ((t.location || '') + ' ' + (t.nickname || '')).trim(); return n; };
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  function observe(fn) { const mo = new MutationObserver(() => fn()); mo.observe(document.documentElement, { childList: true, subtree: true }); return mo; }
  function onUrlChange(fn) { let last = location.href; setInterval(() => { if (location.href !== last) { last = location.href; fn(); } }, 1000); }
  function css(text) { const s = document.createElement('style'); s.textContent = text; document.documentElement.appendChild(s); }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  // player rows across ESPN tables: headshot img carries the ESPN player id
  function playerIdFromRow(row) { const img = row.querySelector('img[src*="/headshots/nfl/players/full/"]'); const m = img && img.src.match(/players\/full\/(\d+)\.png/); return m ? +m[1] : null; }

  root.EspnMods = { LOG, q, page, load, startAutoRefresh, onData: fn => listeners.push(fn), names, norm, observe, onUrlChange, css, el, playerIdFromRow, settings, setSetting, enabled, registerMod, anyLive };
})(typeof window !== 'undefined' ? window : globalThis);
