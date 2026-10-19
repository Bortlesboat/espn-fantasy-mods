# espn-fantasy-mods

Userscripts that fix things ESPN Fantasy Football gets wrong on the web app
(`fantasy.espn.com`). Install any mod with Tampermonkey / Violentmonkey.

| Mod | What it does | Install |
|-----|--------------|---------|
| [win-probability](mods/win-probability) | Replaces the miscalibrated "Chance to Win" with a correctly computed one | `dist/win-probability.user.js` |

## win-probability

ESPN's "Chance to Win" (FantasyCast, matchup pages, mobile app) is built from a
formula with two textbook errors, first called out publicly by
[@will_j_5](https://x.com/will_j_5/status/2111844628710215817). This repo
confirms it against the shipped client code and ships a fix.

### What ESPN does

For each team, with `x` = points so far, `m` = projection, `c` = projected
ceiling (`appliedTotalCeiling` in ESPN's API) and `f` = share of the player's
game still to play:

```
M = Σ (x + f·m)            team mean
U = Σ f·(c − m)            team "upside"
σ = sqrt((U_home² + U_away²) / 2)
P(home) = Φ((M_home − M_away) / σ)        clamped to [1%, 99%] while time remains
```

### What is wrong with it

1. **Spreads are summed, not root-sum-squared.** Each `c − m` is roughly one
   standard deviation of a player's score. Nine independent one-SD spreads
   combine to 3 SD, not 9. ESPN's pregame σ is about 2× too wide, so underdogs
   look stronger than they are. In one 12-team PPR league over weeks 1–5 of
   2026, ESPN's pregame team "upside" averaged 79 points, while the actual
   standard deviation of (score − projection) was 22.
2. **Remaining spread scales with `f`, not `sqrt(f)`.** Variance scales with
   time remaining; standard deviation scales with its square root. With half
   a game left ESPN keeps 50% of the spread instead of 71%, and near the end of
   a game it keeps almost none. Favorites look safer than they are late.

The two errors cancel around two thirds of the way through the week, which is
why the number *looks* reasonable on Sunday evening and is badly off on
Thursday and on Monday night.

### What the fix does

```
σ = k · sqrt( Σ_home f·(c − m)² + Σ_away f·(c − m)² )
```

`k` is a calibration constant, default `1.0`. On the league above it fits to
about `0.8`; set `ESPN_WINPROB_K` at the top of the userscript to override.

The mod fetches the same league and game JSON the page already uses, computes
both numbers, rewrites the tracker, and shows ESPN's original on hover.

### Development

```
node test/core.test.js     # synthetic unit tests of the math
node build.js              # writes dist/*.user.js
node test/replay.local.js <league.json> <games.json> [k]   # replay saved API responses
```

`core.js` is a pure module with no DOM dependency so it can be reused in
Python ports, Discord bots, etc.

## Contributing a mod

Each mod lives in `mods/<name>/` with `header.txt` (userscript metadata),
`core.js` (pure logic, unit-tested) and `ui.js` (page glue). `build.js`
concatenates them into `dist/<name>.user.js`.

## Disclaimer

Not affiliated with ESPN. Uses only data your browser already receives while
logged in; nothing is sent anywhere else.
