import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 4000 },
  server: { proxy: { '/api': 'http://127.0.0.1:8080' } },
});
