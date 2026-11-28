# Architecture

```
formmorpheus/
├── frontend/              the interface (vanilla TS + Vite)
│   └── src/
│       ├── engine/        movie model, ops, history, keys, renderer (no DOM)
│       ├── paint/         brushes, strokes, layers, fill, select, transform, filters (no DOM)
│       ├── ui/            Stage, Timeline, Draw & Paint, popovers, the shell, Help
│       ├── media/         video decoding, audio clock, importers
│       ├── export/        rendering and encoding
│       ├── io/            engine client, .fmo format, recovery
│       ├── app/app.ts     commands, menus, keys, save and open
│       └── styles/        tokens and stylesheets
├── backend/               the engine service (FastAPI)
├── src-tauri/             the desktop shell (Tauri 2)
├── setup/                 scripts behind ./formmorpheus
└── docs/MANUAL.md         the user manual, also the in-app Help
```

## Three programs

1. **The interface** runs in a browser or the Tauri webview. It holds the movie in memory, edits it, draws it and encodes most exports.
2. **The engine** is a small local FastAPI service. It keeps the movie library on disk, the kept exports, Recently Deleted and crash recovery copies, and it runs ffmpeg for the formats a browser cannot encode.
3. **The desktop shell** opens the window, starts the engine as a sidecar, shows the splash and reveals the window without a white frame.

## The split that matters

The movie model and the paint core are pure code with no DOM, so they could run in a worker or in another shell. Everything that touches the page lives in `ui/`. The `app.ts` file wires the two with one command table that feeds the menus, the buttons, the key bindings and command search.

## The window

The window is a Stage over a Timeline. The Build panel (`ui/build-panel.ts`) is a column docked beside the Stage in the same grid, not over it, with tabs for Characters, Actions, Scenes, Create and Camera. It shows only while a movie is open in the editor, keeps its open state and tab in `localStorage`, and runs commands through the same registry as the menus. Compose, Perform and Keyframe are a segmented switch (`.fm-modes`) in the Timeline's top row, and its Preview button runs the full-screen preview from the first frame.

## Data

A movie is a plain object: tracks, each holding content blocks, each with a transform, options, keys and for flipbooks and drawings their layers. Pictures, sound and fonts are assets referenced by id and kept as blobs beside the movie. Every edit is a pure function from movie to movie, so history is a list of movies that share structure.

## UI rules

One build, then patch: UI is made once from a template and updated by toggling classes and setting text. Colors, spacing and z-index come from tokens. Icons are inline SVG in `currentColor`.
