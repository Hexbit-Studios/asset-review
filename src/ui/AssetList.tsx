import { useEffect, useMemo, useRef } from 'react';
import { Box, Image, Layers, MessageSquare, Search } from 'lucide-react';
import type { AssetEntry, AssetSettings, AssetStatus, Note } from '../../shared/types.ts';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Toggle } from '@/components/ui/toggle';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AppSelect } from './controls.tsx';

export interface AssetFilter {
  text: string;
  kind: 'all' | 'models' | 'sprites';
  onlyOpenNotes: boolean;
  status?: AssetStatus;
}

const KIND_ICON = {
  model: <Box className="size-3.5 text-info" />,
  image: <Image className="size-3.5 text-violet-500 dark:text-violet-300" />,
  aseprite: <Layers className="size-3.5 text-warning" />,
};

const STATUS_DOT: Record<AssetStatus, string> = {
  unreviewed: 'bg-muted-foreground/30',
  'needs-work': 'bg-warning',
  approved: 'bg-success',
};

export function AssetList(props: {
  title: string;
  root: string;
  assets: AssetEntry[];
  total: number;
  notes: Note[];
  settings: Record<string, AssetSettings>;
  selected: string | null;
  filter: AssetFilter;
  onFilter: (f: AssetFilter) => void;
  onSelect: (path: string) => void;
}) {
  const { assets, notes, settings, selected, filter, onFilter } = props;
  const listRef = useRef<HTMLDivElement>(null);

  const openCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) if (n.status === 'open') m.set(n.asset, (m.get(n.asset) ?? 0) + 1);
    return m;
  }, [notes]);

  const groups = useMemo(() => {
    const g = new Map<string, AssetEntry[]>();
    for (const a of assets) {
      const dir = a.path.includes('/') ? a.path.slice(0, a.path.lastIndexOf('/')) : '';
      if (!g.has(dir)) g.set(dir, []);
      g.get(dir)!.push(a);
    }
    return [...g];
  }, [assets]);

  useEffect(() => {
    listRef.current?.querySelector('[data-selected=true]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <nav className="flex h-full min-h-0 flex-col bg-card">
      <header className="flex flex-col gap-2 border-b p-3">
        <div className="truncate font-semibold" title={props.root}>
          {props.title}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-7"
            placeholder="Filter assets…"
            value={filter.text}
            onChange={(e) => onFilter({ ...filter, text: e.target.value })}
            onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLInputElement).blur()}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={filter.kind}
            onValueChange={(v) => v && onFilter({ ...filter, kind: v as AssetFilter['kind'] })}
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="models">3D</ToggleGroupItem>
            <ToggleGroupItem value="sprites">2D</ToggleGroupItem>
          </ToggleGroup>
          <Toggle
            variant="outline"
            size="sm"
            pressed={filter.onlyOpenNotes}
            onPressedChange={(v) => onFilter({ ...filter, onlyOpenNotes: v })}
            title="Only assets with open notes"
          >
            <MessageSquare /> Open
          </Toggle>
          <AppSelect
            title="Review status"
            value={filter.status ?? 'any'}
            onChange={(v) => onFilter({ ...filter, status: v === 'any' ? undefined : (v as AssetStatus) })}
            options={[
              { value: 'any', label: 'Any status' },
              { value: 'unreviewed', label: 'Unreviewed' },
              { value: 'needs-work', label: 'Needs work' },
              { value: 'approved', label: 'Approved' },
            ]}
          />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto py-1" ref={listRef}>
        {groups.map(([dir, items]) => (
          <div key={dir}>
            {dir && <div className="px-3 pt-2.5 pb-1 font-mono text-xs text-muted-foreground">{dir}/</div>}
            {items.map((a) => {
              const status = settings[a.path]?.status ?? 'unreviewed';
              const open = openCount.get(a.path) ?? 0;
              const on = a.path === selected;
              return (
                <button
                  key={a.path}
                  data-selected={on}
                  className={cn(
                    'flex w-full items-center gap-2 border-l-2 border-transparent py-1 pr-3 pl-4 text-left text-sm hover:bg-muted',
                    on && 'border-primary bg-accent text-accent-foreground hover:bg-accent',
                  )}
                  onClick={() => props.onSelect(a.path)}
                  title={a.path}
                >
                  {KIND_ICON[a.kind]}
                  <span className="min-w-0 flex-1 truncate">{a.path.split('/').pop()}</span>
                  {open > 0 && <Badge className="h-4 min-w-4 px-1 text-[0.7rem]">{open}</Badge>}
                  <span className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[status])} title={status} />
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <footer className="border-t px-3 py-1.5 text-xs text-muted-foreground">
        {assets.length} / {props.total} assets
      </footer>
    </nav>
  );
}
