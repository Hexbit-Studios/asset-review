import type { NoteMarker } from '../../shared/types.ts';

export const MARKER_COLOR = '#ff2bd6';

/** Draw numbered cursor markers onto a copy of the capture. */
export function drawMarkers(src: HTMLCanvasElement, markers: NoteMarker[]): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const s = Math.max(1, out.width / 1200);
  markers.forEach((m, i) => {
    const x = m.x * out.width;
    const y = m.y * out.height;
    ctx.save();
    ctx.lineWidth = 3 * s;
    // Ring + crosshair, with a dark halo so it reads on any background.
    for (const [color, w] of [
      ['rgba(0,0,0,0.75)', 6 * s],
      [MARKER_COLOR, 2.5 * s],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(x, y, 18 * s, 0, Math.PI * 2);
      ctx.moveTo(x - 30 * s, y);
      ctx.lineTo(x - 8 * s, y);
      ctx.moveTo(x + 8 * s, y);
      ctx.lineTo(x + 30 * s, y);
      ctx.moveTo(x, y - 30 * s);
      ctx.lineTo(x, y - 8 * s);
      ctx.moveTo(x, y + 8 * s);
      ctx.lineTo(x, y + 30 * s);
      ctx.stroke();
    }
    if (markers.length > 1) {
      const label = String(i + 1);
      ctx.font = `bold ${14 * s}px ui-monospace, monospace`;
      const bx = x + 20 * s,
        by = y - 34 * s;
      ctx.fillStyle = MARKER_COLOR;
      ctx.fillRect(bx, by, 18 * s, 18 * s);
      ctx.fillStyle = '#000';
      ctx.fillText(label, bx + 5 * s, by + 14 * s);
    }
    ctx.restore();
  });
  return out;
}

/** Append a caption strip under the image (asset, clip/frame, settings, time). */
export function withCaption(src: HTMLCanvasElement, lines: string[]): HTMLCanvasElement {
  const s = Math.max(1, src.width / 1200);
  const lineH = 18 * s;
  const pad = 8 * s;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height + Math.round(lines.length * lineH + pad * 2);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  ctx.fillStyle = '#0d0d12';
  ctx.fillRect(0, src.height, out.width, out.height - src.height);
  ctx.font = `${12 * s}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  lines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? '#e8e8f0' : '#9a9ab0';
    ctx.fillText(l, pad, src.height + pad + lineH * (i + 0.75));
  });
  return out;
}

export function toPng(c: HTMLCanvasElement) {
  return c.toDataURL('image/png');
}

export async function copyToClipboard(c: HTMLCanvasElement): Promise<boolean> {
  try {
    const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}
