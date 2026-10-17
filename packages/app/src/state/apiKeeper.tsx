import { useEffect } from 'react';
import type { VaultApi } from '@ergonotes/core';
import { setApiRef } from './appRef';

/**
 * Editor node views (pictures, audio) live outside the React tree and reach the api through a holder (appRef). While an editor
 * that has an api of its own is shown (a file outside the vault, the Scratchpad), the holder has to point at it; when it goes
 * away the vault's api is put back. `restore` is that api, taken outside the override: inside it `useApp().api` is the editor's own.
 */
export function ApiKeeper({ api, restore }: { api: VaultApi; restore: VaultApi }) {
  setApiRef(api);
  useEffect(() => () => setApiRef(restore), []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
