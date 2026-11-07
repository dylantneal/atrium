import { useEffect, useState } from 'preact/hooks';
import type { Place } from '../ambient/weather';
import type { AppContext } from '../api';
import { useStore } from '../../ui/hud/useStore';
import { dayName, defaultUnits, formatTemp, formatWind, glyph, hourLabel, type Units } from './format';

/** The flat view: today in detail, location and units. All typing for the weather app happens here. */
export function WeatherSurface({ ctx }: { ctx: AppContext }) {
  const s = useStore(ctx.ambient.store);
  const [units, setUnits] = useState<Units>(defaultUnits());
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    void ctx.settings.get<Units>('units').then((u) => u && setUnits(u));
  }, []);

  const pickUnits = (u: Units) => {
    setUnits(u);
    void ctx.settings.set('units', u);
  };

  const search = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await ctx.ambient.search(query);
      setResults(r);
      if (r.length === 0) setMsg(query.trim().length < 2 ? 'Type at least two letters.' : `No places found for "${query}".`);
    } catch (e) {
      setMsg(`Could not search: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  const choose = async (p: Place) => {
    setResults([]);
    setQuery('');
    await ctx.ambient.setPlace(p);
    setMsg(`Showing the weather for ${p.name}.`);
  };

  const here = () => {
    if (!navigator.geolocation) return setMsg('This device cannot share its location.');
    setMsg('Asking for your location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => void choose({ name: 'My location', lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => setMsg(`Could not get your location (${err.message}). Search for a city instead.`),
      { timeout: 10_000 },
    );
  };

  const c = s.conditions;
  const hours = s.forecast.hourly.filter((h) => h.time >= s.now - 3600_000).slice(0, 12);
  const updated = Math.max(0, Math.round((s.updated - s.forecast.fetchedAt) / 60000));

  return (
    <div class="weather" data-testid="weather-surface">
      <section class="now">
        <div class="big" data-testid="weather-temp">{formatTemp(c.tempC, units)}</div>
        <div>
          <div class="label" data-testid="weather-label">{glyph(c.code)} {c.label}</div>
          <div class="muted">Wind {formatWind(c.windKph, units)} · {s.place.name}</div>
          <div class="muted" data-testid="weather-source">{s.source === 'live' ? `Live from Open-Meteo, fetched ${updated} min ago` : 'Demo sky: no location set, so this weather is simulated'}</div>
        </div>
      </section>
      {s.error && <div class="banner" role="alert"><span>Could not refresh: {s.error}. Showing the last forecast.</span><button onClick={() => void ctx.ambient.refresh(true)}>Retry</button></div>}

      <section>
        <h3>Location</h3>
        <form class="row" onSubmit={(e) => (e.preventDefault(), void search())}>
          <input value={query} aria-label="Place search" placeholder="Search for a city" onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
          <button type="submit" disabled={busy}>Search</button>
        </form>
        <div class="row">
          <button onClick={here}>Use my location</button>
          <button disabled={s.source === 'demo'} onClick={() => void ctx.ambient.setPlace(null).then(() => setMsg('Back to the demo sky.'))}>Use the demo sky</button>
        </div>
        {results.length > 0 && (
          <ul class="places" role="listbox" aria-label="Places found">
            {results.map((p) => (
              <li key={`${p.lat},${p.lon}`}>
                <button onClick={() => void choose(p)}>{p.name}</button>
              </li>
            ))}
          </ul>
        )}
        {msg && <p class="muted" role="status">{msg}</p>}
        <p class="muted">Weather comes from Open-Meteo, a free service that needs no account. Only the place you choose is sent.</p>
      </section>

      <section>
        <h3>Units</h3>
        <div class="row" role="group" aria-label="Units">
          <button aria-pressed={units === 'metric'} onClick={() => pickUnits('metric')}>°C · km/h</button>
          <button aria-pressed={units === 'imperial'} onClick={() => pickUnits('imperial')}>°F · mph</button>
        </div>
      </section>

      <section>
        <h3>Next hours</h3>
        <ol class="hours">
          {hours.map((h) => (
            <li key={h.time}>
              <b>{hourLabel(h.time)}</b> <span>{glyph(h.code)}</span> {formatTemp(h.tempC, units)} <span class="muted">{h.precipProb}%</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3>This week</h3>
        <ul class="days">
          {s.forecast.daily.map((d, i) => (
            <li key={d.time}>
              <b>{i === 0 ? 'Today' : dayName(d.time)}</b> <span>{glyph(d.code)}</span> {formatTemp(d.maxC, units)} <span class="muted">{formatTemp(d.minC, units)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
