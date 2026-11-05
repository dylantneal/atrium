import * as THREE from 'three';

/** M0 placeholder: a plain lit room so the render loop, lights and fog can be verified. Replaced by generated rooms in M1. */
export function buildEmptyRoom(): THREE.Group {
  const g = new THREE.Group();
  const w = 10, d = 8, h = 3.6;
  const wall = new THREE.MeshStandardMaterial({ color: 0xb9a99a, roughness: 0.9 });
  const floor = new THREE.MeshStandardMaterial({ color: 0x4a3f38, roughness: 0.8 });
  const ceil = new THREE.MeshStandardMaterial({ color: 0xded6cc, roughness: 1 });
  const room = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [wall, wall, ceil, floor, wall, wall].map((m) => m.clone()));
  for (const m of room.material as THREE.Material[]) m.side = THREE.BackSide;
  room.position.y = h / 2;
  g.add(room);
  const lamp = new THREE.PointLight(0xffd9a8, 18, 14, 1.6);
  lamp.position.set(0, h - 0.4, 0);
  g.add(lamp);
  return g;
}
