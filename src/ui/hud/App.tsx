import { useEffect, useState } from 'preact/hooks';
import type { ActionBus, Toast } from '../../core/actions';
import type { World } from '../../world/scene';

export function Enter({ onEnter }: { onEnter: () => void }) {
  return (
    <div class="enter" role="dialog" aria-label="Welcome">
      <div>
        <h1>ATRIUM</h1>
        <p>Your folders, as a building you can walk through. Light shows what is active; dust shows what is not.</p>
        <button class="btn-primary" autofocus onClick={onEnter}>
          Enter
        </button>
      </div>
    </div>
  );
}

export function PerfOverlay({ world }: { world: World }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const id = setInterval(() => {
      const s = world.stats;
      setText(
        [
          `fps        ${s.fps}`,
          `frame ms   ${s.frameMs}`,
          `draw calls ${s.drawCalls}`,
          `triangles  ${s.triangles}`,
          `textures   ${s.textures}`,
          `geometries ${s.geometries}`,
          `heap MB    ${s.heapMB ?? 'n/a'}`,
          `scale      ${s.scale}  tier ${world.currentTier}`,
        ].join('\n'),
      );
    }, 400);
    return () => clearInterval(id);
  }, [world]);
  return <div class="perf" data-testid="perf">{text}</div>;
}

export function Toasts({ bus }: { bus: ActionBus }) {
  const [toasts, setToasts] = useState<Toast[]>(bus.currentToasts);
  useEffect(() => bus.onToasts(setToasts), [bus]);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`}>
          <span>{t.text}</span>
          {t.undoable && (
            <button
              onClick={() => {
                bus.dismissToast(t.id);
                void bus.undo();
              }}
            >
              Undo
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
