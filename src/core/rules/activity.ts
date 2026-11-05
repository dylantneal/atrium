import type { AccessEvent, Id, Node } from '../../data/schema';

export const DAY = 24 * 3600 * 1000;

/**
 * Activity score from the design doc: a = 0.6 e^(-days_since_modified / 14) + 0.4 min(1, opens_30d / 20).
 * A project untouched for six weeks scores near 0.03 from recency alone.
 */
export function activityScore(daysSinceMod: number, opens30: number): number {
  return 0.6 * Math.exp(-Math.max(0, daysSinceMod) / 14) + 0.4 * Math.min(1, opens30 / 20);
}

export interface FolderActivity {
  activity: number;
  /** Newest modification anywhere under the folder (ms). */
  newest: number;
  /** Whole days since anything in the tree was modified or opened. */
  idleDays: number;
  opens30: number;
}

/** Activity for every folder, from the node list and access log. Pure and O(n). */
export function computeActivity(nodes: Node[], events: AccessEvent[], now: number): Map<Id, FolderActivity> {
  const children = new Map<Id | null, Node[]>();
  for (const n of nodes) {
    const list = children.get(n.parent) ?? [];
    list.push(n);
    children.set(n.parent, list);
  }
  const cutoff = now - 30 * DAY;
  const opensBy = new Map<Id, number>();
  const lastTouch = new Map<Id, number>();
  for (const e of events) {
    if (e.ts >= cutoff) opensBy.set(e.nodeId, (opensBy.get(e.nodeId) ?? 0) + 1);
    lastTouch.set(e.nodeId, Math.max(lastTouch.get(e.nodeId) ?? 0, e.ts));
  }
  const out = new Map<Id, FolderActivity>();
  const walk = (n: Node): { newest: number; touched: number; opens: number } => {
    if (n.kind !== 'folder') return { newest: n.mtime, touched: Math.max(n.mtime, lastTouch.get(n.id) ?? 0), opens: opensBy.get(n.id) ?? 0 };
    let newest = 0;
    let touched = 0;
    let opens = 0;
    const kids = children.get(n.id) ?? [];
    for (const k of kids) {
      const r = walk(k);
      newest = Math.max(newest, r.newest);
      touched = Math.max(touched, r.touched);
      opens += r.opens;
    }
    if (kids.length === 0) {
      newest = n.mtime;
      touched = n.mtime;
    }
    out.set(n.id, {
      activity: activityScore((now - newest) / DAY, opens),
      newest,
      idleDays: Math.max(0, Math.floor((now - touched) / DAY)),
      opens30: opens,
    });
    return { newest, touched, opens };
  };
  for (const root of children.get(null) ?? []) walk(root);
  return out;
}
