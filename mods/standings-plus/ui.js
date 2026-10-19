/* standings-plus: adds ALL-PLAY, LUCK and PF RK columns to the Season Stats table on the Standings page. */
(function () {
  'use strict';
  const M = EspnMods, S = EspnStandings;
  M.registerMod('standings', 'All-play record + luck on standings');
  if (!M.enabled('standings')) return;
  if (M.page() !== 'standings') return;
  let stats = null, names = {};
  M.css(`.espnmods-luck-pos{color:#0a7d2e}.espnmods-luck-neg{color:#c0392b}`);

  function patch() {
    if (!stats) return;
    const tables = Array.from(document.querySelectorAll('table.Table'));
    // Season Stats: a fixed-left table (RK, TEAM) paired with a right table whose header starts with PF
    const right = tables.find(t => /^PF\b/.test((t.querySelector('thead') || {}).innerText || ''));
    const left = tables.find(t => t.classList.contains('Table--fixed-left') && t.querySelectorAll('tbody tr').length === (right ? right.querySelectorAll('tbody tr').length : -1));
    if (!right || !left) return;
    if (right.dataset.espnmods === 'done') return;
    const byName = {}; for (const id in names) byName[M.norm(names[id])] = +id;
    const head = right.querySelector('thead tr'); if (!head) return;
    for (const [txt, title] of [['ALL-PLAY', 'Record if you had played every team every week'], ['LUCK', 'Actual wins minus expected wins from all-play (+ = lucky schedule)'], ['PF RK', 'Rank by points for']]) {
      const th = M.el('th', 'Table__TH', txt); th.title = title; th.style.textAlign = 'right'; head.appendChild(th);
    }
    const lrows = left.querySelectorAll('tbody tr'), rrows = right.querySelectorAll('tbody tr');
    rrows.forEach((tr, i) => {
      const nameEl = lrows[i] && lrows[i].querySelector('.teamName'); const tid = nameEl && byName[M.norm(nameEl.getAttribute('title') || nameEl.textContent)];
      const s = tid && stats[tid];
      const cells = s ? [`${s.apW}-${s.apL}${s.apT ? '-' + s.apT : ''}`, (s.luck >= 0 ? '+' : '') + s.luck.toFixed(1), String(s.pfRank)] : ['', '', ''];
      cells.forEach((c, j) => { const td = M.el('td', 'Table__TD'); const d = M.el('div', 'jsx-2810852873 table--cell tar', c); if (j === 1 && s) d.classList.add(s.luck >= 0 ? 'espnmods-luck-pos' : 'espnmods-luck-neg'); td.appendChild(d); tr.appendChild(td); });
    });
    right.dataset.espnmods = 'done';
  }
  M.onData(d => { names = M.names(d.league); stats = S.compute(d.league); patch(); });
  M.observe(patch);
  M.load().catch(e => console.warn(M.LOG, 'standings load failed', e));
})();
