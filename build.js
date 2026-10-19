// Concatenates each mod's header + core + ui into a single installable .user.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'mods');
for (const mod of fs.readdirSync(root)) {
  const dir = path.join(root, mod);
  const parts = ['header.txt', 'core.js', 'ui.js'].map(f => path.join(dir, f));
  if (!parts.every(fs.existsSync)) continue;
  const out = parts.map(p => fs.readFileSync(p, 'utf8')).join('\n');
  fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
  const target = path.join(__dirname, 'dist', `${mod}.user.js`);
  fs.writeFileSync(target, out);
  console.log('built', path.relative(__dirname, target), out.length, 'bytes');
}
