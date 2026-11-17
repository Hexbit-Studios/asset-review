import type { ReactNode } from 'react';
import {
  Bone,
  Camera,
  CircleHelp,
  Grid3x3,
  MessageSquarePlus,
  Monitor,
  Moon,
  Orbit,
  PersonStanding,
  Sparkles,
  Sun,
  SquareDashed,
  Lightbulb,
  Grip,
} from 'lucide-react';
import type { Background, ViewPreset, ViewerSettings } from '../viewer/Viewer.ts';
import type { DisplayMode } from '../viewer/content.ts';
import type { ThemePref } from './theme.ts';
import { BUILTIN_LABELS, isBuiltin } from '../viewer/lighting.ts';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Kbd } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AppSelect } from './controls.tsx';

const PRESETS: [ViewPreset, string][] = [
  ['front', '1 · Front'],
  ['back', '2 · Back'],
  ['left', '3 · Left'],
  ['right', '4 · Right'],
  ['top', '5 · Top'],
  ['iso', '6 · Iso'],
  ['game', '7 · Game'],
];

const THEME_ICON: Record<ThemePref, ReactNode> = {
  system: <Monitor />,
  light: <Sun />,
  dark: <Moon />,
};

export function Toolbar(props: {
  settings: ViewerSettings;
  kind: string | null;
  background: Background;
  onBackground: (bg: Background) => void;
  lightingPresets: string[];
  onChange: (p: Partial<ViewerSettings>) => void;
  onPreset: (p: ViewPreset) => void;
  onFrame: () => void;
  onNote: () => void;
  onScreenshot: () => void;
  onHelp: () => void;
  theme: ThemePref;
  onTheme: () => void;
}) {
  const { settings: s, kind, onChange } = props;
  const isModel = kind === 'model';
  const isPixel = kind === 'sprite' || kind === 'stack';
  const sep = <Separator orientation="vertical" className="mx-0.5 h-5!" />;

  return (
    // View controls wrap on the left; the capture / note / theme / help actions stay pinned top-right.
    <div className="flex items-start gap-1.5 border-b bg-card px-2 py-1.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      <AppSelect
        title="Camera: frame (F) or preset (1-7)"
        value=""
        placeholder="View…"
        onChange={(v) => (v === 'frame' ? props.onFrame() : props.onPreset(v as ViewPreset))}
        options={[
          { value: 'frame', label: 'F · Frame asset' },
          ...(kind !== 'sprite' ? PRESETS.map(([p, label]) => ({ value: p, label })) : []),
        ]}
      />
      {isModel && (
        <>
          <ToolToggle on={s.ortho} onClick={() => onChange({ ortho: !s.ortho })} title="Orthographic (O)" icon={<SquareDashed />}>
            Ortho
          </ToolToggle>
          <ToolToggle
            on={s.orbit}
            onClick={() => onChange({ orbit: !s.orbit })}
            title="Orbit the camera around the model (C). Drag to look around; it resumes when you let go."
            icon={<Orbit />}
          >
            Orbit
          </ToolToggle>
        </>
      )}
      {sep}

      <AppSelect
        title="Lighting (L)"
        value={s.lighting}
        onChange={(v) => onChange({ lighting: v })}
        options={props.lightingPresets.map((p) =>
          isBuiltin(p) ? { value: p, label: BUILTIN_LABELS[p] } : { value: p, label: p, group: 'Custom' },
        )}
      />
      <AppSelect
        title={`Background for ${kind === 'model' || !kind ? '3D models' : '2D art'} (B)`}
        value={props.background}
        onChange={(v) => props.onBackground(v as Background)}
        options={[
          { value: 'checker', label: 'Checker' },
          { value: 'dark', label: 'Dark' },
          { value: 'mid', label: 'Mid grey' },
          { value: 'light', label: 'Light' },
          { value: 'green', label: 'Green' },
          { value: 'magenta', label: 'Magenta' },
        ]}
      />

      {isModel && (
        <>
          {sep}
          <AppSelect
            title="Display (M)"
            value={s.display}
            onChange={(v) => onChange({ display: v as DisplayMode })}
            options={[
              { value: 'shaded', label: 'Shaded' },
              { value: 'albedo', label: 'Albedo' },
              { value: 'wireframe', label: 'Wireframe' },
              { value: 'checker', label: 'UV checker' },
              { value: 'normals', label: 'Normals' },
            ]}
          />
          <AppSelect
            title="Render at low resolution with nearest upscaling"
            value={String(s.pixelate)}
            onChange={(v) => onChange({ pixelate: Number(v) })}
            options={[{ value: '0', label: 'Full res' }, ...[2, 3, 4, 6, 8].map((n) => ({ value: String(n), label: `Pixelate ÷${n}` }))]}
          />
          <ToolToggle on={s.skeleton} onClick={() => onChange({ skeleton: !s.skeleton })} title="Skeleton (X)" icon={<Bone />}>
            Bones
          </ToolToggle>
        </>
      )}

      {isPixel && (
        <>
          {sep}
          <AppSelect
            title="Screen pixels per sprite pixel (wheel, +/-)"
            value={String(s.spriteScale)}
            onChange={(v) => onChange({ spriteScale: Number(v) })}
            options={Array.from(new Set([1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64, s.spriteScale]))
              .sort((a, b) => a - b)
              .map((n) => ({ value: String(n), label: `${n}× zoom` }))}
          />
          <ToolToggle
            on={s.spriteNative}
            onClick={() => onChange({ spriteNative: !s.spriteNative })}
            title="Render at native sprite resolution (pixel-perfect), else smooth at screen resolution"
            icon={<Grip />}
          >
            Native px
          </ToolToggle>
          <ToolToggle
            on={s.litSprites}
            onClick={() => onChange({ litSprites: !s.litSprites })}
            title="Let scene lighting affect sprites"
            icon={<Lightbulb />}
          >
            Lit
          </ToolToggle>
        </>
      )}

      {sep}
      <ToolToggle on={s.bloom} onClick={() => onChange({ bloom: !s.bloom })} title="HDR bloom on emissive / neon (E)" icon={<Sparkles />}>
        Bloom
      </ToolToggle>
      {kind !== 'sprite' && (
        <>
          <ToolToggle on={s.grid} onClick={() => onChange({ grid: !s.grid })} title="Grid (G)" icon={<Grid3x3 />}>
            Grid
          </ToolToggle>
          <ToolToggle on={s.human} onClick={() => onChange({ human: !s.human })} title="1.75 m human for scale (H)" icon={<PersonStanding />}>
            Human
          </ToolToggle>
        </>
      )}

      </div>
      <div className="flex shrink-0 items-center gap-1.5">
      <Button variant="outline" size="sm" onClick={props.onScreenshot} title="Screenshot to .review/shots + clipboard (P)">
        <Camera /> Shot <Kbd>P</Kbd>
      </Button>
      <Button size="sm" onClick={props.onNote} title="New note at cursor (N)">
        <MessageSquarePlus /> Note <Kbd className="bg-primary-foreground/20 text-primary-foreground">N</Kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={props.onTheme}
        title={`Interface theme: ${props.theme === 'system' ? 'auto (follows OS)' : props.theme} · T to cycle`}
        aria-label="Interface theme"
      >
        {THEME_ICON[props.theme]}
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={props.onHelp} title="Shortcuts (?)" aria-label="Shortcuts">
        <CircleHelp />
      </Button>
      </div>
    </div>
  );
}

/** Icon toggle; its name and shortcut show in a tooltip. */
function ToolToggle(props: { on: boolean; onClick: () => void; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle variant="outline" size="sm" pressed={props.on} onPressedChange={props.onClick} aria-label={String(props.children)}>
          {props.icon}
        </Toggle>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64">
        <p>
          <span className="font-medium">{props.children}</span> · {props.title}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
