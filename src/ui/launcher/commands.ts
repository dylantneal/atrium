import { ui } from '../../core/uiState';
import type { FocusController } from '../focus/FocusController';

export interface LauncherCommand {
  id: string;
  title: string;
  hint?: string;
  run(ctl: FocusController): void | Promise<void>;
}

/** Things you can do from the launcher (type ">" or open it empty). Other features register more later. */
export const baseCommands: LauncherCommand[] = [
  { id: 'home', title: 'Go home', run: (c) => void c.session.enter(c.vfs.rootId, c.session.currentId, false) },
  { id: 'up', title: 'Go up one level', hint: 'B', run: (c) => void c.session.goUp() },
  { id: 'list', title: 'Show this room as a list', hint: 'L', run: () => ui.set({ listView: !ui.get().listView }) },
  { id: 'trash', title: 'Open the trash', run: () => ui.set({ ashes: true }) },
  {
    id: 'note',
    title: 'New note here',
    run: async (c) => {
      const room = c.session.view?.room;
      if (!room || room.kind !== 'folder') return c.bus.toast('Go into a folder to add a note there', 'error');
      const id = await c.vfs.create(c.session.currentId, 'Untitled note.md', '# Untitled note\n\n');
      await c.session.reload();
      await c.open(id);
    },
  },
];
