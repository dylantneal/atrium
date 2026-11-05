import type { Id } from '../data/schema';
import { createStore } from './store';

export interface Aim {
  kind: 'item' | 'door';
  id: Id;
  name: string;
  detail: string;
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
}

export const ui = createStore<UiState>({ entered: false, fade: false, crumbs: [], aim: null, roomTitle: '', listView: false });
