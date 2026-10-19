// ==UserScript==
// @name         ESPN Fantasy — Fixed Chance to Win
// @namespace    https://github.com/Bortlesboat/espn-fantasy-mods
// @version      0.1.0
// @description  Replaces ESPN fantasy football's miscalibrated "Chance to Win" with a correctly computed one (root-sum-square player spreads, sqrt time scaling).
// @author       Bortlesboat
// @match        https://fantasy.espn.com/football/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

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

/* Page glue for fantasy.espn.com: fetch the same data the page uses,
 * recompute win probability, and rewrite the "Chance to Win" tracker. */
(function () {
  'use strict';
  const core = (typeof EspnWinProb !== 'undefined') ? EspnWinProb : require('./core.js');
  const K = (typeof ESPN_WINPROB_K !== 'undefined') ? ESPN_WINPROB_K : 1.0;
  const API = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';
  const GAMES = 'https://site.api.espn.com/apis/fantasy/v2/games/ffl/games';
  const LOG = '[espn-winprob]';
  let league = null, games = null, results = null, names = {};

  function q(name) { return new URL(location.href).searchParams.get(name); }

  function weekDates() {
    // ESPN requests Thu..Tue around the current NFL week; a Tue..Tue window covers it.
    const d = new Date(); const day = d.getDay(); // 0=Sun
    const back = (day + 5) % 7; // days since Tuesday
    const start = new Date(d); start.setDate(d.getDate() - back);
    const end = new Date(start); end.setDate(start.getDate() + 7);
    const fmt = x => x.toISOString().slice(0, 10).replace(/-/g, '');
    return fmt(start) + '-' + fmt(end);
  }

  async function refresh() {
    const leagueId = q('leagueId'); if (!leagueId) return;
    const season = q('seasonId') || new Date().getFullYear();
    try {
      const lr = await fetch(`${API}/${season}/segments/0/leagues/${leagueId}?view=mMatchupScore&view=mBoxscore&view=mRoster&view=mSettings&view=mStatus&view=mTeam`, { credentials: 'include' });
      league = await lr.json();
      const gr = await fetch(`${GAMES}?useMap=true&dates=${weekDates()}&pbpOnly=true`); // public, wildcard CORS: no credentials
      games = await gr.json();
      names = core.teamNames(league);
      results = core.compute(league, games, { k: K });
      console.log(LOG, 'computed', results.map(r => `${names[r.homeTeamId]} ${Math.round(r.fixed*100)}% (espn ${Math.round(r.espn*100)}%) vs ${names[r.awayTeamId]}`));
      patchAll();
    } catch (e) { console.warn(LOG, 'refresh failed', e); }
  }

  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  // Find which matchup a tracker belongs to by looking for two team names in its ancestors.
  function matchupFor(tracker) {
    if (!results) return null;
    const entries = Object.entries(names).map(([id, n]) => [+id, norm(n)]).filter(e => e[1]);
    let el = tracker;
    for (let depth = 0; depth < 12 && el; depth++, el = el.parentElement) {
      const text = norm(el.innerText);
      const found = [];
      for (const [id, n] of entries) { const i = text.indexOf(n); if (i >= 0) found.push([i, id]); }
      const ids = [...new Set(found.sort((a, b) => a[0] - b[0]).map(f => f[1]))];
      if (ids.length >= 2) {
        const r = results.find(r => ids.includes(r.homeTeamId) && ids.includes(r.awayTeamId));
        if (r) return { r, leftIsHome: ids.indexOf(r.homeTeamId) < ids.indexOf(r.awayTeamId) };
      }
    }
    // fallback: single matchup page with ?teamId=
    const tid = +q('teamId');
    const r = results.find(r => r.homeTeamId === tid || r.awayTeamId === tid);
    return r ? { r, leftIsHome: false } : null; // ESPN boxscore shows away on the left
  }

  function patch(tracker) {
    const m = matchupFor(tracker); if (!m) return;
    const { r, leftIsHome } = m;
    const leftFixed = leftIsHome ? r.fixed : 1 - r.fixed;
    const leftEspn = leftIsHome ? r.espn : 1 - r.espn;
    const L = Math.round(leftFixed * 100), Rr = 100 - L;
    const eL = Math.floor(leftEspn * 100), eR = 100 - eL;
    const pcts = tracker.querySelectorAll('.totalPerc');
    if (pcts.length !== 2) return;
    const key = `${L}|${Rr}`;
    if (tracker.dataset.winprobKey === key) return;
    tracker.dataset.winprobKey = key;
    pcts[0].textContent = `${L}%`; pcts[1].textContent = `${Rr}%`;
    pcts[0].title = `ESPN shows ${eL}% — corrected ${L}%`; pcts[1].title = `ESPN shows ${eR}% — corrected ${Rr}%`;
    const bars = tracker.querySelectorAll('.chanceValue');
    if (bars[0]) bars[0].style.width = L + '%';
    if (bars[1]) bars[1].style.width = Rr + '%';
    const label = tracker.querySelector('.trackerLabel, .header');
    if (label && !label.querySelector('.winprob-badge')) {
      const b = document.createElement('span'); b.className = 'winprob-badge';
      b.textContent = ' (fixed)'; b.title = `Recomputed with root-sum-square spreads; ESPN: ${eL}%–${eR}%`;
      b.style.cssText = 'font-size:10px;opacity:.7;cursor:help';
      label.appendChild(b);
    }
  }

  function patchAll() { document.querySelectorAll('.chanceToWinTracker').forEach(patch); }

  new MutationObserver(() => { if (results) patchAll(); }).observe(document.documentElement, { childList: true, subtree: true });
  refresh();
  setInterval(refresh, 60 * 1000);
  let lastUrl = location.href;
  setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; refresh(); } }, 1000);
  if (typeof window !== 'undefined') window.__espnWinProb = { refresh, get results() { return results; }, get names() { return names; } };
})();
