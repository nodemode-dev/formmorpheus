# HASHOUT_LOG · frontend · formmorpheus

Living log of all comment content, explainers, rationale, TODOs, & removed code for the interface. Source files stay comment-free; everything they would have said lives here, indexed. Read this first, then edit code surgically.

Current build version: v0.4.0
Last updated: 2026-10-30 · phases 4 to 6 (Draw & Paint, Flipbook & onion skins, Keyframes)

---

## Org-navi-map

```
frontend/
├── index.html                  critical style, theme boot, stage-share boot, stylesheet order, #app, #overlay-root, #toast-root
├── package.json                deps: fontsource, tauri api, fflate; dev: tauri cli, typescript, vite
├── vite.config.ts              port 5194, host false, strictPort, /api proxy to 9494
├── tsconfig.json               strict, bundler resolution, src only
├── oc_install / boot_frontend  install & dev server scripts (+ .bat)
├── public/
│   ├── splash.html             the desktop splash card, formmorpheusSplashDone()
│   └── favicon.svg/.ico, apple-touch-icon.png
└── src/
    ├── main.ts                 applyTheme, language, startApp, page translator
    ├── version.ts              VERSION (the dispatcher reads this line)
    ├── app/
    │   └── app.ts              shell template, commands, menus, keys, save/open, import, autosave, reveal
    ├── engine/                 no DOM imports; usable w/o the UI
    │   ├── types.ts            Movie, Track, Content, Asset, blend modes, presets
    │   ├── model.ts            factories, ids, lookups, spans
    │   ├── time.ts             fps presets, timecode, parse
    │   ├── ops.ts              pure movie edits (tracks, content, trims, groups, movie settings)
    │   ├── history.ts          snapshot undo w/ merge tags, recovery points, shared-node packing
    │   ├── engine.ts           Engine: run/undo/redo, selection, Playhead, modes, playback, jobs
    │   ├── events.ts           typed emitter
    │   ├── flip-ops.ts         Flipbook rows & frames, holds, split, conversion to & from tracks
    │   ├── keys.ts             keyframe kinds & channels, temporal Bezier eases, animate()
    │   ├── key-ops.ts          pure key edits: lanes, keys, eases, reverse, copy & paste, shift, scale
    │   └── render.ts           Canvas 2D compositor: tracks, blends, masks, groups, flipbook rows, keys & live filters, thumbnails
    ├── paint/                  the paint core, no DOM (OffscreenCanvas only in doc.ts)
    │   ├── types.ts            contract: Raster, Mask, PixelPatch, PenSample, Brush, StrokeSettings, PaintLayer
    │   ├── tips.ts, dynamics.ts, brushes.ts   tip shapes & grain, pressure curve & tilt, the starter library
    │   ├── stroke.ts           dab engine: paint, smudge, erase, opacity cap, alpha lock, selection, tile snapshots
    │   ├── input.ts            PointerEvents to PenSamples: coalesced & predicted points, streamline
    │   ├── preview.ts          brush stroke previews for the panel
    │   ├── doc.ts, history.ts  PaintDoc layers, compositing w/ clipping, encode & load, paint undo
    │   ├── fill.ts, select.ts, transform.ts   color drop & fills, masks & outlines, affine / quad / mesh resampling
    │   └── filters.ts          blur, sharpen, noise, HSB, lens blur (Draw & Paint & Keyframe live filters)
    ├── io/
    │   ├── api.ts              engine service client (library, capabilities, service state)
    │   ├── disk.ts             path helpers
    │   └── fmo.ts              .fmo zip: manifest, movie, history, assets, poster
    ├── ui/
    │   ├── stage-view.ts       Stage canvas, timecode, selection box, Compose move/scale/rotate
    │   ├── timeline.ts         transport row, ruler & tracks canvases, drags, mode pill, Edit pill
    │   ├── popover.ts          glass popover built once, submenus
    │   ├── content-menu.ts     content options popover
    │   ├── track-menu.ts       track options popover
    │   ├── movie-settings.ts   Movie settings popover (Project, Stage, Timeline)
    │   ├── new-movie-dialog.ts New Movie dialog
    │   ├── settings-dialog.ts  Preferences (General, Interface, Timeline)
    │   ├── status.ts           status bar: undo/redo, movie size, hint, jobs, engine
    │   ├── shell-model.ts      the small model Home & Jobs read
    │   ├── titlebar-tools.ts   theme toggle & command search
    │   ├── prefs.ts            formmorpheus.prefs store, font size, scale, system theme
    │   ├── icons-morph.ts      animation icons merged into ICONS
    │   ├── brand.ts            brand mark
    │   ├── paint-view.ts       Draw & Paint: canvas, top bar, sidebar, strokes, frames, onion skins, saving
    │   ├── paint-tools.ts      Select, Transform & Filters capsule & interactions
    │   ├── paint-settings.ts   Settings popover (Add, Canvas, Onions, Prefs) & the pressure curve
    │   ├── brush-panel.ts, layers-panel.ts, colour-panel.ts, flip-strip.ts   Draw & Paint panels
    │   ├── key-lanes.ts        keyframe lane layout, drawing & hit tests
    │   ├── action-menu.ts      Action menu, Motion & Live Filters lists, parameter cards, lane menus
    │   └── (from formvis)      dom, themes, icons, i18n, i18n/langs, commands, menu, native-menu,
    │                           caption-buttons, home, home-files, jobs-list, toast, dialogs,
    │                           dialog-history, dropdown, number-fields, command-palette, panels/controls
    └── styles/
        ├── tokens.css, fonts.css, shell.css, panels.css, dialogs.css, light-mode.css, scrollbars.css   (from formvis)
        ├── morpheus.css        Stage over Timeline layout & timeline tokens
        ├── popovers.css        popover, content, track, movie settings, new movie styles
        ├── paint.css           Draw & Paint view, sidebar, tools capsule
        └── paint-panels.css, paint-settings.css, colour.css, flip-strip.css, keyframes.css
```

---

## Table of contents

- [index.html](#index-html)
- [src/app/app.ts](#src-app-app)
- [src/engine/types.ts](#src-engine-types)
- [src/engine/ops.ts](#src-engine-ops)
- [src/engine/history.ts](#src-engine-history)
- [src/engine/engine.ts](#src-engine-engine)
- [src/engine/render.ts](#src-engine-render)
- [src/io/fmo.ts](#src-io-fmo)
- [src/ui/stage-view.ts](#src-ui-stage-view)
- [src/ui/timeline.ts](#src-ui-timeline)
- [src/ui (copied from formvis)](#src-ui-copied)
- [src/styles](#src-styles)

---

## index.html {#index-html}

### index.html · theme boot & stage-share boot
- refers-to: index.html :: the two inline scripts in head
- kind: rationale
- logged: v0.3.0 · 2026-10-30

The theme boot is formvis's, unchanged except the skin key (`formmorpheus_user_skin`); `nodemode_ui_settings` stays shared w/ the family as the owner's map requires. The formvis dock boot was replaced by a stage-share boot that writes `--fm-stage-share` from `formmorpheus.prefs` before first paint, so the Stage and Timeline split never jumps. The `/node_modules` font preloads were dropped: they only resolve under the dev server.

---

## src/app/app.ts {#src-app-app}

### src/app/app.ts · startApp
- refers-to: src/app/app.ts :: startApp
- kind: rationale
- logged: v0.3.0 · 2026-10-30

Single movie at a time (no tab strip): the title row shows the movie name and the window title follows `• name - formmorpheus`. Home is formvis's Home screen and is opened by the Theater button. Every `button[data-cmd]` is synced from the command registry in one animation frame and run through one delegated click handler. The Create menu's items are set when it opens because a standalone PopupMenu resolves command ids at `setItems` time and the commands did not exist yet at construction (a v0.3.0 bug: the menu opened empty).

### src/app/app.ts · openFromLibrary, openFile, importImage
- refers-to: src/app/app.ts :: openFromLibrary, openFile, importImage
- kind: rationale
- logged: v0.3.0 · 2026-10-30

Pictures are decoded (`renderer.preload`) before the movie opens or the content is placed. Without it the Stage painted the movie once without its pictures and again a frame later, a visible blink under 4x CPU throttling.

### src/app/app.ts · importFiles
- refers-to: src/app/app.ts :: importFiles
- kind: todo
- logged: v0.3.0 · 2026-10-30

Video and audio are refused w/ a notice until the media phase (Phase 8). Drawings & flipbooks open a notice in `editContent` until Draw & Paint (Phase 4).

---

## src/engine/types.ts {#src-engine-types}

### src/engine/types.ts · Content
- refers-to: src/engine/types.ts :: Content, Movie
- kind: rationale
- logged: v0.3.0 · 2026-10-30

Time is integer frames at the movie fps (`start`, `duration`, `offset`); seconds appear only in labels. `offset` is the trimmed head of the source, so trims are non-destructive. Every content kind carries every field (layers, frames, text, tracks) so the type stays flat and serialises the same way for all kinds. `transform.x/y` are offsets from the movie centre in movie pixels.

---

## src/engine/ops.ts {#src-engine-ops}

### src/engine/ops.ts · whole file
- refers-to: src/engine/ops.ts :: every export
- kind: rationale
- logged: v0.3.0 · 2026-10-30

Pure functions: each returns a new Movie and copies only the path it changes, so history snapshots share everything else. A refused edit throws `OpError` w/ a sentence for the person; `Engine.run` turns it into a notice and records nothing.

### src/engine/ops.ts · trimContent
- refers-to: src/engine/ops.ts :: trimContent
- kind: explainer
- logged: v0.3.0 · 2026-10-30

A plain trim stops at the neighbour and at the source length (video, audio, flipbook). `ripple` (Free Trim, Alt in the timeline) pushes later content right when an end grows, and earlier content left when a start moves.

### src/engine/ops.ts · groupContent, ungroupContent
- refers-to: src/engine/ops.ts :: groupContent, ungroupContent
- kind: explainer
- logged: v0.3.0 · 2026-10-30

A group holds its own tracks w/ starts rebased to the group start; ungroup puts each inner track back as a new track at the group's place and restores absolute starts. Tracks that grouping empties are removed (the top one hosts the group), and ungroup removes the group's track when it is left empty, so a group then ungroup returns the same number of tracks (v0.3.0 fix: two empty tracks were left behind).

---

## src/engine/history.ts {#src-engine-history}

### src/engine/history.ts · History
- refers-to: src/engine/history.ts :: History.record
- kind: rationale
- logged: v0.3.0 · 2026-10-30

Snapshot undo after formvfx's engine (Arc snapshots there, structural sharing here). A gesture passes one merge tag on every step so a drag is one undo step; `endGesture` closes it. Depth 0 means unlimited. A recovery point is taken when a new edit discards a redo branch of 3 or more steps: the tip of that branch is kept (up to 3).

### src/engine/history.ts · packStates
- refers-to: src/engine/history.ts :: packStates, unpackStates
- kind: explainer
- logged: v0.3.0 · 2026-10-30

The saved history is a table of unique objects: shared subtrees are written once and referenced by index, so a long history costs roughly what it changed, not one movie per step.

---

## src/engine/engine.ts {#src-engine-engine}

### src/engine/engine.ts · run
- refers-to: src/engine/engine.ts :: Engine.run
- kind: explainer
- logged: v0.3.0 · 2026-10-30

`run(label, fn, merge)` is the only way the movie changes. `fn` may return a Movie or `{ movie, select }`. Playback uses an injected Ticker (the app gives it requestAnimationFrame) so the engine has no DOM dependency.

### src/engine/engine.ts · nameMovie
- refers-to: src/engine/engine.ts :: nameMovie
- kind: rationale
- logged: v0.3.0 · 2026-10-30

Saving under a name renames the movie w/o an undo step: the name is the file's, not an edit.

---

## src/engine/render.ts {#src-engine-render}

### src/engine/render.ts · composeTracks
- refers-to: src/engine/render.ts :: Renderer.composeTracks
- kind: explainer
- logged: v0.3.0 · 2026-10-30

Tracks draw bottom to top. Each content renders into its own layer, held one step before it is composited, so the content above can still act on it: clipping clips the new layer to the held one; an alpha or luminance mask (optionally inverted) cuts the held layer and is not drawn itself. Groups draw their inner tracks into the parent layer; passthrough blends as normal at the group level.

### src/engine/render.ts · preload
- refers-to: src/engine/render.ts :: Renderer.preload
- kind: rationale
- logged: v0.3.0 · 2026-10-30

Decodes image blobs into the bitmap cache ahead of first paint; see app.ts openFromLibrary.

---

## src/io/fmo.ts {#src-io-fmo}

### src/io/fmo.ts · layout
- refers-to: src/io/fmo.ts :: packMovie
- kind: explainer
- logged: v0.3.0 · 2026-10-30

A zip: `manifest.json` (app, format, version, saved, history flag), `movie.json`, `history.json` (labels, recovery metadata, packed states), `assets/<id>` (stored, no compression), `poster.png` (480 px wide, read by the Home screen through the backend). A newer format number is refused w/ a message. A share w/o history omits `history.json`.

---

## src/ui/stage-view.ts {#src-ui-stage-view}

### src/ui/stage-view.ts · hideSvg
- refers-to: src/ui/stage-view.ts :: hideSvg
- kind: warning-context
- logged: v0.3.0 · 2026-10-30

`setHidden` from dom.ts writes the `hidden` property, which SVG elements do not have; the selection box stayed hidden. SVG uses the attribute through `hideSvg`.

### src/ui/stage-view.ts · move
- refers-to: src/ui/stage-view.ts :: StageView.move
- kind: explainer
- logged: v0.3.0 · 2026-10-30

Compose transforms on the Stage: move snaps to the centre and quarter lines within 8 screen pixels (Alt turns snapping off), corner handles scale about the centre, the top handle rotates (Shift: 15 degree steps). Each drag is one undo step through a merge tag.

---

## src/ui/timeline.ts {#src-ui-timeline}

### src/ui/timeline.ts · TimelineView
- refers-to: src/ui/timeline.ts :: TimelineView
- kind: explainer
- logged: v0.3.0 · 2026-10-30

DOM for the transport row, the Edit pill and the mode pill; two canvases for the ruler and the tracks, redrawn in one animation frame on engine events (formvfx timeline pattern). Zoom is pixels per frame; ruler labels are seconds once a second is 40 px wide, frames below. Ruler click or drag scrubs, Alt-drag on the ruler zooms, Ctrl or Cmd wheel zooms about the pointer, Shift wheel pans, middle drag pans. On tracks: click selects and moves the Playhead into the block, Shift or Cmd adds, drag moves in time and between tracks, the edges of a selected block trim (Alt: Free Trim), drag on empty lane w/ Multi-select or Shift draws a box, the end-of-movie bar sets the duration, right-click opens content or track options, double-click edits.

### src/ui/timeline.ts · TOP_PAD
- refers-to: src/ui/timeline.ts :: TOP_PAD
- kind: rationale
- logged: v0.3.0 · 2026-10-30

26 px above the first lane so the Edit pill sits above the top block instead of over its name chip.

### src/ui/timeline.ts · tracksDown
- refers-to: src/ui/timeline.ts :: TimelineView.tracksDown
- kind: rationale
- logged: v0.3.0 · 2026-10-30

A selected block's edge wins over the movie's end bar when they meet (a block that runs to the end of the movie); the end bar sets the duration only away from an edge.

---

## src/ui (copied from formvis) {#src-ui-copied}

### src/ui · provenance
- refers-to: src/ui :: dom, themes, icons, i18n, i18n/langs, commands, menu, native-menu, caption-buttons, home, home-files, jobs-list, toast, dialogs, dialog-history, dropdown, number-fields, command-palette, panels/controls
- kind: explainer
- logged: v0.3.0 · 2026-10-30

Copied from formvis 1.98.4 (owner's repo, Apache-2.0), then edited by hand: storage keys renamed `formvis.*` to `formmorpheus.*`; the Engine type in home, jobs-list and command-palette replaced by `ShellModel` or removed; Home text, nav labels, format chips & presets made for movies; i18n tables emptied (English is the key and passes through; 30 languages stay selectable for when tables ship). Inherited doc comments in the copied files are comment debt, migrated here when a file is next touched.

### src/ui/i18n.ts · LOADERS, MORE, EXTRA
- refers-to: src/ui/i18n.ts :: the three table maps
- kind: removed-code
- logged: v0.3.0 · 2026-10-30

Removed: the 29 dynamic imports per map pointing at `./i18n/<code>`, `./i18n/more/<code>`, `./i18n/extra/<code>` (formvis 1.98.4 `frontend/src/ui/i18n.ts` lines 10 to 62). Those tables are keyed by formvis's English strings and weigh 3.6 MB; formmorpheus ships its own tables later. `load()` now tolerates a missing loader.

### src/ui/panels/controls.ts · matrixRow, curveRow
- refers-to: src/ui/panels/controls.ts :: after colorRow
- kind: removed-code
- logged: v0.3.0 · 2026-10-30

Removed: `matrixRow` and `curveRow` (formvis 1.98.4 `frontend/src/ui/panels/controls.ts` lines 107 to 195), filter widgets that imported the formvis engine (`clamp`, `filters-lib/distort.curveValue`). A local `clamp` replaces the import. The easing curve editor of Phase 6 may start from `curveRow`.

### src/ui/titlebar-tools.ts · TitleTools
- refers-to: src/ui/titlebar-tools.ts :: TitleTools
- kind: removed-code
- logged: v0.3.0 · 2026-10-30

Written fresh in formvis's shape w/o the workspace select, Lock Workspace, the Claude Code and terminal buttons (`WORKSPACES`, `loadCustom`, `saveCustom`, `choose`, `addCustom`, `removeCustom`, `syncCustom`, `syncDock`; formvis 1.98.4 `frontend/src/ui/titlebar-tools.ts`). formmorpheus has a fixed Stage over Timeline layout and no dock. Kept: theme toggle and command search.

### src/ui/command-palette.ts · render
- refers-to: src/ui/command-palette.ts :: CommandPalette.render, constructor
- kind: removed-code
- logged: v0.3.0 · 2026-10-30

Removed the tool and tool-variant hits loop (`for (const t of toolList()) { ... }`, formvis 1.98.4 lines 118 to 130) and the `engine` constructor argument; formmorpheus has no tool registry yet. Commands and menu paths remain.

### src/ui/native-menu.ts, dialogs.ts, icons.ts · comments
- refers-to: native-menu.ts :: header and accelerator docs; dialogs.ts :: Dialog.close focus note; icons.ts :: objectSelect
- kind: removed-code
- logged: v0.3.0 · 2026-10-30

Three doc comments that named formvis were removed; their content: native menus mirror the in-window MenuDef list and only run on macOS; focus left in a hidden dialog is blurred so shortcuts reach the app again; the Object Selection icon is a dashed frame w/ a pointer.

---

## src/styles {#src-styles}

### src/styles · shell.css, panels.css, dialogs.css
- refers-to: src/styles :: shell.css, panels.css, dialogs.css
- kind: todo
- logged: v0.3.0 · 2026-10-30

Copied whole from formvis 1.98.4; most selectors (rail, options bar, layers, tiles, video timeline, plugins, assistant) are unused here. Prune by selector in a dedicated, approved pass; `morpheus.css` overrides the grid for the Stage over Timeline layout.

---

## src/paint (Phase 4) {#src-paint}

### src/paint · provenance
- refers-to: src/paint :: every file
- kind: rationale
- logged: v0.4.0 · 2026-10-30

A self-contained CPU paint core on plain straight-alpha RGBA rasters (ImageData layout, so a raster moves to a canvas w/o conversion). formvis's stroke engine is tied to tiled rasters, GPU dabs & its document, so the dab placement, opacity cap, smudge & pressure dynamics were adapted rather than copied whole; fill, select, transform & filters were written fresh against `types.ts`. The brush library, tip shapes & palettes are original.

### src/paint/stroke.ts · Stroke
- refers-to: src/paint/stroke.ts :: Stroke
- kind: warning-context
- logged: v0.4.0 · 2026-10-30

The stroke opacity cap holds per stroke through a coverage buffer; tile snapshots (64 px) are taken on first touch so `finish()` returns one exact patch. The first dab waits for the second sample so a stroke-following dab knows its angle. `predicted` samples are ignored here (drawing them is the view's job; the view does not draw them yet). Mouse pressure is a fixed 0.5 and does not go through the pressure curve. Measured: one 2,000 sample stroke at 120 px on 3840x2160 about 490 ms in node (0.6 ms a dab).

### src/paint/stroke.ts · applySmudge
- refers-to: src/paint/stroke.ts :: applySmudge
- kind: fix
- logged: v0.4.0 · 2026-10-30

Smudge first only mixed colour inside existing paint (alpha untouched, from a wrong brief), so it never smeared. It now mixes the carried paint into the layer in premultiplied space, alpha included: paint drags out past its edge & dragging from empty canvas thins it. With alpha lock it mixes colour only.

### src/styles/paint.css · .fm-paint z-index
- refers-to: src/styles/paint.css :: .fm-paint
- kind: fix
- logged: v0.4.0 · 2026-10-30

The view sits at `--z-menu`, level w/ `#overlay-root`, which comes later in the page & so stays on top: the Flipbook strip's frame & track menus live there. At `--z-modal` they opened behind the canvas.

### src/paint/doc.ts · composite
- refers-to: src/paint/doc.ts :: composite
- kind: warning-context
- logged: v0.4.0 · 2026-10-30

Composites every visible layer each call; the view clips to the dirty rectangle before calling it (measured in headless software rendering: 20 layers at 4K, 90 to 190 ms clipped vs 410 to 540 ms unclipped). A clipped layer w/ a non-normal blend is exact over an opaque base & approximate at soft edges.

### src/paint/doc.ts · encode
- refers-to: src/paint/doc.ts :: encode
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Layers are stored as PNG pixel assets, one per changed layer, so a saved Drawing is ordinary pictures in the `.fmo` & the movie history only records asset ids. `convertToBlob` took about one second for a 1080p layer in headless Chromium, which is why the view saves Flipbook frames in the background (see paint-view).

## src/ui/paint-view.ts {#src-ui-paint-view}

### src/ui/paint-view.ts · commitDoc, parked
- refers-to: src/ui/paint-view.ts :: commitDoc, encodeDoc, loadDoc, parked, saving
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Moving to another Flipbook frame parks the open PaintDoc & encodes it on a promise chain; the frame is found again by its id when the encode lands (frames can move meanwhile), the parked doc is reused if the person returns before it lands, & onion skins & strip thumbnails draw parked docs live. Done & strip edits wait for the whole chain. Frame moves pressed while a load runs are queued (`pendingNav`), never dropped.

### src/ui/paint-view.ts · drawOnions, ghosts
- refers-to: src/ui/paint-view.ts :: drawOnions, ghosts
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Tinted onion frames are built once per frame & setting & cached (24 kept); rebuilding them on every repaint made strokes on a Flipbook stall. Ghosts fade w/ distance from the current frame. Onion settings are the movie's unless the Flipbook has its own (`content.onion`).

### src/ui/paint-view.ts · redraw
- refers-to: src/ui/paint-view.ts :: redraw, paint, cursorBox
- kind: warning-context
- logged: v0.4.0 · 2026-10-30

Pixel changes repaint only their screen rectangle (plus the old brush outline box); view changes repaint everything. Keep that split: a full repaint per pointer move is too slow at 4K.

### src/ui/paint-tools.ts · lift, commitFloat
- refers-to: src/ui/paint-tools.ts :: lift, commitFloat, dropFloat
- kind: warning-context
- logged: v0.4.0 · 2026-10-30

Transform lifts the selection (or every pixel w/ alpha) into a float & keeps a full copy of the layer; Done writes one patch over the union of the source & destination rectangles, Cancel restores the copy. Freeform & Uniform preview through the canvas transform (fast); Distort & Warp preview by real resampling on pointer up.

## src/engine (Phases 5 & 6) {#src-engine-p56}

### src/engine/types.ts · FlipTrack, KeyLane
- refers-to: src/engine/types.ts :: FlipTrack, Key, KeyLane, OnionSettings
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Flipbooks hold rows (`flip`), each a list of frames w/ holds that loop; `frames` on Content was replaced before any file shipped. Keys are stored per channel in content-local frames, w/ the ease of the span leaving each key; `options` carries the non-animated lane settings (Noise style). Onion settings count back & forward frames separately (0 turns a side off).

### src/engine/keys.ts · evalChannel
- refers-to: src/engine/keys.ts :: evalChannel, easeCurve
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Ported from formvfx's temporal Bezier (speed & influence, Newton then bisection); the presets use speed 0 & 33 percent influence on the eased end(s). Binary search, no allocation: about 71 ns a call on a 200 key channel.

### src/engine/ops.ts · trimContent, splitContent, patchMovie
- refers-to: src/engine/ops.ts :: trimContent, splitContent, patchMovie
- kind: rationale
- logged: v0.4.0 · 2026-10-30

Trimming the start or splitting shifts keys so they stay at the same movie time; a frame rate change scales key times & Flipbook holds by the same ratio as content starts & durations.

### src/engine/render.ts · applyFilters
- refers-to: src/engine/render.ts :: applyFilters
- kind: todo
- logged: v0.4.0 · 2026-10-30

Live filters run on the content's whole view-sized surface w/ getImageData, so a blur costs 100 ms or more a frame in software rendering. Limit the work to the content's bounds & move it to a worker (or the GPU compositor) before Phase 9 export.
