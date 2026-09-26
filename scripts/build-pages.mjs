import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const out = resolve('.pages-dist');
await mkdir(join(out, 'art'), { recursive: true });
const hash = createHash('sha256');
// Conservative compatibility fence; never silently replay a save against changed code.
for (const directory of ['src/core', 'src/agents', 'src/game', 'src/web']) {
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.ts')).sort()) {
    hash.update(directory + '/' + name).update(await readFile(join(directory, name)));
  }
}
hash.update(await readFile('scripts/build-pages.mjs'));
const version = hash.digest('hex');
const shared = { bundle: true, platform: 'browser', format: 'esm', target: ['es2022'], minify: true, sourcemap: false, logLevel: 'info' };
await build({ ...shared, entryPoints: ['src/web/client.ts'], outfile: join(out, 'client.js') });
const result = await build({ ...shared, entryPoints: ['src/web/browser-worker.ts'], outfile: join(out, 'browser-worker.js'), metafile: true,
  define: { __PAGES_BUILD_ID__: JSON.stringify(version) },
  plugins: [{ name: 'worker-json-boundary', setup(builder) {
    builder.onResolve({ filter: /(^|\/)proxy-detection\.js$/ }, () => ({ path: resolve('src/web/browser-proxy-detection.ts') }));
  } }],
});
if (Object.keys(result.metafile.inputs).some((name) => /src\/(cli\/|web\/(server|checkpoints)\.ts)/.test(name))) throw new Error('Node-only module in Pages bundle');
const html = (await readFile('src/web/index.html', 'utf8'))
  .replace('<html lang="zh-CN">', '<html lang="zh-CN" data-runtime="pages">')
  .replaceAll('href="/', 'href="./').replaceAll('src="/', 'src="./')
  .replace('只用虚拟筹码 · 本机运行', '单机试玩 · 浏览器存档 · 无账号云同步')
  .replace('<main class="main">', '<main class="main"><p class="pages-note">在线单机版：无需登录。结算后保存在此浏览器；刷新会回到上次结算，未结束的一手不保存。请勿清理网站数据或同时在多个标签页保存。</p>')
  .replace('<head>', '<head>\n  <meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; worker-src \'self\'; style-src \'self\'; connect-src \'self\'; img-src \'self\' data:; object-src \'none\'; base-uri \'self\'">');
if (!html.includes('data-runtime="pages"')) throw new Error('Missing Pages runtime marker');
await writeFile(join(out, 'index.html'), html);
for (const file of ['style.css', 'pixel-table.css']) {
  let css = (await readFile('src/web/' + file, 'utf8')).replaceAll("url('/art/", "url('./art/");
  if (file === 'pixel-table.css') css += '\n.pages-note{padding:10px 0;color:var(--muted);font-size:12px;line-height:1.7}.at-table .pages-note{display:none}\n';
  await writeFile(join(out, file), css);
}
for (const name of ['hunter', 'maniac', 'calling-station', 'room']) await copyFile(`src/web/art/${name}-v1.png`, join(out, 'art', `${name}-v1.png`));
await writeFile(join(out, '.nojekyll'), '');
await writeFile(join(out, 'build.json'), JSON.stringify({ version, runtime: 'browser-worker' }));
console.log(`Pages bundle: ${out} (${version.slice(0, 12)})`);
