import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
let writer;
export function exportWriterSource() {
  return writer ||= build({ stdin: { contents: "export { default } from 'write-excel-file/browser';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', minify: true }).then(result => result.outputFiles[0].text);
}
