import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `vite build --mode demo` makes the web demo of apps/site: Harry's made-up vault in memory (src/demo)
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  define: { __DEMO__: JSON.stringify(mode === 'demo') },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 4000, ...(mode === 'demo' ? { outDir: 'dist-demo' } : {}) },
  server: { proxy: { '/api': 'http://127.0.0.1:8080' } },
}));
