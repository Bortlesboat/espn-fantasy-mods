/* optimal-lineup: on the Box Score page, show each team's optimal lineup total and points left on the bench. */
(function () {
  'use strict';
  const M = EspnMods, O = EspnOptimal;
  M.registerMod('optimal', 'Optimal lineup on box scores');
  if (!M.enabled('optimal')) return;
  if (M.page() !== 'boxscore') return;
  let data = null;
  const spFromUrl = () => +M.q('matchupPeriodId') || +M.q('scoringPeriodId') || undefined;

  function patch() {
    if (!data) return;
    const league = data.league, sp = league.scoringPeriodId || league.status.latestScoringPeriod;
    const headers = Array.from(document.querySelectorAll('.teamHeaders .teamName')).map(e => M.norm(e.getAttribute('title') || e.textContent));
    const statuses = document.querySelectorAll('.teamPlayerStatus');
    if (headers.length < 2 || statuses.length < 2) return;
    const names = M.names(league); const byName = {}; for (const id in names) byName[M.norm(names[id])] = +id;
    const ids = headers.map(h => byName[h]); if (!ids[0] || !ids[1]) return;
    const mt = (league.schedule || []).find(m => m.home && m.away && ids.includes(m.home.teamId) && ids.includes(m.away.teamId) && m.home.rosterForCurrentScoringPeriod);
    if (!mt) return;
    const slots = O.slotsFor(league);
    ids.slice(0, 2).forEach((tid, i) => {
      const side = mt.home.teamId === tid ? mt.home : mt.away;
      const r = O.solve(O.rosterPlayers(side, sp), slots);
      const host = statuses[i]; const key = r.optimal.toFixed(1) + '|' + r.benchLeft.toFixed(1);
      let lab = host.querySelector('.espnmods-optimal');
      if (!lab) { lab = M.el('div', 'statusLabel espnmods-optimal'); lab.append('Optimal:'); lab.appendChild(M.el('span', 'statusValue fw-bold')); host.appendChild(lab); }
      if (lab.dataset.key === key) return; lab.dataset.key = key;
      lab.querySelector('.statusValue').textContent = `${r.optimal.toFixed(1)}` + (r.benchLeft > 0.05 ? ` (−${r.benchLeft.toFixed(1)})` : '');
      lab.title = 'Best possible lineup from this roster: ' + r.lineup.map(l => `${l.player.name} ${l.player.points.toFixed(1)}`).join(', ');
    });
  }
  M.onData(d => { data = d; patch(); });
  M.observe(patch);
  M.load({ scoringPeriodId: spFromUrl() }).catch(e => console.warn(M.LOG, 'optimal load failed', e));
  M.onUrlChange(() => M.load({ scoringPeriodId: spFromUrl(), force: true }).catch(() => {}));
})();
