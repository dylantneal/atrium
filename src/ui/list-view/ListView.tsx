import { useEffect, useState } from 'preact/hooks';
import { ui } from '../../core/uiState';
import type { Id } from '../../data/schema';
import type { FocusController } from '../focus/FocusController';
import { useUi } from '../hud/App';

type Sort = 'name' | 'kind' | 'date';

/** Accessible, sortable list of the current room: the world is never the only way in. */
export function ListView({ ctl }: { ctl: FocusController }) {
  const { listView, roomTitle } = useUi();
  const [sort, setSort] = useState<Sort>('name');
  const [, force] = useState(0);
  const s = ctl.session;
  useEffect(() => {
    if (!listView) return;
    const t = setInterval(() => force((n) => n + 1), 600);
    return () => clearInterval(t);
  }, [listView]);
  if (!listView) return null;

  const items = [...s.items.values()];
  items.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true }) : sort === 'kind' ? a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) : b.mtime - a.mtime));
  const doors = s.view?.room.doors ?? [];

  const go = (id: Id) => void s.enter(id, s.currentId, false);

  return (
    <aside class="listview" aria-label={`Contents of ${roomTitle}`} data-testid="listview">
      <header>
        <b>{roomTitle}</b>
        <button aria-label="Close list" onClick={() => ui.set({ listView: false })}>✕</button>
      </header>
      <div class="sortbar" role="group" aria-label="Sort by">
        {(['name', 'kind', 'date'] as Sort[]).map((k) => (
          <button key={k} aria-pressed={sort === k} onClick={() => setSort(k)}>{k}</button>
        ))}
      </div>
      <h4>Doors</h4>
      <ul>
        {doors.map((d) => (
          <li key={d.id}>
            <button onClick={() => go(d.to)}>{d.label === 'Back' ? '↑ Up one level' : `→ ${d.label}`}</button>
          </li>
        ))}
      </ul>
      <h4>Items ({items.length})</h4>
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <button onClick={() => void ctl.open(i.id)}>
              <span>{i.name}</span>
              <span class="muted"> {i.kind}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
