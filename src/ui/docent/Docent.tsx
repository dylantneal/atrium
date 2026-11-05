import { useEffect, useRef, useState } from 'preact/hooks';
import { ui } from '../../core/uiState';
import type { DocentService } from '../../docent/service';
import { useStore } from '../hud/useStore';
import { useUi } from '../hud/App';

const CHIPS = ['Sort this wall by color', 'Summarize this room', 'Suggest threads', 'Give me a tour', 'Find crow animation'];

export function DocentPanel({ docent }: { docent: DocentService }) {
  const { docent: open, focus } = useUi();
  const { messages, touring } = useStore(docent.store);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [messages.length]);
  if (!open || focus) return null;
  const send = (t: string) => {
    setText('');
    void docent.ask(t);
  };
  return (
    <aside class="docent" aria-label="Docent" data-testid="docent">
      <header>
        <b>Docent</b>
        <span class="muted">runs on this device · uses names and dates only</span>
        <button aria-label="Close docent" onClick={() => ui.set({ docent: false })}>✕</button>
      </header>
      <div class="msgs" aria-live="polite">
        {messages.length === 0 && <p class="muted">Ask me to sort a wall, summarize a room, suggest threads, tag items, give a tour, or find something.</p>}
        {messages.map((m) => (
          <div key={m.id} class={`msg ${m.role}`}>
            <p>{m.text}</p>
            {m.proposal && (
              <div class="proposal" data-testid="proposal">
                <b>{m.proposal.title}</b>
                <ul>{m.proposal.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                {m.proposal.status === 'pending' ? (
                  <div class="row">
                    <button class="btn-primary" data-testid="apply" onClick={() => void docent.confirm(m.id, true)}>Apply</button>
                    <button onClick={() => void docent.confirm(m.id, false)}>Cancel</button>
                  </div>
                ) : (
                  <span class="muted">{m.proposal.status === 'applied' ? 'Applied. Undo is in the hotbar.' : 'Cancelled.'}</span>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div class="chips">
        {CHIPS.map((c) => <button key={c} onClick={() => send(c)}>{c}</button>)}
        {touring && <button class="danger" onClick={() => docent.stopTour()}>Stop tour</button>}
      </div>
      <form onSubmit={(e) => (e.preventDefault(), send(text))}>
        <input value={text} aria-label="Ask the docent" placeholder="Ask the docent…" onInput={(e) => setText((e.target as HTMLInputElement).value)} />
      </form>
    </aside>
  );
}

export function CaptionBar({ docent }: { docent: DocentService }) {
  const { caption } = useUi();
  if (!caption) return null;
  return (
    <div class="caption" role="status" data-testid="caption">
      <span>{caption}</span>
      <button onClick={() => docent.stopTour()}>Stop</button>
    </div>
  );
}
