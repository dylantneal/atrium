import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ActionBus } from '../../core/actions';
import type { World } from '../../world/scene';
import { Enter, PerfOverlay, Toasts } from './App';

export interface UiHandles {
  onEnter(cb: () => void): void;
}

export function mountUi(el: HTMLElement, world: World, bus: ActionBus): UiHandles {
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
        {perf && <PerfOverlay world={world} />}
        <Toasts bus={bus} />
      </>
    );
  }
  render(<Root />, el);
  return { onEnter: (cb) => (enterCb = cb) };
}
