// Synthetic unit tests for mods/win-probability/core.js (node test/core.test.js)
const assert = require('assert');
const core = require('../mods/win-probability/core.js');

function player(id, team, proj, ceil, actual, f) {
  return { lineupSlotId: 0, playerId: id, playerPoolEntry: { player: {
    id, fullName: 'P' + id, proTeamId: team, injuryStatus: 'ACTIVE',
    stats: [
      { scoringPeriodId: 1, statSourceId: 1, appliedTotal: proj, appliedTotalCeiling: ceil },
      { scoringPeriodId: 1, statSourceId: 0, appliedTotal: actual },
    ] } } };
}
function league(homePlayers, awayPlayers) {
  return {
    status: { latestScoringPeriod: 1, currentMatchupPeriod: 1 },
    settings: { rosterSettings: { lineupSlotCounts: { 0: 9, 20: 7 } } },
    teams: [{ id: 1, name: 'Home' }, { id: 2, name: 'Away' }],
    schedule: [{ id: 1, matchupPeriodId: 1,
      home: { teamId: 1, rosterForCurrentScoringPeriod: { entries: homePlayers } },
      away: { teamId: 2, rosterForCurrentScoringPeriod: { entries: awayPlayers } } }],
  };
}
function games(pct) { // one pro game for team 100 and 200
  const state = pct <= 0 ? 'pre' : pct >= 100 ? 'post' : 'in';
  return { events: [{ percentComplete: pct, fullStatus: { type: { state } }, competitors: [{ id: '100' }, { id: '200' }] }] };
}

// 1) phi sanity
assert(Math.abs(core.phi(0) - 0.5) < 1e-9);
assert(Math.abs(core.phi(1.96) - 0.975) < 1e-3);

// 2) pregame, 9 equal starters each proj 10 ceiling 20 (upside 10), home +5 per player
const H = Array.from({ length: 9 }, (_, i) => player(i, 100, 15, 25, 0, 1));
const A = Array.from({ length: 9 }, (_, i) => player(10 + i, 200, 10, 20, 0, 1));
let [r] = core.compute(league(H, A), games(0));
// ESPN: U = 90 each, sigma = sqrt((90^2+90^2)/2) = 90 ; diff = 45 -> phi(0.5)
assert(Math.abs(r.sigmaEspn - 90) < 1e-9, 'espn sigma');
assert(Math.abs(r.espn - core.phi(0.5)) < 1e-9, 'espn prob');
// fixed: sqrt(9*100 + 9*100) = sqrt(1800) = 42.43 -> phi(45/42.43)
assert(Math.abs(r.sigmaFixed - Math.sqrt(1800)) < 1e-9, 'fixed sigma');
assert(r.fixed > r.espn, 'favorite stronger under fix pregame');

// 3) half-time: ESPN keeps 50% of sigma, fix keeps sqrt(0.5)=70.7%
const pre = r;
[r] = core.compute(league(H, A), games(50));
assert(Math.abs(r.sigmaEspn / pre.sigmaEspn - 0.5) < 1e-9, 'espn linear time scaling');
assert(Math.abs(r.sigmaFixed / pre.sigmaFixed - Math.SQRT1_2) < 1e-9, 'fixed sqrt time scaling');

// 4) final: no uncertainty, winner by points
const Hf = H.map(p => { p.playerPoolEntry.player.stats[1].appliedTotal = 12; return p; });
[r] = core.compute(league(Hf, A), games(100));
assert.strictEqual(r.fixed, 1); assert.strictEqual(r.espn, 1);

// 5) clamp while time remains
const big = Array.from({ length: 9 }, (_, i) => player(i, 100, 40, 41, 0, 1));
[r] = core.compute(league(big, A), games(10));
assert.strictEqual(r.espn, 0.99); assert.strictEqual(r.fixed, 0.99);

console.log('core.test.js: all assertions passed');
