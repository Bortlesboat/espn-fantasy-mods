/* win-probability: rewrite "Chance to Win" trackers (FantasyCast) and add corrected odds to the Scoreboard. */
(function () {
  'use strict';
  const M = EspnMods, core = EspnWinProb;
  M.registerMod('winprob', 'Corrected win probability');
  if (!M.enabled('winprob')) return;
  const K = (typeof ESPN_WINPROB_K !== 'undefined') ? ESPN_WINPROB_K : 1.0;
  let results = null, names = {};
  const pct = p => Math.round(p * 100);

  M.css(`.espnmods-odds{list-style:none;font-size:11px;color:#6c6d6f;padding:2px 0 4px}.espnmods-odds b{color:#1a1a1a}.espnmods-sigma{font-size:10px;color:#6c6d6f;text-align:center;margin-top:2px}.winprob-badge{font-size:10px;opacity:.7;cursor:help}`);

  function recompute(data) {
    names = M.names(data.league);
    results = core.compute(data.league, data.games, { k: K });
    patchAll();
  }

  function matchupForTracker(tracker) {
    const entries = Object.entries(names).map(([id, n]) => [+id, M.norm(n)]).filter(e => e[1]);
    let el = tracker;
    for (let depth = 0; depth < 12 && el; depth++, el = el.parentElement) {
      const text = M.norm(el.innerText);
      const found = [];
      for (const [id, n] of entries) { const i = text.indexOf(n); if (i >= 0) found.push([i, id]); }
      const ids = [...new Set(found.sort((a, b) => a[0] - b[0]).map(f => f[1]))];
      if (ids.length >= 2) {
        const r = results.find(r => ids.includes(r.homeTeamId) && ids.includes(r.awayTeamId));
        if (r) return { r, leftIsHome: ids.indexOf(r.homeTeamId) < ids.indexOf(r.awayTeamId) };
      }
    }
    const tid = +M.q('teamId');
    const r = results.find(r => r.homeTeamId === tid || r.awayTeamId === tid);
    return r ? { r, leftIsHome: false } : null;
  }

  function patchTracker(tracker) {
    const m = matchupForTracker(tracker); if (!m) return;
    const { r, leftIsHome } = m;
    const L = pct(leftIsHome ? r.fixed : 1 - r.fixed), Rr = 100 - L;
    const eL = Math.floor((leftIsHome ? r.espn : 1 - r.espn) * 100), eR = 100 - eL;
    const pcts = tracker.querySelectorAll('.totalPerc'); if (pcts.length !== 2) return;
    const key = `${L}|${Rr}|${r.sigmaFixed.toFixed(1)}`;
    if (tracker.dataset.winprobKey === key) return;
    tracker.dataset.winprobKey = key;
    pcts[0].textContent = `${L}%`; pcts[1].textContent = `${Rr}%`;
    pcts[0].title = `ESPN shows ${eL}% — corrected ${L}%`; pcts[1].title = `ESPN shows ${eR}% — corrected ${Rr}%`;
    const bars = tracker.querySelectorAll('.chanceValue');
    if (bars[0]) bars[0].style.width = L + '%';
    if (bars[1]) bars[1].style.width = Rr + '%';
    const label = tracker.querySelector('.trackerLabel, .header');
    if (label && !label.querySelector('.winprob-badge')) {
      const b = M.el('span', 'winprob-badge', ' (fixed)');
      b.title = 'Recomputed with root-sum-square player spreads and sqrt time scaling. Hover the numbers for ESPN\'s original.';
      label.appendChild(b);
    }
    let sig = tracker.querySelector('.espnmods-sigma');
    if (!sig) { sig = M.el('div', 'espnmods-sigma'); tracker.appendChild(sig); }
    const lm = leftIsHome ? r.homeMean : r.awayMean, rm = leftIsHome ? r.awayMean : r.homeMean;
    sig.textContent = `proj ${lm.toFixed(1)} vs ${rm.toFixed(1)} · spread σ ${r.sigmaFixed.toFixed(1)} (ESPN used ${r.sigmaEspn.toFixed(1)})`;
  }

  // League Scoreboard: one line of corrected odds under every matchup
  function patchScoreboard() {
    document.querySelectorAll('ul.ScoreboardScoreCell__Competitors').forEach(ul => {
      const ids = Array.from(ul.querySelectorAll('li a[href*="teamId="]')).map(a => +(a.href.match(/teamId=(\d+)/) || [])[1]).filter(Boolean);
      const uniq = [...new Set(ids)]; if (uniq.length < 2) return;
      const r = results.find(r => uniq.includes(r.homeTeamId) && uniq.includes(r.awayTeamId)); if (!r) return;
      const topIsHome = uniq[0] === r.homeTeamId;
      const top = pct(topIsHome ? r.fixed : 1 - r.fixed), bot = 100 - top;
      const eTop = Math.floor((topIsHome ? r.espn : 1 - r.espn) * 100);
      const key = `${top}|${eTop}`;
      let li = ul.querySelector('.espnmods-odds');
      if (!li) { li = M.el('li', 'espnmods-odds'); ul.appendChild(li); }
      if (li.dataset.key === key) return; li.dataset.key = key;
      li.innerHTML = ''; li.append('Win odds: '); li.appendChild(M.el('b', '', `${top}% – ${bot}%`)); li.append(`  (ESPN ${eTop}–${100 - eTop})`);
      li.title = `Corrected chance to win, top team first. σ ${r.sigmaFixed.toFixed(1)} vs ESPN's ${r.sigmaEspn.toFixed(1)}`;
    });
  }

  function patchAll() { if (!results) return; document.querySelectorAll('.chanceToWinTracker').forEach(patchTracker); patchScoreboard(); }

  M.onData(recompute);
  M.observe(patchAll);
  M.onUrlChange(() => M.load({ force: true }).catch(e => console.warn(M.LOG, e)));
  M.load().catch(e => console.warn(M.LOG, 'winprob load failed', e));
  M.startAutoRefresh();
  window.__espnWinProb = { get results() { return results; }, get names() { return names; }, refresh: () => M.load({ force: true }) };
})();
