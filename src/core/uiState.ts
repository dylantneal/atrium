import type { Id } from '../data/schema';
import { createStore } from './store';

export interface Aim {
  kind: 'item' | 'door' | 'slot';
  id: Id;
  name: string;
  detail: string;
  hint?: string;
}

export interface Crumb {
  id: Id;
  name: string;
}

export interface UiState {
  entered: boolean;
  fade: boolean;
  crumbs: Crumb[];
  aim: Aim | null;
  roomTitle: string;
  listView: boolean;
  focus: { id: Id } | null;
  ashes: boolean;
  launcher: { open: boolean; query: string };
  docent: boolean;
  settings: boolean;
  perf: boolean;
  caption: string | null;
  searchBanner: { query: string; kept: boolean } | null;
}

export const ui = createStore<UiState>({ entered: false, fade: false, crumbs: [], aim: null, roomTitle: '', listView: false, focus: null, ashes: false, launcher: { open: false, query: '' }, docent: false, settings: false, perf: new URLSearchParams(location.search).has('perf'), caption: null, searchBanner: null });
