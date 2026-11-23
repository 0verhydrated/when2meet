import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const output = new URL('pages-dist/', root);
const serviceOrigin = process.env.PUBLIC_SERVICE_ORIGIN || '';
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const supabaseEnabled = Boolean(supabaseUrl && supabaseKey);
if (Boolean(supabaseUrl) !== Boolean(supabaseKey)) throw new Error('Set both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY');
if (supabaseEnabled) {
  const target = new URL(supabaseUrl);
  if (target.protocol !== 'https:' || target.origin !== supabaseUrl || target.username || target.password) throw new Error('SUPABASE_URL must be an HTTPS origin');
  let allowed = supabaseKey.startsWith('sb_publishable_');
  if (supabaseKey.startsWith('eyJ')) { try { allowed = JSON.parse(Buffer.from(supabaseKey.split('.')[1], 'base64url')).role === 'anon'; } catch {} }
  if (!allowed) throw new Error('Only a public Supabase publishable or anon key may be included in Pages');
}
if (serviceOrigin) {
  const target = new URL(serviceOrigin);
  if (target.origin !== serviceOrigin || target.protocol !== 'https:' || target.username || target.password || target.hostname.endsWith('.chatgpt.site')) throw new Error('PUBLIC_SERVICE_ORIGIN must be the HTTPS origin of the standalone When2Meet server');
}
await mkdir(output, { recursive: true });
let html = await readFile(new URL('public/index.html', root), 'utf8');
html = html.replace(/href="\/app([^"]*)"/g, (_, suffix) => {
  const query = new URLSearchParams(suffix.replace(/^\?/, '')); query.set('view', 'app');
  return `href="${supabaseEnabled ? './?' + query : serviceOrigin ? serviceOrigin + '/app' + suffix : './?auth=' + (suffix.includes('signup=1') ? 'signup' : 'login')}"`;
});
html = html.replaceAll('href="/#how"', 'href="#how"').replaceAll('href="/"', 'href="./"');
html = html.replaceAll('href="/favicon.svg"', 'href="./favicon.svg"').replaceAll('href="/styles.css"', 'href="./styles.css"').replaceAll('src="/app.js"', `src="./${supabaseEnabled ? 'app.js' : 'pages-auth.js'}"`);
if (!supabaseEnabled) html = html.replace('<div class="hero-actions">', `<p class="pages-notice">${serviceOrigin ? '회원가입과 일정 저장은 연결된 When2Meet 서버에서 처리합니다. 이메일 인증은 필요하지 않습니다.' : '회원가입 서버를 연결 중입니다. 현재 계정 생성과 일정 저장은 사용할 수 없습니다.'}</p><div class="hero-actions">`);
if (supabaseEnabled) html = html.replace('<meta name="viewport"', `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${supabaseUrl}; base-uri 'none'; form-action 'self'">\n  <meta name="viewport"`);
html = html.replace('<script type="module"', '<link rel="canonical" href="https://0verhydrated.github.io/when2meet/">\n  <script type="module"');
await writeFile(new URL('index.html', output), html);
const css = (await readFile(new URL('public/styles.css', root), 'utf8')).replaceAll('url("/tokens.css")', 'url("./tokens.css")');
await writeFile(new URL('styles.css', output), css);
for (const name of ['tokens.css', 'demo.js', 'pages-auth.js', 'auth-ui.js', 'navigation.js', 'app.js', 'backend.js', 'favicon.svg']) await copyFile(new URL('public/' + name, root), new URL(name, output));
if (supabaseEnabled) await build({ entryPoints: [fileURLToPath(new URL('public/supabase-backend.js', root))], outfile: fileURLToPath(new URL('backend.js', output)), bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', define: { __SUPABASE_URL__: JSON.stringify(supabaseUrl), __SUPABASE_KEY__: JSON.stringify(supabaseKey) } });
await writeFile(new URL('.nojekyll', output), '');
console.log('Built public GitHub Pages site at pages-dist/');
