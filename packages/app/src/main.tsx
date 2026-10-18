import '@fontsource-variable/inter';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installFocusMode } from './state/util';
import { applyPrefs } from './state/prefs';
import { routeArgon2ToWorker } from './backend/argon2';
import { DEMO } from './demo/flag';

// Excalidraw's fonts come with the built app (see vite.config.ts), not from a CDN; `vite dev` has none, so it keeps the CDN
if (!DEMO && import.meta.env.PROD) (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = new URL('./excalidraw-assets/', document.baseURI).href;

routeArgon2ToWorker();
installFocusMode();
applyPrefs();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
