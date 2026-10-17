import { build } from 'esbuild';
await build({
  entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node18',
  external: ['vscode'], sourcemap: false, minify: true, legalComments: 'none', logLevel: 'info',
});
