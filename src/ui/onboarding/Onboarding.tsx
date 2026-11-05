import { useEffect, useState } from 'preact/hooks';
import type { GameEvent } from '../../core/events';
import { getSetting, setSetting } from '../../data/idb';
import type { Session } from '../../world/session';
import { useUi } from '../hud/App';

interface Step {
  event: GameEvent;
  title: string;
  hint: string;
}

const STEPS: Step[] = [
  { event: 'navigated', title: 'Walk through a door', hint: 'Move with WASD or the left-hand stick, then walk into a lit doorway (or tap it).' },
  { event: 'pickup', title: 'Pick up an image', hint: 'Aim at a picture and press E, right-click, or long-press. It goes to your hotbar.' },
  { event: 'placed', title: 'Place it in another room', hint: 'Carry it through a door, then pick a glowing spot on a wall with E. Undo is in the hotbar.' },
  { event: 'focus', title: 'Open something flat', hint: 'Click a picture or note (or press Enter) to read and edit it full screen. Esc returns.' },
  { event: 'search', title: 'Search for it', hint: 'Press Ctrl+K or /, type a word, then Ctrl+Enter to see all results as a room.' },
  { event: 'live', title: 'Watch a dim room light up', hint: 'Go Home and press "Make it live", then look at the door that brightens.' },
];

/** A short guided first run: a checklist that ticks itself off as you do each thing. Skippable, replayable. */
export function Onboarding({ session, replay }: { session: Session; replay: number }) {
  const { entered, focus, launcher } = useUi();
  const [done, setDone] = useState<Set<GameEvent>>(new Set());
  const [hidden, setHidden] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const off = new URLSearchParams(location.search).get('tour') === 'off';
    void getSetting<boolean>('onboardingDone').then((d) => setHidden(off || (!!d && replay === 0)));
    if (replay > 0) {
      setDone(new Set());
      setHidden(false);
    }
  }, [replay]);

  useEffect(() => {
    if (!entered) return;
    const offs = STEPS.map((s) => session.events.on(s.event, () => setDone((d) => new Set(d).add(s.event))));
    return () => offs.forEach((f) => f());
  }, [entered, session]);

  const finished = done.size === STEPS.length;
  useEffect(() => {
    if (finished) void setSetting('onboardingDone', true);
  }, [finished]);

  if (!entered || hidden || focus || launcher.open) return null;
  const current = STEPS.find((s) => !done.has(s.event));
  return (
    <aside class="onboarding" aria-label="Welcome tour" data-testid="onboarding">
      <header>
        <b>{finished ? 'You have seen the whole tour' : `Welcome tour · ${done.size} of ${STEPS.length}`}</b>
        <button aria-label={collapsed ? 'Expand tour' : 'Collapse tour'} onClick={() => setCollapsed((c) => !c)}>{collapsed ? '▴' : '▾'}</button>
        <button
          onClick={() => {
            setHidden(true);
            void setSetting('onboardingDone', true);
          }}
        >
          {finished ? 'Done' : 'Skip'}
        </button>
      </header>
      {!collapsed && (
        <>
          <ol>
            {STEPS.map((s) => (
              <li key={s.event} class={done.has(s.event) ? 'done' : s === current ? 'now' : ''}>
                <span aria-hidden="true">{done.has(s.event) ? '✓' : s === current ? '→' : '·'}</span> {s.title}
              </li>
            ))}
          </ol>
          {current && <p class="hint">{current.hint}</p>}
        </>
      )}
    </aside>
  );
}
