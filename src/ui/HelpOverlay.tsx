import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';

const KEYS: [string, string][] = [
  ['N', 'New note: screenshot now, marker at the cursor'],
  ['P', 'Screenshot to .review/shots and copy to clipboard'],
  ['↑ ↓  /  J K', 'Previous / next asset'],
  ['Space', 'Play / pause (assets open paused on frame 1; stacks: turntable)'],
  ['← →  /  , .', 'Step frame (stacks: 22.5°)'],
  ['Shift+← →  /  Home End', 'First / last frame'],
  ['[  ]', 'Previous / next animation clip'],
  ['R', 'Root motion: play the clip in place / with travel'],
  ['A  /  W', 'Mark asset approved / needs work'],
  ['F', 'Frame the asset'],
  ['1–7', 'Front, back, left, right, top, iso, game camera'],
  ['O', 'Orthographic camera (models)'],
  ['C', 'Orbit the camera around the model (drag to look around; speed in the inspector)'],
  ['L / Shift+L', 'Cycle lighting presets: studio, day, night, neon night, flat, then your own'],
  ['B / Shift+B', 'Cycle background (remembered separately for 3D models and 2D art)'],
  ['M / Shift+M', 'Cycle display: shaded, albedo, wireframe, UV checker, normals'],
  ['G  H  X', 'Grid · 1.75 m human · skeleton'],
  ['E', 'Bloom on / off (strength, threshold, radius in the inspector)'],
  ['U  S', 'Onion skin · whole sheet with frame grid'],
  ['Wheel  + −', 'Sprite zoom in whole-pixel steps'],
  ['T', 'Interface theme: auto (follows OS), light, dark'],
  ['?', 'This help'],
];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Shortcuts</DialogTitle>
          <DialogDescription>
            Drop files or folders anywhere to copy them into <code className="font-mono">_inbox/</code>. Notes live in{' '}
            <code className="font-mono">.review/notes</code>, screenshots in <code className="font-mono">.review/shots</code>.
          </DialogDescription>
        </DialogHeader>
        <table className="text-sm">
          <tbody>
            {KEYS.map(([k, d]) => (
              <tr key={k} className="border-b last:border-0">
                <td className="py-1.5 pr-4 align-top whitespace-nowrap">
                  <Kbd>{k}</Kbd>
                </td>
                <td className="py-1.5">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}
