# asset-review

A project-agnostic viewer for reviewing game art: 3D meshes, sprites, sprite sheets, sprite stacks and Aseprite files. You can leave screenshot notes on anything you're looking at. Notes are plain files in the reviewed folder, so an artist, a contractor or a coding agent can read them, act on them and reply.

![A skinned character mid-walk under the Neon night lighting preset, with the asset list on the left and the inspector showing model stats and the lighting editor on the right](docs/screenshots/overview.png)

## Quick start

Needs [Node.js](https://nodejs.org) 20.19 or newer. From the folder you want to review (a game project, an asset folder, a delivery from an artist):

```bash
npx @hexbit/asset-review            # opens http://localhost:5199
```

Or install the `asset-review` command once:

```bash
npm install -g @hexbit/asset-review
asset-review                        # review the current folder
asset-review path/to/assets         # or any folder
asset-review init                   # optional: .gitignore entry + review.config.json
```

`.blend` files need [Blender](https://www.blender.org) installed (set `BLENDER_PATH` if it isn't found). Everything else works with Node alone.

## Working as a team

Reviews are plain files in `.review/` inside the reviewed folder, so they travel with the project:

1. **Reviewer** opens the project with `asset-review`, leaves notes, commits `.review/` and pushes.
2. **Artist or developer** pulls, opens `asset-review`, fixes the asset and replies on the note (in the app, or `asset-review reply` from a terminal), marks it *addressed*, commits and pushes.
3. **Reviewer** pulls and sees the reply and the updated asset (notes written before the change are tagged *updated since*), then resolves or reopens.

Each note is its own file, so concurrent notes rarely conflict. Screenshots are PNGs; on long projects consider Git LFS (`git lfs track ".review/shots/*.png"`).

**Without git:** point `asset-review` at a shared Dropbox, Google Drive or OneDrive folder. The sync app carries assets and notes between people, and the viewer picks up changes live.

## What it loads

| Kind | Files | Notes |
|---|---|---|
| Models | `.glb` `.gltf` `.fbx` `.obj` (+`.mtl`) `.vox` `.blend` | `.blend` is converted to glb with your local Blender (modifiers applied) and cached in `.review/cache`. Set `BLENDER_PATH` if Blender isn't found. FBX in centimetres is scaled down automatically. |
| Aseprite | `.aseprite` `.ase` | Read natively. Tags become animations (forward / reverse / ping-pong), per-frame durations are kept, and layers (including groups) can be switched on and off. Blend modes map to canvas modes. |
| Sheets | `.png` + same-name `.json` | Aseprite `--data` export (hash or array), TexturePacker / PixiJS JSON (trimmed and rotated frames). |
| Strips / grids | any image | Set the layout to **grid** (columns, rows, frame count, fps) in the inspector. Strips of square frames are detected and flagged for you. |
| Animated images | `.gif` `.webp` | Decoded frame by frame (Chromium). |
| Sprite stacks | `name.stack15.png`, or a sidecar `name.json` containing `{"stack":{"slices":15}}`, or layout **stack** | One row of slices, ground slice on the left, as in SpriteCook's [sprite stacking guide](https://www.spritecook.ai/blog/sprite-stacking-pixel-art). Each slice is drawn as a real horizontal plane, so you can orbit, change the pitch (which acts like the squash factor) and change slice spacing. **Native px** renders at sprite resolution for the true pixel look. Aseprite files can also be stacks (each frame is one slice). |
| Direction sheets | `name.dir16.png` or layout **dir sheet** | 8, 16 or 32 directions in rows of 8. |

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/sprite-stack.png" alt="A pixel-art hover car drawn as a 15-slice sprite stack, turned to 68 degrees on the turntable"></td>
    <td width="50%"><img src="docs/screenshots/aseprite.png" alt="An Aseprite file playing its blink tag, with its layers and groups listed in the inspector (light theme)"></td>
  </tr>
  <tr>
    <td>Sprite stacks render as real stacked slices: orbit them, change the pitch and slice spacing, and view them at native pixel resolution.</td>
    <td>Aseprite files open directly: tags become clips, and layers and groups can be switched on and off.</td>
  </tr>
</table>

## Model animation

- Every clip in a glb/gltf/fbx/.blend is listed in the timeline: skeletal (skinned), morph-target and object animation. You can play, pause, scrub, step frame by frame (← →), change speed, and toggle looping. **X** shows the skeleton.
- glTF stores no frame rate, so it's detected from the key times (Blender exports a key on every frame). Steps and frame numbers use that rate, for example `f13 / 25 @24fps`.
- **In place** (or **R**) removes the root's horizontal travel so walk and run cycles play on the spot. The vertical bob is kept. It only appears when a clip actually moves its root, and it works through rotated or scaled armatures (Mixamo FBX, Blender).
- Blender: each action must be pushed to an NLA track or have a fake user, or only the active action gets exported. `scripts/blender/android.py` shows the pattern.

## Lighting

Presets: **studio**, **day**, **night** (neutral moonlight with a cool rim, suits most games), **neon night** (magenta and cyan street neon) and **flat** (**L** cycles them). Each one is editable in the inspector:
- exposure and reflections
- ambient and sky/ground fill colours
- a key light (sun or moon) with direction, height and shadows
- up to six accent point lights, whose height can go negative to light from below like street neon.

**+ New preset** adds your own (for example "rainy alley" or "club interior"), starting as a copy of the active lighting. Custom presets appear in the lighting dropdown and the **L** cycle, and can be deleted; built-ins can only be edited or reverted.

Edits apply live and are kept in your browser; the section header says **edited**. **Save to project** writes the preset to `review.config.json` under `lighting`, which makes it the default for anyone reviewing that folder. Editing that file by hand also applies live. Each note records the exact lighting values in use when it was written (`view.lightRig`).

## Bloom

HDR bloom is on by default (**E** toggles it; strength, threshold and radius are in the inspector). Only pixels brighter than the threshold glow, so emissive materials with Blender Emission Strength above 1 bloom and ordinary lit surfaces don't. Unlit sprites never exceed 1.0, so lower the threshold to make sprite neon glow. Screenshots and notes capture the bloom.

## Reviewing

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/note-composer.png" alt="The new-note dialog with a screenshot of a turret and a marker on its glowing visor"></td>
    <td width="50%"><img src="docs/screenshots/notes.png" alt="A note thread on the turret: the reviewer's note marked addressed, a reply explaining the fix, and the note's marker shown in the viewport"></td>
  </tr>
  <tr>
    <td>Press <b>N</b> over the problem: the screenshot and marker are captured instantly.</td>
    <td>Replies (here from an agent via the CLI) appear live; <b>Go to view</b> restores the exact camera and frame.</td>
  </tr>
</table>

- **N**: new note. The viewport is captured the moment you press it, with a marker where your cursor was. Click the image to add more markers, type, then press Enter. Saving marks the asset *needs work*.
- **P**: screenshot to `.review/shots/` and the clipboard.
- **A / W**: mark the asset approved / needs work. **↑↓** or **J K** move between assets.
- **Orbit** (or **C**) circles the camera around a 3D model. Speed (seconds per turn) and direction are in the inspector. Dragging takes over and the orbit resumes when you let go. Restoring a note's view always stops orbiting.
- **Notes on info items:** hover any row in the inspector's Info box (triangles, size, texel density per mesh, textures, warnings…) and click **✎** to write a note about that item. The note records the item and its value at the time (CLI: `- about: Texel density: barrel_0 = 320.8 px/m`). Rows with active notes show a badge; click it to jump to the note.
- **Go to view** on a note restores the exact camera, frame, lighting and settings from when it was written.
- When an asset changes on disk it reloads in place and keeps your camera. Notes written before the change are tagged **updated since**. The check compares file contents, so re-saving or re-exporting an identical file doesn't trigger it.
- If an asset is moved or deleted, its notes stay: they're tagged **asset missing** and listed under *missing assets* at the bottom of the asset list.
- Drag files or folders onto the window to copy them into `_inbox/` (handy for contractor deliveries).
- The interface follows your OS light/dark setting. **T** (or the toolbar button) cycles Auto → Light → Dark, remembered per browser. The viewport background is a separate review setting (**B**), so screenshots look the same in either theme. It defaults to Mid grey for 3D models and Checker for 2D art, and each remembers its own choice.
- Press **?** for every shortcut: playback, view presets, lighting (studio / day / night / neon night / flat, plus your own), display modes (albedo, wireframe, UV checker, normals), pixelate, onion skin, whole sheet with frame grid, 1.75 m human for scale.

The model inspector shows size in metres, triangle/vertex/material counts, bones, textures, and **texel density** (px/m, area weighted, overall and per mesh). Set `texelDensity` in the config to flag meshes that are more than about 1.4× off target.

## Files it writes (in the reviewed folder)

```
.review/
  notes/<id>.json        one note per file: text, markers, view state, status, replies
  shots/<id>.png         marked screenshot with a caption strip (asset, frame, settings, time)
  shots/<id>.clean.png   the same frame without markers or caption
  shots/shot-*.png       P screenshots
  assets.json            per-asset status and layout overrides
  cache/                 .blend conversions (safe to delete or gitignore)
```

Folders that are never scanned: tooling and version control (`node_modules`, `.git`, …), build output (`dist`, `build`, `Build(s)`, `out`) and the generated folders of Godot (`.godot`, `.import`), Unity (`Library`, `Temp`, `Logs`, `obj`, `UserSettings`) and Unreal (`Intermediate`, `Saved`, `DerivedDataCache`, `Binaries`). Add more with `ignore` in the config.

Optional `review.config.json` in the root:

```json
{
  "name": "My Game",
  "author": "your-name",
  "texelDensity": 64,
  "pixelsPerUnit": 32,
  "ignore": ["reference", "exports/old"],
  "lighting": { "night": { "...": "written by Save to project" } }
}
```

## Agent / CLI loop

```bash
asset-review notes <dir>                       # open notes as markdown, with absolute screenshot paths
asset-review notes <dir> --status open,addressed --asset hovercar --json
asset-review reply <id-prefix> "Shrunk the wheels 20%" --status addressed --author claude --dir <dir>
asset-review status <id-prefix> resolved --dir <dir>
```

The intended loop: the reviewer leaves notes, the agent reads them (`notes`, then opens the screenshot PNGs), fixes the asset and replies with `--status addressed`. The reply shows up live in the browser, and the reviewer resolves or reopens it.

## Development

```bash
pnpm install
pnpm dev          # review ./examples with the Vite dev server (hot reload of the UI)
pnpm build        # UI → dist/client, CLI + server → dist/node
pnpm start        # run the built production server on ./examples
pnpm test && pnpm typecheck
pnpm fixtures     # regenerate examples/ (needs Blender for the models)
```

`node bin/asset-review.ts <dir> --dev` runs the CLI from source against any folder (Node 22.18+ runs the TypeScript directly).

Layout: `bin/` (CLI), `server/` (review store, Blender conversion, the HTTP backend in `app.ts`, the production server in `serve.ts`, the Vite dev plugin in `plugin.ts`), `shared/` (types), `src/formats/` (Aseprite / sheet parsing), `src/viewer/` (three.js viewport, content types, playback), `src/ui/` (React panels).

UI: React + Tailwind CSS v4 + [shadcn/ui](https://ui.shadcn.com) (Radix, `radix-nova` style, lucide icons). The shadcn components live in `src/components/ui` (add more with `npx shadcn@latest add <name>`), and the theme tokens (magenta primary, cyan `info`, `success`, `warning`; light and dark) are in `src/index.css`. Everything is sized in rem and the root font size is never set, so the UI follows the browser's font-size setting. The side panels are resizable and remember their widths; the inspector sections below Info collapse and remember their state.

## Releasing

1. Bump `version` in `package.json` and add a section to `CHANGELOG.md`.
2. Commit, then tag and push: `git tag v0.2.0 && git push origin main --tags`.
3. The `Release` workflow tests, builds, publishes `@hexbit/asset-review` to npm (trusted publishing, with provenance) and creates the GitHub Release.

## License

[MIT](LICENSE) © Hexbit Studios
