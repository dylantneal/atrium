import { useEffect, useRef, useState } from 'preact/hooks';
import { ui } from '../../core/uiState';
import type { Id, Node } from '../../data/schema';
import type { FocusController } from '../focus/FocusController';
import { useUi } from '../hud/App';
import { baseCommands, type LauncherCommand } from './commands';

interface Row {
  kind?: string;
  type: 'file' | 'folder' | 'command';
  id: string;
  title: string;
  sub: string;
  cmd?: LauncherCommand;
}

const ICON: Record<string, string> = { folder: '▣', image: '▤', video: '▶', audio: '♪', markdown: '≡', text: '≡', pdf: '▥' };

export function Launcher({ ctl, extra }: { ctl: FocusController; extra: LauncherCommand[] }) {
  const { launcher } = useUi();
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState(0);
  const [total, setTotal] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const q = launcher.query;
  const s = ctl.session;

  const commands = [...baseCommands, ...extra, ...(s.demo ? [{ id: 'live', title: 'Make it live (demo)', run: () => void s.makeItLive() } as LauncherCommand] : [])];

  useEffect(() => {
    if (launcher.open) setTimeout(() => input.current?.focus(), 0);
  }, [launcher.open]);

  /** Rows for a query. Used by the debounced effect and by Enter (which must not act on rows for an older query). */
  const compute = async (query: string): Promise<{ rows: Row[]; total: number }> => {
    const text = query.trim();
    if (text === '' || text.startsWith('>')) {
      const f = text.replace(/^>\s*/, '').toLowerCase();
      const list = commands.filter((c) => c.title.toLowerCase().includes(f));
      return { rows: list.map((c) => ({ type: 'command', id: c.id, title: c.title, sub: c.hint ?? 'command', cmd: c }) as Row), total: 0 };
    }
    const hits = await s.search.query(text, 60);
    const nodes: (Node | null)[] = await Promise.all(hits.slice(0, 8).map((h) => s.vfs.stat(h.id).catch(() => null)));
    return {
      rows: nodes
        .filter((n): n is Node => !!n)
        .map((n) => ({ kind: n.kind, type: n.kind === 'folder' ? 'folder' : 'file', id: n.id, title: n.name, sub: s.search.paths.get(n.id) || 'Home' }) as Row),
      total: hits.length,
    };
  };

  // which query the rows on screen belong to: Enter compares this with what is typed
  const rowsFor = useRef<string | null>(null);

  useEffect(() => {
    if (!launcher.open) return;
    let alive = true;
    const t = setTimeout(async () => {
      const r = await compute(q);
      if (!alive) return;
      rowsFor.current = q;
      setRows(r.rows);
      setTotal(r.total);
      setSel(0);
    }, 60);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, launcher.open, s.demo, extra.length]);

  if (!launcher.open) return null;
  const close = () => ui.set({ launcher: { open: false, query: '' } });

  const activate = async (r: Row) => {
    close();
    if (r.type === 'command') return void r.cmd!.run(ctl);
    if (r.type === 'folder') return void s.enter(r.id, s.currentId, false);
    const node = await s.vfs.stat(r.id);
    if (node.parent && node.parent !== s.currentId) await s.enter(node.parent, s.currentId, false);
    await ctl.open(r.id);
  };
  const asRoom = async () => {
    const text = q.trim();
    close();
    await s.enterSearch(text);
  };

  return (
    <div class="launcher-wrap" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div class="launcher" role="dialog" aria-label="Search and commands" data-testid="launcher">
        <input
          ref={input}
          value={q}
          placeholder="Search files and rooms, or type > for commands"
          aria-label="Search"
          onInput={(e) => ui.set({ launcher: { open: true, query: (e.target as HTMLInputElement).value } })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowDown') (e.preventDefault(), setSel((i) => Math.min(rows.length - 1, i + 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((i) => Math.max(0, i - 1)));
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.shiftKey) && q.trim() && !q.startsWith('>')) void asRoom();
            else if (e.key === 'Enter') {
              e.preventDefault();
              // rows are debounced: if they are for an older query, compute the right ones now instead of acting on stale rows
              void (async () => {
                const current = rowsFor.current === q ? rows : (await compute(q)).rows;
                const pick = rowsFor.current === q ? current[sel] : current[0];
                if (pick) await activate(pick);
              })();
            }
          }}
        />
        <ul role="listbox">
          {rows.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === sel} class={i === sel ? 'sel' : ''} onPointerMove={() => i !== sel && setSel(i)} onClick={() => void activate(r)}>
              <span class="ico">{r.type === 'command' ? '›' : ICON[r.kind ?? 'text'] ?? '•'}</span>
              <span class="t">{r.title}</span>
              <span class="muted s">{r.sub}</span>
            </li>
          ))}
          {rows.length === 0 && q.trim() && !q.startsWith('>') && <li class="muted empty">No matches</li>}
        </ul>
        {total > 0 && !q.startsWith('>') && (
          <footer>
            <button data-testid="show-as-room" onClick={() => void asRoom()}>
              Show all {total} result{total === 1 ? '' : 's'} as a room
            </button>
            <span class="muted">Enter: open · Ctrl+Enter: room</span>
          </footer>
        )}
      </div>
    </div>
  );
}

export function SearchBanner({ ctl }: { ctl: FocusController }) {
  const { searchBanner } = useUi();
  if (!searchBanner) return null;
  const s = ctl.session;
  return (
    <div class="search-banner" role="region" aria-label="Search room" data-testid="search-banner">
      <span>
        {searchBanner.kept ? 'Saved room' : 'Search'}: <b>{searchBanner.query}</b>
      </span>
      {!searchBanner.kept && <button class="btn-primary" data-testid="keep-room" onClick={() => void s.keepSearch()}>Keep room</button>}
      {!searchBanner.kept && <button onClick={() => ui.set({ launcher: { open: true, query: searchBanner.query } })}>Refine</button>}
      {searchBanner.kept && <button onClick={() => void s.deleteView()}>Delete room</button>}
      <button onClick={() => void s.goUp()}>Close</button>
    </div>
  );
}

export type { Id };
