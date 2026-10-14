import '@fontsource-variable/inter';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installFocusMode } from './state/util';

installFocusMode();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
