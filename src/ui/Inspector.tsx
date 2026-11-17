import { useEffect, useState, type RefObject } from 'react';
import { ChevronRight, Pencil, RotateCcw } from 'lucide-react';
import type { AssetEntry, AssetSettings, AssetStatus, ImageLayout, LightRig, Note, NoteInfo } from '../../shared/types.ts';
import type { SpriteAsset } from '../formats/sprite.ts';
import type { Viewer, ViewerSettings } from '../viewer/Viewer.ts';
import { statKey, type Stat } from '../viewer/content.ts';
import type { Lighting } from '../viewer/lighting.ts';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Section, Slider } from './controls.tsx';
import { CheckField } from './Timeline.tsx';
import { LightingEditor } from './LightingEditor.tsx';

const STATUSES: [AssetStatus, string, string][] = [
  ['unreviewed', 'Unreviewed', 'data-[state=on]:bg-muted data-[state=on]:text-foreground'],
  ['needs-work', 'Needs work · W', 'data-[state=on]:border-warning data-[state=on]:bg-warning/15 data-[state=on]:text-warning'],
  ['approved', 'Approved · A', 'data-[state=on]:border-success data-[state=on]:bg-success/15 data-[state=on]:text-success'],
];

export function Inspector(props: {
  entry: AssetEntry | null;
  settings: AssetSettings | undefined;
  viewer: RefObject<Viewer | null>;
  viewerSettings: ViewerSettings;
  kind: string | null;
  sprite: SpriteAsset | null;
  loadNotes: string[];
  statsTick: number;
  /** Notes on this asset (to badge info rows that have notes). */
  notes: Note[];
  onNoteInfo: (info: NoteInfo) => void;
  onShowNote: (noteId: string) => void;
  targetDensity?: number;
  layerVisibility: Record<number, boolean>;
  onLayerVisibility: (index: number, visible: boolean) => void;
  onSettings: (patch: AssetSettings) => void;
  onViewer: (patch: Partial<ViewerSettings>) => void;
  onSaveLighting: (preset: Lighting, rig: LightRig) => Promise<void>;
  onDeleteProjectLighting: (preset: Lighting) => Promise<void>;
}) {
  const { entry, settings, sprite, kind, viewerSettings: vs, onViewer } = props;
  const [stats, setStats] = useState<Stat[]>([]);

  useEffect(() => {
    // Stats depend on the current frame (colour count) so refresh a few times a second for sprites.
    const read = () => setStats(props.viewer.current?.content?.stats(props.targetDensity) ?? []);
    read();
    if (kind !== 'sprite') return;
    const id = window.setInterval(read, 500);
    return () => window.clearInterval(id);
  }, [props.statsTick, props.targetDensity, kind, vs.showSheet, props.viewer]);

  if (!entry) return <div className="p-4 text-sm text-muted-foreground">Select an asset</div>;
  const status = settings?.status ?? 'unreviewed';
  const isImage = entry.kind === 'image' || entry.kind === 'aseprite';
  const rows: Stat[] = [
    ...stats,
    ...props.loadNotes
      .filter((n) => !stats.some((s) => s.value === n))
      .map((n): Stat => ({ label: 'Warning', key: `Warning: ${n}`, value: n, warn: true })),
  ];

  return (
    <div className="flex flex-col">
      {/* Asset header */}
      <div className="flex flex-col gap-1.5 border-b p-3">
        <h3 className="font-semibold break-all" title={entry.path}>
          {entry.path.split('/').pop()}
        </h3>
        <div className="text-xs break-all text-muted-foreground">{entry.path}</div>
        <div className="text-xs text-muted-foreground">
          {formatBytes(entry.size)} · modified {new Date(entry.mtime).toLocaleString()}
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={status}
          onValueChange={(v) => v && props.onSettings({ status: v as AssetStatus })}
          className="mt-1 flex-wrap"
        >
          {STATUSES.map(([s, label, cls]) => (
            <ToggleGroupItem key={s} value={s} className={cls}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* Info: always visible, every row can carry a note */}
      <div className="border-b px-3 pt-2 pb-2">
        <div className="pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Info</div>
        <Table className="text-[0.8rem]">
          <TableBody>
            {rows.map((s, i) => {
              const key = statKey(s);
              const about = props.notes.filter((n) => n.info?.key === key && (n.status === 'open' || n.status === 'addressed'));
              return (
                <TableRow key={i} className="group/row border-0">
                  <TableCell
                    className={cn(
                      'py-1 pr-2 pl-0 align-top whitespace-pre text-muted-foreground',
                      about.length > 0 && 'font-medium text-primary',
                    )}
                  >
                    {s.label}
                  </TableCell>
                  <TableCell className={cn('w-full py-1 align-top whitespace-normal', s.warn && 'text-warning')}>{s.value}</TableCell>
                  <TableCell className="py-0.5 pr-0 text-right align-top whitespace-nowrap">
                    {about.length > 0 && (
                      <Badge
                        asChild
                        className="mr-1 h-5 min-w-5 cursor-pointer px-1.5"
                        title={about.map((n) => `${n.status}: ${n.text}`).join('\n')}
                      >
                        <button onClick={() => props.onShowNote(about[about.length - 1].id)}>{about.length}</button>
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                      title={`Leave a note about ${key}`}
                      aria-label={`Note about ${key}`}
                      onClick={() => props.onNoteInfo({ key, label: s.label.trim(), value: s.value })}
                    >
                      <Pencil />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Everything below Info is collapsible */}
      {isImage && (
        <LayoutEditor
          layout={settings?.layout ?? sprite?.layout ?? undefined}
          explicit={!!settings?.layout}
          isAseprite={entry.kind === 'aseprite'}
          onChange={(layout) => props.onSettings({ layout })}
        />
      )}

      {kind === 'stack' && (
        <Section id="stack" title="Sprite stack">
          <Slider label="Slice spacing (px)" min={0.25} max={3} step={0.25} value={vs.stackSpacing} onChange={(v) => onViewer({ stackSpacing: v })} />
          <Slider label="Camera pitch" unit="°" min={15} max={90} step={1} value={vs.stackPitch} onChange={(v) => onViewer({ stackPitch: v })} />
          <p className="text-xs text-muted-foreground">
            squash ≈ {Math.sin((vs.stackPitch * Math.PI) / 180).toFixed(2)} (article default 0.75 ≈ 49°)
          </p>
          <Slider label="Gap fill copies" min={1} max={6} step={1} value={vs.stackFill} onChange={(v) => onViewer({ stackFill: v })} />
          <p className="text-xs text-muted-foreground">Space spins the turntable; ←/→ step 22.5° (16 directions).</p>
        </Section>
      )}

      {kind === 'sprite' && (
        <Section id="sprite" title="Sprite">
          <div className="flex flex-wrap gap-1.5">
            <Toggle variant="outline" size="sm" pressed={vs.onion} onPressedChange={(v) => onViewer({ onion: v })} title="Onion skin previous frame (U)">
              Onion skin
            </Toggle>
            {sprite?.sheet && sprite.frames.length > 1 && (
              <Toggle
                variant="outline"
                size="sm"
                pressed={vs.showSheet}
                onPressedChange={(v) => onViewer({ showSheet: v })}
                title="Show the whole sheet with frame grid (S)"
              >
                Whole sheet
              </Toggle>
            )}
          </div>
        </Section>
      )}

      {kind === 'model' && vs.orbit && (
        <Section id="orbit" title="Camera orbit">
          <Slider label="Seconds per turn" min={4} max={60} step={1} unit="s" value={vs.orbitSeconds} onChange={(v) => onViewer({ orbitSeconds: v })} />
          <CheckField id="orbit-reverse" checked={vs.orbitReverse} onChange={(v) => onViewer({ orbitReverse: v })}>
            reverse direction
          </CheckField>
        </Section>
      )}

      {(kind === 'model' || vs.litSprites) && (
        <LightingEditor
          viewer={props.viewer}
          settings={vs}
          onViewer={onViewer}
          onSaveProject={props.onSaveLighting}
          onDeleteProject={props.onDeleteProjectLighting}
        />
      )}

      {vs.bloom && (
        <Section id="bloom" title="Bloom">
          <Slider label="Strength" min={0} max={3} step={0.05} value={vs.bloomStrength} onChange={(v) => onViewer({ bloomStrength: v })} />
          <Slider label="Threshold" min={0} max={2} step={0.05} value={vs.bloomThreshold} onChange={(v) => onViewer({ bloomThreshold: v })} />
          <Slider label="Radius" min={0} max={1} step={0.05} value={vs.bloomRadius} onChange={(v) => onViewer({ bloomRadius: v })} />
          <p className="text-xs text-muted-foreground">
            Only pixels brighter than the threshold glow. Emissive materials above 1.0 (Blender Emission Strength &gt; 1) bloom; unlit sprites top
            out at 1.0, so lower the threshold to make sprite neon glow.
          </p>
        </Section>
      )}

      {sprite?.layers && sprite.layers.length > 0 && (
        <Section id="layers" title="Layers">
          <div className="flex max-h-64 flex-col overflow-y-auto">
            {layerTree(sprite.layers).map((l) => {
              const visible = props.layerVisibility[l.index] ?? l.visible;
              const id = `layer-${l.index}`;
              return (
                <div key={l.index} className="flex items-center gap-2 rounded-md py-1 hover:bg-muted" style={{ paddingLeft: `${0.375 + l.depth * 0.875}rem` }}>
                  <Checkbox id={id} checked={visible} onCheckedChange={(v) => props.onLayerVisibility(l.index, v === true)} />
                  <Label htmlFor={id} className="flex items-center gap-1 font-normal">
                    {l.group && <ChevronRight className="size-3.5 rotate-90 text-muted-foreground" />}
                    {l.name}
                  </Label>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

function LayoutEditor(props: {
  layout?: ImageLayout;
  explicit: boolean;
  isAseprite: boolean;
  onChange: (l: ImageLayout | null) => void;
}) {
  const l = props.layout ?? { mode: 'single' };
  const [draft, setDraft] = useState<ImageLayout>(l);
  useEffect(() => setDraft(l), [JSON.stringify(l)]); // eslint-disable-line react-hooks/exhaustive-deps
  const modes: ImageLayout['mode'][] = props.isAseprite ? ['single', 'stack'] : ['single', 'grid', 'stack', 'directions'];
  const num = (k: keyof ImageLayout, label: string, placeholder?: string) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`layout-${k}`} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <Input
        id={`layout-${k}`}
        type="number"
        min={1}
        className="h-8"
        value={(draft[k] as number | undefined) ?? ''}
        placeholder={placeholder ?? 'auto'}
        onChange={(e) => setDraft({ ...draft, [k]: e.target.value ? Number(e.target.value) : undefined })}
      />
    </div>
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(l);
  return (
    <Section
      id="layout"
      title="Layout"
      extra={!props.explicit && <span className="text-xs text-muted-foreground">auto-detected</span>}
    >
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={draft.mode}
        onValueChange={(v) => {
          if (!v) return;
          const next = { ...draft, mode: v as ImageLayout['mode'] };
          setDraft(next);
          if (v === 'single' || props.isAseprite) props.onChange(next);
        }}
        className="flex-wrap"
      >
        {modes.map((m) => (
          <ToggleGroupItem key={m} value={m}>
            {m === 'directions' ? 'dir sheet' : m}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {draft.mode === 'grid' && (
        <div className="grid grid-cols-2 gap-2">
          {num('cols', 'Columns')}
          {num('rows', 'Rows')}
          {num('frameCount', 'Frames')}
          {num('fps', 'FPS', '10')}
        </div>
      )}
      {draft.mode === 'stack' && !props.isAseprite && <div className="grid grid-cols-2 gap-2">{num('slices', 'Slices')}</div>}
      {draft.mode === 'directions' && (
        <div className="grid grid-cols-2 gap-2">
          {num('frameCount', 'Directions', '8')}
          {num('cols', 'Columns', '8')}
        </div>
      )}
      {draft.mode !== 'single' && !props.isAseprite && (
        <div className="flex gap-2">
          <Button size="sm" disabled={!dirty && props.explicit} onClick={() => props.onChange(draft)}>
            Apply
          </Button>
          {props.explicit && (
            <Button size="sm" variant="outline" onClick={() => props.onChange(null)}>
              <RotateCcw /> Reset to auto
            </Button>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Filename hints: <code className="font-mono">name.stack15.png</code>, <code className="font-mono">name.dir16.png</code>, or a sidecar{' '}
        <code className="font-mono">name.json</code>.
      </p>
    </Section>
  );
}

/**
 * Layers as Aseprite shows them: top of the stack first, each group directly above its children.
 * In the file, layers go bottom to top and a group's children follow the group entry.
 */
function layerTree<T extends { depth: number }>(layers: T[]): T[] {
  const out: T[] = [];
  const visit = (start: number, end: number, depth: number) => {
    const siblings: [number, number][] = [];
    for (let i = start; i < end; ) {
      let j = i + 1;
      while (j < end && layers[j].depth > depth) j++;
      siblings.push([i, j]);
      i = j;
    }
    for (const [i, j] of siblings.reverse()) {
      out.push(layers[i]);
      if (j > i + 1) visit(i + 1, j, depth + 1);
    }
  };
  visit(0, layers.length, 0);
  return out;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
