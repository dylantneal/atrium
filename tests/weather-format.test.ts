import { describe, expect, it } from 'vitest';
import { cToF, dayName, defaultUnits, formatTemp, formatWind, glyph, hourLabel, tempColor } from '../src/apps/weather/format';

describe('weather formatting', () => {
  it('converts and rounds temperatures in both unit systems', () => {
    expect(cToF(0)).toBe(32);
    expect(cToF(100)).toBe(212);
    expect(formatTemp(20, 'metric')).toBe('20°C');
    expect(formatTemp(20, 'imperial')).toBe('68°F');
    expect(formatTemp(-0.4, 'metric')).toMatch(/^-?0°C$/);
    expect(formatTemp(21.6, 'metric')).toBe('22°C');
  });
  it('formats wind speed', () => {
    expect(formatWind(10, 'metric')).toBe('10 km/h');
    expect(formatWind(16.09, 'imperial')).toBe('10 mph');
  });
  it('picks units from the locale region', () => {
    expect(defaultUnits('en-US')).toBe('imperial');
    expect(defaultUnits('en-GB')).toBe('metric');
    expect(defaultUnits('fr-FR')).toBe('metric');
    expect(defaultUnits('nonsense!!')).toBe('metric');
  });
  it('labels days and hours', () => {
    const d = new Date(2026, 5, 21, 0, 0).getTime(); // a Sunday, local time
    expect(dayName(d)).toBe('Sun');
    expect(hourLabel(new Date(2026, 5, 21, 0).getTime())).toBe('12a');
    expect(hourLabel(new Date(2026, 5, 21, 9).getTime())).toBe('9a');
    expect(hourLabel(new Date(2026, 5, 21, 12).getTime())).toBe('12p');
    expect(hourLabel(new Date(2026, 5, 21, 15).getTime())).toBe('3p');
  });
  it('has a glyph for every weather family, never an empty one', () => {
    for (const code of [0, 2, 3, 45, 61, 73, 81, 95]) expect(glyph(code).length).toBeGreaterThan(0);
    expect(glyph(0)).not.toBe(glyph(73));
  });
  it('runs the temperature colour ramp from cold to hot', () => {
    const r = (c: number) => (c >> 16) & 255;
    const b = (c: number) => c & 255;
    expect(b(tempColor(-20))).toBeGreaterThan(r(tempColor(-20)));
    expect(r(tempColor(40))).toBeGreaterThan(b(tempColor(40)));
    expect(tempColor(-50)).toBe(tempColor(-10));
    expect(tempColor(60)).toBe(tempColor(32));
  });
});
