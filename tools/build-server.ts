import { build } from 'esbuild';
import { rmSync } from 'node:fs';
rmSync('dist/server', { recursive: true, force: true });
await build({
  entryPoints: ['apps/server/lambda.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  minify: true,
  sourcemap: false,
  logLevel: 'warning',
});
