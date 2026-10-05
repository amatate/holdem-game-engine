import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('.pages-dist'), prefix = '/holdem-game-engine/';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8' };
const paths = ['index.html', 'client.js', 'browser-worker.js', 'style.css', 'pixel-table.css', 'deck-skins.css', 'build.json',
  ...['hunter', 'maniac', 'calling-station', 'room', 'card-back', 'deck-lantern', 'deck-blue-hour', 'deck-jade', 'deck-ghost'].map((n) => `art/${n}-v1.png`),
  ...['rock', 'small-ball', 'trapper', 'value-bettor'].map((n) => `art/${n}-v2.png`)];
for (const file of await readdir(resolve(root, 'audio')).catch(() => [])) {
  if (/^[a-z0-9-]+-v1\.wav$/.test(file) || ['cool-vibes-v1.mp3', 'MUSIC-CREDITS.txt', 'CREDITS.txt', 'LICENSE-casino.txt', 'LICENSE-interface.txt', 'manifest.json'].includes(file)) paths.push('audio/' + file);
}
const server = createServer(async (req, res) => {
  if (req.url === '/') { res.writeHead(302, { Location: prefix }); res.end(); return; }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === prefix ? 'index.html' : pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';
  if (!paths.includes(file)) { res.writeHead(404); res.end(); return; }
  try {
    const body = await readFile(resolve(root, file));
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, { 'Content-Type': types[ext], 'Cache-Control': 'no-store' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
server.listen(Number(process.env.HOLDEM_PAGES_PORT ?? 4182), '127.0.0.1', () => console.log(`Pages preview: http://127.0.0.1:${server.address().port}${prefix}`));
