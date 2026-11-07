import { beforeEach, describe, expect, it } from 'vitest';
import { AmbientService, OpenMeteoProvider, type WeatherProvider } from '../src/apps/ambient/ambient';
import { demoForecast, type Place } from '../src/apps/ambient/weather';
import { closeDb, getSetting, setDbName } from '../src/data/idb';

const NOON_NYC = Date.UTC(2026, 5, 21, 16, 56); // June solstice solar noon in New York
const MIDNIGHT_NYC = Date.UTC(2026, 5, 21, 4, 0);
const PARIS: Place = { name: 'Paris, FR', lat: 48.85, lon: 2.35 };

function fakeProvider(over: Partial<WeatherProvider> = {}) {
  const calls: Place[] = [];
  const p: WeatherProvider = {
    async fetchForecast(place, now) {
      calls.push(place);
      const f = demoForecast(now, place, 63);
      return { ...f, source: 'live' as const };
    },
    async search(name) {
      return name.toLowerCase().includes('paris') ? [PARIS] : [];
    },
    ...over,
  };
  return { p, calls };
}

describe('AmbientService', () => {
  beforeEach(async () => {
    await closeDb();
    setDbName(`amb-${Math.random()}`);
  });

  it('runs a demo sky with no provider and no network: bright at noon, dark at midnight', () => {
    const a = new AmbientService({ clock: () => NOON_NYC, force: 'clear' }); // pin the weather: stars depend on cloud
    expect(a.store.get().source).toBe('demo');
    a.setNow(NOON_NYC);
    expect(a.store.get().daylight).toBeGreaterThan(0.9);
    a.setNow(MIDNIGHT_NYC);
    expect(a.store.get().daylight).toBe(0);
    expect(a.store.get().palette.stars).toBeGreaterThan(0.9);
    // an overcast night hides most of the stars
    a.force('cloud');
    expect(a.store.get().palette.stars).toBeLessThan(0.4);
  });

  it('moves time without touching the real clock, and returns to it', () => {
    let real = 1_000_000;
    const a = new AmbientService({ clock: () => real });
    a.setNow(NOON_NYC);
    expect(a.now).toBe(NOON_NYC);
    real += 60_000; // a real minute passes
    expect(a.now).toBe(NOON_NYC + 60_000);
    a.advance(3600_000);
    expect(a.now).toBe(NOON_NYC + 60_000 + 3600_000);
    a.setNow(null);
    expect(a.now).toBe(real);
  });

  it('runs faster than real time on request', () => {
    let real = 0;
    const a = new AmbientService({ clock: () => real });
    a.setNow(NOON_NYC);
    a.setTimeScale(1440);
    real += 1000; // one real second is 24 simulated minutes
    expect(a.now - NOON_NYC).toBe(1440 * 1000);
  });

  it('can be forced to a preset: rain greys the sky, dims daylight, and sets precipitation', () => {
    const clear = new AmbientService({ clock: () => NOON_NYC, force: 'clear' });
    const rain = new AmbientService({ clock: () => NOON_NYC, force: 'rain' });
    expect(clear.store.get().conditions.precip).toBe('none');
    expect(rain.store.get().conditions).toMatchObject({ precip: 'rain', label: 'Rain' });
    expect(rain.store.get().daylight).toBeLessThan(clear.store.get().daylight);
    rain.force(null);
    rain.force('snow');
    expect(rain.store.get().conditions.precip).toBe('snow');
  });

  it('uses live data when a place and a provider exist, and remembers the place', async () => {
    const { p, calls } = fakeProvider();
    const a = new AmbientService({ clock: () => NOON_NYC, provider: p });
    await a.setPlace(PARIS);
    expect(calls).toEqual([PARIS]);
    expect(a.store.get()).toMatchObject({ source: 'live', place: PARIS, error: null });
    expect(await getSetting('ambient:place')).toEqual(PARIS);
    // a new service loads the saved place
    const b = new AmbientService({ clock: () => NOON_NYC, provider: p });
    await b.load();
    expect(b.store.get().place).toEqual(PARIS);
    expect(b.store.get().source).toBe('live');
  });

  it('keeps the last good forecast and reports the error when a refresh fails', async () => {
    let fail = false;
    const { p } = fakeProvider({
      async fetchForecast(place, now) {
        if (fail) throw new Error('offline');
        return { ...demoForecast(now, place, 3), source: 'live' as const };
      },
    });
    const a = new AmbientService({ clock: () => NOON_NYC, provider: p });
    await a.setPlace(PARIS);
    expect(a.store.get().conditions.label).toBe('Overcast');
    fail = true;
    await a.refresh(true);
    expect(a.store.get().error).toBe('offline');
    expect(a.store.get().conditions.label).toBe('Overcast'); // still showing the last forecast
    expect(a.store.get().source).toBe('live');
  });

  it('falls back to the demo sky when the place is cleared', async () => {
    const { p } = fakeProvider();
    const a = new AmbientService({ clock: () => NOON_NYC, provider: p });
    await a.setPlace(PARIS);
    await a.setPlace(null);
    expect(a.store.get().source).toBe('demo');
    expect(a.store.get().place.name).toBe('Demo sky');
  });

  it('searches places through the provider, and returns nothing without one', async () => {
    const { p } = fakeProvider();
    expect(await new AmbientService({ provider: p }).search('paris')).toEqual([PARIS]);
    expect(await new AmbientService().search('paris')).toEqual([]);
  });

  it('the snapshot carries only what drawing needs', () => {
    const a = new AmbientService({ clock: () => NOON_NYC, force: 'storm' });
    const s = a.snapshot();
    expect(Object.keys(s).sort()).toEqual(['cloud', 'daylight', 'fog', 'now', 'palette', 'precip', 'precipIntensity', 'sun', 'thunder']);
    expect(s.thunder).toBe(true);
  });
});

describe('OpenMeteoProvider', () => {
  const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
  it('requests the forecast URL and parses it', async () => {
    const urls: string[] = [];
    const prov = new OpenMeteoProvider(async (u) => {
      urls.push(String(u));
      return okJson({ utc_offset_seconds: 0, current: { time: '2026-06-21T12:00', temperature_2m: 20, weather_code: 0, wind_speed_10m: 5, is_day: 1 } });
    });
    const f = await prov.fetchForecast(PARIS, 5);
    expect(urls[0]).toMatch(/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
    expect(f.current.tempC).toBe(20);
  });
  it('turns HTTP errors and junk bodies into errors, never into fake weather', async () => {
    await expect(new OpenMeteoProvider(async () => ({ ok: false, status: 503 }) as Response).fetchForecast(PARIS, 0)).rejects.toThrow(/503/);
    await expect(new OpenMeteoProvider(async () => okJson({ nope: 1 })).fetchForecast(PARIS, 0)).rejects.toThrow();
  });
  it('does not search for one-letter queries', async () => {
    let called = false;
    const prov = new OpenMeteoProvider(async () => ((called = true), okJson({})));
    expect(await prov.search('p')).toEqual([]);
    expect(called).toBe(false);
  });
});
