import type { VaultApi } from '@ergonotes/core';

// Editor node views live outside the React tree of the app providers; they reach the api through this holder.
let current: VaultApi | null = null;
export const setApiRef = (a: VaultApi) => { current = a; };
export const getApi = (): VaultApi | null => current;
