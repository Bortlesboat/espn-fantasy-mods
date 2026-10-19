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
