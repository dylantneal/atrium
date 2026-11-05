import { useEffect, useRef, useState } from 'preact/hooks';

/** Pan and zoom with pointer events: wheel, drag, pinch, double-click to toggle fit and 100%. */
export function ImageViewer({ blob, name }: { blob: Blob; name: string }) {
  const [url, setUrl] = useState('');
  const [tf, setTf] = useState({ s: 1, x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; s: number } | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  const zoomAt = (cx: number, cy: number, factor: number) =>
    setTf((t) => {
      const r = box.current!.getBoundingClientRect();
      const px = cx - r.left - r.width / 2;
      const py = cy - r.top - r.height / 2;
      const s = Math.min(16, Math.max(0.2, t.s * factor));
      const k = s / t.s;
      return { s, x: px - (px - t.x) * k, y: py - (py - t.y) * k };
    });

  return (
    <div
      class="img-viewer"
      ref={box}
      onWheel={(e) => {
        e.preventDefault();
        zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      }}
      onDblClick={() => setTf((t) => (t.s === 1 ? { s: 2.5, x: 0, y: 0 } : { s: 1, x: 0, y: 0 }))}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.current.size === 2) {
          const [a, b] = [...ptrs.current.values()];
          pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), s: tf.s };
        }
      }}
      onPointerMove={(e) => {
        const p = ptrs.current.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;
        if (ptrs.current.size === 2 && pinch.current) {
          const [a, b] = [...ptrs.current.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const target = (pinch.current.s * d) / pinch.current.d;
          zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, target / tf.s);
        } else if (ptrs.current.size === 1) setTf((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
      }}
      onPointerUp={(e) => {
        ptrs.current.delete(e.pointerId);
        pinch.current = null;
      }}
      onPointerCancel={(e) => {
        ptrs.current.delete(e.pointerId);
        pinch.current = null;
      }}
    >
      {url && <img ref={img} src={url} alt={name} draggable={false} style={{ transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.s})` }} />}
      <div class="zoom-ctl">
        <button aria-label="Zoom out" onClick={() => setTf((t) => ({ ...t, s: Math.max(0.2, t.s / 1.4) }))}>−</button>
        <button aria-label="Fit" onClick={() => setTf({ s: 1, x: 0, y: 0 })}>{Math.round(tf.s * 100)}%</button>
        <button aria-label="Zoom in" onClick={() => setTf((t) => ({ ...t, s: Math.min(16, t.s * 1.4) }))}>+</button>
      </div>
    </div>
  );
}
