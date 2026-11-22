import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';

await build({
  entryPoints: ['src/app.js', 'src/persistence-worker.js', 'src/compute-worker.js'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outdir: 'dist',
  splitting: true,
  minify: true,
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
  logLevel: 'info'
});
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.mjs', 'dist/pdf.worker.mjs');
