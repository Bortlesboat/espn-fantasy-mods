// ==UserScript==
// @name         ESPN Fantasy Mods
// @namespace    https://github.com/Bortlesboat/espn-fantasy-mods
// @version      0.2.0
// @description  Fixes and quality-of-life mods for ESPN Fantasy Football: corrected Chance to Win, scoreboard odds, optimal lineup on box scores, all-play/luck standings, Boris Chen tier badges, hide chat bar. Toggle each from the Tampermonkey menu.
// @author       Bortlesboat
// @match        https://fantasy.espn.com/football/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      s3-us-west-1.amazonaws.com
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/Bortlesboat/espn-fantasy-mods/master/dist/espn-fantasy-mods.user.js
// @updateURL    https://raw.githubusercontent.com/Bortlesboat/espn-fantasy-mods/master/dist/espn-fantasy-mods.user.js
// ==/UserScript==

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

/* ESPN fantasy football win probability — faithful replication of ESPN's
 * client-side formula plus a corrected version.
 *
 * ESPN (as shipped in fantasy.espn.com's kona bundle, Oct 2026):
 *   per team:  M = sum_i (x_i + f_i * m_i)         (mean)
 *              U = sum_i  f_i * (c_i - m_i)         ("upside", used as a SD)
 *   matchup:   sigma = sqrt((U_home^2 + U_away^2) / 2)
 *              P(home) = Phi((M_home - M_away) / sigma), clamped to [0.01, 0.99]
 *   where x = points so far, m = projection, c = projected ceiling
 *   (appliedTotalCeiling, fallback 1.5*m), f = share of game remaining.
 *
 * Two errors: (1) per-player spreads are summed instead of root-sum-squared;
 * (2) remaining spread is scaled by f instead of sqrt(f).
 *
 * Corrected:  sigma = k * sqrt( sum_both f_i * (c_i - m_i)^2 )
 *   k is a calibration constant (1.0 = pure fix). Fit on one 12-team league,
 *   weeks 1-5 2026, k came out ~0.8.
 */
(function (root, factory) {
  const api = factory();
  if (root) root.EspnWinProb = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis), function () {
  'use strict';

  const BENCH_SLOTS = new Set([20, 21]); // bench, IR
  const OUT = 'OUT';

  function phi(z) {
    // standard normal CDF via erf approximation (Abramowitz-Stegun 7.1.26)
    const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
    return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }

  function starterSlots(league) {
    const counts = league.settings.rosterSettings.lineupSlotCounts;
    const s = new Set();
    for (const k in counts) if (counts[k] > 0 && !BENCH_SLOTS.has(+k)) s.add(+k);
    return s;
  }

  // proTeamId -> share of game remaining (1 = not started, 0 = final / no game)
  function fractionRemaining(games) {
    const f = {};
    for (const e of (games && games.events) || []) {
      const state = e.fullStatus && e.fullStatus.type && e.fullStatus.type.state;
      const pc = e.percentComplete || 0;
      const rem = state === 'pre' ? 1 : state === 'post' ? 0 : Math.max(0, 1 - pc / 100);
      for (const c of e.competitors || []) f[+c.id] = rem;
    }
    return f;
  }

  function stat(player, sp, sourceId) {
    return (player.stats || []).find(s => s.scoringPeriodId === sp && s.statSourceId === sourceId);
  }

  function teamTerms(side, sp, slots, frac) {
    let M = 0, U = 0, Q = 0, minutesLeft = 0;
    const players = [];
    const roster = side.rosterForCurrentScoringPeriod;
    if (!roster) return null;
    for (const e of roster.entries || []) {
      if (!slots.has(e.lineupSlotId)) continue;
      const p = e.playerPoolEntry && e.playerPoolEntry.player;
      if (!p) continue;
      const act = stat(p, sp, 0), prj = stat(p, sp, 1);
      const f = frac[p.proTeamId] || 0;
      const x = (act && act.appliedTotal) || 0;
      const m = (prj && prj.appliedTotal) || 0;
      const c = (prj && prj.appliedTotalCeiling) || 1.5 * m;
      const out = p.injuryStatus === OUT;
      const rem = out ? 0 : f * m;
      const up = out ? 0 : f * (c - m);
      M += x + rem; U += up; Q += out ? 0 : f * (c - m) * (c - m);
      minutesLeft += f;
      players.push({ name: p.fullName, f, x, m, c });
    }
    return { M, U, Q, minutesLeft, players };
  }

  function clamp(p, anyTimeLeft) {
    if (!anyTimeLeft) return p;
    if (p > 0.99) return 0.99;
    if (p < 0.01) return 0.01;
    return p;
  }

  /** Returns per-matchup {homeTeamId, awayTeamId, espn, fixed, ...} for the current matchup period. */
  function compute(league, games, opts) {
    opts = opts || {};
    const k = opts.k == null ? 1.0 : opts.k;
    const sp = opts.scoringPeriodId || league.status.latestScoringPeriod;
    const mp = opts.matchupPeriodId || league.status.currentMatchupPeriod;
    const slots = starterSlots(league);
    const frac = fractionRemaining(games);
    const out = [];
    for (const mt of league.schedule || []) {
      if (mt.matchupPeriodId !== mp || !mt.home || !mt.away) continue;
      const H = teamTerms(mt.home, sp, slots, frac), A = teamTerms(mt.away, sp, slots, frac);
      if (!H || !A) continue;
      const diff = H.M - A.M;
      const timeLeft = H.minutesLeft > 0 || A.minutesLeft > 0;
      const sigE = Math.sqrt((H.U * H.U + A.U * A.U) / 2);
      const sigF = k * Math.sqrt(H.Q + A.Q);
      const tie = diff === 0 ? 0.5 : diff > 0 ? 1 : 0;
      const espn = sigE > 0 ? clamp(phi(diff / sigE), timeLeft) : tie;
      const fixed = sigF > 0 ? clamp(phi(diff / sigF), timeLeft) : tie;
      out.push({ matchupId: mt.id, homeTeamId: mt.home.teamId, awayTeamId: mt.away.teamId,
        homeMean: H.M, awayMean: A.M, sigmaEspn: sigE, sigmaFixed: sigF, espn, fixed, timeLeft });
    }
    return out;
  }

  function teamNames(league) {
    const names = {};
    for (const t of league.teams || []) names[t.id] = t.name || ((t.location || '') + ' ' + (t.nickname || '')).trim();
    return names;
  }

  return { phi, compute, teamNames, fractionRemaining, starterSlots };
}));

/* win-probability: rewrite "Chance to Win" trackers (FantasyCast) and add corrected odds to the Scoreboard. */
(function () {
  'use strict';
  const M = EspnMods, core = EspnWinProb;
  M.registerMod('winprob', 'Corrected win probability');
  if (!M.enabled('winprob')) return;
  const K = (typeof ESPN_WINPROB_K !== 'undefined') ? ESPN_WINPROB_K : 1.0;
  let results = null, names = {};
  const pct = p => Math.round(p * 100);

  M.css(`.espnmods-odds{list-style:none;font-size:11px;color:#6c6d6f;padding:2px 0 4px}.espnmods-odds b{color:#1a1a1a}.espnmods-sigma{font-size:10px;color:#6c6d6f;text-align:center;margin-top:2px}.winprob-badge{font-size:10px;opacity:.7;cursor:help}`);

  function recompute(data) {
    names = M.names(data.league);
    results = core.compute(data.league, data.games, { k: K });
    patchAll();
  }

  function matchupForTracker(tracker) {
    const entries = Object.entries(names).map(([id, n]) => [+id, M.norm(n)]).filter(e => e[1]);
    let el = tracker;
    for (let depth = 0; depth < 12 && el; depth++, el = el.parentElement) {
      const text = M.norm(el.innerText);
      const found = [];
      for (const [id, n] of entries) { const i = text.indexOf(n); if (i >= 0) found.push([i, id]); }
      const ids = [...new Set(found.sort((a, b) => a[0] - b[0]).map(f => f[1]))];
      if (ids.length >= 2) {
        const r = results.find(r => ids.includes(r.homeTeamId) && ids.includes(r.awayTeamId));
        if (r) return { r, leftIsHome: ids.indexOf(r.homeTeamId) < ids.indexOf(r.awayTeamId) };
      }
    }
    const tid = +M.q('teamId');
    const r = results.find(r => r.homeTeamId === tid || r.awayTeamId === tid);
    return r ? { r, leftIsHome: false } : null;
  }

  function patchTracker(tracker) {
    const m = matchupForTracker(tracker); if (!m) return;
    const { r, leftIsHome } = m;
    const L = pct(leftIsHome ? r.fixed : 1 - r.fixed), Rr = 100 - L;
    const eL = Math.floor((leftIsHome ? r.espn : 1 - r.espn) * 100), eR = 100 - eL;
    const pcts = tracker.querySelectorAll('.totalPerc'); if (pcts.length !== 2) return;
    const key = `${L}|${Rr}|${r.sigmaFixed.toFixed(1)}`;
    if (tracker.dataset.winprobKey === key) return;
    tracker.dataset.winprobKey = key;
    pcts[0].textContent = `${L}%`; pcts[1].textContent = `${Rr}%`;
    pcts[0].title = `ESPN shows ${eL}% — corrected ${L}%`; pcts[1].title = `ESPN shows ${eR}% — corrected ${Rr}%`;
    const bars = tracker.querySelectorAll('.chanceValue');
    if (bars[0]) bars[0].style.width = L + '%';
    if (bars[1]) bars[1].style.width = Rr + '%';
    const label = tracker.querySelector('.trackerLabel, .header');
    if (label && !label.querySelector('.winprob-badge')) {
      const b = M.el('span', 'winprob-badge', ' (fixed)');
      b.title = 'Recomputed with root-sum-square player spreads and sqrt time scaling. Hover the numbers for ESPN\'s original.';
      label.appendChild(b);
    }
    let sig = tracker.querySelector('.espnmods-sigma');
    if (!sig) { sig = M.el('div', 'espnmods-sigma'); tracker.appendChild(sig); }
    const lm = leftIsHome ? r.homeMean : r.awayMean, rm = leftIsHome ? r.awayMean : r.homeMean;
    sig.textContent = `proj ${lm.toFixed(1)} vs ${rm.toFixed(1)} · spread σ ${r.sigmaFixed.toFixed(1)} (ESPN used ${r.sigmaEspn.toFixed(1)})`;
  }

  // League Scoreboard: one line of corrected odds under every matchup
  function patchScoreboard() {
    document.querySelectorAll('ul.ScoreboardScoreCell__Competitors').forEach(ul => {
      const ids = Array.from(ul.querySelectorAll('li a[href*="teamId="]')).map(a => +(a.href.match(/teamId=(\d+)/) || [])[1]).filter(Boolean);
      const uniq = [...new Set(ids)]; if (uniq.length < 2) return;
      const r = results.find(r => uniq.includes(r.homeTeamId) && uniq.includes(r.awayTeamId)); if (!r) return;
      const topIsHome = uniq[0] === r.homeTeamId;
      const top = pct(topIsHome ? r.fixed : 1 - r.fixed), bot = 100 - top;
      const eTop = Math.floor((topIsHome ? r.espn : 1 - r.espn) * 100);
      const key = `${top}|${eTop}`;
      let li = ul.querySelector('.espnmods-odds');
      if (!li) { li = M.el('li', 'espnmods-odds'); ul.appendChild(li); }
      if (li.dataset.key === key) return; li.dataset.key = key;
      li.innerHTML = ''; li.append('Win odds: '); li.appendChild(M.el('b', '', `${top}% – ${bot}%`)); li.append(`  (ESPN ${eTop}–${100 - eTop})`);
      li.title = `Corrected chance to win, top team first. σ ${r.sigmaFixed.toFixed(1)} vs ESPN's ${r.sigmaEspn.toFixed(1)}`;
    });
  }

  function patchAll() { if (!results) return; document.querySelectorAll('.chanceToWinTracker').forEach(patchTracker); patchScoreboard(); }

  M.onData(recompute);
  M.observe(patchAll);
  M.onUrlChange(() => M.load({ force: true }).catch(e => console.warn(M.LOG, e)));
  M.load().catch(e => console.warn(M.LOG, 'winprob load failed', e));
  M.startAutoRefresh();
  window.__espnWinProb = { get results() { return results; }, get names() { return names; }, refresh: () => M.load({ force: true }) };
})();

/* Optimal lineup: best possible starting lineup from a roster given slot counts and eligibility. */
(function (root, factory) {
  const api = factory(); if (root) root.EspnOptimal = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const NON_START = new Set([20, 21]);
  function slotsFor(league) {
    const counts = league.settings.rosterSettings.lineupSlotCounts; const out = [];
    for (const k in counts) if (!NON_START.has(+k)) for (let i = 0; i < counts[k]; i++) out.push(+k);
    return out;
  }
  /** players: [{id, name, points, eligibleSlots:[], lineupSlotId}] ; returns {optimal, actual, lineup:[{slot,player}], benchLeft} */
  function solve(players, slots) {
    const pool = players.filter(p => p.lineupSlotId !== 21); // IR cannot start
    const actual = players.filter(p => !NON_START.has(p.lineupSlotId)).reduce((s, p) => s + (p.points || 0), 0);
    // order slots: most restrictive first (fewest eligible players)
    const elig = slots.map(s => pool.filter(p => (p.eligibleSlots || []).includes(s)).sort((a, b) => (b.points || 0) - (a.points || 0)));
    const order = slots.map((s, i) => i).sort((a, b) => elig[a].length - elig[b].length);
    const CAND = 6; const memo = new Map();
    const idx = new Map(pool.map((p, i) => [p, i]));
    function best(k, used) {
      if (k === order.length) return { v: 0, picks: [] };
      const key = k + ':' + used; if (memo.has(key)) return memo.get(key);
      let res = { v: -Infinity, picks: [] };
      let tried = 0;
      for (const p of elig[order[k]]) {
        const bit = 1 << idx.get(p); if (used & bit) continue;
        const sub = best(k + 1, used | bit);
        const v = (p.points || 0) + sub.v;
        if (v > res.v) res = { v, picks: [[order[k], p]].concat(sub.picks) };
        if (++tried >= CAND) break;
      }
      if (res.v === -Infinity) { res = best(k + 1, used); } // slot cannot be filled
      memo.set(key, res); return res;
    }
    const r = best(0, 0);
    const lineup = r.picks.map(([si, p]) => ({ slot: slots[si], player: p }));
    return { optimal: Math.max(r.v, 0), actual, lineup, benchLeft: Math.max(0, r.v - actual) };
  }
  function rosterPlayers(side, sp) {
    const roster = side.rosterForCurrentScoringPeriod; if (!roster) return [];
    return (roster.entries || []).map(e => { const p = e.playerPoolEntry && e.playerPoolEntry.player; if (!p) return null;
      const st = (p.stats || []).find(s => s.scoringPeriodId === sp && s.statSourceId === 0);
      return { id: p.id, name: p.fullName, points: (st && st.appliedTotal) || 0, eligibleSlots: p.eligibleSlots || [], lineupSlotId: e.lineupSlotId }; }).filter(Boolean);
  }
  return { slotsFor, solve, rosterPlayers };
}));

/* optimal-lineup: on the Box Score page, show each team's optimal lineup total and points left on the bench. */
(function () {
  'use strict';
  const M = EspnMods, O = EspnOptimal;
  M.registerMod('optimal', 'Optimal lineup on box scores');
  if (!M.enabled('optimal')) return;
  if (M.page() !== 'boxscore') return;
  let data = null;
  const spFromUrl = () => +M.q('matchupPeriodId') || +M.q('scoringPeriodId') || undefined;

  function patch() {
    if (!data) return;
    const league = data.league, sp = league.scoringPeriodId || league.status.latestScoringPeriod;
    const headers = Array.from(document.querySelectorAll('.teamHeaders .teamName')).map(e => M.norm(e.getAttribute('title') || e.textContent));
    const statuses = document.querySelectorAll('.teamPlayerStatus');
    if (headers.length < 2 || statuses.length < 2) return;
    const names = M.names(league); const byName = {}; for (const id in names) byName[M.norm(names[id])] = +id;
    const ids = headers.map(h => byName[h]); if (!ids[0] || !ids[1]) return;
    const mt = (league.schedule || []).find(m => m.home && m.away && ids.includes(m.home.teamId) && ids.includes(m.away.teamId) && m.home.rosterForCurrentScoringPeriod);
    if (!mt) return;
    const slots = O.slotsFor(league);
    ids.slice(0, 2).forEach((tid, i) => {
      const side = mt.home.teamId === tid ? mt.home : mt.away;
      const r = O.solve(O.rosterPlayers(side, sp), slots);
      const host = statuses[i]; const key = r.optimal.toFixed(1) + '|' + r.benchLeft.toFixed(1);
      let lab = host.querySelector('.espnmods-optimal');
      if (!lab) { lab = M.el('div', 'statusLabel espnmods-optimal'); lab.append('Optimal:'); lab.appendChild(M.el('span', 'statusValue fw-bold')); host.appendChild(lab); }
      if (lab.dataset.key === key) return; lab.dataset.key = key;
      lab.querySelector('.statusValue').textContent = `${r.optimal.toFixed(1)}` + (r.benchLeft > 0.05 ? ` (−${r.benchLeft.toFixed(1)})` : '');
      lab.title = 'Best possible lineup from this roster: ' + r.lineup.map(l => `${l.player.name} ${l.player.points.toFixed(1)}`).join(', ');
    });
  }
  M.onData(d => { data = d; patch(); });
  M.observe(patch);
  M.load({ scoringPeriodId: spFromUrl() }).catch(e => console.warn(M.LOG, 'optimal load failed', e));
  M.onUrlChange(() => M.load({ scoringPeriodId: spFromUrl(), force: true }).catch(() => {}));
})();

/* Standings extras: all-play record, expected wins, luck, points-for rank. */
(function (root, factory) {
  const api = factory(); if (root) root.EspnStandings = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function compute(league) {
    const cur = league.status.currentMatchupPeriod;
    const weeks = {};
    for (const m of league.schedule || []) {
      if (!m.home || !m.away || m.matchupPeriodId >= cur) continue;
      if (m.winner === 'UNDECIDED') continue;
      (weeks[m.matchupPeriodId] = weeks[m.matchupPeriodId] || []).push([m.home.teamId, m.home.totalPoints || 0], [m.away.teamId, m.away.totalPoints || 0]);
    }
    const out = {};
    for (const t of league.teams || []) out[t.id] = { teamId: t.id, apW: 0, apL: 0, apT: 0, expWins: 0, games: 0, pf: (t.record && t.record.overall && t.record.overall.pointsFor) || t.points || 0, wins: (t.record && t.record.overall && t.record.overall.wins) || 0 };
    for (const w in weeks) {
      const rows = weeks[w]; const n = rows.length;
      for (const [tid, pts] of rows) {
        const o = out[tid]; if (!o) continue;
        let W = 0, L = 0, T = 0;
        for (const [oid, op] of rows) { if (oid === tid) continue; if (pts > op) W++; else if (pts < op) L++; else T++; }
        o.apW += W; o.apL += L; o.apT += T; o.games++;
        o.expWins += n > 1 ? (W + 0.5 * T) / (n - 1) : 0;
      }
    }
    const byPf = Object.values(out).sort((a, b) => b.pf - a.pf);
    byPf.forEach((o, i) => { o.pfRank = i + 1; });
    for (const id in out) { const o = out[id]; o.luck = o.wins - o.expWins; }
    return out;
  }
  return { compute };
}));

/* standings-plus: adds ALL-PLAY, LUCK and PF RK columns to the Season Stats table on the Standings page. */
(function () {
  'use strict';
  const M = EspnMods, S = EspnStandings;
  M.registerMod('standings', 'All-play record + luck on standings');
  if (!M.enabled('standings')) return;
  if (M.page() !== 'standings') return;
  let stats = null, names = {};
  M.css(`.espnmods-luck-pos{color:#0a7d2e}.espnmods-luck-neg{color:#c0392b}`);

  function patch() {
    if (!stats) return;
    const tables = Array.from(document.querySelectorAll('table.Table'));
    // Season Stats: a fixed-left table (RK, TEAM) paired with a right table whose header starts with PF
    const right = tables.find(t => /^PF\b/.test((t.querySelector('thead') || {}).innerText || ''));
    const left = tables.find(t => t.classList.contains('Table--fixed-left') && t.querySelectorAll('tbody tr').length === (right ? right.querySelectorAll('tbody tr').length : -1));
    if (!right || !left) return;
    if (right.dataset.espnmods === 'done') return;
    const byName = {}; for (const id in names) byName[M.norm(names[id])] = +id;
    const head = right.querySelector('thead tr'); if (!head) return;
    for (const [txt, title] of [['ALL-PLAY', 'Record if you had played every team every week'], ['LUCK', 'Actual wins minus expected wins from all-play (+ = lucky schedule)'], ['PF RK', 'Rank by points for']]) {
      const th = M.el('th', 'Table__TH', txt); th.title = title; th.style.textAlign = 'right'; head.appendChild(th);
    }
    const lrows = left.querySelectorAll('tbody tr'), rrows = right.querySelectorAll('tbody tr');
    rrows.forEach((tr, i) => {
      const nameEl = lrows[i] && lrows[i].querySelector('.teamName'); const tid = nameEl && byName[M.norm(nameEl.getAttribute('title') || nameEl.textContent)];
      const s = tid && stats[tid];
      const cells = s ? [`${s.apW}-${s.apL}${s.apT ? '-' + s.apT : ''}`, (s.luck >= 0 ? '+' : '') + s.luck.toFixed(1), String(s.pfRank)] : ['', '', ''];
      cells.forEach((c, j) => { const td = M.el('td', 'Table__TD'); const d = M.el('div', 'jsx-2810852873 table--cell tar', c); if (j === 1 && s) d.classList.add(s.luck >= 0 ? 'espnmods-luck-pos' : 'espnmods-luck-neg'); td.appendChild(d); tr.appendChild(td); });
    });
    right.dataset.espnmods = 'done';
  }
  M.onData(d => { names = M.names(d.league); stats = S.compute(d.league); patch(); });
  M.observe(patch);
  M.load().catch(e => console.warn(M.LOG, 'standings load failed', e));
})();

/* Boris Chen tiers (borischen.co): parse the public text files and match ESPN player names. */
(function (root, factory) {
  const api = factory(); if (root) root.EspnTiers = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const BASE = 'https://s3-us-west-1.amazonaws.com/fftiers/out/';
  const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
  function fileFor(pos, fmt) { // fmt: 'PPR' | 'HALF' | ''
    const suffix = (pos === 'RB' || pos === 'WR' || pos === 'TE' || pos === 'FLX') && fmt ? '-' + fmt : '';
    return BASE + 'text_' + pos + suffix + '.txt';
  }
  function formatFor(league) {
    const items = (((league || {}).settings || {}).scoringSettings || {}).scoringItems || [];
    const rec = (items.find(s => s.statId === 53) || {}).points || 0;
    return rec >= 1 ? 'PPR' : rec >= 0.5 ? 'HALF' : '';
  }
  const normName = s => (s || '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  function parse(text) {
    const map = {};
    for (const line of (text || '').split('\n')) {
      const m = line.match(/^Tier\s+(\d+):\s*(.*)$/); if (!m) continue;
      for (const n of m[2].split(',')) { const k = normName(n); if (k) map[k] = +m[1]; }
    }
    return map;
  }
  // ESPN names D/ST like "Bills D/ST"; tiers use "Buffalo Bills" → match on nickname (last word)
  function lookup(map, name, pos) {
    if (pos === 'DST') { const nick = normName(name.replace(/d\/st/i, '')).split(' ').pop(); for (const k in map) if (k.split(' ').pop() === nick) return map[k]; return null; }
    const k = normName(name); if (map[k] != null) return map[k];
    const parts = k.split(' '); if (parts.length > 2) { const short = parts[0] + ' ' + parts[parts.length - 1]; if (map[short] != null) return map[short]; }
    return null;
  }
  return { POS, fileFor, formatFor, parse, lookup, normName };
}));

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

/* declutter: hide the sticky "Fantasy Chat" bar. Toggle from the Tampermonkey menu. */
(function () {
  'use strict';
  const M = EspnMods;
  M.registerMod('declutter', 'Hide Fantasy Chat bar');
  if (!M.enabled('declutter')) return;
  M.css(`.bottomBarContainer{display:none !important}`);
})();
