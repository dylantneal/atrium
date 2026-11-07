import * as THREE from 'three';
import type { AmbientSnapshot } from '../apps/ambient/ambient';
import { sunInWindow, WALL_AZIMUTH } from '../apps/ambient/sun';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const FRAG = /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSun;
uniform vec2 uSunPos; uniform vec2 uMoonPos;
uniform float uStars; uniform float uCloud; uniform float uPrecip; uniform float uIntensity; uniform float uFog; uniform float uTime; uniform float uDay;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 uv = vUv;
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.08, 0.95, uv.y));
  // stars
  if (uStars > 0.01) {
    vec2 cell = floor(uv * vec2(70.0));
    float h = hash(cell);
    col += vec3(step(0.985, h)) * uStars * smoothstep(0.2, 0.55, uv.y) * (0.65 + 0.35 * sin(uTime * 2.0 + h * 40.0));
  }
  // moon, then sun
  if (uMoonPos.x >= 0.0) {
    float dm = distance(uv, uMoonPos);
    col = mix(col, vec3(0.92, 0.94, 1.0), smoothstep(0.045, 0.036, dm) * (1.0 - uCloud * 0.6));
    col += vec3(0.5, 0.55, 0.7) * exp(-dm * 9.0) * 0.18;
  }
  if (uSunPos.x >= 0.0) {
    float ds = distance(uv, uSunPos);
    col += uSun * exp(-ds * 5.5) * 0.45 * (1.0 - uCloud * 0.65);
    col = mix(col, uSun, smoothstep(0.06, 0.048, ds) * (1.0 - uCloud * 0.7));
  }
  // clouds drifting
  float c = noise(uv * vec2(3.0, 2.0) + vec2(uTime * 0.02, 0.0)) * 0.6 + noise(uv * vec2(7.0, 4.0) - vec2(uTime * 0.035, 0.0)) * 0.4;
  float mask = smoothstep(1.0 - uCloud - 0.02, 1.0 - uCloud * 0.55 + 0.2, c + uCloud * 0.3);
  vec3 cloudCol = mix(vec3(1.0), vec3(0.5, 0.53, 0.6), uCloud) * (0.28 + 0.72 * uDay);
  col = mix(col, cloudCol, mask * clamp(uCloud * 1.15, 0.0, 1.0) * 0.92);
  col = mix(col, uHorizon * 0.85 + 0.12, uFog * 0.85);
  if (uPrecip > 0.5 && uPrecip < 1.5) {
    // rain: falling streaks in columns
    vec2 p = uv * vec2(90.0, 7.0);
    float id = floor(p.x);
    float speed = 2.4 + hash(vec2(id, 1.0)) * 2.2;
    float y = fract(p.y + uTime * speed + hash(vec2(id, 3.0)));
    float on = step(1.0 - uIntensity * 0.6, hash(vec2(id, floor(p.y + uTime * speed + hash(vec2(id, 3.0))))));
    col = mix(col, vec3(0.82, 0.88, 1.0), smoothstep(0.0, 0.04, y) * smoothstep(0.22, 0.0, y) * on * 0.55);
  } else if (uPrecip > 1.5) {
    // snow: soft drifting flakes
    vec2 p = uv * vec2(28.0, 18.0) + vec2(sin(uTime * 0.7 + uv.y * 6.0) * 0.6, -uTime * 0.9);
    vec2 cell = floor(p);
    vec2 f = fract(p) - 0.5;
    float flake = step(1.0 - uIntensity * 0.5, hash(cell)) * smoothstep(0.22, 0.06, length(f + (hash(cell + 3.0) - 0.5) * 0.4));
    col = mix(col, vec3(1.0), flake * 0.9);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export interface SkyUniformsView {
  zenith: number;
  horizon: number;
  sunPos: [number, number] | null;
  moonPos: [number, number] | null;
  precip: 'none' | 'rain' | 'snow';
  cloud: number;
  stars: number;
}

/** One sky material per wall side: each window looks a different way, so the sun sits in a different place. */
export function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uZenith: { value: new THREE.Color(0x3d7fd6) },
      uHorizon: { value: new THREE.Color(0xbfe0ff) },
      uSun: { value: new THREE.Color(0xfff4d6) },
      uSunPos: { value: new THREE.Vector2(-1, -1) },
      uMoonPos: { value: new THREE.Vector2(-1, -1) },
      uStars: { value: 0 },
      uCloud: { value: 0 },
      uPrecip: { value: 0 },
      uIntensity: { value: 0 },
      uFog: { value: 0 },
      uTime: { value: 0 },
      uDay: { value: 1 },
    },
  });
}

/** Point a sky material at the current sky as seen from a wall facing `side`. Returns what it set (tests read this). */
export function applySky(mat: THREE.ShaderMaterial, a: AmbientSnapshot, side: 'N' | 'E' | 'S' | 'W'): SkyUniformsView {
  const u = mat.uniforms;
  u.uZenith.value.setHex(a.palette.zenith);
  u.uHorizon.value.setHex(a.palette.horizon);
  u.uSun.value.setHex(a.palette.sun);
  const facing = WALL_AZIMUTH[side];
  const sunPos = a.sun.altitude > -0.05 ? sunInWindow(a.sun, facing) : null;
  // the moon rides opposite the sun
  const moon = { altitude: -a.sun.altitude, azimuth: (a.sun.azimuth + Math.PI) % (2 * Math.PI) };
  const moonPos = a.sun.altitude < 0.02 ? sunInWindow(moon, facing) : null;
  u.uSunPos.value.set(sunPos ? sunPos.x : -1, sunPos ? sunPos.y : -1);
  u.uMoonPos.value.set(moonPos ? moonPos.x : -1, moonPos ? moonPos.y : -1);
  u.uStars.value = a.palette.stars;
  u.uCloud.value = a.cloud;
  u.uPrecip.value = a.precip === 'rain' ? 1 : a.precip === 'snow' ? 2 : 0;
  u.uIntensity.value = a.precipIntensity;
  u.uFog.value = a.fog;
  u.uDay.value = a.daylight;
  return { zenith: a.palette.zenith, horizon: a.palette.horizon, sunPos: sunPos ? [sunPos.x, sunPos.y] : null, moonPos: moonPos ? [moonPos.x, moonPos.y] : null, precip: a.precip, cloud: a.cloud, stars: a.palette.stars };
}
