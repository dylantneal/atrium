import type { Session } from '../../world/session';
import { useStore } from './useStore';

/** Renders every panel an app registered. Each panel decides for itself whether it is open. */
export function PanelHost({ session }: { session: Session }) {
  useStore(session.apps.version);
  return (
    <>
      {session.apps.panels().map(({ app, panel, ctx }) => {
        const Panel = panel.component;
        return <Panel key={app.id} ctx={ctx} />;
      })}
    </>
  );
}
