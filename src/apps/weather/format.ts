export type Units = 'metric' | 'imperial';

/** Regions that use Fahrenheit and miles per hour. */
const IMPERIAL = new Set(['US', 'LR', 'MM']);

export function defaultUnits(locale: string = typeof navigator !== 'undefined' ? navigator.language : 'en-US'): Units {
  try {
    return IMPERIAL.has(new Intl.Locale(locale).maximize().region ?? '') ? 'imperial' : 'metric';
  } catch {
    return 'metric';
  }
}

export const cToF = (c: number) => (c * 9) / 5 + 32;

export function formatTemp(c: number, units: Units): string {
  const v = units === 'imperial' ? cToF(c) : c;
  return `${Math.round(v)}°${units === 'imperial' ? 'F' : 'C'}`;
}

export function formatWind(kph: number, units: Units): string {
  return units === 'imperial' ? `${Math.round(kph * 0.621371)} mph` : `${Math.round(kph)} km/h`;
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayName = (ms: number) => DAY[new Date(ms).getDay()];
export const hourLabel = (ms: number) => {
  const h = new Date(ms).getHours();
  return h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;
};

/** A short glyph for a conditions label: used on cards, never as the only cue (the label is always shown too). */
export function glyph(code: number): string {
  if (code === 0 || code === 1) return '☀';
  if (code === 2) return '⛅';
  if (code === 3) return '☁';
  if (code === 45 || code === 48) return '🌫';
  if (code >= 51 && code <= 67) return '🌧';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '❄';
  if (code >= 80 && code <= 82) return '🌦';
  if (code >= 95) return '⛈';
  return '·';
}

/** Temperature to a bar colour: cold blue, cool teal, warm yellow, hot red. */
export function tempColor(c: number): number {
  const stops: [number, number][] = [[-10, 0x4a7bd0], [5, 0x5fc0b0], [18, 0xf0c95a], [32, 0xe0603a]];
  if (c <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i];
    const [b, cb] = stops[i + 1];
    if (c <= b) {
      const t = (c - a) / (b - a);
      const ch = (shift: number) => Math.round(((ca >> shift) & 255) * (1 - t) + ((cb >> shift) & 255) * t);
      return (ch(16) << 16) | (ch(8) << 8) | ch(0);
    }
  }
  return stops[stops.length - 1][1];
}
