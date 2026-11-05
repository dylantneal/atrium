import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ActionBus } from '../../core/actions';
import type { World } from '../../world/scene';
import type { Session } from '../../world/session';
import { FocusOverlay } from '../focus/FocusOverlay';
import type { FocusController } from '../focus/FocusController';
import { ListView } from '../list-view/ListView';
import { ui } from '../../core/uiState';
import { Ashes, DemoChip, Hotbar } from './Hotbar';
import { Launcher, SearchBanner } from '../launcher/Launcher';
import { CaptionBar, DocentPanel } from '../docent/Docent';
import { Onboarding } from '../onboarding/Onboarding';
import { Settings } from '../settings/Settings';
import type { DocentService } from '../../docent/service';
import { Crumbs, Enter, Fade, PerfOverlay, Reticle, Toasts, useUi } from './App';

export interface UiHandles {
  onEnter(cb: () => void): void;
}

export function mountUi(el: HTMLElement, world: World, bus: ActionBus, session: () => Session | null, focus: () => FocusController | null, docent: () => DocentService | null): UiHandles {
  let enterCb: () => void = () => {};
  // an Enter click may arrive before main.ts registers its callback: remember it and replay on registration
  let enteredEarly = false;
  function Root() {
    const { entered } = useUi();
    const { perf } = useUi();
    useEffect(() => {
      const ck = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          if (!ui.get().focus) ui.set({ launcher: { open: !ui.get().launcher.open, query: '' } });
        }
      };
      addEventListener('keydown', ck);
      return () => removeEventListener('keydown', ck);
    }, []);
    useEffect(() => {
      const k = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement;
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.closest?.('.cm-editor')) return;
        if (e.key === '`' || e.key === '~') ui.set({ perf: !ui.get().perf });
        else if ((e.key === 'l' || e.key === 'L') && !ui.get().focus) ui.set({ listView: !ui.get().listView });
        else if (e.key === '/' && !ui.get().focus && !ui.get().launcher.open) (e.preventDefault(), ui.set({ launcher: { open: true, query: '' } }));
      };
      addEventListener('keydown', k);
      return () => removeEventListener('keydown', k);
    }, []);
    return (
      <>
        {!entered && (
          <Enter
            onEnter={() => {
              // state lives in the store, so a click that lands while the world is still loading is not lost
              ui.set({ entered: true });
              enteredEarly = true;
              enterCb();
            }}
          />
        )}
        <Crumbs onGo={(id) => void session()?.enter(id, session()!.currentId, false)} onUp={() => void session()?.goUp()} />
        <Reticle />
        {perf && <PerfOverlay world={world} />}
        <Toasts bus={bus} />
        <FocusHost focus={focus} docent={docent} />
        <Fade />
      </>
    );
  }
  render(<Root />, el);
  return {
    onEnter: (cb) => {
      enterCb = cb;
      if (enteredEarly) cb();
    },
  };
}

import { useEffect as useEffectH, useState as useStateH } from 'preact/hooks';
function FocusHost({ focus, docent }: { focus: () => FocusController | null; docent: () => DocentService | null }) {
  const [ctl, setCtl] = useStateH<FocusController | null>(focus());
  const [replay, setReplay] = useStateH(0);
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
      <DemoChip session={ctl.session} />
      <Ashes session={ctl.session} />
      <SearchBanner ctl={ctl} />
      <FocusOverlay ctl={ctl} />
      <ListView ctl={ctl} />
      <Launcher
        ctl={ctl}
        extra={[
          { id: 'docent', title: 'Ask the docent…', run: () => ui.set({ docent: true }) },
          { id: 'settings', title: 'Settings (control room)', run: () => ui.set({ settings: true }) },
          { id: 'replay', title: 'Replay the welcome tour', run: () => setReplay((n) => n + 1) },
        ]}
      />
      <Settings session={ctl.session} onReplay={() => (ui.set({ settings: false }), setReplay((n) => n + 1))} />
      <Onboarding session={ctl.session} replay={replay} />
      {docent() && <DocentPanel docent={docent()!} />}
      {docent() && <CaptionBar docent={docent()!} />}
    </>
  );
}
