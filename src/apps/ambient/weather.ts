import { hash32 } from '../../util/hash';

/** Weather types, the WMO code table, the Open-Meteo parser, and a deterministic demo sky. No network and no DOM in here. */

export type Precip = 'none' | 'rain' | 'snow';

export interface Place {
  name: string;
  lat: number;
  lon: number;
}

export interface Conditions {
  code: number;
  label: string;
  /** 0..1 cloud cover. */
  cloud: number;
  precip: Precip;
  /** 0..1 how hard it is falling. */
  intensity: number;
  /** 0..1 fog density. */
  fog: number;
  thunder: boolean;
}

export interface Current extends Conditions {
  tempC: number;
  windKph: number;
  isDay: boolean;
  time: number;
}

export interface HourPoint {
  time: number;
  tempC: number;
  code: number;
  precipProb: number;
}

export interface DayPoint {
  time: number;
  code: number;
  maxC: number;
  minC: number;
}

export interface Forecast {
  place: Place;
  current: Current;
  hourly: HourPoint[];
  daily: DayPoint[];
  fetchedAt: number;
  source: 'live' | 'demo';
}

const C = (label: string, cloud: number, precip: Precip = 'none', intensity = 0, fog = 0, thunder = false): Omit<Conditions, 'code'> => ({ label, cloud, precip, intensity, fog, thunder });

const TABLE: Record<number, Omit<Conditions, 'code'>> = {
  0: C('Clear', 0.04),
  1: C('Mostly clear', 0.2),
  2: C('Partly cloudy', 0.5),
  3: C('Overcast', 0.95),
  45: C('Fog', 0.9, 'none', 0, 0.7),
  48: C('Freezing fog', 0.9, 'none', 0, 0.8),
  51: C('Light drizzle', 0.85, 'rain', 0.15),
  53: C('Drizzle', 0.9, 'rain', 0.3),
  55: C('Heavy drizzle', 0.95, 'rain', 0.45),
  56: C('Freezing drizzle', 0.9, 'rain', 0.25),
  57: C('Heavy freezing drizzle', 0.95, 'rain', 0.4),
  61: C('Light rain', 0.9, 'rain', 0.35),
  63: C('Rain', 0.95, 'rain', 0.6),
  65: C('Heavy rain', 1, 'rain', 0.9),
  66: C('Freezing rain', 0.95, 'rain', 0.5),
  67: C('Heavy freezing rain', 1, 'rain', 0.8),
  71: C('Light snow', 0.9, 'snow', 0.3),
  73: C('Snow', 0.95, 'snow', 0.55),
  75: C('Heavy snow', 1, 'snow', 0.85),
  77: C('Snow grains', 0.85, 'snow', 0.3),
  80: C('Light showers', 0.8, 'rain', 0.4),
  81: C('Showers', 0.88, 'rain', 0.65),
  82: C('Violent showers', 0.98, 'rain', 0.95),
  85: C('Snow showers', 0.9, 'snow', 0.5),
  86: C('Heavy snow showers', 0.98, 'snow', 0.8),
  95: C('Thunderstorm', 0.98, 'rain', 0.7, 0, true),
  96: C('Thunderstorm with hail', 0.98, 'rain', 0.85, 0, true),
  99: C('Severe thunderstorm', 1, 'rain', 0.95, 0, true),
};

/** Turns a WMO weather code into things we can draw. Unknown codes read as "Unknown" with a clear sky. */
export function describeCode(code: number): Conditions {
  const t = TABLE[code];
  return t ? { code, ...t } : { code, ...C('Unknown', 0.3) };
}

// ---------------------------------------------------------------- Open-Meteo

export const OPEN_METEO_HOST = 'api.open-meteo.com';
export const GEOCODING_HOST = 'geocoding-api.open-meteo.com';

export function forecastUrl(p: Place): string {
  const q = new URLSearchParams({
    latitude: p.lat.toFixed(3),
    longitude: p.lon.toFixed(3),
    current: 'temperature_2m,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    forecast_days: '7',
    timezone: 'auto',
  });
  return `https://${OPEN_METEO_HOST}/v1/forecast?${q}`;
}

export function geocodeUrl(name: string): string {
  return `https://${GEOCODING_HOST}/v1/search?${new URLSearchParams({ name, count: '5', language: 'en', format: 'json' })}`;
}

export class WeatherParseError extends Error {}

const num = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new WeatherParseError(`Bad ${what}`);
  return v;
};

/** Open-Meteo gives local times without an offset; `utc_offset_seconds` turns them into real instants. */
function localToUtc(iso: unknown, offsetSec: number): number {
  if (typeof iso !== 'string') throw new WeatherParseError('Bad time');
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) throw new WeatherParseError(`Bad time "${iso}"`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - offsetSec * 1000;
}

export function parseForecast(json: any, place: Place, fetchedAt: number): Forecast {
  if (!json || typeof json !== 'object') throw new WeatherParseError('Empty response');
  const off = typeof json.utc_offset_seconds === 'number' ? json.utc_offset_seconds : 0;
  const cur = json.current;
  if (!cur) throw new WeatherParseError('No current conditions');
  const current: Current = {
    ...describeCode(num(cur.weather_code, 'weather code')),
    tempC: num(cur.temperature_2m, 'temperature'),
    windKph: num(cur.wind_speed_10m, 'wind'),
    isDay: cur.is_day === 1,
    time: localToUtc(cur.time, off),
  };
  const h = json.hourly;
  const hourly: HourPoint[] = [];
  if (h && Array.isArray(h.time)) {
    for (let i = 0; i < h.time.length; i++) {
      hourly.push({
        time: localToUtc(h.time[i], off),
        tempC: num(h.temperature_2m?.[i], 'hourly temperature'),
        code: num(h.weather_code?.[i], 'hourly code'),
        precipProb: typeof h.precipitation_probability?.[i] === 'number' ? h.precipitation_probability[i] : 0,
      });
    }
  }
  const d = json.daily;
  const daily: DayPoint[] = [];
  if (d && Array.isArray(d.time)) {
    for (let i = 0; i < d.time.length; i++) {
      daily.push({ time: localToUtc(`${d.time[i]}T12:00`, off), code: num(d.weather_code?.[i], 'daily code'), maxC: num(d.temperature_2m_max?.[i], 'daily max'), minC: num(d.temperature_2m_min?.[i], 'daily min') });
    }
  }
  return { place, current, hourly, daily, fetchedAt, source: 'live' };
}

export function parseGeocoding(json: any): Place[] {
  const rows = json?.results;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => typeof r?.latitude === 'number' && typeof r?.longitude === 'number' && typeof r?.name === 'string')
    .map((r) => ({ name: [r.name, r.admin1, r.country_code].filter((x) => typeof x === 'string' && x).join(', '), lat: r.latitude, lon: r.longitude }));
}

// ---------------------------------------------------------------- demo sky

export const DEMO_PLACE: Place = { name: 'Demo sky', lat: 40.71, lon: -74.0 };

/** Presets for `?weather=` and tests. */
export const WEATHER_PRESETS: Record<string, number> = { clear: 0, partly: 2, cloud: 3, fog: 45, rain: 63, storm: 95, snow: 73 };

const STATES: [number, number][] = [
  [0, 40], [1, 12], [2, 18], [3, 12], [45, 4], [61, 6], [63, 5], [80, 3],
];

/** Same time, same sky: a gentle pseudo-random weather that changes every six hours. */
export function demoCode(ms: number, tempC: number): number {
  const block = Math.floor(ms / (6 * 3600_000));
  let r = hash32(`demo-weather:${block}`) % 100;
  for (const [code, w] of STATES) {
    if (r < w) return tempC <= 0 && code >= 60 && code < 70 ? 71 : code;
    r -= w;
  }
  return 0;
}

/** Seasonal and daily temperature for the demo sky (northern hemisphere, mid-latitude). */
export function demoTemp(ms: number, lat: number): number {
  const day = (ms / 86400000 + 4) % 365.25; // day of year, rough
  const season = Math.sin(((day - 100) / 365.25) * 2 * Math.PI) * (lat >= 0 ? 1 : -1);
  const hour = ((ms / 3600000) % 24 + 24 + lat / 15) % 24; // crude local hour
  const diurnal = Math.sin(((hour - 9) / 24) * 2 * Math.PI) * 4;
  return Math.round((11 + 12 * season + diurnal) * 10) / 10;
}

export function demoForecast(now: number, place: Place = DEMO_PLACE, forceCode?: number): Forecast {
  const at = (ms: number) => {
    const t = demoTemp(ms, place.lat);
    return { t, code: forceCode ?? demoCode(ms, t) };
  };
  const top = Math.floor(now / 3600_000) * 3600_000;
  const nowS = at(now);
  const hourly: HourPoint[] = Array.from({ length: 24 }, (_, i) => {
    const ms = top + i * 3600_000;
    const s = at(ms);
    const c = describeCode(s.code);
    return { time: ms, tempC: s.t, code: s.code, precipProb: c.precip === 'none' ? 5 : Math.round(40 + c.intensity * 55) };
  });
  const day0 = Math.floor(now / 86400000) * 86400000;
  const daily: DayPoint[] = Array.from({ length: 7 }, (_, i) => {
    const noon = day0 + i * 86400000 + 12 * 3600_000;
    const temps = [0, 6, 12, 15, 18, 21].map((h) => demoTemp(day0 + i * 86400000 + h * 3600_000, place.lat));
    return { time: noon, code: at(noon).code, maxC: Math.max(...temps), minC: Math.min(...temps) };
  });
  const cur = describeCode(nowS.code);
  return {
    place,
    current: { ...cur, tempC: nowS.t, windKph: 6 + (hash32(`wind:${Math.floor(now / 3600_000)}`) % 20) + cur.intensity * 20, isDay: true, time: now },
    hourly,
    daily,
    fetchedAt: now,
    source: 'demo',
  };
}

export const toF = (c: number) => (c * 9) / 5 + 32;
