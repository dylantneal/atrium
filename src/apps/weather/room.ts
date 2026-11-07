import * as THREE from 'three';
import type { AmbientState } from '../ambient/ambient';
import { AppRoom, makeAppRoom } from '../appRoom';
import { HALL_ID, type AppContext, type RoomBuildDeps } from '../api';
import { dayName, defaultUnits, formatTemp, formatWind, glyph, hourLabel, tempColor, type Units } from './format';

interface CanvasPlane {
  mesh: THREE.Mesh;
  g: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  w: number;
  h: number;
}

function canvasPlane(px: [number, number], size: [number, number], transparent = true): CanvasPlane {
  const c = document.createElement('canvas');
  c.width = px[0];
  c.height = px[1];
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), new THREE.MeshBasicMaterial({ map: tex, transparent }));
  return { mesh, g: c.getContext('2d')!, tex, w: px[0], h: px[1] };
}

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color });

/**
 * The Weather Deck: a table with the next 24 hours as bars, the week as cards, and today's conditions on the wall.
 * Everything redraws as the sky or the clock changes; windows (from the base room) show the live sky.
 */
export async function buildWeatherDeck(ctx: AppContext, deps: RoomBuildDeps): Promise<AppRoom> {
  const data = makeAppRoom({ id: 'app:weather', title: 'Weather Deck', width: 10, depth: 8, backTo: HALL_ID, palette: 6, activity: 0.85 });
  const room = new AppRoom({ ...deps, room: data, items: new Map(), props: 1 }, 'weather');

  // table
  const table = new THREE.Group();
  const wood = lambert(0x8a6a45);
  const top = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.08, 1.5), wood);
  top.position.y = 0.9;
  table.add(top);
  for (const [x, z] of [[-1.6, -0.65], [1.6, -0.65], [-1.6, 0.65], [1.6, 0.65]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.86, 0.08), wood);
    leg.position.set(x, 0.43, z);
    table.add(leg);
  }
  table.position.set(0, 0, -0.9);
  room.addObject(table, 'table');

  // 24 hourly bars (one instanced mesh)
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), 24);
  bars.frustumCulled = false;
  table.add(bars);

  const labels = canvasPlane([1024, 96], [3.1, 0.29]);
  labels.mesh.position.set(0, 0.99, 0.55);
  table.add(labels.mesh);

  const cards = canvasPlane([1260, 200], [3.3, 0.52]);
  cards.mesh.position.set(0, 1.62, -0.62);
  table.add(cards.mesh);

  const plaque = canvasPlane([900, 300], [3.0, 1.0]);
  plaque.mesh.position.set(0, 2.25, -3.93);
  room.addDecor(plaque.mesh);

  let units: Units = (await ctx.settings.get<Units>('units')) ?? defaultUnits();
  let drawnKey = '';

  const draw = (s: AmbientState) => {
    const f = s.forecast;
    const hours = f.hourly.filter((h) => h.time >= s.now - 3600_000).slice(0, 24);
    const temps = hours.map((h) => h.tempC);
    const lo = Math.min(...temps, 0);
    const hi = Math.max(...temps, lo + 1);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    bars.count = hours.length;
    hours.forEach((h, i) => {
      const height = 0.06 + ((h.tempC - lo) / (hi - lo)) * 0.26;
      const x = -1.5 + (i * 3.0) / 23;
      m.compose(new THREE.Vector3(x, 0.94 + height / 2, 0.12), new THREE.Quaternion(), new THREE.Vector3(0.09, height, 0.09));
      bars.setMatrixAt(i, m);
      col.setHex(tempColor(h.tempC)).lerp(new THREE.Color(0x2f6bd6), Math.min(0.55, Math.max(0, (h.precipProb - 40) / 90)));
      bars.setColorAt(i, col);
    });
    bars.instanceMatrix.needsUpdate = true;
    if (bars.instanceColor) bars.instanceColor.needsUpdate = true;

    // hour labels under the bars
    const lg = labels.g;
    lg.clearRect(0, 0, labels.w, labels.h);
    lg.fillStyle = 'rgba(20,18,26,0.82)';
    lg.fillRect(0, 0, labels.w, labels.h);
    lg.fillStyle = '#f2eef8';
    lg.textAlign = 'center';
    hours.forEach((h, i) => {
      if (i % 3 !== 0) return;
      const x = 22 + (i * (labels.w - 44)) / 23;
      lg.font = '600 24px system-ui, sans-serif';
      lg.fillText(hourLabel(h.time), x, 34);
      lg.font = '500 22px system-ui, sans-serif';
      lg.fillStyle = '#b8b0c8';
      lg.fillText(formatTemp(h.tempC, units), x, 72);
      lg.fillStyle = '#f2eef8';
    });
    labels.tex.needsUpdate = true;

    // the week
    const cg = cards.g;
    cg.clearRect(0, 0, cards.w, cards.h);
    f.daily.slice(0, 7).forEach((d, i) => {
      const x = i * 180;
      cg.fillStyle = 'rgba(20,18,26,0.85)';
      cg.beginPath();
      cg.roundRect(x + 4, 4, 172, 192, 14);
      cg.fill();
      cg.fillStyle = '#f2eef8';
      cg.textAlign = 'center';
      cg.font = '700 28px system-ui, sans-serif';
      cg.fillText(i === 0 ? 'Today' : dayName(d.time), x + 90, 40);
      cg.font = '56px system-ui, sans-serif';
      cg.fillText(glyph(d.code), x + 90, 108);
      cg.font = '600 26px system-ui, sans-serif';
      cg.fillText(`${formatTemp(d.maxC, units)}`, x + 90, 146);
      cg.fillStyle = '#9fb0d8';
      cg.font = '500 22px system-ui, sans-serif';
      cg.fillText(`${formatTemp(d.minC, units)}`, x + 90, 176);
    });
    cards.tex.needsUpdate = true;

    // today on the wall
    const pg = plaque.g;
    pg.clearRect(0, 0, plaque.w, plaque.h);
    pg.fillStyle = 'rgba(16,13,22,0.86)';
    pg.beginPath();
    pg.roundRect(0, 0, plaque.w, plaque.h, 26);
    pg.fill();
    pg.fillStyle = '#f4eff9';
    pg.textAlign = 'left';
    pg.font = '700 120px system-ui, sans-serif';
    pg.fillText(formatTemp(s.conditions.tempC, units), 40, 140);
    pg.font = '56px system-ui, sans-serif';
    pg.fillText(glyph(s.conditions.code), 560, 120);
    pg.font = '600 46px system-ui, sans-serif';
    pg.fillText(s.conditions.label, 40, 212);
    pg.fillStyle = '#b8b0c8';
    pg.font = '500 30px system-ui, sans-serif';
    pg.fillText(`Wind ${formatWind(s.conditions.windKph, units)}  ·  ${s.place.name}  ·  ${s.source === 'live' ? 'live' : 'demo sky'}`, 40, 262);
    plaque.tex.needsUpdate = true;
  };

  const refresh = async (s: AmbientState) => {
    units = (await ctx.settings.get<Units>('units')) ?? units;
    const key = `${Math.floor(s.now / 60000)}|${s.place.name}|${s.source}|${s.conditions.code}|${units}|${s.forecast.fetchedAt}`;
    if (key === drawnKey) return;
    drawnKey = key;
    draw(s);
  };
  draw(ctx.ambient.store.get());
  drawnKey = '';
  const off = ctx.ambient.store.subscribe((s) => void refresh(s));
  room.addDisposer(off);
  return room;
}
