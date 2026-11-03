// Copies the static app into www/, the folder Capacitor packages into the native shell.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';

const files = ['index.html', 'styles.css', 'theme.js', 'core.js', 'myp.js', 'config.js', 'app.js', 'manifest.webmanifest'];
const dirs = ['icons', 'data', 'fonts'];

rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of files) cpSync(f, `www/${f}`);
// data/snapshots are the daily source files for history.json; the app only needs history.json itself
for (const d of dirs) cpSync(d, `www/${d}`, { recursive: true, filter: src => basename(src) !== 'snapshots' });
console.log(`www/ ready: ${files.length} files, ${dirs.join(', ')}`);
