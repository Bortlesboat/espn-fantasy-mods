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
