import { nextSunEvent, type SunEvent } from '../ambient/sun';
import type { AtriumApp } from '../api';
import { buildWeatherDeck } from './room';
import { WeatherSurface } from './surface';

const SKY_PRESETS = ['clear', 'partly', 'cloud', 'fog', 'rain', 'storm', 'snow'] as const;

/** Weather and sky: a room with the forecast on a table, a flat view for details and location, and demo commands. */
export function weatherApp(): AtriumApp {
  const app: AtriumApp = {
    id: 'weather',
    name: 'Weather',
    icon: '☁',
    room: {
      title: 'Weather Deck',
      build: buildWeatherDeck,
      describe: (id) => (id === 'table' ? { name: 'Forecast table', detail: 'Next 24 hours as bars, the week as cards', hint: 'Click for details, location and units' } : { name: id }),
      onActivate: (ctx, id) => {
        if (id === 'table') void ctx.session.openSurface('weather');
      },
    },
    surface: {
      title: 'Weather',
      render: (_props, { ctx }) => <WeatherSurface ctx={ctx} />,
    },
    commands: [
      { id: 'weather-deck', title: 'Weather: open the Weather Deck', run: (c) => void c.session.enter('app:weather', c.session.currentId, false) },
      { id: 'weather-details', title: 'Weather: details and location…', run: (c) => void c.session.apps.context('weather')?.session.openSurface('weather') },
      ...(['sunrise', 'noon', 'sunset', 'midnight'] as SunEvent[]).map((ev) => ({
        id: `sky-${ev}`,
        title: `Sky: jump to ${ev}`,
        run: (c: { session: { apps: { context(id: string): { ambient: import('../ambient/ambient').AmbientService } | undefined } } }) => {
          const a = c.session.apps.context('weather')?.ambient;
          if (!a) return;
          const p = a.currentPlace;
          a.setNow(nextSunEvent(a.now, p.lat, p.lon, ev));
        },
      })),
      {
        id: 'sky-now',
        title: 'Sky: back to the real time',
        run: (c) => c.session.apps.context('weather')?.ambient.setNow(null),
      },
      ...SKY_PRESETS.map((w) => ({
        id: `sky-${w}`,
        title: `Sky: show ${w} weather`,
        run: (c: { session: { apps: { context(id: string): { ambient: import('../ambient/ambient').AmbientService } | undefined } } }) => c.session.apps.context('weather')?.ambient.force(w),
      })),
      { id: 'sky-real', title: 'Sky: use the real (or demo) forecast', run: (c) => c.session.apps.context('weather')?.ambient.force(null) },
    ],
  };
  return app;
}
