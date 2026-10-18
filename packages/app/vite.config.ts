import { cpSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Excalidraw loads its drawing fonts from a CDN unless it is told where they are. The app is offline-first (and a preview
// of a drawing is what an agent looks at to check its work), so the fonts ship with the app. Xiaolai, the 13 MB CJK
// fallback, is left out; the Latin fonts (Excalifont, Nunito, ...) cover the drawings' text.
function excalidrawFonts(): Plugin {
  return {
    name: 'excalidraw-fonts',
    apply: 'build',
    writeBundle(opts) {
      // the package's entry is dist/prod/index.js; its fonts are beside it
      const from = join(dirname(fileURLToPath(import.meta.resolve('@excalidraw/excalidraw'))), 'fonts');
      if (!existsSync(from) || !opts.dir) return;
      for (const family of readdirSync(from)) if (family !== 'Xiaolai') cpSync(join(from, family), join(opts.dir, 'excalidraw-assets', 'fonts', family), { recursive: true });
    },
  };
}

// `vite build --mode demo` makes the web demo of apps/site: Harry's made-up vault in memory (src/demo)
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'demo' ? [] : [excalidrawFonts()])],
  base: './',
  define: { __DEMO__: JSON.stringify(mode === 'demo') },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 4000, ...(mode === 'demo' ? { outDir: 'dist-demo' } : {}) },
  server: { proxy: { '/api': 'http://127.0.0.1:8080' } },
}));
