/* Boris Chen tiers (borischen.co): parse the public text files and match ESPN player names. */
(function (root, factory) {
  const api = factory(); if (root) root.EspnTiers = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const BASE = 'https://s3-us-west-1.amazonaws.com/fftiers/out/';
  const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
  function fileFor(pos, fmt) { // fmt: 'PPR' | 'HALF' | ''
    const suffix = (pos === 'RB' || pos === 'WR' || pos === 'TE' || pos === 'FLX') && fmt ? '-' + fmt : '';
    return BASE + 'text_' + pos + suffix + '.txt';
  }
  function formatFor(league) {
    const items = (((league || {}).settings || {}).scoringSettings || {}).scoringItems || [];
    const rec = (items.find(s => s.statId === 53) || {}).points || 0;
    return rec >= 1 ? 'PPR' : rec >= 0.5 ? 'HALF' : '';
  }
  const normName = s => (s || '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  function parse(text) {
    const map = {};
    for (const line of (text || '').split('\n')) {
      const m = line.match(/^Tier\s+(\d+):\s*(.*)$/); if (!m) continue;
      for (const n of m[2].split(',')) { const k = normName(n); if (k) map[k] = +m[1]; }
    }
    return map;
  }
  // ESPN names D/ST like "Bills D/ST"; tiers use "Buffalo Bills" → match on nickname (last word)
  function lookup(map, name, pos) {
    if (pos === 'DST') { const nick = normName(name.replace(/d\/st/i, '')).split(' ').pop(); for (const k in map) if (k.split(' ').pop() === nick) return map[k]; return null; }
    const k = normName(name); if (map[k] != null) return map[k];
    const parts = k.split(' '); if (parts.length > 2) { const short = parts[0] + ' ' + parts[parts.length - 1]; if (map[short] != null) return map[short]; }
    return null;
  }
  return { POS, fileFor, formatFor, parse, lookup, normName };
}));
