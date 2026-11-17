import { useCallback, useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import type { NoteInfo, NoteMarker } from '../../shared/types.ts';
import { drawMarkers } from './capture.ts';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

export interface ComposerState {
  asset: string;
  clean: HTMLCanvasElement;
  markers: NoteMarker[];
  view: Record<string, unknown>;
  caption: string[];
  /** Set when the note is about an inspector info item. */
  info?: NoteInfo;
}

/**
 * Dialog shown after pressing N. The screenshot is already taken (frozen at keypress) with a
 * marker where the cursor was. Click the image to add markers, right-click a marker to remove it.
 */
export function NoteComposer(props: {
  state: ComposerState;
  onCancel: () => void;
  onSave: (state: ComposerState, text: string) => Promise<void>;
  onChange: (state: ComposerState) => void;
}) {
  const { state } = props;
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canvasEl = useRef<HTMLCanvasElement | null>(null);

  const draw = useCallback(() => {
    const c = canvasEl.current;
    if (!c) return;
    const marked = drawMarkers(state.clean, state.markers);
    c.width = marked.width;
    c.height = marked.height;
    c.getContext('2d')!.drawImage(marked, 0, 0);
  }, [state.clean, state.markers]);
  useEffect(draw, [draw]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setErr(null);
    try {
      await props.onSave(state, text.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const pos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onCancel()}>
      <DialogContent className="flex max-h-[94vh] w-[min(72rem,94vw)] max-w-none! flex-col gap-3 overflow-y-auto sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            New note <span className="font-mono text-xs font-normal text-muted-foreground">{state.asset}</span>
            {state.info && (
              <Badge variant="outline" className="border-info text-info" title="This note is about an inspector info item">
                <Info /> {state.info.key}: <b>{state.info.value}</b>
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {state.markers.length} marker(s). Click the image to add more, right-click to remove one.
          </DialogDescription>
        </DialogHeader>
        <canvas
          ref={(c) => {
            canvasEl.current = c;
            draw();
          }}
          className="composer-shot cursor-crosshair rounded-md"
          title="Click to add a marker · right-click to remove the nearest"
          onClick={(e) => props.onChange({ ...state, markers: [...state.markers, pos(e)] })}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!state.markers.length) return;
            const p = pos(e);
            let best = 0;
            state.markers.forEach((m, i) => {
              if (Math.hypot(m.x - p.x, m.y - p.y) < Math.hypot(state.markers[best].x - p.x, state.markers[best].y - p.y)) best = i;
            });
            props.onChange({ ...state, markers: state.markers.filter((_, i) => i !== best) });
          }}
        />
        <Textarea
          autoFocus
          rows={4}
          placeholder={
            state.info
              ? `What's wrong with ${state.info.key}? e.g. "should be under 800", "too low for a hero prop" (Enter to save)`
              : 'What should change? (Enter to save · Shift+Enter for newline · Esc to cancel)'
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              save();
            }
          }}
        />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">{state.caption.join(' · ')}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={props.onCancel}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Save note'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
