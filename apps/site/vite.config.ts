import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The landing page of Ergonotes. `npm run build:site` (repo root) builds the web demo first; scripts/copy-demo.mjs then puts it at /demo/.
export default defineConfig({ plugins: [react()], build: { target: 'es2022', sourcemap: false } });
