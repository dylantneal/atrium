import { useState } from 'preact/hooks';
import { ui } from '../../core/uiState';
import { deleteDb, setSetting } from '../../data/idb';
import type { Tier } from '../../world/quality';
import type { Session } from '../../world/session';
import { useUi } from '../hud/App';

export type QualityChoice = 'auto' | Tier;

export async function applyQuality(session: Session, choice: QualityChoice, persist = true) {
  session.world.autoTier = choice === 'auto';
  session.world.setTier(choice === 'auto' ? 'high' : choice);
  if (persist) await setSetting('quality', choice);
  await session.reload(); // props density (cobwebs) is decided when a room is built
}

/** The control room: quality, performance overlay, demo reset, replay the welcome tour. */
export function Settings({ session, onReplay }: { session: Session; onReplay: () => void }) {
  const { settings } = useUi();
  const [q, setQ] = useState<QualityChoice>(() => (session.world.autoTier ? 'auto' : session.world.currentTier));
  const [confirm, setConfirm] = useState(false);
  if (!settings) return null;
  return (
    <div class="settings" role="dialog" aria-label="Settings" data-testid="settings">
      <header>
        <b>Control room</b>
        <button aria-label="Close settings" onClick={() => ui.set({ settings: false })}>✕</button>
      </header>
      <fieldset>
        <legend>Graphics quality</legend>
        {(['auto', 'low', 'medium', 'high'] as QualityChoice[]).map((c) => (
          <label key={c}>
            <input
              type="radio"
              name="quality"
              checked={q === c}
              onChange={() => {
                setQ(c);
                void applyQuality(session, c);
              }}
            />
            {c === 'auto' ? 'Auto (steps down if the frame rate drops)' : c[0].toUpperCase() + c.slice(1)}
          </label>
        ))}
      </fieldset>
      <button onClick={() => ui.set({ perf: !ui.get().perf })}>Toggle performance overlay (`)</button>
      <button onClick={onReplay}>Replay the welcome tour</button>
      {session.demo &&
        (confirm ? (
          <div class="confirm" role="alertdialog">
            <span>Reset the demo? Your layouts, inventory and edits to the sample files are cleared.</span>
            <button
              class="danger"
              data-testid="confirm-reset"
              onClick={async () => {
                await deleteDb();
                location.reload();
              }}
            >
              Reset demo
            </button>
            <button onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        ) : (
          <button class="danger" onClick={() => setConfirm(true)}>Reset demo data…</button>
        ))}
    </div>
  );
}
