import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('pages-dist/', root);
const serviceOrigin = 'https://when2meet-weekly.snu-chatgpt-5678.chatgpt.site';
await mkdir(output, { recursive: true });
let html = await readFile(new URL('public/index.html', root), 'utf8');
html = html.replace(/href="\/app([^"]*)"/g, (_, suffix) => `href="${serviceOrigin}/app${suffix}"`);
html = html.replaceAll('href="/#how"', 'href="#how"').replaceAll('href="/"', 'href="./"');
html = html.replaceAll('href="/favicon.svg"', 'href="./favicon.svg"').replaceAll('href="/styles.css"', 'href="./styles.css"').replaceAll('src="/app.js"', 'src="./demo.js"');
html = html.replace('<div class="hero-actions">', '<p class="pages-notice">이 페이지는 누구나 볼 수 있습니다. 로그인·약속 생성·참여는 연결된 ChatGPT 서비스에서 진행되며, 현재 접근 권한이 있는 사용자만 이용할 수 있습니다.</p><div class="hero-actions">');
html = html.replace('<script type="module"', '<link rel="canonical" href="https://0verhydrated.github.io/when2meet/">\n  <script type="module"');
await writeFile(new URL('index.html', output), html);
const css = (await readFile(new URL('public/styles.css', root), 'utf8')).replaceAll('url("/tokens.css")', 'url("./tokens.css")');
await writeFile(new URL('styles.css', output), css);
for (const name of ['tokens.css', 'demo.js', 'favicon.svg']) await copyFile(new URL('public/' + name, root), new URL(name, output));
await writeFile(new URL('.nojekyll', output), '');
console.log('Built public GitHub Pages site at pages-dist/');
