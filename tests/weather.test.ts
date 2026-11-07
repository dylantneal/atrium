import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { demoCode, demoForecast, demoTemp, describeCode, forecastUrl, geocodeUrl, parseForecast, parseGeocoding, WeatherParseError, WEATHER_PRESETS } from '../src/apps/ambient/weather';

describe('describeCode (WMO table)', () => {
  it('maps the codes the API can return to something drawable', () => {
    expect(describeCode(0)).toMatchObject({ label: 'Clear', precip: 'none' });
    expect(describeCode(3).cloud).toBeGreaterThan(0.9);
    expect(describeCode(45).fog).toBeGreaterThan(0.5);
    expect(describeCode(63)).toMatchObject({ precip: 'rain' });
    expect(describeCode(65).intensity).toBeGreaterThan(describeCode(61).intensity);
    expect(describeCode(73)).toMatchObject({ precip: 'snow' });
    expect(describeCode(95).thunder).toBe(true);
    expect(describeCode(999)).toMatchObject({ label: 'Unknown', precip: 'none' });
  });
  it('every documented code has sane ranges', () => {
    for (const code of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]) {
      const c = describeCode(code);
      expect(c.label).not.toBe('Unknown');
      for (const v of [c.cloud, c.intensity, c.fog]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(c.precip === 'none').toBe(c.intensity === 0);
    }
  });
});

const PLACE = { name: 'Testville', lat: 51.5, lon: -0.12 };
// A trimmed real-shaped Open-Meteo response. Times are local; utc_offset_seconds turns them into instants.
const FIXTURE = {
  utc_offset_seconds: 3600,
  current: { time: '2026-11-07T14:00', temperature_2m: 9.4, weather_code: 61, wind_speed_10m: 14.2, is_day: 1 },
  hourly: { time: ['2026-11-07T14:00', '2026-11-07T15:00'], temperature_2m: [9.4, 9.0], weather_code: [61, 3], precipitation_probability: [70, 40] },
  daily: { time: ['2026-11-07', '2026-11-08'], weather_code: [61, 0], temperature_2m_max: [10.1, 12.3], temperature_2m_min: [6.2, 5.0] },
};

describe('parseForecast', () => {
  it('reads current, hourly and daily data and converts local times to UTC instants', () => {
    const f = parseForecast(FIXTURE, PLACE, 123);
    expect(f.source).toBe('live');
    expect(f.current).toMatchObject({ tempC: 9.4, windKph: 14.2, isDay: true, label: 'Light rain', precip: 'rain' });
    expect(f.current.time).toBe(Date.UTC(2026, 10, 7, 13, 0)); // 14:00 at UTC+1
    expect(f.hourly).toHaveLength(2);
    expect(f.hourly[1]).toMatchObject({ tempC: 9, code: 3, precipProb: 40 });
    expect(f.daily.map((d) => [d.maxC, d.minC])).toEqual([[10.1, 6.2], [12.3, 5]]);
    expect(f.daily[0].time).toBe(Date.UTC(2026, 10, 7, 11, 0));
    expect(f.fetchedAt).toBe(123);
  });
  it('fails loudly on malformed data rather than showing nonsense', () => {
    expect(() => parseForecast(null, PLACE, 0)).toThrow(WeatherParseError);
    expect(() => parseForecast({}, PLACE, 0)).toThrow(/current/);
    expect(() => parseForecast({ current: { ...FIXTURE.current, temperature_2m: 'warm' } }, PLACE, 0)).toThrow(/temperature/);
    expect(() => parseForecast({ current: { ...FIXTURE.current, time: 'yesterday' } }, PLACE, 0)).toThrow(/time/);
  });
  it('tolerates missing hourly and daily blocks', () => {
    const f = parseForecast({ current: FIXTURE.current }, PLACE, 0);
    expect(f.hourly).toEqual([]);
    expect(f.daily).toEqual([]);
  });
});

describe('request builders and geocoding', () => {
  it('builds keyless Open-Meteo URLs on the allowed hosts', () => {
    const u = new URL(forecastUrl(PLACE));
    expect(u.host).toBe('api.open-meteo.com');
    expect(u.searchParams.get('latitude')).toBe('51.500');
    expect(u.searchParams.get('timezone')).toBe('auto');
    expect(u.searchParams.get('forecast_days')).toBe('7');
    expect(u.search).not.toMatch(/key|token/i);
    expect(new URL(geocodeUrl('São Paulo')).searchParams.get('name')).toBe('São Paulo');
    expect(new URL(geocodeUrl('x')).host).toBe('geocoding-api.open-meteo.com');
  });
  it('parses geocoding results and ignores junk rows', () => {
    const r = parseGeocoding({ results: [{ name: 'Paris', admin1: 'Île-de-France', country_code: 'FR', latitude: 48.85, longitude: 2.35 }, { name: 'bad' }, null] });
    expect(r).toEqual([{ name: 'Paris, Île-de-France, FR', lat: 48.85, lon: 2.35 }]);
    expect(parseGeocoding({})).toEqual([]);
  });
});

describe('demo sky', () => {
  const NOW = Date.UTC(2026, 10, 7, 15, 30);
  it('is deterministic: same time, same sky', () => {
    expect(demoForecast(NOW)).toEqual(demoForecast(NOW));
  });
  it('can be forced to a preset for tests and demos', () => {
    for (const [name, code] of Object.entries(WEATHER_PRESETS)) {
      const f = demoForecast(NOW, undefined, code);
      expect(f.current.code, name).toBe(code);
      expect(f.hourly.every((h) => h.code === code)).toBe(true);
      expect(f.source).toBe('demo');
    }
  });
  it('has 24 hourly and 7 daily points in the right order, with sane temperatures', () => {
    const f = demoForecast(NOW);
    expect(f.hourly).toHaveLength(24);
    expect(f.daily).toHaveLength(7);
    for (let i = 1; i < f.hourly.length; i++) expect(f.hourly[i].time - f.hourly[i - 1].time).toBe(3600_000);
    for (const d of f.daily) {
      expect(d.maxC).toBeGreaterThanOrEqual(d.minC);
      expect(d.maxC).toBeLessThan(45);
      expect(d.minC).toBeGreaterThan(-40);
    }
  });
  it('property: any moment gives a valid code, finite numbers, and never rain below freezing', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_102_444_800_000 }), fc.double({ min: -60, max: 70, noNaN: true }), (ms, lat) => {
        const t = demoTemp(ms, lat);
        expect(Number.isFinite(t)).toBe(true);
        const c = describeCode(demoCode(ms, -3));
        expect(c.label).not.toBe('Unknown');
        expect(c.precip === 'rain' && c.code >= 60 && c.code < 70).toBe(false);
      }),
    );
  });
});
