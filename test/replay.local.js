// Replays saved real league/games JSON (not committed) through core.js.
// usage: node test/replay.local.js <league.json> <games.json> [k]
const fs = require('fs');
const core = require('../mods/win-probability/core.js');
const [,, lp, gp, kArg] = process.argv;
const league = JSON.parse(fs.readFileSync(lp, 'utf8'));
const games = JSON.parse(fs.readFileSync(gp, 'utf8'));
const names = core.teamNames(league);
for (const r of core.compute(league, games, { k: kArg ? +kArg : 1 })) {
  console.log(`${names[r.homeTeamId]} vs ${names[r.awayTeamId]}: api=${league.schedule.find(m=>m.id===r.matchupId).home.winProbability} espn=${r.espn.toFixed(3)} fixed=${r.fixed.toFixed(3)} sigma ${r.sigmaEspn.toFixed(1)} -> ${r.sigmaFixed.toFixed(1)}`);
}
