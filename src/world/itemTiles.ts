import type { Id, Node } from '../data/schema';
import type { VFS } from '../vfs/vfs';
import type { Atlas } from './atlas';
import { paintAudio, paintDocument, paintFolder, paintGeneric, paintImage, paintPlaceholder, paintVideo } from './tiles';
import type { ThumbService } from './thumbs';

export interface ItemInfo {
  id: Id;
  name: string;
  kind: Node['kind'];
  size: number;
  mtime: number;
  color?: number;
  tags: string[];
}

export const infoOf = (n: Node): ItemInfo => ({ id: n.id, name: n.name, kind: n.kind, size: n.size, mtime: n.mtime, color: n.color, tags: n.tags });

/**
 * Paints a tile for an item: an instant placeholder first, then the real content when it is ready.
 * `alive()` lets us skip work if the room was left in the meantime.
 */
export function fillTile(atlas: Atlas, tile: number, item: ItemInfo, vfs: VFS, thumbs: ThumbService, alive: () => boolean): Promise<void> {
  switch (item.kind) {
    case 'image': {
      atlas.paint(tile, (c, w, h) => paintPlaceholder(c, w, h, item.color, 'image'));
      return thumbs.get({ id: item.id, mtime: item.mtime, size: item.size } as Node).then((bmp) => {
        if (!bmp || !alive()) return;
        atlas.paint(tile, (c, w, h) => paintImage(c, w, h, bmp));
      });
    }
    case 'text':
    case 'markdown': {
      atlas.paint(tile, (c, w, h) => paintDocument(c, w, h, item.name, item.kind, []));
      return vfs
        .read(item.id)
        .then((b) => b.slice(0, 600).text())
        .then((txt) => {
          if (!alive()) return;
          const lines = txt.split('\n').filter((l) => l.trim().length > 0);
          atlas.paint(tile, (c, w, h) => paintDocument(c, w, h, item.name, item.kind, lines));
        })
        .catch(() => {});
    }
    case 'audio':
      atlas.paint(tile, (c, w, h) => paintAudio(c, w, h, item.name, item.id));
      return Promise.resolve();
    case 'video':
      atlas.paint(tile, (c, w, h) => paintVideo(c, w, h, item.name, item.color));
      return Promise.resolve();
    case 'folder':
      atlas.paint(tile, (c, w, h) => paintFolder(c, w, h, item.name));
      return Promise.resolve();
    default:
      atlas.paint(tile, (c, w, h) => paintGeneric(c, w, h, item.name, item.kind));
      return Promise.resolve();
  }
}
