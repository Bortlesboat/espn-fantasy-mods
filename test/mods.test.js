// Unit tests for optimal-lineup, standings-plus and tiers cores (node test/mods.test.js)
const assert = require('assert');
const O = require('../mods/optimal-lineup/core.js');
const S = require('../mods/standings-plus/core.js');
const T = require('../mods/tiers/core.js');

// ---- optimal lineup: QB, RB, RB, WR, FLEX(RB/WR/TE); bench holds the best RB
const slots = [0, 2, 2, 4, 23];
const P = (id, pts, elig, slot) => ({ id, name: 'p' + id, points: pts, eligibleSlots: elig, lineupSlotId: slot });
const players = [
  P(1, 20, [0, 20], 0),          // QB starter
  P(2, 10, [2, 23, 20], 2),      // RB starter
  P(3, 8, [2, 23, 20], 2),       // RB starter
  P(4, 12, [4, 23, 20], 4),      // WR starter
  P(5, 5, [4, 23, 20], 23),      // FLEX starter (WR)
  P(6, 25, [2, 23, 20], 20),     // bench RB, should start
  P(7, 30, [0, 20], 21),         // IR QB, cannot start
];
let r = O.solve(players, slots);
assert.strictEqual(r.actual, 55);
assert.strictEqual(r.optimal, 20 + 25 + 10 + 12 + 8, 'RB6 in, RB3 to flex, WR5 out');
assert.strictEqual(r.benchLeft, 20);
assert(!r.lineup.some(l => l.player.id === 7), 'IR player never starts');

// unfillable slot (no TE) is skipped, not fatal
r = O.solve(players, [0, 6]);
assert.strictEqual(r.optimal, 20);

// ---- standings: 4 teams, 2 completed weeks
const league = {
  status: { currentMatchupPeriod: 3 },
  teams: [1, 2, 3, 4].map(id => ({ id, record: { overall: { wins: 0, pointsFor: 0 } } })),
  schedule: [
    { matchupPeriodId: 1, winner: 'HOME', home: { teamId: 1, totalPoints: 100 }, away: { teamId: 2, totalPoints: 90 } },
    { matchupPeriodId: 1, winner: 'HOME', home: { teamId: 3, totalPoints: 120 }, away: { teamId: 4, totalPoints: 80 } },
    { matchupPeriodId: 2, winner: 'AWAY', home: { teamId: 1, totalPoints: 70 }, away: { teamId: 3, totalPoints: 110 } },
    { matchupPeriodId: 2, winner: 'HOME', home: { teamId: 2, totalPoints: 95 }, away: { teamId: 4, totalPoints: 60 } },
    { matchupPeriodId: 3, winner: 'UNDECIDED', home: { teamId: 1, totalPoints: 0 }, away: { teamId: 4, totalPoints: 0 } },
  ],
};
league.teams[0].record.overall = { wins: 2, pointsFor: 170 }; // pretend an extra win to make team 1 "lucky"
league.teams[1].record.overall = { wins: 1, pointsFor: 185 };
league.teams[2].record.overall = { wins: 2, pointsFor: 230 };
league.teams[3].record.overall = { wins: 0, pointsFor: 140 };
const st = S.compute(league);
assert.strictEqual(st[3].apW, 6); assert.strictEqual(st[3].apL, 0);       // best both weeks
assert.strictEqual(st[1].apW, 3); assert.strictEqual(st[1].apL, 3);       // wk1: beat 2,4 ; wk2: beat 4
assert.strictEqual(st[4].apW, 0);
assert(Math.abs(st[3].expWins - 2) < 1e-9 && Math.abs(st[3].luck) < 1e-9);
assert(Math.abs(st[1].expWins - 1) < 1e-9 && Math.abs(st[1].luck - 1) < 1e-9, 'team 1: 2 wins on 1 expected => luck +1');
assert.strictEqual(st[3].pfRank, 1); assert.strictEqual(st[4].pfRank, 4);

// ---- tiers
const map = T.parse('Tier 1: Josh Allen, Brock Purdy\nTier 2: Patrick Mahomes II, C.J. Stroud\nTier 3: Kenneth Walker III\n');
assert.strictEqual(T.lookup(map, 'Patrick Mahomes', 'QB'), 2);
assert.strictEqual(T.lookup(map, 'C.J. Stroud', 'QB'), 2);
assert.strictEqual(T.lookup(map, 'Kenneth Walker III', 'RB'), 3);
assert.strictEqual(T.lookup(map, 'Nobody Here', 'QB'), null);
const dst = T.parse('Tier 1: Buffalo Bills, Kansas City Chiefs\n');
assert.strictEqual(T.lookup(dst, 'Bills D/ST', 'DST'), 1);
assert.strictEqual(T.lookup(dst, 'Jets D/ST', 'DST'), null);
assert.strictEqual(T.formatFor({ settings: { scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] } } }), 'PPR');
assert.strictEqual(T.formatFor({ settings: { scoringSettings: { scoringItems: [{ statId: 53, points: 0.5 }] } } }), 'HALF');
assert.strictEqual(T.formatFor({ settings: { scoringSettings: { scoringItems: [] } } }), '');
assert.strictEqual(T.fileFor('RB', 'PPR'), 'https://s3-us-west-1.amazonaws.com/fftiers/out/text_RB-PPR.txt');
assert.strictEqual(T.fileFor('QB', 'PPR'), 'https://s3-us-west-1.amazonaws.com/fftiers/out/text_QB.txt');

console.log('mods.test.js: all assertions passed');
