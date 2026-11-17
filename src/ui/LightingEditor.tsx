import { useState, type ReactNode, type RefObject } from 'react';
import { Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import type { LightRig } from '../../shared/types.ts';
import { BUILTIN_LABELS, BUILTIN_RIGS, cloneRig, isBuiltin, presetNameError, type Lighting } from '../viewer/lighting.ts';
import type { Viewer, ViewerSettings } from '../viewer/Viewer.ts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ColorInput, ColorIntensity, Section, Slider } from './controls.tsx';
import { CheckField } from './Timeline.tsx';

const SOURCE_LABEL = {
  browser: 'Edited in this browser',
  project: 'Project default (review.config.json)',
  'built-in': 'Built-in',
} as const;

const MAX_ACCENTS = 6;

/**
 * Edits the active lighting preset. Changes are live and kept in this browser; "Save to
 * project" writes the preset to review.config.json so it becomes everyone's default.
 */
export function LightingEditor(props: {
  viewer: RefObject<Viewer | null>;
  settings: ViewerSettings;
  onViewer: (patch: Partial<ViewerSettings>) => void;
  onSaveProject: (preset: Lighting, rig: LightRig) => Promise<void>;
  onDeleteProject: (preset: Lighting) => Promise<void>;
}) {
  const v = props.viewer.current;
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);
  if (!v) return null;
  const preset = props.settings.lighting;
  const rig = v.rigFor(preset);
  const source = v.rigSource(preset);
  const hasProject = !!v.projectRigs[preset];
  const builtin = isBuiltin(preset);
  const nameError = newName === null ? null : presetNameError(newName, v.presetNames());
  const isNew = source === 'browser' && !builtin && !hasProject;

  const update = (fn: (r: LightRig) => void) => {
    const next = cloneRig(rig);
    fn(next);
    props.onViewer({ lightRigs: { ...props.settings.lightRigs, [preset]: next } });
  };
  const dropBrowserEdits = () => {
    const { [preset]: _, ...rest } = props.settings.lightRigs;
    props.onViewer({ lightRigs: rest });
  };
  const createPreset = () => {
    if (newName === null || nameError) return;
    const name = newName.trim();
    // A new preset starts as a copy of whatever is active now.
    props.onViewer({ lighting: name, lightRigs: { ...props.settings.lightRigs, [name]: cloneRig(rig) } });
    setNewName(null);
  };
  const deletePreset = async () => {
    const where = hasProject ? ' from this browser and from review.config.json' : '';
    if (!confirm(`Delete the "${preset}" lighting preset${where}?`)) return;
    const { [preset]: _, ...rest } = props.settings.lightRigs;
    props.onViewer({ lighting: 'studio', lightRigs: rest });
    if (hasProject) await props.onDeleteProject(preset);
  };

  const badge =
    source === 'browser' ? (
      <Badge variant="outline" className="border-warning text-warning">
        {isNew ? 'new' : 'edited'}
      </Badge>
    ) : source === 'project' ? (
      <Badge variant="outline" className="border-success text-success">
        project
      </Badge>
    ) : (
      <Badge variant="outline">built-in</Badge>
    );

  return (
    <Section
      id="lighting"
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          Lighting <span className="truncate font-medium tracking-normal text-foreground normal-case">· {builtin ? BUILTIN_LABELS[preset] : preset}</span>
        </span>
      }
      extra={badge}
    >
      <p className="text-xs text-muted-foreground">
        {isNew ? 'Custom preset, only in this browser until saved to the project' : SOURCE_LABEL[source]}
      </p>

      <Slider label="Exposure" min={0.1} max={3} step={0.05} value={rig.exposure} onChange={(x) => update((r) => (r.exposure = x))} />
      <Slider label="Reflections" min={0} max={2} step={0.01} value={rig.environment} onChange={(x) => update((r) => (r.environment = x))} />
      <ColorIntensity
        label="Ambient"
        color={rig.ambient.color}
        intensity={rig.ambient.intensity}
        max={5}
        onColor={(c) => update((r) => (r.ambient.color = c))}
        onIntensity={(x) => update((r) => (r.ambient.intensity = x))}
      />
      <div className="flex items-end gap-2">
        <ColorInput value={rig.hemisphere.sky} title="Sky colour" onChange={(c) => update((r) => (r.hemisphere.sky = c))} />
        <ColorInput value={rig.hemisphere.ground} title="Ground colour" onChange={(c) => update((r) => (r.hemisphere.ground = c))} />
        <Slider
          className="flex-1"
          label="Sky / ground fill"
          min={0}
          max={5}
          step={0.05}
          value={rig.hemisphere.intensity}
          onChange={(x) => update((r) => (r.hemisphere.intensity = x))}
        />
      </div>

      <LightCard
        title="Key light"
        subtitle="sun / moon"
        extra={
          <CheckField id="key-shadows" checked={rig.key.shadows} onChange={(x) => update((r) => (r.key.shadows = x))}>
            shadows
          </CheckField>
        }
      >
        <ColorIntensity
          label="Intensity"
          color={rig.key.color}
          intensity={rig.key.intensity}
          max={10}
          onColor={(c) => update((r) => (r.key.color = c))}
          onIntensity={(x) => update((r) => (r.key.intensity = x))}
        />
        <Slider label="Direction" unit="°" min={0} max={359} step={1} value={rig.key.azimuth} onChange={(x) => update((r) => (r.key.azimuth = x))} />
        <Slider label="Height" unit="°" min={0} max={90} step={1} value={rig.key.elevation} onChange={(x) => update((r) => (r.key.elevation = x))} />
      </LightCard>

      {rig.accents.map((a, i) => (
        <LightCard
          key={i}
          title={`Accent ${i + 1}`}
          subtitle="point light"
          extra={
            <Button variant="ghost" size="icon-xs" title="Remove this light" aria-label={`Remove accent ${i + 1}`} onClick={() => update((r) => r.accents.splice(i, 1))}>
              <X />
            </Button>
          }
        >
          <ColorIntensity
            label="Intensity"
            color={a.color}
            intensity={a.intensity}
            max={40}
            step={0.5}
            onColor={(c) => update((r) => (r.accents[i].color = c))}
            onIntensity={(x) => update((r) => (r.accents[i].intensity = x))}
          />
          <Slider label="Direction" unit="°" min={0} max={359} step={1} value={a.azimuth} onChange={(x) => update((r) => (r.accents[i].azimuth = x))} />
          <Slider label="Height" unit="°" min={-30} max={90} step={1} value={a.elevation} onChange={(x) => update((r) => (r.accents[i].elevation = x))} />
          <Slider
            label="Distance (× asset size)"
            min={0.5}
            max={6}
            step={0.1}
            value={a.distance}
            onChange={(x) => update((r) => (r.accents[i].distance = x))}
          />
        </LightCard>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={rig.accents.length >= MAX_ACCENTS}
          onClick={() =>
            update((r) => r.accents.push({ color: '#ff2bd6', intensity: 6, azimuth: (r.accents.length * 120) % 360, elevation: 20, distance: 2 }))
          }
        >
          <Plus /> Accent light
        </Button>
        <CheckField id="tone-mapping" checked={rig.toneMapping} onChange={(x) => update((r) => (r.toneMapping = x))}>
          tone mapping
        </CheckField>
      </div>
      <p className="text-xs text-muted-foreground">
        Direction 0° is the front (facing the default camera), 90° the right. Accent lights at negative height light from below, like street neon.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={saving || source === 'project'}
          title="Write this preset to review.config.json so it's the default for everyone using this folder"
          onClick={async () => {
            setSaving(true);
            try {
              await props.onSaveProject(preset, rig);
              dropBrowserEdits();
            } finally {
              setSaving(false);
            }
          }}
        >
          <Save /> {saving ? 'Saving…' : 'Save to project'}
        </Button>
        {source === 'browser' && (builtin || hasProject) && (
          <Button size="sm" variant="outline" onClick={dropBrowserEdits} title="Drop this browser's edits">
            <RotateCcw /> Revert to {hasProject ? 'project' : 'built-in'}
          </Button>
        )}
        {builtin && source !== 'browser' && hasProject && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => props.onViewer({ lightRigs: { ...props.settings.lightRigs, [preset]: cloneRig(BUILTIN_RIGS[preset]) } })}
            title="Load the built-in values to edit (Save to project to make them the default again)"
          >
            Start from built-in
          </Button>
        )}
      </div>

      {newName === null ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setNewName('')} title="Create a new preset starting from the current lighting">
            <Plus /> New preset
          </Button>
          {!builtin && (
            <Button size="sm" variant="destructive" onClick={deletePreset} title="Delete this custom preset">
              <Trash2 /> Delete preset
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border p-2">
          <Input
            autoFocus
            className="h-8"
            placeholder="Preset name, e.g. rainy alley"
            value={newName}
            aria-invalid={newName.trim() !== '' && !!nameError}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createPreset();
              if (e.key === 'Escape') setNewName(null);
            }}
          />
          {newName.trim() !== '' && nameError && <p className="text-xs text-destructive">{nameError}</p>}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!!nameError} onClick={createPreset}>
              Create
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNewName(null)}>
              Cancel
            </Button>
            <span className="text-xs text-muted-foreground">Starts as a copy of {builtin ? BUILTIN_LABELS[preset] : preset}.</span>
          </div>
        </div>
      )}
    </Section>
  );
}

function LightCard(props: { title: string; subtitle: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border bg-muted/40 p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{props.title}</span>
        <span className="text-xs text-muted-foreground">{props.subtitle}</span>
        <span className="flex-1" />
        {props.extra}
      </div>
      {props.children}
    </div>
  );
}
