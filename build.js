// Builds dist/<mod>.user.js for each mod that has a header, and dist/espn-fantasy-mods.user.js with everything.
const fs = require('fs'), path = require('path');
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const root = path.join(__dirname, 'mods');
const shared = read(path.join(__dirname, 'src', 'shared.js'));
const ORDER = ['win-probability', 'optimal-lineup', 'standings-plus', 'tiers', 'declutter'];
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
const mods = ORDER.filter(m => fs.existsSync(path.join(root, m)));
const body = m => ['core.js', 'ui.js'].map(f => path.join(root, m, f)).filter(fs.existsSync).map(read).join('\n');
for (const m of mods) {
  const h = path.join(root, m, 'header.txt'); if (!fs.existsSync(h)) continue;
  const out = [read(h), shared, body(m)].join('\n');
  fs.writeFileSync(path.join(__dirname, 'dist', `${m}.user.js`), out);
  console.log('built', `dist/${m}.user.js`, out.length, 'bytes');
}
const all = [read(path.join(__dirname, 'src', 'header.all.txt')), shared, ...mods.map(body)].join('\n');
fs.writeFileSync(path.join(__dirname, 'dist', 'espn-fantasy-mods.user.js'), all);
console.log('built dist/espn-fantasy-mods.user.js', all.length, 'bytes');
