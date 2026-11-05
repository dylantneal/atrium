import { useEffect, useRef, useState } from 'preact/hooks';
import { restoreCmd } from '../../core/handCommands';
import { ui } from '../../core/uiState';
import type { Id, Node } from '../../data/schema';
import { hex, paintGeneric, paintImage, paintPlaceholder } from '../../world/tiles';
import type { Session } from '../../world/session';
import { useStore } from './useStore';
import { useUi } from './App';

function Thumb({ session, id }: { session: Session; id: Id }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [node, setNode] = useState<Node | null>(null);
  useEffect(() => {
    let alive = true;
    session.vfs.stat(id).then((n) => alive && setNode(n)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);
  useEffect(() => {
    const c = ref.current;
    if (!c || !node) return;
    const ctx = c.getContext('2d')!;
    const draw = (fn: (g: CanvasRenderingContext2D) => void) => {
      ctx.save();
      ctx.scale(c.width / 256, c.height / 160);
      fn(ctx);
      ctx.restore();
    };
    draw((g) => (node.kind === 'image' ? paintPlaceholder(g, 256, 160, node.color, 'image') : paintGeneric(g, 256, 160, node.name, node.kind)));
    if (node.kind !== 'image') return;
    let alive = true;
    void session.thumbs.get(node).then((bmp) => {
      if (alive && bmp) draw((g) => paintImage(g, 256, 160, bmp));
    });
    return () => {
      alive = false;
    };
  }, [node?.id, node?.name]);
  return <canvas ref={ref} width={96} height={60} aria-label={node?.name ?? 'item'} title={node?.name} />;
}

export function Hotbar({ session }: { session: Session }) {
  const inv = useStore(session.inventory.store);
  const { entered, focus } = useUi();
  if (!entered || focus) return null;
  return (
    <div class="hotbar" role="toolbar" aria-label="Hands and shortcuts" data-testid="hotbar">
      <div class="slots">
        {inv.slots.map((id, i) => (
          <button
            key={i}
            class={`slot ${i === inv.selected ? 'sel' : ''} ${id ? 'full' : ''}`}
            aria-label={id ? `Slot ${i + 1}, holding an item` : `Slot ${i + 1}, empty`}
            aria-pressed={i === inv.selected}
            data-testid={`slot-${i}`}
            onClick={() => session.inventory.select(i)}
          >
            <span class="num">{i + 1}</span>
            {id && <Thumb session={session} id={id} />}
          </button>
        ))}
      </div>
      <div class="pins">
        <button title="Go to Home" aria-label="Go to Home" onClick={() => void session.enter(session.vfs.rootId, session.currentId, false)}>⌂</button>
        <button title="Put the selected item back (Q)" aria-label="Put back" disabled={!inv.slots[inv.selected]} onClick={() => session.putBack()}>↺</button>
        <button title="Copy instead of move" aria-label="Copy mode" aria-pressed={inv.copy} class={inv.copy ? 'on' : ''} onClick={() => session.inventory.toggleCopy()}>⧉</button>
        <button title="Trash" aria-label="Open trash" onClick={() => ui.set({ ashes: !ui.get().ashes })}>🗑</button>
        <button title="Undo" aria-label="Undo" onClick={() => void session.bus.undo()}>⎌</button>
      </div>
    </div>
  );
}

export function Ashes({ session }: { session: Session }) {
  const { ashes } = useUi();
  const [items, setItems] = useState<Node[]>([]);
  const [confirm, setConfirm] = useState(false);
  const inv = useStore(session.inventory.store);
  useEffect(() => {
    if (!ashes) return;
    let alive = true;
    const load = async () => {
      const tid = await session.vfs.trashId();
      const list = await session.vfs.list(tid);
      if (alive) setItems(list);
    };
    void load();
    const off = session.vfs.watch(() => void load());
    return () => {
      alive = false;
      off();
    };
  }, [ashes]);
  if (!ashes) return null;
  const held = inv.slots[inv.selected];
  return (
    <aside class="ashes" aria-label="Trash" data-testid="ashes">
      <header>
        <b>Trash</b>
        <button aria-label="Close trash" onClick={() => ui.set({ ashes: false })}>✕</button>
      </header>
      {held && <button onClick={() => void session.trashSelected()}>Trash the item in my hand</button>}
      {items.length === 0 ? (
        <p class="muted">Nothing here. Trashed items can be restored until you empty it.</p>
      ) : (
        <ul>
          {items.map((n) => (
            <li key={n.id}>
              <span>{n.name}</span>
              <button onClick={() => void session.bus.dispatch(restoreCmd(session.handCtx, n.id))}>Restore</button>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 &&
        (confirm ? (
          <div class="confirm" role="alertdialog" aria-label="Confirm empty trash">
            <span>Delete {items.length} item{items.length === 1 ? '' : 's'} forever? This cannot be undone.</span>
            <button class="danger" data-testid="confirm-empty" onClick={async () => { await session.vfs.emptyTrash(); setConfirm(false); }}>Delete forever</button>
            <button onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        ) : (
          <button class="danger" data-testid="empty-trash" onClick={() => setConfirm(true)}>Empty trash…</button>
        ))}
    </aside>
  );
}
