import { useEffect, useState } from 'preact/hooks';
import type { Node } from '../../data/schema';
import { useUi } from '../hud/App';
import { Drawer } from './Drawer';
import type { FocusController } from './FocusController';
import { ImageViewer } from './ImageViewer';
import { TextEditor } from './TextEditor';

function useBlobUrl(ctl: FocusController, id: string, rev: number) {
  const [state, setState] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    let alive = true;
    let url = '';
    ctl.vfs.read(id).then((blob) => {
      if (!alive) return;
      url = URL.createObjectURL(blob);
      setState({ blob, url });
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
      setState(null);
    };
  }, [id, rev]);
  return state;
}

function MediaViewer({ ctl, node, rev }: { ctl: FocusController; node: Node; rev: number }) {
  const b = useBlobUrl(ctl, node.id, rev);
  if (!b) return <div class="center muted">Loading…</div>;
  return node.kind === 'video' ? (
    <video class="media" src={b.url} controls playsInline />
  ) : (
    <div class="center">
      <audio src={b.url} controls />
    </div>
  );
}

function ImageLoader({ ctl, node, rev }: { ctl: FocusController; node: Node; rev: number }) {
  const b = useBlobUrl(ctl, node.id, rev);
  return b ? <ImageViewer blob={b.blob} name={node.name} /> : <div class="center muted">Loading…</div>;
}

function MetaCard({ node }: { node: Node }) {
  return (
    <div class="center meta-card">
      <div class="big-ext">{node.name.includes('.') ? node.name.split('.').pop()!.toUpperCase() : node.kind.toUpperCase()}</div>
      <p>No built-in viewer for {node.kind} files yet.</p>
    </div>
  );
}

export function FocusOverlay({ ctl }: { ctl: FocusController }) {
  const { focus } = useUi();
  const [node, setNode] = useState<Node | null>(null);
  const [rev, setRev] = useState(0);
  const [drawer, setDrawer] = useState(innerWidth >= 900);

  useEffect(() => {
    if (!focus) return;
    let alive = true;
    const load = () => ctl.vfs.stat(focus.id).then((n) => alive && setNode(n)).catch(() => {});
    void load();
    const off = ctl.vfs.watch((cs) => cs.some((c) => c.id === focus.id) && load());
    return () => {
      alive = false;
      off();
    };
  }, [focus?.id]);

  useEffect(() => {
    if (!focus) return;
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.closest?.('.cm-editor') || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA';
      if (e.key === 'Escape') {
        e.preventDefault();
        if (typing && t.tagName === 'INPUT') (t as HTMLInputElement).blur();
        else void ctl.close();
      } else if (!typing && (e.key === ']' || e.key === 'ArrowRight')) void ctl.step(1);
      else if (!typing && (e.key === '[' || e.key === 'ArrowLeft')) void ctl.step(-1);
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [focus?.id]);

  if (!focus) return null;
  const n = node && node.id === focus.id ? node : null;
  const order = ctl.session.view?.itemOrder() ?? [];
  const pos = order.indexOf(focus.id);

  return (
    <div class="focus" role="dialog" aria-modal="true" aria-label={n ? `Viewing ${n.name}` : 'Viewer'} data-testid="focus">
      <header class="focus-bar">
        <button onClick={() => void ctl.close()} aria-label="Close and return to the room" data-testid="focus-close">✕ Close</button>
        <div class="focus-title">
          <b>{n?.name ?? '…'}</b>
          <span class="muted">{pos >= 0 ? ` ${pos + 1} of ${order.length} in this room` : ''}</span>
        </div>
        <button onClick={() => void ctl.step(-1)} aria-label="Previous item in this room">‹</button>
        <button onClick={() => void ctl.step(1)} aria-label="Next item in this room">›</button>
        <button onClick={() => setDrawer((d) => !d)} aria-pressed={drawer} aria-label="Toggle details">ⓘ</button>
      </header>
      <div class="focus-body">
        <main class="viewer">
          {n && (n.kind === 'text' || n.kind === 'markdown') && <TextEditor key={`${n.id}:${rev}`} id={n.id} name={n.name} markdown={n.kind === 'markdown'} vfs={ctl.vfs} ctl={ctl} />}
          {n && n.kind === 'image' && <ImageLoader key={n.id} ctl={ctl} node={n} rev={rev} />}
          {n && (n.kind === 'video' || n.kind === 'audio') && <MediaViewer key={n.id} ctl={ctl} node={n} rev={rev} />}
          {n && !['text', 'markdown', 'image', 'video', 'audio'].includes(n.kind) && <MetaCard node={n} />}
        </main>
        {drawer && n && <Drawer node={n} ctl={ctl} onRestored={() => setRev((r) => r + 1)} />}
      </div>
    </div>
  );
}
