export function pageUrl(path) {
  const base = new URL('.', import.meta.url);
  if (base.pathname === '/') return path;
  const target = new URL(path, base.origin);
  if (target.origin !== base.origin) return target.href;
  const query = new URLSearchParams(target.search);
  if (target.pathname === '/app') query.set('view', 'app');
  else if (/^\/m\/[a-f0-9]{32}$/.test(target.pathname)) query.set('meeting', target.pathname.slice(3));
  else if (target.pathname !== '/') return target.pathname + target.search + target.hash;
  return base.pathname + (query.size ? '?' + query : '') + target.hash;
}
export function pageMarkup(markup) { return markup.replace(/href="(\/[^"<>]*)"/g, (_, path) => `href="${pageUrl(path)}"`); }
