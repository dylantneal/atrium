import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ActionBus } from '../../core/actions';
import type { World } from '../../world/scene';
import type { Session } from '../../world/session';
import { Crumbs, Enter, Fade, PerfOverlay, Reticle, Toasts } from './App';

export interface UiHandles {
  onEnter(cb: () => void): void;
}

export function mountUi(el: HTMLElement, world: World, bus: ActionBus, session: () => Session | null): UiHandles {
  let enterCb: () => void = () => {};
  function Root() {
    const [entered, setEntered] = useState(false);
    const [perf, setPerf] = useState(new URLSearchParams(location.search).has('perf'));
    useEffect(() => {
      const k = (e: KeyboardEvent) => {
        if (e.key === '`' || e.key === '~') setPerf((p) => !p);
      };
      addEventListener('keydown', k);
      return () => removeEventListener('keydown', k);
    }, []);
    return (
      <>
        {!entered && (
          <Enter
            onEnter={() => {
              setEntered(true);
              enterCb();
            }}
          />
        )}
        <Crumbs onGo={(id) => void session()?.enter(id, session()!.currentId, false)} onUp={() => void session()?.goUp()} />
        <Reticle />
        {perf && <PerfOverlay world={world} />}
        <Toasts bus={bus} />
        <Fade />
      </>
    );
  }
  render(<Root />, el);
  return { onEnter: (cb) => (enterCb = cb) };
}
