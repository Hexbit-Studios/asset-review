import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useDefaultLayout } from 'react-resizable-panels';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { AssetEntry, AssetSettings, Note, NoteMarker, ServerInfo, NoteInfo } from '../shared/types.ts';
import { api } from './api.ts';
import { loadContent } from './loadContent.ts';
import type { SpriteAsset } from './formats/sprite.ts';
import { DEFAULT_SETTINGS, Viewer, type Background, type Lighting, type ViewPreset, type ViewerSettings } from './viewer/Viewer.ts';
import type { DisplayMode } from './viewer/content.ts';
import type { PlaybackState } from './viewer/playback.ts';
import { copyToClipboard, drawMarkers, toPng, withCaption } from './ui/capture.ts';
import { AssetList, type AssetFilter } from './ui/AssetList.tsx';
import { Toolbar } from './ui/Toolbar.tsx';
import { Timeline } from './ui/Timeline.tsx';
import { Inspector } from './ui/Inspector.tsx';
import { NotesPanel } from './ui/NotesPanel.tsx';
import { NoteComposer, type ComposerState } from './ui/NoteComposer.tsx';
import { HelpOverlay } from './ui/HelpOverlay.tsx';
import { Lightbox } from './ui/Lightbox.tsx';
import { useTheme } from './ui/theme.ts';
import { BUILTIN_PRESETS } from './viewer/lighting.ts';

const BACKGROUNDS: Background[] = ['checker', 'dark', 'mid', 'light', 'green', 'magenta'];
const DISPLAY: DisplayMode[] = ['shaded', 'albedo', 'wireframe', 'checker', 'normals'];
const PRESET_KEYS: Record<string, ViewPreset> = { '1': 'front', '2': 'back', '3': 'left', '4': 'right', '5': 'top', '6': 'iso', '7': 'game' };
const SETTINGS_KEY = 'asset-review:viewer-settings';
/** Bump when a default changes in a way saved settings should pick up. */
const SETTINGS_VERSION = 5;

function loadViewerSettings(): ViewerSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    if ((saved.settingsVersion ?? 1) < 2) {
      // v2 retuned bloom; drop the old values so the new defaults apply.
      for (const k of ['bloom', 'bloomStrength', 'bloomThreshold', 'bloomRadius']) delete saved[k];
    }
    // v3 split the single backdrop into bgModel / bgSprite.
    delete saved.background;
    // v4 changed the 3D default to mid grey.
    if ((saved.settingsVersion ?? 1) < 4) delete saved.bgModel;
    // v5: the old "night" was the neon look and is now the "neon" preset; a new neutral night
    // took its name. Edits made to the old night belong to neon.
    if ((saved.settingsVersion ?? 1) < 5 && saved.lightRigs?.night && !saved.lightRigs.neon) {
      saved.lightRigs.neon = saved.lightRigs.night;
      delete saved.lightRigs.night;
    }
    delete saved.settingsVersion;
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function cycle<T>(list: T[], current: T, dir = 1): T {
  return list[(list.indexOf(current) + dir + list.length) % list.length];
}

function selectedFromHash(): string | null {
  const m = /asset=([^&]+)/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
}

export function App() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [assets, setAssets] = useState<AssetEntry[]>([]);
  const [assetSettings, setAssetSettings] = useState<Record<string, AssetSettings>>({});
  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<string | null>(selectedFromHash());
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadNotes, setLoadNotes] = useState<string[]>([]);
  const [sprite, setSprite] = useState<SpriteAsset | null>(null);
  const [layerVis, setLayerVis] = useState<Record<string, Record<number, boolean>>>({});
  const [vs, setVs] = useState<ViewerSettings>(loadViewerSettings);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [filter, setFilter] = useState<AssetFilter>({ text: '', kind: 'all', onlyOpenNotes: false });
  const [tab, setTab] = useState<'inspect' | 'notes'>('inspect');
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [focusedNote, setFocusedNote] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [contentKind, setContentKind] = useState<string | null>(null);
  const [statsTick, setStatsTick] = useState(0);
  const theme = useTheme();
  // Remembers the panel widths between sessions.
  const panelLayout = useDefaultLayout({ id: 'asset-review-layout', storage: localStorage });

  const viewportRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const loadToken = useRef(0);
  const pendingView = useRef<Note | null>(null);

  const entry = useMemo(() => assets.find((a) => a.path === selected) ?? null, [assets, selected]);
  const currentSettings = selected ? assetSettings[selected] : undefined;
  const ppu = info?.config.pixelsPerUnit ?? 32;

  const flash = useCallback((msg: string) => {
    toast(msg);
  }, []);

  // ---------------------------------------------------------------- data

  const refreshAssets = useCallback(async () => {
    const { assets, settings } = await api.assets();
    setAssets(assets);
    setAssetSettings(settings);
    return assets;
  }, []);
  const refreshNotes = useCallback(async () => setNotes((await api.notes()).notes), []);

  useEffect(() => {
    api.info().then(setInfo).catch((e) => setError(String(e)));
    refreshAssets().then((list) => {
      setSelected((cur) => cur && list.some((a) => a.path === cur) ? cur : list[0]?.path ?? null);
    });
    refreshNotes();
  }, [refreshAssets, refreshNotes]);

  useEffect(() => {
    if (selected) history.replaceState(null, '', `#asset=${encodeURIComponent(selected)}`);
  }, [selected]);

  // Live file changes from the server watcher.
  useEffect(() => {
    // Server-sent events from the review backend (works in dev and in the published build).
    const source = new EventSource('/api/events');
    const handler = (data: { changes: { path: string; type: string }[] }) => {
      let assetsChanged = false;
      let notesChanged = false;
      if (data.changes.some((c) => c.path === 'review.config.json' || c.path === '.review/config.json'))
        api.info().then(setInfo);
      const bump: Record<string, number> = {};
      for (const c of data.changes) {
        if (c.path.startsWith('.review/notes/')) notesChanged = true;
        else {
          assetsChanged = true;
          // A sidecar JSON change should reload its image too.
          const base = c.path.replace(/\.json$/, '');
          bump[c.path] = Date.now();
          for (const ext of ['png', 'webp', 'gif', 'jpg']) bump[`${base}.${ext}`] = Date.now();
        }
      }
      if (assetsChanged) {
        refreshAssets();
        setVersions((v) => ({ ...v, ...bump }));
      }
      if (notesChanged) refreshNotes();
    };
    const onFs = (e: MessageEvent) => handler(JSON.parse(e.data));
    source.addEventListener('fs', onFs);
    return () => {
      source.removeEventListener('fs', onFs);
      source.close();
    };
  }, [refreshAssets, refreshNotes]);

  // ---------------------------------------------------------------- viewer

  useEffect(() => {
    const v = new Viewer(viewportRef.current!);
    v.ppu = ppu;
    v.set(vs);
    viewerRef.current = v;
    // Handle for scripted checks / debugging from the console.
    (window as unknown as { __assetReview: unknown }).__assetReview = { viewer: v };
    const off = v.onChange(() => {
      setVs({ ...v.settings });
    });
    return () => {
      off();
      v.dispose();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (viewerRef.current) viewerRef.current.ppu = ppu;
  }, [ppu]);

  // Project lighting presets from review.config.json (live: edits to the file apply immediately).
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    v.projectRigs = info?.config.lighting ?? {};
    v.refreshLighting();
  }, [info]);

  // A preset that no longer exists (deleted, or removed from the project config) falls back to
  // studio. Only checked once the project config is known, so project presets aren't reset early.
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !info) return;
    if (!v.presetNames().includes(vs.lighting)) v.set({ lighting: 'studio' });
  }, [info, vs.lighting, vs.lightRigs]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...vs, settingsVersion: SETTINGS_VERSION }));
    } catch {
      /* storage unavailable */
    }
  }, [vs]);

  // Poll playback state for the timeline (cheap, and avoids per-frame React renders).
  useEffect(() => {
    const id = window.setInterval(() => {
      const st = viewerRef.current?.content?.playback.state() ?? null;
      setPlayback((prev) => (JSON.stringify(prev) === JSON.stringify(st) ? prev : st));
    }, 80);
    return () => window.clearInterval(id);
  }, []);

  const version = selected ? versions[selected] ?? 0 : 0;
  const layout = currentSettings?.layout;
  const layoutKey = JSON.stringify(layout ?? null);
  const visKey = selected ? JSON.stringify(layerVis[selected] ?? {}) : '';

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !entry) return;
    const token = ++loadToken.current;
    const isReload = viewer.content !== null && viewer.assetPath === entry.path;
    setLoading(true);
    setError(null);
    const vis = new Map(Object.entries(layerVis[entry.path] ?? {}).map(([k, v]) => [Number(k), v]));
    loadContent(entry, assetSettings[entry.path], viewer.settings, ppu, version, vis.size ? vis : undefined)
      .then((res) => {
        if (token !== loadToken.current) {
          res.content.dispose();
          return;
        }
        // Keep camera + playback position when the same asset reloads (file changed on disk).
        const prevPb = isReload ? viewer.content?.playback.state() : null;
        viewer.setContent(res.content, { keepView: isReload });
        viewer.assetPath = entry.path;
        if (prevPb && prevPb.clip >= 0) {
          res.content.playback.setClip(prevPb.clip);
          if (prevPb.playing) res.content.playback.play();
          else res.content.playback.seek(prevPb.time);
        }
        const pending = pendingView.current;
        if (pending && pending.asset === entry.path) {
          pendingView.current = null;
          if (pending.view) viewer.applyViewState(pending.view);
        }
        setLoadNotes(res.notes);
        setSprite(res.sprite ?? null);
        setContentKind(res.content.kind);
        setStatsTick((t) => t + 1);
      })
      .catch((err) => {
        if (token !== loadToken.current) return;
        console.error(err);
        viewer.setContent(null);
        viewer.assetPath = null;
        setContentKind(null);
        setSprite(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => token === loadToken.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.path, entry?.mtime, version, layoutKey, visKey, ppu]);

  const setViewer = useCallback((patch: Partial<ViewerSettings>) => viewerRef.current?.set(patch), []);

  // ---------------------------------------------------------------- navigation

  const visibleAssets = useMemo(() => filterAssets(assets, notes, assetSettings, filter), [assets, notes, assetSettings, filter]);

  const move = useCallback(
    (dir: number) => {
      if (!visibleAssets.length) return;
      const i = visibleAssets.findIndex((a) => a.path === selected);
      const next = visibleAssets[(i + dir + visibleAssets.length) % visibleAssets.length];
      setSelected(next.path);
      setFocusedNote(null);
    },
    [visibleAssets, selected],
  );

  const saveAssetSettings = useCallback(async (asset: string, patch: AssetSettings) => {
    setAssetSettings((all) => ({ ...all, [asset]: { ...all[asset], ...patch } }));
    const saved = await api.saveSettings(asset, patch);
    setAssetSettings((all) => ({ ...all, [asset]: saved }));
  }, []);

  // ---------------------------------------------------------------- capture

  const captionLines = useCallback((): string[] => {
    const v = viewerRef.current!;
    const pb = v.content?.playback.state();
    const s = v.settings;
    const parts = [
      selected ?? '(no asset)',
      pb && pb.clip >= 0
        ? `${pb.clips[pb.clip]?.name} · ${pb.unit === 'frames' ? `frame ${(pb.frameInClip ?? 0) + 1}/${pb.frameCount}` : pb.unit === 'degrees' ? `${pb.time.toFixed(0)}°` : `f${Math.round(pb.time * (pb.fps ?? 30))} (${pb.time.toFixed(2)}s @${pb.fps ?? 30}fps)${pb.inPlace ? ' · in place' : ''}`}`
        : null,
    ].filter(Boolean);
    const settingsLine =
      v.content?.kind === 'model'
        ? `${s.lighting}${v.rigSource(s.lighting) === 'browser' ? ' (edited)' : ''} light · ${s.display} · ${v.usesOrtho ? 'ortho' : 'persp'}${s.pixelate ? ` · pixelate ${s.pixelate}` : ''}`
        : `${s.spriteScale}× ${s.spriteNative ? 'native' : 'smooth'}${v.content?.kind === 'stack' ? ` · spacing ${s.stackSpacing} · pitch ${s.stackPitch}°` : ''}`;
    return [parts.join('  ·  '), `${settingsLine}  ·  ${new Date().toLocaleString()}`];
  }, [selected]);

  /** Start a note. With `info` the note is about an inspector item (no cursor marker). */
  const startNote = useCallback(
    (info?: NoteInfo) => {
      const v = viewerRef.current;
      if (!v || !selected || composer) return;
      const clean = v.capture();
      const c = cursorRef.current;
      const markers: NoteMarker[] = c && !info ? [{ x: c.x, y: c.y }] : [];
      v.content?.playback.pause();
      const caption = captionLines();
      if (info) caption.unshift(`About ${info.key}: ${info.value}`);
      setComposer({ clean, markers, view: v.viewState(), caption, asset: selected, info });
    },
    [selected, composer, captionLines],
  );

  const saveNote = useCallback(
    async (state: ComposerState, text: string) => {
      const marked = withCaption(drawMarkers(state.clean, state.markers), state.caption);
      const note = await api.createNote({
        asset: state.asset,
        text,
        markers: state.markers,
        view: state.view,
        info: state.info,
        screenshot: toPng(marked),
        cleanScreenshot: toPng(state.clean),
      });
      setNotes((n) => [...n.filter((x) => x.id !== note.id), note]);
      setComposer(null);
      // Notes about an info row stay in the inspector, where the row now shows a badge.
      if (!state.info) setTab('notes');
      if (assetSettings[state.asset]?.status !== 'needs-work') saveAssetSettings(state.asset, { status: 'needs-work' });
      flash('Note saved');
    },
    [assetSettings, saveAssetSettings, flash],
  );

  const screenshot = useCallback(async () => {
    const v = viewerRef.current;
    if (!v) return;
    const img = withCaption(v.capture(), captionLines());
    const [{ abs }, copied] = await Promise.all([api.screenshot(toPng(img), selected ?? undefined), copyToClipboard(img)]);
    flash(`Screenshot saved${copied ? ' + copied' : ''}: ${abs}`);
  }, [captionLines, selected, flash]);

  const restoreNote = useCallback(
    (note: Note) => {
      setFocusedNote(note.id);
      if (note.asset === selected && viewerRef.current?.assetPath === note.asset) {
        if (note.view) viewerRef.current.applyViewState(note.view);
      } else {
        // Applied by the load effect once the asset is in the viewer.
        pendingView.current = note;
        setSelected(note.asset);
      }
    },
    [selected],
  );

  // ---------------------------------------------------------------- keyboard

  // After picking from a dropdown, hand focus back so Space / arrows drive the viewer again
  // (otherwise arrows would keep changing the dropdown and shortcuts are ignored).
  useEffect(() => {
    const onChange = (e: Event) => {
      if (e.target instanceof HTMLSelectElement) e.target.blur();
    };
    document.addEventListener('change', onChange);
    return () => document.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if (composer || lightbox || help) return;
      if (e.defaultPrevented) return; // a focused widget (slider, tabs, menu) already used the key
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const v = viewerRef.current;
      const pb = v?.content?.playback;
      const k = e.key;
      const handled = () => e.preventDefault();
      if (k === '?' ) return handled(), setHelp((h) => !h);
      if (k === 'Escape') return setHelp(false), setFocusedNote(null);
      if (k === 'ArrowDown' || k === 'j') return handled(), move(1);
      if (k === 'ArrowUp' || k === 'k') return handled(), move(-1);
      if (k === 'n' || k === 'N') return handled(), startNote();
      if (k === 'p' || k === 'P') return handled(), void screenshot();
      if (k === 't') return theme.cycle();
      if (k === 'r') {
        const st = pb?.state();
        if (st?.inPlace !== undefined) pb!.setInPlace?.(!st.inPlace);
        return;
      }
      if (!v) return;
      if (k === ' ') return handled(), pb?.toggle();
      if (k === 'Home' || (k === 'ArrowLeft' && e.shiftKey)) return handled(), pb?.goToStart();
      if (k === 'End' || (k === 'ArrowRight' && e.shiftKey)) return handled(), pb?.goToEnd();
      if (k === 'ArrowRight' || k === '.') return handled(), pb?.step(1);
      if (k === 'ArrowLeft' || k === ',') return handled(), pb?.step(-1);
      if (k === ']' || k === '[') {
        const st = pb?.state();
        if (st && st.clips.length) pb!.setClip((st.clip + (k === ']' ? 1 : -1) + st.clips.length) % st.clips.length);
        return handled();
      }
      if (k === 'f') return v.frame(v.content?.kind === 'stack' ? 'game' : v.content?.kind === 'sprite' ? 'front' : 'iso');
      if (PRESET_KEYS[k]) return v.preset(PRESET_KEYS[k]);
      if (k === 'o') return setViewer({ ortho: !v.settings.ortho });
      if (k === 'c') return setViewer({ orbit: !v.settings.orbit });
      if (k === 'g') return setViewer({ grid: !v.settings.grid });
      if (k === 'e') return setViewer({ bloom: !v.settings.bloom });
      if (k === 'h') return setViewer({ human: !v.settings.human });
      if (k === 'x') return setViewer({ skeleton: !v.settings.skeleton });
      if (k === 'u') return setViewer({ onion: !v.settings.onion });
      if (k === 's') return setViewer({ showSheet: !v.settings.showSheet });
      if (k === 'l' || k === 'L') return setViewer({ lighting: cycle(v.presetNames(), v.settings.lighting, k === 'L' ? -1 : 1) });
      if (k === 'b' || k === 'B') return setViewer(v.backgroundPatch(cycle(BACKGROUNDS, v.background, k === 'B' ? -1 : 1)));
      if (k === 'm' || k === 'M') return setViewer({ display: cycle(DISPLAY, v.settings.display, k === 'M' ? -1 : 1) });
      if (k === '=' || k === '+') return setViewer({ spriteScale: Math.min(64, v.settings.spriteScale + 1) });
      if (k === '-') return setViewer({ spriteScale: Math.max(1, v.settings.spriteScale - 1) });
      if (k === 'a' && selected) return saveAssetSettings(selected, { status: 'approved' });
      if (k === 'w' && selected) return saveAssetSettings(selected, { status: 'needs-work' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composer, lightbox, help, move, startNote, screenshot, setViewer, selected, saveAssetSettings, theme.cycle]);

  // ---------------------------------------------------------------- drag & drop

  const importDropped = useCallback(
    async (dt: DataTransfer) => {
      const files = await collectDropped(dt);
      if (!files.length) return;
      flash(`Uploading ${files.length} file(s) to _inbox/…`);
      const uploaded: string[] = [];
      for (const { path, file } of files) uploaded.push((await api.upload(path, file)).path);
      const list = await refreshAssets();
      const first = list.find((a) => uploaded.includes(a.path));
      if (first) setSelected(first.path);
      flash(`Added ${uploaded.length} file(s) to _inbox/`);
    },
    [refreshAssets, flash],
  );

  // Only drags carrying files from outside (Finder) count; in-page drags of images, text or
  // sliders are ignored. dragleave is unreliable (fires per child, and not at all when a drag
  // is cancelled), so the overlay hides itself once dragover stops arriving.
  useEffect(() => {
    let hideTimer = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const hide = () => {
      window.clearTimeout(hideTimer);
      setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(hide, 250);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      hide();
      void importDropped(e.dataTransfer!);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    window.addEventListener('dragend', hide);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
      window.removeEventListener('dragend', hide);
      window.removeEventListener('blur', hide);
    };
  }, [importDropped]);

  // ---------------------------------------------------------------- render

  const assetNotes = notes.filter((n) => n.asset === selected);
  const focused = notes.find((n) => n.id === focusedNote) ?? null;

  const openOnAsset = assetNotes.filter((n) => n.status === 'open').length;

  return (
    <TooltipProvider delayDuration={250}>
    <div className="h-dvh overflow-hidden">
      <ResizablePanelGroup id="asset-review-layout" orientation="horizontal" defaultLayout={panelLayout.defaultLayout} onLayoutChanged={panelLayout.onLayoutChanged}>
        <ResizablePanel id="assets" defaultSize="16rem" minSize="11rem" maxSize="32rem">
          <AssetList
            title={info?.rootName ?? '…'}
            root={info?.root ?? ''}
            assets={visibleAssets}
            total={assets.length}
            notes={notes}
            settings={assetSettings}
            selected={selected}
            filter={filter}
            onFilter={setFilter}
            onSelect={(p) => {
              setSelected(p);
              setFocusedNote(null);
            }}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />

        <ResizablePanel id="main" minSize="24rem">
          <main className="flex h-full min-w-0 flex-col">
            <Toolbar
              settings={vs}
              kind={contentKind}
              background={contentKind === 'model' || !contentKind ? vs.bgModel : vs.bgSprite}
              lightingPresets={viewerRef.current?.presetNames() ?? BUILTIN_PRESETS}
              onBackground={(bg) => viewerRef.current && setViewer(viewerRef.current.backgroundPatch(bg))}
              onChange={setViewer}
              onPreset={(p) => viewerRef.current?.preset(p)}
              onFrame={() => {
                const v = viewerRef.current;
                v?.frame(v.content?.kind === 'stack' ? 'game' : v.content?.kind === 'sprite' ? 'front' : 'iso');
              }}
              onNote={() => startNote()}
              onScreenshot={screenshot}
              onHelp={() => setHelp(true)}
              theme={theme.pref}
              onTheme={theme.cycle}
            />
            <div
              className={cn('relative min-h-0 flex-1 cursor-crosshair overflow-hidden', dragging && 'outline-2 -outline-offset-4 outline-primary outline-dashed')}
              ref={viewportRef}
              onPointerDown={() => (document.activeElement as HTMLElement | null)?.blur?.()}
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                cursorRef.current = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
              }}
              onMouseLeave={() => (cursorRef.current = null)}
            >
              {focused && focused.asset === selected && (
                <div className="pointer-events-none absolute inset-0">
                  {focused.markers.map((m, i) => (
                    <div key={i} className="note-marker" style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}>
                      {focused.markers.length > 1 && (
                        <span className="absolute -top-4 left-6 bg-primary px-1 font-mono text-xs font-bold text-primary-foreground">{i + 1}</span>
                      )}
                    </div>
                  ))}
                  <div className="pointer-events-auto absolute bottom-2.5 left-2.5 flex max-w-[60%] items-start gap-2 rounded-lg border border-primary bg-popover/90 px-2.5 py-1.5 text-sm text-popover-foreground backdrop-blur">
                    <span>
                      <b>Note view</b> {focused.text.slice(0, 120)}
                    </span>
                    <Button variant="ghost" size="icon-xs" onClick={() => setFocusedNote(null)} aria-label="Close note view">
                      <X />
                    </Button>
                  </div>
                </div>
              )}
              {loading && <Overlay>Loading…</Overlay>}
              {error && (
                <Overlay className="pointer-events-auto border-destructive text-destructive select-text">{error}</Overlay>
              )}
              {!assets.length && !loading && <Overlay>No assets found in {info?.root}. Drop files here to add them to _inbox/.</Overlay>}
              {dragging && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center bg-primary/10 text-xl">Drop to copy into _inbox/</div>
              )}
            </div>
            <Timeline playback={playback} viewer={viewerRef} />
          </main>
        </ResizablePanel>
        <ResizableHandle withHandle />

        <ResizablePanel id="side" defaultSize="22rem" minSize="16rem" maxSize="40rem">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex h-full min-h-0 flex-col gap-0 bg-card">
            <TabsList className="m-2 w-[calc(100%-1rem)] shrink-0">
              <TabsTrigger value="inspect">Inspect</TabsTrigger>
              <TabsTrigger value="notes">
                Notes {openOnAsset > 0 && <Badge className="h-4 min-w-4 px-1 text-[0.7rem]">{openOnAsset}</Badge>}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="inspect" className="min-h-0 flex-1 overflow-y-auto border-t">
              <Inspector
                entry={entry}
                settings={currentSettings}
                viewer={viewerRef}
                viewerSettings={vs}
                kind={contentKind}
                sprite={sprite}
                loadNotes={loadNotes}
                statsTick={statsTick}
                notes={assetNotes}
                onNoteInfo={(info) => startNote(info)}
                onShowNote={(id) => {
                  setTab('notes');
                  setFocusedNote(id);
                }}
                targetDensity={info?.config.texelDensity}
                layerVisibility={selected ? layerVis[selected] ?? {} : {}}
                onLayerVisibility={(idx, visible) =>
                  selected && setLayerVis((all) => ({ ...all, [selected]: { ...all[selected], [idx]: visible } }))
                }
                onSettings={(patch) => selected && saveAssetSettings(selected, patch)}
                onViewer={setViewer}
                onSaveLighting={async (preset, rig) => {
                  const config = await api.updateConfig({ lighting: { [preset]: rig } });
                  setInfo((i) => (i ? { ...i, config } : i));
                  flash(`Saved the ${preset} lighting to review.config.json`);
                }}
                onDeleteProjectLighting={async (preset) => {
                  const config = await api.updateConfig({ lighting: { [preset]: null } });
                  setInfo((i) => (i ? { ...i, config } : i));
                }}
              />
            </TabsContent>
            <TabsContent value="notes" className="min-h-0 flex-1 overflow-y-auto border-t">
              <NotesPanel
                notes={notes}
                assets={assets}
                asset={selected}
                author={info?.author ?? 'reviewer'}
                focused={focusedNote}
                onRestore={restoreNote}
                onOpenImage={setLightbox}
                onChanged={(n) => setNotes((all) => all.map((x) => (x.id === n.id ? n : x)))}
                onDeleted={(id) => setNotes((all) => all.filter((x) => x.id !== id))}
              />
            </TabsContent>
          </Tabs>
        </ResizablePanel>
      </ResizablePanelGroup>

      {composer && <NoteComposer state={composer} onCancel={() => setComposer(null)} onSave={saveNote} onChange={setComposer} />}
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      <Toaster theme={theme.resolved} position="bottom-center" />
    </div>
    </TooltipProvider>
  );
}

function Overlay(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute top-3 left-1/2 max-w-[80%] -translate-x-1/2 rounded-lg border bg-popover/90 px-3 py-1.5 text-sm whitespace-pre-wrap text-popover-foreground backdrop-blur',
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

function filterAssets(assets: AssetEntry[], notes: Note[], settings: Record<string, AssetSettings>, f: AssetFilter) {
  const text = f.text.trim().toLowerCase();
  const open = new Set(notes.filter((n) => n.status === 'open').map((n) => n.asset));
  return assets.filter((a) => {
    if (text && !a.path.toLowerCase().includes(text)) return false;
    if (f.kind === 'models' && a.kind !== 'model') return false;
    if (f.kind === 'sprites' && a.kind === 'model') return false;
    if (f.onlyOpenNotes && !open.has(a.path)) return false;
    if (f.status && (settings[a.path]?.status ?? 'unreviewed') !== f.status) return false;
    return true;
  });
}

async function collectDropped(dt: DataTransfer): Promise<{ path: string; file: File }[]> {
  const out: { path: string; file: File }[] = [];
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ path: prefix + entry.name, file });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      } while (batch.length);
    }
  };
  if (entries.length) for (const e of entries) await walk(e, '');
  else for (const f of [...dt.files]) out.push({ path: f.name, file: f });
  return out;
}
