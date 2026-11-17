import { useEffect, useState } from 'react';
import { Crosshair, Info, Send, Trash2 } from 'lucide-react';
import type { AssetEntry, Note, NoteStatus } from '../../shared/types.ts';
import { api, fileUrl } from '../api.ts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';

export function NotesPanel(props: {
  notes: Note[];
  assets: AssetEntry[];
  asset: string | null;
  author: string;
  focused: string | null;
  onRestore: (n: Note) => void;
  onOpenImage: (src: string) => void;
  onChanged: (n: Note) => void;
  onDeleted: (id: string) => void;
}) {
  const [scope, setScope] = useState<'asset' | 'all'>('asset');
  const [show, setShow] = useState<'active' | 'all'>('active');
  const mtimes = new Map(props.assets.map((a) => [a.path, a.mtime]));

  // Bring the focused note (e.g. clicked from an inspector badge) into view.
  useEffect(() => {
    if (props.focused) document.querySelector('[data-focused=true]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [props.focused]);

  let list = props.notes;
  if (scope === 'asset') list = list.filter((n) => n.asset === props.asset);
  if (show === 'active') list = list.filter((n) => n.status === 'open' || n.status === 'addressed');
  list = [...list].reverse();

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-card p-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={scope} onValueChange={(v) => v && setScope(v as typeof scope)}>
          <ToggleGroupItem value="asset">This asset</ToggleGroupItem>
          <ToggleGroupItem value="all">All assets</ToggleGroupItem>
        </ToggleGroup>
        <span className="flex-1" />
        <ToggleGroup type="single" variant="outline" size="sm" value={show} onValueChange={(v) => v && setShow(v as typeof show)}>
          <ToggleGroupItem value="active">Active</ToggleGroupItem>
          <ToggleGroupItem value="all">All</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {!list.length && (
        <p className="p-4 text-sm text-muted-foreground">
          No notes. Hover the viewport where something is off and press <Kbd>N</Kbd>, or use the pencil on an Info row.
        </p>
      )}
      <div className="flex flex-col gap-2.5 p-2.5">
        {list.map((n) => (
          <NoteCard
            key={n.id}
            note={n}
            author={props.author}
            showAsset={scope === 'all'}
            assetChanged={(mtimes.get(n.asset) ?? 0) > n.assetMtime + 1}
            focused={props.focused === n.id}
            onRestore={() => props.onRestore(n)}
            onOpenImage={props.onOpenImage}
            onChanged={props.onChanged}
            onDeleted={props.onDeleted}
          />
        ))}
      </div>
    </div>
  );
}

const NEXT_ACTIONS: Record<NoteStatus, [NoteStatus, string][]> = {
  open: [
    ['resolved', 'Resolve'],
    ['wontfix', "Won't fix"],
  ],
  addressed: [
    ['resolved', 'Looks good, resolve'],
    ['open', 'Still wrong, reopen'],
  ],
  resolved: [['open', 'Reopen']],
  wontfix: [['open', 'Reopen']],
};

const STATUS_BADGE: Record<NoteStatus, string> = {
  open: 'border-primary text-primary',
  addressed: 'border-info text-info',
  resolved: 'border-success text-success',
  wontfix: 'text-muted-foreground',
};

function NoteCard(props: {
  note: Note;
  author: string;
  showAsset: boolean;
  assetChanged: boolean;
  focused: boolean;
  onRestore: () => void;
  onOpenImage: (src: string) => void;
  onChanged: (n: Note) => void;
  onDeleted: (id: string) => void;
}) {
  const { note } = props;
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<Note>) => {
    setBusy(true);
    try {
      props.onChanged(await fn());
    } finally {
      setBusy(false);
    }
  };
  const sendReply = () => {
    if (!reply.trim()) return;
    act(() => api.updateNote(note.id, { reply: { text: reply.trim(), author: props.author } })).then(() => setReply(''));
  };

  return (
    <div
      data-focused={props.focused}
      className={cn(
        'flex flex-col gap-2 rounded-xl border bg-background p-2.5 text-sm',
        props.focused && 'border-primary ring-2 ring-primary/30',
        (note.status === 'resolved' || note.status === 'wontfix') && 'opacity-60',
      )}
    >
      {note.screenshot && (
        <img
          src={fileUrl(note.screenshot)}
          alt="Note screenshot"
          draggable={false}
          className="w-full cursor-zoom-in rounded-md"
          onClick={() => props.onOpenImage(fileUrl(note.screenshot!))}
          title="Open full size"
        />
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className={cn('uppercase', STATUS_BADGE[note.status])}>
          {note.status}
        </Badge>
        {props.assetChanged && (
          <Badge variant="outline" className="border-warning text-warning" title="The asset file changed after this note was written">
            updated since
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {note.author} · {new Date(note.createdAt).toLocaleString()}
        </span>
      </div>
      {props.showAsset && <div className="font-mono text-xs text-muted-foreground">{note.asset}</div>}
      {note.info && (
        <Badge variant="outline" className="h-auto self-start border-info whitespace-normal text-info" title="About this inspector info item (value when the note was written)">
          <Info /> {note.info.key}: <b>{note.info.value}</b>
        </Badge>
      )}
      <div className="whitespace-pre-wrap">{note.text || <i className="text-muted-foreground">(no text)</i>}</div>
      {note.replies.map((r, i) => (
        <div key={i} className={cn('border-l-2 py-0.5 pl-2 whitespace-pre-wrap', r.author === props.author ? 'border-primary' : 'border-info')}>
          <span className="font-medium">{r.author}</span> <span className="text-xs text-muted-foreground">{new Date(r.at).toLocaleString()}</span>
          <div>{r.text}</div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="xs" variant="outline" onClick={props.onRestore} title="Restore the camera, frame and settings from this note">
          <Crosshair /> Go to view
        </Button>
        {NEXT_ACTIONS[note.status].map(([s, label]) => (
          <Button key={s} size="xs" variant="outline" disabled={busy} onClick={() => act(() => api.updateNote(note.id, { status: s }))}>
            {label}
          </Button>
        ))}
        <span className="flex-1" />
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={busy}
          title="Delete"
          aria-label="Delete note"
          onClick={async () => {
            if (!confirm('Delete this note and its screenshots?')) return;
            await api.deleteNote(note.id);
            props.onDeleted(note.id);
          }}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="flex items-end gap-1.5">
        <Textarea
          rows={1}
          className="min-h-8 py-1.5"
          placeholder="Reply… (⌘/Ctrl+Enter to send)"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply();
          }}
        />
        {reply.trim() && (
          <Button size="icon-sm" disabled={busy} onClick={sendReply} title="Send reply" aria-label="Send reply">
            <Send />
          </Button>
        )}
      </div>
    </div>
  );
}
