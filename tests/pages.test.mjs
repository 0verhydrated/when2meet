import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('Pages export supports repository paths without fake server functionality', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build-pages.mjs', import.meta.url))], { env: { ...process.env, PUBLIC_SERVICE_ORIGIN: '' } });
  const root = new URL('../pages-dist/', import.meta.url);
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const css = readFileSync(new URL('styles.css', root), 'utf8');
  const demo = readFileSync(new URL('demo.js', root), 'utf8');
  assert.match(html, /src="\.\/pages-auth\.js\?v=[a-f0-9]{12}"/);
  assert.match(css, /url\("\.\/tokens\.css\?v=[a-f0-9]{12}"\)/);
  assert.doesNotMatch(html, /(?:href|src)="\//);
  assert.doesNotMatch(demo, /fetch\(|\/api\//);
  assert.match(html, /현재 계정 생성과 일정 저장은 사용할 수 없습니다/);
  assert.match(html, /href="\.\/\?auth=signup"/);
  assert.doesNotMatch(html, /chatgpt\.site|signin-with-chatgpt/);
  for (const asset of ['styles.css', 'tokens.css', 'demo.js', 'pages-auth.js', 'auth-ui.js', 'favicon.svg']) assert.ok(readFileSync(new URL(asset, root)).length);
});
test('Pages can link to a standalone HTTPS server', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build-pages.mjs', import.meta.url))], { env: { ...process.env, PUBLIC_SERVICE_ORIGIN: 'https://when2meet.example' } });
  const html = readFileSync(new URL('../pages-dist/index.html', import.meta.url), 'utf8');
  assert.match(html, /href="https:\/\/when2meet\.example\/app\?signup=1"/);
  assert.doesNotMatch(html, /chatgpt\.site/);
});
test('Supabase Pages runs the complete app on the public site with only a publishable key', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build-pages.mjs', import.meta.url))], { env: { ...process.env, PUBLIC_SERVICE_ORIGIN: '', SUPABASE_URL: 'https://test-project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only' } });
  const root = new URL('../pages-dist/', import.meta.url);
  const html = readFileSync(new URL('index.html', root), 'utf8');
  assert.match(html, /src="\.\/app\.js\?v=[a-f0-9]{12}"/);
  const revision = /src="\.\/app\.js\?v=([a-f0-9]{12})"/.exec(html)[1];
  for (const name of ['backend', 'fixed-grid', 'everytime-import', 'schedule-grid']) assert.ok(readFileSync(new URL('app.js', root), 'utf8').includes(`./${name}.js?v=${revision}`));
  assert.match(html, /href="\.\/\?signup=1&amp;view=app"|href="\.\/\?signup=1&view=app"/);
  assert.doesNotMatch(html, /서버를 연결 중|chatgpt\.site/);
  assert.match(readFileSync(new URL('backend.js', root), 'utf8'), /test-project\.supabase\.co/);
  assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build-pages.mjs', import.meta.url))], { env: { ...process.env, SUPABASE_URL: 'https://test-project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_secret_forbidden' }, stdio: 'pipe' }));
});
