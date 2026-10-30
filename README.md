<p align="center">
  <img src="assets/formmorpheus_folder_icon.png" alt="formmorpheus logo" width="160" />
</p>

<h1 align="center">formmorpheus</h1>

<p align="center"><b>The animation studio of the form family: a Stage over a Timeline, drawn frame by frame or performed live.</b></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.8.0-f97316" alt="version v0.8.0" />
  <img src="https://img.shields.io/badge/Node.js-20.19%2B-339933?logo=nodedotjs&logoColor=white" alt="Node.js 20.19+" />
  <img src="https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&logoColor=white" alt="Python 3.12+" />
  <img src="https://img.shields.io/badge/license-Apache--2.0-555555" alt="license Apache-2.0" />
</p>

## What it is

formmorpheus is a desktop animation studio for macOS, Linux & Windows, built in the image of its siblings formvis (image) & formvfx (compositing). A movie is a Stage on top & a Timeline below: tracks hold content blocks (drawings, flipbooks, pictures, text, groups, later video & sound) that you arrange in Compose mode, animate by hand in Keyframe mode, or record from live gestures in Perform mode. Movies save as `.fmo` files w/ their full undo history inside. An iPad edition, MorpheusMobile by FormAI, follows once formmorpheus is stable.

**Stack:** vanilla TypeScript + Vite · Python + FastAPI · Tauri 2 · **Scale:** v0.8.0, phases 1 to 19 of 22

## Highlights

- **Stage over Timeline** one screen, resizable split, a dimmed backstage around the movie frame & a frame-accurate timecode
- **Tracks of content** move in time & between tracks, trim, Free Trim (Alt) that ripples neighbours, split at the Playhead, duplicate, duplicate after, fill duration, group & ungroup, box select
- **Content options** opacity, 17 blend modes plus passthrough for groups, clipping, alpha & luminance masks w/ invert, highlight colours, rename
- **Compose on the Stage** drag to move, corner handles to scale, a handle to rotate (Shift snaps to 15 degrees), snapping to centre & quarter lines
- **History that lasts** every edit is one undo step, drags merge into one, depth 10 to unlimited, saved inside the `.fmo`, w/ automatic recovery points when you branch after 3 or more undos
- **Movie settings** resolution up to 3840 px a side, 12 to 120 fps presets & custom, duration by timecode, transparent background, loop, ping pong or one shot playback
- **Draw & Paint** a full-area canvas w/ an original brush library of 18 brushes in 7 sets, paint, smudge & erase, pressure, tilt & streamline smoothing, a size & opacity sidebar, drawing layers w/ blend modes, clipping & alpha lock, a color panel (disc, classic, harmony, value, palettes), color drop fill, select (automatic, freehand, rectangle, ellipse), transform (freeform, uniform, distort, warp) & adjustment filters
- **Flipbooks** frame by frame animation w/ multiple tracks, holds, insert, duplicate, cut, copy & paste of frames, onion skins tinted forwards & backwards, a floating frame strip w/ playback, & conversion to & from tracks of drawings
- **Warp & Distort** keys on the Action menu w/ a mesh of 2x2 to 6x6 nodes, recorded by hand or in Perform, plus an optional GPU compositor that is used only when it is faster and matches the processor
- **More paint & Flipbook tools** drawing layer groups & layer masks, remembered brush size & opacity slots, an eyedropper loupe, color drop threshold & continue fill, Transform nudge & a finer mesh w/ bending handles, canvas rotate, row masks, onion blend, a mini preview & looping the visible region
- **Perform** drag a block on the Stage while the movie plays & your gesture becomes keys at the movie's frame rate (lift to pause, drag to resume), w/ motion filtering that thins the keys, pen barrel roll, & card sliders that record filters
- **Video & sound** import video, sound, animated GIFs (as Flipbooks), TIFF & fonts; frame-accurate video, waveforms & filmstrips on the Timeline, sound locked to the picture by the audio clock, scrubbing, volume & Volume keys, separate audio from video
- **Export** MP4, WebM (w/ transparency), MOV, animated GIF w/ its own palette & dithering, PNG, JPG or WebP frames, the current frame, ranges & ping pong; exports are kept on the Home screen's Exports page
- **Engine export** ProRes 422 HQ, ProRes 4444 w/ transparency & HEVC through the ffmpeg you have installed, run by the engine as a separate program, w/ progress & cancel
- **Safe by default** Recently Deleted keeps deleted movies & exports for 30 days w/ restore; crash recovery snapshots unsaved work every minute & offers it back after a crash
- **In your language** the interface in 30 languages, right to left included; an in-app manual (F1) w/ search
- **Stage you can move around** zoom toward the pointer, pan, fit, rotate the view & a full-screen preview; Stage Options for the background colour, transparency, backstage & timecode
- **Rigging & motion** a Graph editor for custom eases, curved motion paths, pivots, parenting, a keyed camera & bones, plus lip-sync from sound & a Boil effect
- **Brushes** 165 original brushes in 19 sets, `.abr` & `.brushset` import, per-brush pressure & smoothing
- **Desktop apps** `./build_app` makes the macOS app & dmg, Windows msi & installer, Linux deb & AppImage; `.fmo` files open in the running app & join the OS recent list
- **Keyframes** Move & Scale plus live filters (opacity, Gaussian blur, sharpen, noise, hue saturation brightness, lens blur) keyed on lanes under each block, easing (linear, ease in, ease out, ease in & out, hold), expanded per-channel rows, copy, paste & reverse
- **The form family shell** the same splash & reveal, title bar, menus (in the window or the macOS menu bar), Home screen, Preferences & status bar as formvis, w/ 28 shared themes & zero flash on load

## Quick Start

### Requirements

Node 20.19+ or 22.12+, Python 3.12+. Desktop builds also need Rust (`https://rustup.rs`). `./formmorpheus doctor` checks them.

### macOS & Linux

```shell
chmod +x formmorpheus_oc_install formmorpheus
./formmorpheus_oc_install
./formmorpheus
```

Desktop app:

```shell
./formmorpheus desktop dev
./formmorpheus desktop build
```

### Windows

```shell
formmorpheus_oc_install.bat
formmorpheus.bat
```

### Ports

| Service | URL | Notes |
|---|---|---|
| Frontend | http://localhost:5194 | Vite dev server, `server.host` false, proxies `/api/*` to the backend |
| Backend | http://127.0.0.1:9494 | FastAPI/uvicorn, local only; `./formmorpheus serve` also serves the built interface here |

## Configuration

| Variable | Purpose |
|---|---|
| `FORMMORPHEUS_DATA_DIR` | where the engine keeps its data & the movie library (default: the platform's app data folder) |
| `FORMMORPHEUS_LIBRARY_DIR` | a different folder for the movie library |
| `FORMMORPHEUS_PORT` | the backend port (desktop app: 0, a free port) |
| `FORMMORPHEUS_DEV_URL` | debug desktop builds only: load this interface URL instead of the engine's |
| `FORMMORPHEUS_FFMPEG` | the ffmpeg program for ProRes & HEVC export (default: beside the engine, then `PATH`) |
| `APPLE_SIGNING_IDENTITY`, `WINDOWS_CERT_THUMBPRINT` | optional: sign the desktop build made by `./build_app` |

Set them in the shell. No `.env` is read or committed.

## Architecture

```
formmorpheus/
├── frontend/              the interface (vanilla TS + Vite)
│   ├── src/engine/        the decoupled engine: movie model, ops, flipbook & keyframe ops, history, renderer, no DOM
│   ├── src/paint/         the paint core: brushes, strokes, layers & paint history, fill, select, transform, filters, no DOM
│   ├── src/ui/            Stage, Timeline, Draw & Paint, popovers, the form family shell
│   ├── src/media/         video decoding, the audio engine & clock, import of pictures, video, sound & fonts
│   ├── src/export/        rendering & encoding MP4, WebM, MOV, GIF & frames
│   ├── src/io/            the engine service client & the .fmo format
│   ├── src/app/app.ts     wiring: commands, menus, keys, save & open
│   └── src/styles/        tokens & stylesheets (tokens only, z-index from the scale)
├── backend/               the engine service (FastAPI): library of .fmo movies, kept exports, export jobs, Recently Deleted, crash recovery
├── src-tauri/             the desktop shell (Tauri 2): splash, reveal, title bar, engine sidecar, single instance, recent documents
├── setup/                 install, boot, freeze, desktop & lint scripts behind ./formmorpheus
├── docs/MANUAL.md         the user manual (also the in-app Help)
├── .docs/wiki/            the GitHub wiki pages
├── .github/workflows/     CI: typecheck, build, engine import, cargo check, text lint
├── build_app              the desktop build, start to finish
└── assets/                repo-level art (not wired into the build)
```

## Status

Phases 1 to 19 of 22 have landed: the shell, the movie model w/ saved history & `.fmo` files, the Timeline in Compose mode, Draw & Paint, Flipbooks w/ onion skins, Keyframe mode w/ easing & live filters, Perform mode, video & sound, export, engine export jobs & desktop distribution, the stability work, the documentation, the carried items (layer groups & masks, Warp & Distort keys, the GPU compositor), the extras beyond the reference (graph editor, motion paths, pivots, parenting, camera, bones, lip-sync, boil, round trips w/ formvis & formvfx), & the first wave of reference parity (Stage navigation & options, the Compose box, keyboard shortcuts, the Flipbook workflow & Mini Flipbook, paint feel & clipboard, the brush library, Timeline ergonomics, all blend modes, Theater management). Phases 20 to 22 close the remaining parity gaps found by a full audit against the reference. The Linux desktop build is tested; the macOS & Windows builds are configured but untested here. The iPad edition, MorpheusMobile, starts once the owner calls formmorpheus stable.

## Development

Changes follow the family's rules: single-region hand edits, zero DOM flash, tokens only, no emoji, decisions & removed code in `frontend/HASHOUT_LOG.md`, `backend/HASHOUT_LOG.md` & `src-tauri/HASHOUT_LOG.md`. Commits are Conventional Commits as `nodemode-ai <mackin@nodemode.ai>` w/o attribution trailers.

## Contributors

- nodemode-ai · owner

## Licensing

Apache-2.0, see `LICENSE` & `NOTICE.md`.
