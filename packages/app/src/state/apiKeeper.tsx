import { useEffect } from 'react';
import type { VaultApi } from '@ergonotes/core';
import { useApp } from './app';
import { setApiRef } from './appRef';

/**
 * Editor node views (pictures, audio) live outside the React tree and reach the api through a holder (appRef). While an editor
 * that has an api of its own is shown (a file outside the vault, the Scratchpad), the holder has to point at it; when it goes
 * away the vault's api is put back.
 */
export function ApiKeeper({ api }: { api: VaultApi }) {
  const app = useApp();
  setApiRef(api);
  useEffect(() => () => setApiRef(app.api), []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
