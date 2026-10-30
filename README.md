<p align="center">
  <img src="assets/formmorpheus_folder_icon.png" alt="formmorpheus logo" width="160" />
</p>

<h1 align="center">formmorpheus</h1>

<p align="center"><b>The animation studio of the form family: a Stage over a Timeline, drawn frame by frame or performed live.</b></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.3.0-f97316" alt="version v0.3.0" />
  <img src="https://img.shields.io/badge/Node.js-20.19%2B-339933?logo=nodedotjs&logoColor=white" alt="Node.js 20.19+" />
  <img src="https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&logoColor=white" alt="Python 3.12+" />
  <img src="https://img.shields.io/badge/license-Apache--2.0-555555" alt="license Apache-2.0" />
</p>

## What it is

formmorpheus is a desktop animation studio for macOS, Linux & Windows, built in the image of its siblings formvis (image) & formvfx (compositing). A movie is a Stage on top & a Timeline below: tracks hold content blocks (drawings, flipbooks, pictures, text, groups, later video & sound) that you arrange in Compose mode, animate by hand in Keyframe mode, or record from live gestures in Perform mode. Movies save as `.fmo` files w/ their full undo history inside. An iPad edition, MorpheusMobile by FormAI, follows once formmorpheus is stable.

**Stack:** vanilla TypeScript + Vite · Python + FastAPI · Tauri 2 · **Scale:** v0.3.0, phases 1 to 3 of 12

## Highlights

- **Stage over Timeline** one screen, resizable split, a dimmed backstage around the movie frame & a frame-accurate timecode
- **Tracks of content** move in time & between tracks, trim, Free Trim (Alt) that ripples neighbours, split at the Playhead, duplicate, duplicate after, fill duration, group & ungroup, box select
- **Content options** opacity, 17 blend modes plus passthrough for groups, clipping, alpha & luminance masks w/ invert, highlight colours, rename
- **Compose on the Stage** drag to move, corner handles to scale, a handle to rotate (Shift snaps to 15 degrees), snapping to centre & quarter lines
- **History that lasts** every edit is one undo step, drags merge into one, depth 10 to unlimited, saved inside the `.fmo`, w/ automatic recovery points when you branch after 3 or more undos
- **Movie settings** resolution up to 3840 px a side, 12 to 120 fps presets & custom, duration by timecode, transparent background, loop, ping pong or one shot playback
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

Set them in the shell. No `.env` is read or committed.

## Architecture

```
formmorpheus/
├── frontend/              the interface (vanilla TS + Vite)
│   ├── src/engine/        the decoupled engine: movie model, ops, history, renderer, no DOM
│   ├── src/ui/            Stage, Timeline, popovers, the form family shell
│   ├── src/io/            the engine service client & the .fmo format
│   ├── src/app/app.ts     wiring: commands, menus, keys, save & open
│   └── src/styles/        tokens & stylesheets (tokens only, z-index from the scale)
├── backend/               the engine service (FastAPI): library of .fmo movies, capabilities
├── src-tauri/             the desktop shell (Tauri 2): splash, reveal, title bar, engine sidecar
├── setup/                 install, boot, freeze & desktop scripts behind ./formmorpheus
└── assets/                repo-level art (not wired into the build)
```

## Status

Phases 1 to 3 of the plan have landed: the shell, the movie model w/ saved history & `.fmo` files, & the Timeline in Compose mode. Perform & Keyframe modes show in the mode switch & arrive w/ their phases; Draw & Paint (the painting engine) is the next phase. Video & sound import, export to MP4 & GIF, & the iPad edition MorpheusMobile are planned. The desktop shell compiles on Linux; macOS & Windows builds are untested here.

## Development

Changes follow the family's rules: single-region hand edits, zero DOM flash, tokens only, no emoji, decisions & removed code in `frontend/HASHOUT_LOG.md`, `backend/HASHOUT_LOG.md` & `src-tauri/HASHOUT_LOG.md`. Commits are Conventional Commits as `nodemode-ai <mackin@nodemode.ai>` w/o attribution trailers.

## Contributors

- nodemode-ai · owner

## Licensing

Apache-2.0, see `LICENSE` & `NOTICE.md`.
