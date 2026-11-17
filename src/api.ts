import type { AssetEntry, AssetSettings, Note, NoteInfo, NoteMarker, NoteStatus, NoteWithState, ServerInfo } from '../shared/types.ts';

export function fileUrl(path: string, version?: number): string {
  const enc = path.split('/').map(encodeURIComponent).join('/');
  return `/files/${enc}${version ? `?v=${version}` : ''}`;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  info: () => fetch('/api/info').then((r) => json<ServerInfo>(r)),
  updateConfig: (patch: { lighting?: Record<string, unknown> }) =>
    fetch('/api/config', { method: 'PATCH', body: JSON.stringify(patch) }).then((r) => json<ServerInfo['config']>(r)),
  assets: () =>
    fetch('/api/assets').then((r) => json<{ assets: AssetEntry[]; settings: Record<string, AssetSettings> }>(r)),
  notes: () => fetch('/api/notes').then((r) => json<{ notes: NoteWithState[] }>(r)),
  createNote: (body: {
    asset: string;
    text: string;
    markers: NoteMarker[];
    view: Record<string, unknown>;
    info?: NoteInfo;
    screenshot?: string;
    cleanScreenshot?: string;
  }) =>
    fetch('/api/notes', { method: 'POST', body: JSON.stringify(body) }).then((r) => json<Note>(r)),
  updateNote: (id: string, patch: { text?: string; status?: NoteStatus; reply?: { text: string; author?: string } }) =>
    fetch(`/api/notes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then((r) => json<Note>(r)),
  deleteNote: (id: string) => fetch(`/api/notes/${id}`, { method: 'DELETE' }).then((r) => json(r)),
  saveSettings: (asset: string, settings: AssetSettings) =>
    fetch('/api/settings', { method: 'PUT', body: JSON.stringify({ asset, settings }) }).then((r) =>
      json<AssetSettings>(r),
    ),
  screenshot: (image: string, asset?: string) =>
    fetch('/api/screenshots', { method: 'POST', body: JSON.stringify({ image, asset }) }).then((r) =>
      json<{ path: string; abs: string }>(r),
    ),
  upload: (path: string, file: Blob) =>
    fetch(`/api/upload?path=${encodeURIComponent(path)}`, { method: 'POST', body: file }).then((r) =>
      json<{ path: string }>(r),
    ),
};
