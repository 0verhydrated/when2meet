import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('pages-dist/', root);
const serviceOrigin = process.env.PUBLIC_SERVICE_ORIGIN || '';
if (serviceOrigin) {
  const target = new URL(serviceOrigin);
  if (target.origin !== serviceOrigin || target.protocol !== 'https:' || target.username || target.password || target.hostname.endsWith('.chatgpt.site')) throw new Error('PUBLIC_SERVICE_ORIGIN must be the HTTPS origin of the standalone When2Meet server');
}
await mkdir(output, { recursive: true });
let html = await readFile(new URL('public/index.html', root), 'utf8');
html = html.replace(/href="\/app([^"]*)"/g, (_, suffix) => `href="${serviceOrigin ? serviceOrigin + '/app' + suffix : './?auth=' + (suffix.includes('signup=1') ? 'signup' : 'login')}"`);
html = html.replaceAll('href="/#how"', 'href="#how"').replaceAll('href="/"', 'href="./"');
html = html.replaceAll('href="/favicon.svg"', 'href="./favicon.svg"').replaceAll('href="/styles.css"', 'href="./styles.css"').replaceAll('src="/app.js"', 'src="./pages-auth.js"');
html = html.replace('<div class="hero-actions">', `<p class="pages-notice">${serviceOrigin ? '회원가입과 일정 저장은 연결된 When2Meet 서버에서 처리합니다. 이메일 인증은 필요하지 않습니다.' : '회원가입 서버를 연결 중입니다. 현재 계정 생성과 일정 저장은 사용할 수 없습니다.'}</p><div class="hero-actions">`);
html = html.replace('<script type="module"', '<link rel="canonical" href="https://0verhydrated.github.io/when2meet/">\n  <script type="module"');
await writeFile(new URL('index.html', output), html);
const css = (await readFile(new URL('public/styles.css', root), 'utf8')).replaceAll('url("/tokens.css")', 'url("./tokens.css")');
await writeFile(new URL('styles.css', output), css);
for (const name of ['tokens.css', 'demo.js', 'pages-auth.js', 'auth-ui.js', 'favicon.svg']) await copyFile(new URL('public/' + name, root), new URL(name, output));
await writeFile(new URL('.nojekyll', output), '');
console.log('Built public GitHub Pages site at pages-dist/');
