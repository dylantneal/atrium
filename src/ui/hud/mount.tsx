import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ActionBus } from '../../core/actions';
import type { World } from '../../world/scene';
import type { Session } from '../../world/session';
import { FocusOverlay } from '../focus/FocusOverlay';
import type { FocusController } from '../focus/FocusController';
import { ListView } from '../list-view/ListView';
import { ui } from '../../core/uiState';
import { Ashes, Hotbar } from './Hotbar';
import { Crumbs, Enter, Fade, PerfOverlay, Reticle, Toasts } from './App';

export interface UiHandles {
  onEnter(cb: () => void): void;
}

export function mountUi(el: HTMLElement, world: World, bus: ActionBus, session: () => Session | null, focus: () => FocusController | null): UiHandles {
  let enterCb: () => void = () => {};
  function Root() {
    const [entered, setEntered] = useState(false);
    const [perf, setPerf] = useState(new URLSearchParams(location.search).has('perf'));
    useEffect(() => {
      const k = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement;
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.closest?.('.cm-editor')) return;
        if (e.key === '`' || e.key === '~') setPerf((p) => !p);
        else if ((e.key === 'l' || e.key === 'L') && !ui.get().focus) ui.set({ listView: !ui.get().listView });
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
        <FocusHost focus={focus} />
        <Fade />
      </>
    );
  }
  render(<Root />, el);
  return { onEnter: (cb) => (enterCb = cb) };
}

import { useEffect as useEffectH, useState as useStateH } from 'preact/hooks';
function FocusHost({ focus }: { focus: () => FocusController | null }) {
  const [ctl, setCtl] = useStateH<FocusController | null>(focus());
  useEffectH(() => {
    const t = setInterval(() => {
      const c = focus();
      if (c) {
        setCtl(c);
        clearInterval(t);
      }
    }, 50);
    return () => clearInterval(t);
  }, []);
  if (!ctl) return null;
  return (
    <>
      <Hotbar session={ctl.session} />
      <Ashes session={ctl.session} />
      <FocusOverlay ctl={ctl} />
      <ListView ctl={ctl} />
    </>
  );
}
