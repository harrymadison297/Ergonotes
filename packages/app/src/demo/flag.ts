declare const __DEMO__: boolean | undefined;
/** True in the build that is published as the web demo (`vite build --mode demo`); the installed apps and the server never set it. */
export const DEMO: boolean = typeof __DEMO__ !== 'undefined' && __DEMO__ === true;
