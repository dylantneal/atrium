import { createStore, type Store } from '../../core/store';
import { getSetting, setSetting } from '../../data/idb';
import { daylightFactor, skyPalette, sunPosition, type SkyPalette, type SunPosition } from './sun';
import { DEMO_PLACE, demoForecast, describeCode, forecastUrl, geocodeUrl, parseForecast, parseGeocoding, WEATHER_PRESETS, type Conditions, type Forecast, type Place } from './weather';

/** What drawing code needs from the environment: nothing about network, places or units. */
export interface AmbientSnapshot {
  now: number;
  sun: SunPosition;
  daylight: number;
  palette: SkyPalette;
  cloud: number;
  precip: 'none' | 'rain' | 'snow';
  precipIntensity: number;
  fog: number;
  thunder: boolean;
}

export interface AmbientState {
  now: number;
  place: Place;
  sun: SunPosition;
  daylight: number;
  palette: SkyPalette;
  forecast: Forecast;
  /** Conditions right now: the forecast hour that matches the clock, or the forced preset. */
  conditions: Conditions & { tempC: number; windKph: number };
  source: 'demo' | 'live';
  /** The last refresh error, if any (the previous forecast stays on screen). */
  error: string | null;
  updated: number;
}

export interface WeatherProvider {
  fetchForecast(place: Place, now: number): Promise<Forecast>;
  search(name: string): Promise<Place[]>;
}

/** Keyless public weather and geocoding. `fetchFn` is injectable so tests and the shell can control the network. */
export class OpenMeteoProvider implements WeatherProvider {
  constructor(private fetchFn: typeof fetch = (...a) => fetch(...a)) {}

  async fetchForecast(place: Place, now: number): Promise<Forecast> {
    const res = await this.fetchFn(forecastUrl(place), { cache: 'no-store' });
    if (!res.ok) throw new Error(`Weather service answered ${res.status}`);
    return parseForecast(await res.json(), place, now);
  }

  async search(name: string): Promise<Place[]> {
    if (name.trim().length < 2) return [];
    const res = await this.fetchFn(geocodeUrl(name.trim()));
    if (!res.ok) throw new Error(`Place search answered ${res.status}`);
    return parseGeocoding(await res.json());
  }
}

export interface AmbientOptions {
  /** Real clock (ms since epoch). Defaults to Date.now. */
  clock?: () => number;
  provider?: WeatherProvider | null;
  /** Force a weather preset (a WMO code or a name like "rain") instead of the demo or live data. */
  force?: number | string | null;
}

const REFRESH_MS = 15 * 60_000;

/**
 * The environment as the world sees it: what time it is, where the sun is, what the sky is doing.
 * The demo sky works with no network at all; a place plus a provider switches to live Open-Meteo data.
 * Time can be moved (for tests, and for watching a day go by) without touching the real clock.
 */
export class AmbientService {
  readonly store: Store<AmbientState>;
  private clock: () => number;
  private provider: WeatherProvider | null;
  private place: Place | null = null;
  private live: Forecast | null = null;
  private error: string | null = null;
  private forced: number | null;
  /** now = anchorSim + (real - anchorReal) * scale */
  private anchorReal: number;
  private anchorSim: number;
  private scale = 1;
  private timers: number[] = [];
  private lastRefresh = 0;

  constructor(opts: AmbientOptions = {}) {
    this.clock = opts.clock ?? Date.now;
    this.provider = opts.provider ?? null;
    this.forced = typeof opts.force === 'string' ? (WEATHER_PRESETS[opts.force] ?? null) : (opts.force ?? null);
    this.anchorReal = this.clock();
    this.anchorSim = this.anchorReal;
    this.store = createStore<AmbientState>(this.derive());
  }

  get now(): number {
    return this.anchorSim + (this.clock() - this.anchorReal) * this.scale;
  }
  get currentPlace(): Place {
    return this.place ?? DEMO_PLACE;
  }
  get hasProvider() {
    return this.provider !== null;
  }

  // ---------------------------------------------------------------- time

  /** Jump to a moment (or back to real time with null). Used by tests, demos and "what will it look like at 6pm". */
  setNow(ms: number | null) {
    this.anchorReal = this.clock();
    this.anchorSim = ms ?? this.anchorReal;
    if (ms === null) this.scale = 1;
    this.recompute();
  }

  advance(ms: number) {
    this.anchorSim = this.now + ms;
    this.anchorReal = this.clock();
    this.recompute();
  }

  /** Run time faster than real (a whole day in a minute with 1440). */
  setTimeScale(scale: number) {
    this.anchorSim = this.now;
    this.anchorReal = this.clock();
    this.scale = Math.max(0, scale);
    this.recompute();
  }

  // ---------------------------------------------------------------- weather

  /** Pin the weather to a preset or WMO code, or release it with null. */
  force(code: number | string | null) {
    this.forced = typeof code === 'string' ? (WEATHER_PRESETS[code] ?? null) : code;
    this.recompute();
  }

  /** Load the saved place and units. Never throws; falls back to the demo sky. */
  async load(): Promise<void> {
    try {
      const p = await getSetting<Place>('ambient:place');
      if (p && typeof p.lat === 'number' && typeof p.lon === 'number') this.place = p;
    } catch {
      /* no saved place */
    }
    await this.refresh();
  }

  async setPlace(place: Place | null) {
    this.place = place;
    this.live = null;
    this.error = null;
    await setSetting('ambient:place', place);
    await this.refresh(true);
  }

  /** Fetch live weather when a place is set and a provider exists; otherwise use the demo sky. */
  async refresh(force = false): Promise<void> {
    const now = this.now;
    if (this.place && this.provider && (force || now - this.lastRefresh >= REFRESH_MS || !this.live)) {
      try {
        this.live = await this.provider.fetchForecast(this.place, now);
        this.error = null;
        this.lastRefresh = now;
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
        this.lastRefresh = now - REFRESH_MS + 60_000; // try again in a minute
      }
    }
    this.recompute();
  }

  async search(name: string): Promise<Place[]> {
    if (!this.provider) return [];
    return this.provider.search(name);
  }

  /** Start the periodic work: a gentle recompute so the sky drifts, and the 15-minute refresh. */
  start(tickMs = 5000) {
    this.stop();
    this.timers.push(window.setInterval(() => this.recompute(), tickMs));
    this.timers.push(window.setInterval(() => void this.refresh(), 60_000));
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  // ---------------------------------------------------------------- derive

  recompute() {
    this.store.set(this.derive());
  }

  private forecastNow(now: number): Forecast {
    if (this.live && this.forced === null) return this.live;
    return demoForecast(now, this.place ?? DEMO_PLACE, this.forced ?? undefined);
  }

  private derive(): AmbientState {
    const now = this.now;
    const place = this.place ?? DEMO_PLACE;
    const forecast = this.forecastNow(now);
    // the forecast hour that matches the clock beats the snapshot taken when we fetched
    let cond = { ...forecast.current } as Conditions & { tempC: number; windKph: number };
    if (forecast.source === 'live') {
      const hour = [...forecast.hourly].reverse().find((h) => h.time <= now && now - h.time < 3 * 3600_000);
      if (hour) cond = { ...describeCode(hour.code), tempC: hour.tempC, windKph: forecast.current.windKph };
    } else {
      cond = { ...describeCode(this.forced ?? forecast.current.code), tempC: forecast.current.tempC, windKph: forecast.current.windKph };
    }
    const sun = sunPosition(now, place.lat, place.lon);
    return {
      now,
      place,
      sun,
      daylight: daylightFactor(sun.altitude) * (1 - 0.45 * cond.cloud),
      palette: skyPalette(sun.altitude, cond.cloud),
      forecast,
      conditions: cond,
      source: forecast.source,
      error: this.error,
      updated: this.clock(),
    };
  }

  snapshot(s: AmbientState = this.store.get()): AmbientSnapshot {
    return {
      now: s.now,
      sun: s.sun,
      daylight: s.daylight,
      palette: s.palette,
      cloud: s.conditions.cloud,
      precip: s.conditions.precip,
      precipIntensity: s.conditions.intensity,
      fog: s.conditions.fog,
      thunder: s.conditions.thunder,
    };
  }
}
