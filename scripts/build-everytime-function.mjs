import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
await build({
  entryPoints: [fileURLToPath(new URL('supabase/functions/import-everytime/index.ts', root))],
  outfile: fileURLToPath(new URL('.local/import-everytime/index.ts', root)),
  bundle: true, platform: 'neutral', format: 'esm', target: 'es2022',
  plugins: [{ name: 'deno-npm', setup(builder) { builder.onResolve({ filter: /^fast-xml-parser$/ }, () => ({ path: 'npm:fast-xml-parser@5.12.1', external: true })); } }],
});
console.log('Prepared .local/import-everytime/index.ts for Supabase deployment.');
