import { useEffect, useState } from 'preact/hooks';
import { renameCmd, saveWithVersion, setTagsCmd } from '../../core/commands';
import { getBlob, versionsFor } from '../../data/idb';
import type { Node, VersionRef } from '../../data/schema';
import type { FocusController } from './FocusController';

const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function Drawer({ node, ctl, onRestored }: { node: Node; ctl: FocusController; onRestored: () => void }) {
  const [name, setName] = useState(node.name);
  const [tags, setTags] = useState(node.tags.join(', '));
  const [versions, setVersions] = useState<VersionRef[]>([]);
  const textual = node.kind === 'text' || node.kind === 'markdown';

  useEffect(() => {
    setName(node.name);
    setTags(node.tags.join(', '));
  }, [node.id, node.name, node.tags.join(',')]);

  useEffect(() => {
    let alive = true;
    void versionsFor(node.id).then((v) => alive && setVersions(v));
    const off = ctl.vfs.watch((cs) => cs.some((c) => c.id === node.id) && versionsFor(node.id).then((v) => alive && setVersions(v)));
    return () => {
      alive = false;
      off();
    };
  }, [node.id]);

  const commitName = () => {
    const n = name.trim();
    if (n && n !== node.name) void ctl.bus.dispatch(renameCmd(ctl.vfs, node.id, n));
    else setName(node.name);
  };
  const commitTags = () => {
    const list = tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (list.join(',') !== node.tags.join(',')) void ctl.bus.dispatch(setTagsCmd(ctl.vfs, node.id, list));
  };

  const restore = async (v: VersionRef) => {
    const blob = await getBlob(v.blobKey);
    if (!blob) return ctl.bus.toast('That version is no longer stored', 'error');
    await ctl.flush();
    await saveWithVersion(ctl.vfs, node.id, await blob.text(), true);
    ctl.bus.toast('Restored as a new version');
    onRestored();
  };

  return (
    <aside class="drawer" aria-label="Details">
      <label class="field">
        <span>Name</span>
        <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} onBlur={commitName} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} data-testid="name-input" />
      </label>
      <label class="field">
        <span>Tags</span>
        <input value={tags} placeholder="comma separated" onInput={(e) => setTags((e.target as HTMLInputElement).value)} onBlur={commitTags} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </label>
      <dl class="details">
        <dt>Kind</dt><dd>{node.kind}</dd>
        <dt>Size</dt><dd>{bytes(node.size)}</dd>
        <dt>Modified</dt><dd>{new Date(node.mtime).toLocaleString()}</dd>
      </dl>
      <h3>Versions</h3>
      {versions.length === 0 ? (
        <p class="muted">{textual ? 'A snapshot is saved before your first edit.' : 'No versions yet.'}</p>
      ) : (
        <ul class="versions" data-testid="versions">
          {versions.map((v) => (
            <li key={v.id}>
              <span>{new Date(v.ts).toLocaleString()} · {bytes(v.size)}</span>
              {textual && <button onClick={() => void restore(v)}>Restore</button>}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
