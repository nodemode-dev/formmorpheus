# formmorpheus

The animation studio of the form family: a Stage over a Timeline, drawn frame by frame or performed live. A desktop app for macOS, Linux and Windows, with a web build for development.

## Start here

- **Use it**: [[Getting-Started]] gets the app running; the user manual is `docs/MANUAL.md` in the repo and the Help window in the app (F1).
- **How it is built**: [[Architecture]] maps the parts. [[Engine]], [[Paint-Core]] and [[Media-and-Export]] go into each one. [[Desktop]] covers the Tauri shell and the bundles.
- **Change it**: [[Contributing]] has the rules.

## What it does

- Tracks of content on a Timeline: drawings, flipbooks, pictures, text, video, sound and groups
- Compose, Keyframe and Perform modes
- Draw & Paint with 18 brushes in 7 sets, layers, select, transform and filters
- Flipbooks with onion skins, row masks and a mini preview
- Warp and Distort keys, recorded by hand or in Perform
- Draw & Paint layer groups and masks, an eyedropper loupe and canvas rotate
- An optional GPU compositor that is used only when it is faster and matches the processor
- Export to MP4, WebM, MOV, GIF and frames, and to ProRes and HEVC through your own ffmpeg
- Movies saved as `.fmo` with their full undo history
- 30 interface languages (English and 29 more)

## Stack

Vanilla TypeScript and Vite, Python and FastAPI, Tauri 2. Licensed Apache-2.0.
