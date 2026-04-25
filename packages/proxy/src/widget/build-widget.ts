import { buildSync } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(currentDir, '../../../..');

buildSync({
  absWorkingDir: repoRoot,
  entryPoints: ['packages/proxy/src/widget/widget.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  outfile: 'packages/proxy/dist/widget.js',
});
