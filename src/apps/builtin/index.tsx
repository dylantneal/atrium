import { ui } from '../../core/uiState';
import type { DocentService } from '../../docent/service';
import { CaptionBar, DocentPanel } from '../../ui/docent/Docent';
import { Ashes } from '../../ui/hud/Hotbar';
import { Settings } from '../../ui/settings/Settings';
import type { Session } from '../../world/session';
import type { AtriumApp } from '../api';
import type { AppRegistry } from '../registry';
import { weatherApp } from '../weather';

/**
 * Atrium's own panels, registered through the same interface any app uses (docent, settings, trash).
 * Search stays core because the launcher is the shell's front door.
 */
export function builtinApps(session: Session, docent: DocentService): AtriumApp[] {
  return [
    weatherApp(),
    {
      id: 'docent',
      name: 'Docent',
      icon: '✎',
      panel: {
        component: () => (
          <>
            <DocentPanel docent={docent} />
            <CaptionBar docent={docent} />
          </>
        ),
      },
      commands: [{ id: 'docent', title: 'Ask the docent…', run: () => ui.set({ docent: true }) }],
    },
    {
      id: 'settings',
      name: 'Settings',
      icon: '⚙',
      panel: { component: () => <Settings session={session} /> },
      commands: [{ id: 'settings', title: 'Settings (control room)', run: () => ui.set({ settings: true }) }],
    },
    {
      id: 'trash',
      name: 'Trash',
      icon: '🗑',
      panel: { component: () => <Ashes session={session} /> },
      commands: [{ id: 'trash', title: 'Open the trash', run: () => ui.set({ ashes: true }) }],
    },
  ];
}

export async function registerBuiltins(registry: AppRegistry, session: Session, docent: DocentService) {
  for (const app of builtinApps(session, docent)) await registry.register(app);
}
