import type { ReactNode, RefObject } from 'react';
import { Pause, Play, SkipBack, SkipForward, StepBack, StepForward } from 'lucide-react';
import type { PlaybackState } from '../viewer/playback.ts';
import type { Viewer } from '../viewer/Viewer.ts';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { AppSelect } from './controls.tsx';

const SPEEDS = [0.1, 0.25, 0.5, 1, 1.5, 2];

export function Timeline({ playback: st, viewer }: { playback: PlaybackState | null; viewer: RefObject<Viewer | null> }) {
  const pb = () => viewer.current?.content?.playback;
  if (!st || st.clips.length === 0)
    return <div className="flex h-11 items-center border-t bg-card px-3 text-sm text-muted-foreground">No animation</div>;

  const label =
    st.unit === 'frames'
      ? `${(st.frameInClip ?? 0) + 1} / ${st.frameCount}  (#${st.frame})`
      : st.unit === 'degrees'
        ? `${st.time.toFixed(0)}°`
        : `f${Math.round(st.time * (st.fps ?? 30))} / ${Math.round(st.duration * (st.fps ?? 30))} · ${st.time.toFixed(2)}s @${st.fps ?? 30}fps`;

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-2 border-t bg-card px-2 py-1.5">
      {st.clips.length > 1 ? (
        <AppSelect
          title="Clip ([ / ])"
          value={String(st.clip)}
          onChange={(v) => pb()?.setClip(Number(v))}
          options={st.clips.map((c, i) => ({ value: String(i), label: c.name }))}
        />
      ) : (
        <span className="px-1 text-sm text-muted-foreground">{st.clips[0].name}</span>
      )}

      <div className="flex items-center gap-0.5">
        {st.unit !== 'degrees' && (
          <Transport label="First frame (Shift+← or Home)" onClick={() => pb()?.goToStart()}>
            <SkipBack />
          </Transport>
        )}
        <Transport label="Previous frame (← or ,)" onClick={() => pb()?.step(-1)}>
          <StepBack />
        </Transport>
        <Button size="icon-sm" onClick={() => pb()?.toggle()} title="Play / pause (Space)" aria-label={st.playing ? 'Pause' : 'Play'} className="play">
          {st.playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
        </Button>
        <Transport label="Next frame (→ or .)" onClick={() => pb()?.step(1)}>
          <StepForward />
        </Transport>
        {st.unit !== 'degrees' && (
          <Transport label="Last frame (Shift+→ or End)" onClick={() => pb()?.goToEnd()}>
            <SkipForward />
          </Transport>
        )}
      </div>

      {st.unit === 'frames' && st.frameCount ? (
        <div className="flex min-w-24 flex-1 gap-0.5" role="group" aria-label="Frames">
          {Array.from({ length: st.frameCount }, (_, i) => (
            <button
              key={i}
              className={cn(
                'h-5 min-w-1 flex-1 rounded-sm border border-input bg-muted transition-colors hover:bg-accent',
                i === st.frameInClip && 'border-primary bg-primary hover:bg-primary',
              )}
              onClick={() => {
                const p = pb();
                p?.pause();
                p?.seekFrame?.(i);
              }}
              title={`Frame ${i + 1}`}
              aria-label={`Frame ${i + 1}`}
            />
          ))}
        </div>
      ) : (
        <Slider
          className="min-w-24 flex-1"
          min={0}
          max={st.duration || 1}
          step={st.unit === 'degrees' ? 1 : 1 / 120}
          value={[st.time]}
          aria-label="Scrub"
          onValueChange={([v]) => {
            pb()?.pause();
            pb()?.seek(v);
          }}
        />
      )}

      <span className="min-w-36 text-right font-mono text-xs text-muted-foreground tabular-nums">{label}</span>
      <AppSelect
        title="Speed"
        value={String(st.speed)}
        onChange={(v) => pb()?.setSpeed(Number(v))}
        options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))}
      />
      {st.rootTravel !== undefined && (st.rootTravel > 0.05 || st.inPlace) && (
        <CheckField
          id="tl-inplace"
          checked={!!st.inPlace}
          onChange={(v) => pb()?.setInPlace?.(v)}
          title={`Root moves ${st.rootTravel.toFixed(2)} m in this clip. Lock it to play on the spot (R).`}
        >
          in place
        </CheckField>
      )}
      {st.unit !== 'degrees' && (
        <CheckField id="tl-loop" checked={st.loop} onChange={(v) => pb()?.setLoop(v)} title="Loop">
          loop
        </CheckField>
      )}
    </div>
  );
}

function Transport(props: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="ghost" size="icon-sm" onClick={props.onClick} title={props.label} aria-label={props.label.replace(/ \(.*\)$/, '')}>
      {props.children}
    </Button>
  );
}

export function CheckField(props: { id: string; checked: boolean; onChange: (v: boolean) => void; title?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5" title={props.title}>
      <Checkbox id={props.id} checked={props.checked} onCheckedChange={(v) => props.onChange(v === true)} />
      <Label htmlFor={props.id} className="text-sm font-normal text-muted-foreground">
        {props.children}
      </Label>
    </div>
  );
}
