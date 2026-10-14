import '@fontsource-variable/inter';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installFocusMode } from './state/util';
import { applyPrefs } from './state/prefs';

installFocusMode();
applyPrefs();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
