# Changelog

## 0.1.0

First release.

- Review 3D models (glb, gltf, fbx, obj, vox, and .blend via a local Blender), sprites, sprite sheets (Aseprite / TexturePacker / PixiJS JSON), grid strips, animated GIF/WebP, sprite stacks, direction sheets and native .aseprite files.
- Screenshot notes: press N for a capture with a cursor marker, or note any inspector Info row. Notes, replies and statuses are plain files in `.review/`, meant to be committed.
- CLI for agents and terminals: `notes`, `reply`, `status`; `init` to set a project up.
- Model animation playback with frame-rate detection and an in-place root-motion lock; sprite frame playback with Aseprite tag directions; stack turntable.
- Lighting presets (studio, day, night, neon night, flat) that can be edited, saved to the project, or extended with your own; HDR bloom; camera orbit; texel density and model stats.
- shadcn/ui interface with resizable panels, collapsible inspector sections, light and dark themes, and rem-based sizing that follows the browser font size.
