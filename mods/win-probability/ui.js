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
