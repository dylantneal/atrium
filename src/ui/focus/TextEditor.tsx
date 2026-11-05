import { useEffect, useRef, useState } from 'preact/hooks';
import { saveWithVersion } from '../../core/commands';
import type { Id } from '../../data/schema';
import type { VFS } from '../../vfs/vfs';
import type { FocusController } from './FocusController';
import type { Editor } from './cm';

const AUTOSAVE_MS = 2000;
const MAX_BYTES = 2 * 1024 * 1024;

type Status = 'loading' | 'saved' | 'dirty' | 'saving' | 'error' | 'toolarge';

export function TextEditor({ id, name, markdown, vfs, ctl }: { id: Id; name: string; markdown: boolean; vfs: VFS; ctl: FocusController }) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState('');
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const narrow = innerWidth < 900;
  const snapshotted = useRef(false);
  const dirty = useRef(false);
  const timer = useRef(0);
  const saving = useRef<Promise<void> | null>(null);
  const previewTimer = useRef(0);

  const renderPreview = (text: string) => {
    clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(async () => {
      const [{ marked }, { default: DOMPurify }] = await Promise.all([import('marked'), import('dompurify')]);
      const html = await marked.parse(text, { async: true });
      setPreview(DOMPurify.sanitize(html));
    }, 120);
  };

  const save = async () => {
    const ed = editor.current;
    if (!ed || !dirty.current) return;
    if (saving.current) await saving.current;
    if (!dirty.current) return;
    const text = ed.getText();
    clearTimeout(timer.current);
    setStatus('saving');
    const p = (async () => {
      try {
        await saveWithVersion(vfs, id, text, !snapshotted.current);
        snapshotted.current = true;
        // edits made while saving keep the dirty flag
        if (ed.getText() === text) {
          dirty.current = false;
          setStatus('saved');
        } else setStatus('dirty');
        setErr('');
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();
    saving.current = p;
    await p;
    saving.current = null;
  };

  useEffect(() => {
    let cancelled = false;
    let off = () => {};
    (async () => {
      const blob = await vfs.read(id);
      if (cancelled) return;
      if (blob.size > MAX_BYTES) {
        setStatus('toolarge');
        return;
      }
      const text = await blob.text();
      const { createEditor } = await import('./cm');
      if (cancelled || !host.current) return;
      editor.current = createEditor(
        host.current,
        text,
        name,
        (t) => {
          dirty.current = true;
          setStatus('dirty');
          clearTimeout(timer.current);
          timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
          if (markdown) renderPreview(t);
        },
        () => void save(),
      );
      if (markdown) renderPreview(text);
      setStatus('saved');
      editor.current.focus();
      off = ctl.registerFlush(save);
    })();
    return () => {
      cancelled = true;
      off();
      clearTimeout(timer.current);
      clearTimeout(previewTimer.current);
      editor.current?.destroy();
      editor.current = null;
    };
  }, [id]);

  const saveCopy = async () => {
    const ed = editor.current;
    if (!ed) return;
    try {
      const node = await vfs.stat(id);
      const dot = node.name.lastIndexOf('.');
      const copyName = dot > 0 ? `${node.name.slice(0, dot)} (copy)${node.name.slice(dot)}` : `${node.name} (copy)`;
      await vfs.create(node.parent!, copyName, ed.getText());
      ctl.bus.toast(`Saved a copy as ${copyName}`);
    } catch (e) {
      ctl.bus.toast(`Could not save a copy: ${e instanceof Error ? e.message : e}`, 'error');
    }
  };

  const label: Record<Status, string> = { loading: 'Loading…', saved: 'Saved', dirty: 'Unsaved changes', saving: 'Saving…', error: 'Not saved', toolarge: 'Too large to edit' };

  return (
    <div class="text-viewer">
      {status === 'error' && (
        <div class="banner" role="alert">
          <span>Couldn't save: {err}. Your changes are kept here.</span>
          <button onClick={() => void save()}>Retry</button>
          <button onClick={() => void saveCopy()}>Save as copy</button>
        </div>
      )}
      {status === 'toolarge' && <div class="banner">This file is over 2 MB, so it opens read-only elsewhere. Use the system app to edit it.</div>}
      <div class="editor-bar">
        <span class={`status ${status}`} data-testid="save-status" aria-live="polite">{label[status]}</span>
        {markdown && narrow && (
          <span class="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'edit'} onClick={() => setTab('edit')}>Edit</button>
            <button role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>Preview</button>
          </span>
        )}
        <button onClick={() => void save()} disabled={status !== 'dirty' && status !== 'error'}>Save</button>
      </div>
      <div class={`split ${markdown ? 'two' : ''}`}>
        <div class="pane editor" ref={host} style={{ display: markdown && narrow && tab === 'preview' ? 'none' : undefined }} />
        {markdown && (!narrow || tab === 'preview') && <div class="pane md-preview" data-testid="md-preview" dangerouslySetInnerHTML={{ __html: preview }} />}
      </div>
    </div>
  );
}
