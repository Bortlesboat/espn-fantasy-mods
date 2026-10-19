# espn-fantasy-mods

Userscripts that fix things ESPN Fantasy Football gets wrong on the web app
(`fantasy.espn.com`) and add the quality-of-life features it never shipped.

**Install (everything, recommended):** add [Tampermonkey](https://www.tampermonkey.net/)
or Violentmonkey, then open
[`dist/espn-fantasy-mods.user.js`](https://raw.githubusercontent.com/Bortlesboat/espn-fantasy-mods/master/dist/espn-fantasy-mods.user.js)
and click Install. Each mod can be switched on or off from the Tampermonkey menu
(click the extension icon while on an ESPN page).

| Mod | Where | What it does |
|-----|-------|--------------|
| **Corrected win probability** | FantasyCast, League Scoreboard | Replaces the miscalibrated "Chance to Win" with a correctly computed one; hover shows ESPN's original. Scoreboard gets a corrected-odds line under every matchup. |
| **Optimal lineup** | Box Score | Adds "Optimal: 102.4 (−18.9)" to each team's header: best possible lineup from that roster and the points left on the bench. Hover lists the lineup. |
| **All-play + luck** | Standings → Season Stats | Adds ALL-PLAY record, LUCK (actual wins minus expected wins from all-play) and PF RK columns. |
| **Boris Chen tiers** | Team, Box Score, Players | Tier badge (T1…Tn) next to every player, using [borischen.co](https://www.borischen.co/) tiers for your league's scoring (PPR / half / standard). |
| **Declutter** | Everywhere | Hides the sticky Fantasy Chat bar. |

Only want the win-probability fix, with no extra permissions? Install
[`dist/win-probability.user.js`](https://raw.githubusercontent.com/Bortlesboat/espn-fantasy-mods/master/dist/win-probability.user.js)
instead (`@grant none`).

## The win-probability bug

ESPN's "Chance to Win" is built from a formula with two textbook errors, first
called out publicly by [@will_j_5](https://x.com/will_j_5/status/2111844628710215817).
This repo confirms it against the shipped client code and ships a fix.

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

## Development

```
node test/core.test.js     # synthetic unit tests of the win-probability math
node build.js              # writes dist/*.user.js
node test/replay.local.js <league.json> <games.json> [k]   # replay saved API responses
```

Layout: `src/shared.js` (settings, cached ESPN data layer, DOM helpers) and
`mods/<name>/` with `core.js` (pure logic, no DOM, unit-testable) and `ui.js`
(page glue). `build.js` concatenates everything into `dist/`. A mod with its
own `header.txt` is also built as a standalone script.

Data comes from the same endpoints the page already calls
(`lm-api-reads.fantasy.espn.com` with your session cookie, and the public NFL
games feed). Tier files are fetched from Boris Chen's S3 bucket via
`GM_xmlhttpRequest` because that bucket has no CORS headers.

## Contributing a mod

Add `mods/<name>/ui.js` (and `core.js` if there is logic worth testing),
register it with `EspnMods.registerMod('<key>', 'Menu label')`, and add the
name to `ORDER` in `build.js`. Keep DOM selectors in `ui.js` only.

## Disclaimer

Not affiliated with ESPN or Boris Chen. Uses only data your browser already
receives while logged in; nothing is sent anywhere else.
