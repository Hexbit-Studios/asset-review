// Shared form building blocks on top of shadcn/ui.

import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Slider as UISlider } from '@/components/ui/slider';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/** Labelled slider with the current value. */
export function Slider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  className?: string;
}) {
  return (
    <label className={cn('flex flex-col gap-1.5 text-xs text-muted-foreground', props.className)}>
      <span className="flex justify-between">
        <span>{props.label}</span>
        <span className="font-medium text-foreground tabular-nums">
          {props.value}
          {props.unit ?? ''}
        </span>
      </span>
      <UISlider
        min={props.min}
        max={props.max}
        step={props.step}
        value={[props.value]}
        onValueChange={([v]) => props.onChange(v)}
        aria-label={props.label}
      />
    </label>
  );
}

/** Native colour picker styled to sit next to shadcn inputs. */
export function ColorInput(props: { value: string; onChange: (c: string) => void; title: string }) {
  return (
    <input
      type="color"
      value={props.value}
      title={props.title}
      aria-label={props.title}
      onChange={(e) => props.onChange(e.target.value)}
      className="h-7 w-8 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
    />
  );
}

/** Colour swatch + intensity slider on one row. */
export function ColorIntensity(props: {
  label: string;
  color: string;
  intensity: number;
  max: number;
  step?: number;
  onColor: (c: string) => void;
  onIntensity: (v: number) => void;
}) {
  return (
    <div className="flex items-end gap-2">
      <ColorInput value={props.color} onChange={props.onColor} title={`${props.label} colour`} />
      <Slider
        className="flex-1"
        label={props.label}
        min={0}
        max={props.max}
        step={props.step ?? 0.05}
        value={props.intensity}
        onChange={props.onIntensity}
      />
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: ReactNode;
  group?: string;
}

/**
 * shadcn Select that hands keyboard focus back to the page after a choice, so Space / arrows
 * drive the viewer again instead of reopening the menu.
 */
export function AppSelect(props: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  title?: string;
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'default';
}) {
  const groups = new Map<string, SelectOption[]>();
  for (const o of props.options) {
    const g = o.group ?? '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(o);
  }
  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger size={props.size ?? 'sm'} title={props.title} aria-label={props.title} className={props.className}>
        <SelectValue placeholder={props.placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" onCloseAutoFocus={(e) => e.preventDefault()}>
        {[...groups].map(([g, opts]) => (
          <SelectGroup key={g || '_'}>
            {g && <SelectLabel>{g}</SelectLabel>}
            {opts.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

const SECTION_KEY = 'asset-review:sections';
function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SECTION_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** Collapsible inspector section; open / closed is remembered per section id. */
export function Section(props: { id: string; title: ReactNode; extra?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(() => readOpen()[props.id] ?? props.defaultOpen ?? true);
  const onOpenChange = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(SECTION_KEY, JSON.stringify({ ...readOpen(), [props.id]: v }));
    } catch {
      /* not persisted */
    }
  };
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="border-b">
      <div className="flex items-center gap-2 px-3 py-2">
        <CollapsibleTrigger className="group flex flex-1 items-center gap-1.5 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground">
          <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
          {props.title}
        </CollapsibleTrigger>
        {props.extra}
      </div>
      <CollapsibleContent className="flex flex-col gap-3 px-3 pb-3">{props.children}</CollapsibleContent>
    </Collapsible>
  );
}
