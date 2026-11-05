/// <reference lib="webworker" />
// Decodes and downsizes images off the main thread. Replies with an ImageBitmap (transferred) and a WebP blob for caching.

interface Req {
  id: number;
  blob: Blob;
  w: number;
  h: number;
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, blob, w, h } = e.data;
  try {
    const src = await createImageBitmap(blob);
    const s = Math.max(w / src.width, h / src.height);
    const dw = src.width * s;
    const dh = src.height * s;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
    src.close();
    const webp = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 }).catch(() => null);
    const bitmap = canvas.transferToImageBitmap();
    (self as unknown as Worker).postMessage({ id, bitmap, webp }, [bitmap]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
