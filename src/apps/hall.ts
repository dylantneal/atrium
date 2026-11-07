import { hash32 } from '../util/hash';
import { generateRoom } from '../world/generator/rooms';
import type { ItemInfo } from '../world/itemTiles';
import type { RoomViewDeps } from '../world/roomView';
import { AppRoom } from './appRoom';
import { HALL_ID, roomIdOf, toolRef } from './api';
import type { AppRegistry } from './registry';

/**
 * The Hall is the 3D app launcher: a door to every app that has a room, and a shelf holding every tool you can pick up.
 * It is generated like any folder room, so it gets the same walls, doors, light and spare doorways.
 */
export function buildHall(reg: AppRegistry, rootId: string, deps: Omit<RoomViewDeps, 'room' | 'items'>): AppRoom {
  const tools = reg.tools();
  const items = new Map<string, ItemInfo>();
  for (const a of tools) items.set(toolRef(a.id), { id: toolRef(a.id), name: a.tool!.name, kind: 'tool', size: 0, mtime: 0, tags: [], icon: a.icon });
  const room = generateRoom({
    roomId: HALL_ID,
    kind: 'app',
    items: [...items.values()].map((i) => ({ id: i.id, name: i.name, kind: i.kind })),
    folders: reg.roomApps().map((a) => ({ id: roomIdOf(a.id), name: a.room!.title })),
    parentId: rootId,
    title: 'Apps',
    seed: hash32(HALL_ID),
    palette: 5,
  });
  room.activity = 0.75;
  return new AppRoom({ ...deps, room, items }, 'hall');
}
