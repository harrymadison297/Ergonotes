// The API the UI talks to. `Vault` implements it in-process (desktop/mobile shells); the web build calls the
// same methods over HTTP RPC against the Server peer.
import type { S3Config } from './store-s3.ts';
import type { WebDavConfig } from './store-webdav.ts';
import type { Task } from './markdown.ts';

export interface FolderStoreConfig { type: 'folder'; path: string }
export type StoreConfig = S3Config | WebDavConfig | FolderStoreConfig;

export type ItemType = 'note' | 'folder';
export type VaultState = 'no-vault' | 'locked' | 'ready';

export interface VaultStatus {
  state: VaultState;
  deviceId: string;
  deviceName: string;
  store: { type: StoreConfig['type']; label: string } | null;
  lastSyncAt: number | null;
  lastSyncError: string | null;
  syncing: boolean;
  /** commits waiting to be pushed */
  pending: number;
  conflicts: number;
  remembered: boolean;
  /** true when this build can only reach a vault through a server (web) */
  remote: boolean;
  /** server only: this browser session is signed in */
  authenticated?: boolean;
}

export interface ItemSummary {
  id: string;
  type: ItemType;
  title: string;
  parent: string | null;
  tags: string[];
  created: string;
  updated: string;
  trashed: string | null;
  inTrash: boolean;
  pinned: boolean;
  template: boolean;
  role: string | null;
  snippet: string;
  thumb: string | null;
  conflicted: boolean;
  tasksOpen: number;
  tasksDone: number;
  nextReminder: string | null;
  childCount: number;
}

export interface NoteDoc extends ItemSummary {
  body: string;
  path: { id: string; title: string }[];
  backlinks: { id: string; title: string }[];
  links: { id: string; title: string }[];
}

export interface TaskEntry extends Task {
  noteId: string;
  noteTitle: string;
}

export interface HeadInfo {
  commit: string;
  deviceId: string;
  deviceName: string;
  ts: number;
  purge: boolean;
  text: string;
}
export interface ConflictDetail {
  id: string;
  title: string;
  local: HeadInfo;
  others: HeadInfo[];
  base: string | null;
}
export type ConflictChoice =
  | { kind: 'local' }
  | { kind: 'other'; commit: string }
  | { kind: 'both' }
  | { kind: 'combine' }
  | { kind: 'text'; text: string }
  | { kind: 'delete' };

export interface VersionInfo { commit: string; deviceName: string; ts: number; kind: string; current: boolean }

export interface SyncReport {
  pulled: number;
  pushed: number;
  merged: number;
  conflicts: number;
  compacted: number;
  error?: string;
}

export interface Settings {
  captureFolder: string | null;
  dailyFolder: string | null;
  theme: 'system' | 'light' | 'dark';
}

export interface CalendarData {
  tasks: TaskEntry[];
  notes: ItemSummary[];
  daily: ItemSummary[];
}

export interface FileBlob { name: string; mime: string; data: string }
export interface ImportFile { path: string; content: string }
export interface ExportResult { filename: string; mime: string; content: string }

export interface VaultApi {
  status(): Promise<VaultStatus>;
  createVault(password: string, opts?: { deviceName?: string; remember?: boolean }): Promise<void>;
  joinVault(store: StoreConfig, password: string, opts?: { deviceName?: string; remember?: boolean }): Promise<void>;
  unlock(password: string, opts?: { remember?: boolean }): Promise<void>;
  lock(): Promise<void>;
  changePassword(oldPassword: string, newPassword: string): Promise<void>;
  setDeviceName(name: string): Promise<void>;

  listItems(): Promise<ItemSummary[]>;
  getNote(id: string): Promise<NoteDoc | null>;
  createNote(input: { parent?: string | null; title?: string; body?: string; tags?: string[] }): Promise<ItemSummary>;
  saveNote(id: string, patch: { title?: string; body?: string }): Promise<ItemSummary>;
  createFolder(input: { title: string; parent?: string | null }): Promise<ItemSummary>;
  capture(input: { text: string; title?: string }): Promise<ItemSummary>;
  rename(id: string, title: string): Promise<void>;
  move(id: string, parent: string | null): Promise<void>;
  setTags(id: string, tags: string[]): Promise<void>;
  renameTag(from: string, to: string): Promise<number>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  trash(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  purge(id: string): Promise<void>;
  emptyTrash(): Promise<void>;

  search(query: string): Promise<ItemSummary[]>;
  linkTargets(query: string): Promise<{ id: string; title: string }[]>;
  tags(): Promise<{ tag: string; count: number }[]>;
  tasks(): Promise<TaskEntry[]>;
  toggleTask(noteId: string, index: number, done: boolean): Promise<void>;
  calendar(fromIso: string, toIso: string): Promise<CalendarData>;
  templates(): Promise<ItemSummary[]>;
  createFromTemplate(templateId: string, opts?: { parent?: string | null; title?: string }): Promise<ItemSummary>;
  setTemplate(id: string, isTemplate: boolean): Promise<void>;
  dailyNote(date: string): Promise<ItemSummary>;

  conflicts(): Promise<{ id: string; title: string; heads: number }[]>;
  conflictDetail(id: string): Promise<ConflictDetail | null>;
  resolveConflict(id: string, choice: ConflictChoice): Promise<void>;
  history(id: string): Promise<VersionInfo[]>;
  versionText(id: string, commit: string): Promise<string | null>;
  restoreVersion(id: string, commit: string): Promise<void>;

  getSettings(): Promise<Settings>;
  setSettings(s: Partial<Settings>): Promise<Settings>;
  setStore(store: StoreConfig | null): Promise<void>;
  sync(opts?: { full?: boolean }): Promise<SyncReport>;
  flush(): Promise<void>;

  addFile(input: FileBlob): Promise<{ id: string }>;
  getFile(id: string): Promise<FileBlob | null>;

  importMarkdown(files: ImportFile[], parent?: string | null): Promise<{ notes: number; folders: number }>;
  exportNote(id: string, format: 'md' | 'html'): Promise<ExportResult>;
}

export const VAULT_METHODS = [
  'status', 'createVault', 'joinVault', 'unlock', 'lock', 'changePassword', 'setDeviceName',
  'listItems', 'getNote', 'createNote', 'saveNote', 'createFolder', 'capture', 'rename', 'move', 'setTags',
  'renameTag', 'setPinned', 'trash', 'restore', 'purge', 'emptyTrash', 'search', 'linkTargets', 'tags', 'tasks', 'toggleTask',
  'calendar', 'templates', 'createFromTemplate', 'setTemplate', 'dailyNote', 'conflicts', 'conflictDetail',
  'resolveConflict', 'history', 'versionText', 'restoreVersion', 'getSettings', 'setSettings', 'setStore',
  'sync', 'flush', 'addFile', 'getFile', 'importMarkdown', 'exportNote',
] as const satisfies readonly (keyof VaultApi)[];
