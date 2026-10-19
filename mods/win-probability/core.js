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
