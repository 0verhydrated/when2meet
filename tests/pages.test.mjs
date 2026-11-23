import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('Pages export supports repository paths without fake server functionality', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build-pages.mjs', import.meta.url))]);
  const root = new URL('../pages-dist/', import.meta.url);
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const css = readFileSync(new URL('styles.css', root), 'utf8');
  const demo = readFileSync(new URL('demo.js', root), 'utf8');
  assert.match(html, /src="\.\/demo\.js"/);
  assert.match(css, /url\("\.\/tokens\.css"\)/);
  assert.doesNotMatch(html, /(?:href|src)="\//);
  assert.doesNotMatch(demo, /fetch\(|\/api\//);
  assert.match(html, /현재 접근 권한이 있는 사용자만/);
  assert.match(html, /href="https:\/\/when2meet-weekly\.snu-chatgpt-5678\.chatgpt\.site\/app\?new=1"/);
  for (const asset of ['styles.css', 'tokens.css', 'demo.js', 'favicon.svg']) assert.ok(readFileSync(new URL(asset, root)).length);
});
