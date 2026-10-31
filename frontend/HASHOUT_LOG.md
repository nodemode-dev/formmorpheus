# HASHOUT_LOG · frontend · formmorpheus

Living log of all comment content, explainers, rationale, TODOs, & removed code for the interface. Source files stay comment-free; everything they would have said lives here, indexed. Read this first, then edit code surgically.

Current build version: v0.14.0
Last updated: 2026-10-30 · phases 29 to 31 (performance second wave, rows still open, second review round)

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
    │   ├── perform.ts          Perform takes: Recorder, motion filtering, key reduction, applyTake
    │   └── render.ts           Canvas 2D compositor: tracks, blends, masks, groups, flipbook rows, video, keys & live filters, prepareFrame, thumbnails
    ├── media/                  video & sound (no DOM except the AudioContext, FontFace & canvases)
    │   ├── types.ts            MediaInfo, VideoSource, AudioClip, ClockSource
    │   ├── video.ts            VideoPool: mediabunny decode window, exact frames, filmstrip thumbs
    │   ├── audio.ts            AudioEngine: decode, peaks, play on one AudioContext (the playback clock), scrub, mixdown
    │   ├── import.ts           importMedia: sniff, probe, assets & blocks for pictures, GIF, TIFF, video, sound, fonts
    │   ├── fonts.ts            registerFonts, FONT_FAMILIES
    │   └── gif-decode.ts, tiff-decode.ts
    ├── export/
    │   ├── types.ts            ExportOptions, ExportJob, ExportResult
    │   ├── run.ts              startExport: frame loop, mediabunny MP4 / WebM / MOV, GIF, frame zips, still
    │   └── gif.ts              median-cut quantiser, dithers, LZW, GifWriter
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
    │   ├── action-menu.ts      Action menu, Motion & Live Filters lists, parameter cards (record in Perform), lane menus
    │   ├── perform-ui.ts       Perform banner, Modifications popover, perform settings
    │   ├── export-dialog.ts    Export dialog: Quick share, Advanced, progress, cancel
    │   ├── text-card.ts        Text options: words, font, size, weight, colour, alignment
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
- [Phases 10 to 12 (v0.6.0)](#p1012)
- [Phases 13 to 15 (v0.7.0)](#p1315)
- [Phases 16 to 19 (v0.8.0)](#p1619)

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

## Phases 7 to 9 (v0.5.0) {#p789}

### src/app/app.ts · audio clock
- refers-to: src/app/app.ts :: engine.setTicker, playing, wrap, time handlers
- kind: rationale
- logged: v0.5.0 · 2026-10-30

The Engine's ticker reads `audio.now()`: while sound plays it is the AudioContext clock continued from the moment playback started, otherwise performance.now(). The Engine derives the frame from elapsed clock time, so pictures follow the sound card and cannot drift. Loop turns (`wrap`) restart the sound from the new frame; ping pong backwards plays no sound but keeps the clock. Seeks while stopped scrub about one frame of sound.

### src/media/video.ts · VideoPool
- refers-to: src/media/video.ts :: VideoPool
- kind: warning-context
- logged: v0.5.0 · 2026-10-30

On screen `frame()` never returns a blank once a frame of the asset was shown (it returns the last frame while the wanted one decodes); `exact()` is for export & stills. Decoded frames are copied to canvases so the decoder never stalls on held VideoFrames; the window is about 1 s behind & the prefetch ahead, capped at 400 MB.

### src/media/import.ts · importMedia
- refers-to: src/media/import.ts :: importMedia
- kind: rationale
- logged: v0.5.0 · 2026-10-30

Files are recognised by their bytes first, the extension second. Animated GIFs become Flipbooks (one PNG pixel asset per picture, holds from the delays at the movie's frame rate w/ the rounding error carried); TIFF is decoded here & stored as PNG bc browsers do not read it; fonts become assets registered w/ FontFace on import & on every open.

### src/export/run.ts · startExport
- refers-to: src/export/run.ts :: startExport
- kind: rationale
- logged: v0.5.0 · 2026-10-30

Export renders on the main thread through the same renderer, frame by frame w/ `prepareFrame` (exact pictures & video), yielding every frame through a MessageChannel so a background tab does not throttle it (the plan said a worker; the decoders & bitmaps live on the main thread). Codecs are chosen by what the browser can encode: MP4 & MOV take H.264 then HEVC, AV1, VP9; sound AAC when encodable, else Opus w/ a warning (QuickTime does not play Opus in MP4).

### src/engine/perform.ts · Recorder, applyTake
- refers-to: src/engine/perform.ts :: Recorder, filterMotion, reduceKeys, applyTake
- kind: rationale
- logged: v0.5.0 · 2026-10-30

A take keeps one key per touched frame (skipped frames bridged linearly), then a zero-phase Gaussian (sigma 3 x filtering frames) & Ramer-Douglas-Peucker w/ a tolerance from the channel's range. While the pen is down the unfiltered take is applied under one merge tag, & on lift the filtered take replaces it under the same tag, so a performance is one undo step. Same-kind keys inside the take's range are replaced; other kinds stay (layering).

---

## Phases 10 to 12 (v0.6.0) {#p1012}

### src/media/video.ts · per-block lanes (whole-file rewrite)
- refers-to: src/media/video.ts :: VideoPool, VideoSource (frame, exact, prefetch w/ lane), release, stage, forgetExcept
- kind: rationale
- logged: v0.6.0 · 2026-10-30

Each block of a video asset decodes on its own lane (up to 4 per asset; the block's content id is the lane), so two blocks at different times no longer seek one decoder back and forth (7 seeks and 99 wrong checks before, 2 and 0 after). Scrubbing shows the nearest key frame at once and refines to the exact frame when the scrub rests. exact() takes the frame whose span covers the wanted time and caps its loop (a variable frame rate file hung before); the end clamp stays 4 ms inside the clip. The decoded-frame cap is 768 MB in bytes. Process note: this file was rewritten whole by its builder instead of edited region by region, against SEDO, because the lane change touched nearly every method; the lead kept it after review and records it here.

### src/media/plan.ts, thumb-cache.ts · nothing half-built
- refers-to: src/media/plan.ts :: planPrefetch, firstFrames, firstPictures; src/media/thumb-cache.ts; src/app/app.ts :: prepareOpen, importOne
- kind: fix
- logged: v0.6.0 · 2026-10-30

Import awaits the block's first picture before the engine op adds it, and every open path (library, file, recovery) awaits the first frames at the Playhead before the old movie is dropped; waits cap at 5 s so a stuck decoder cannot block an open. The loop prefetch starts 1.5 s before the end on its own `~wrap` lane, released 2 s after the turn. Filmstrip thumbnails are kept in IndexedDB (64 MB, LRU, every call in try/catch) and fill visible tiles first, then the rest while idle. GIFs stream one picture at a time and stop at 1,000 pictures or 512 MB w/ a warning.

### src/engine/render.ts · direct() and the bitmap byte cap
- refers-to: src/engine/render.ts :: composeTracks, direct, BITMAP_CAP_BYTES
- kind: rationale
- logged: v0.6.0 · 2026-10-30

Plain content (normal blend, opacity 1, no mask, no filter, and no mask on the content above it) is drawn straight onto the output instead of through a temporary surface: 200 tracks of full-frame drawings went from 1.2 to about 10 fps in software-rendered Chromium. The bitmap cache is capped at 1 GB in bytes; bitmaps drawn in the last two frames are never evicted.

### src/paint/history.ts · tiles and a budget
- refers-to: src/paint/history.ts :: tilePatch, PaintHistory(budget)
- kind: rationale
- logged: v0.6.0 · 2026-10-30

A stroke's undo keeps only the 128 px tiles it touched (a diagonal across a 4K layer: 63 MB to 6.3 MB). Total paint history is capped at 1 GB by default; the oldest steps drop w/ a toast. A Preferences field is not wired yet.

### src/ui/i18n.ts · 29 tables
- refers-to: src/ui/i18n.ts :: LOADERS; src/ui/i18n/[code].ts
- kind: explainer
- logged: v0.6.0 · 2026-10-30

One chunk per language, loaded on demand; es-MX and fr-CA hold only regional differences and fall back to es and fr. Keys are the English labels w/o a trailing "..." or ":"; key names, format codes, fonts and theme names stay English. Words drawn on canvases are not translated. Where formvis had the same key its wording was reused so the family reads alike.

### src/io/recovery.ts · crash recovery
- refers-to: src/io/recovery.ts :: Recovery; backend/app/routers/recovery.py
- kind: explainer
- logged: v0.6.0 · 2026-10-30

Every 60 s while the movie has unsaved changes a snapshot (no history, no poster) goes to the engine's Recovery folder; it is deleted on save, close, replace, a return to unmodified and on `pagehide`. The engine holds one movie, so Recover opens the newest snapshot as the unsaved movie and saves any others to the library as "[name] (Recovered)".

### src/export/engine-jobs.ts · ProRes and HEVC through the engine
- refers-to: src/export/engine-jobs.ts :: startEngineExport, encodeWav, jobCapabilities; src/ui/export-dialog.ts
- kind: explainer
- logged: v0.6.0 · 2026-10-30

Frames render as in the browser export, go up as PNGs (4 at a time) w/ a 16-bit WAV mixdown, and the engine runs ffmpeg. The dialog greys out formats the installed ffmpeg cannot make and says why. About 8 frames a second at 1080p.

### src/ui/help-view.ts · Help
- refers-to: src/ui/help-view.ts :: HelpView, renderMarkdown; docs/MANUAL.md
- kind: explainer
- logged: v0.6.0 · 2026-10-30

The manual is bundled w/ `?raw` and rendered once into DOM nodes (no innerHTML); each `##` heading is a section; search filters sections. F1 opens it, also on the Home screen. The section list and the manual text carry `data-no-i18n`: the manual is English only, and word-by-word table hits made it half translated.

---

## Phases 13 to 15 (v0.7.0) {#p1315}

### src/engine/gpu · the GPU compositor
- refers-to: src/engine/gpu/compositor.ts, shaders.ts, textures.ts, probe.ts; src/engine/render.ts :: useGpu, autoGpu, gpuActive, drawFrame
- kind: rationale
- logged: v0.7.0 · 2026-10-30

WebGL2 on an OffscreenCanvas walks the tracks as composeTracks does (held layer, clipping, masks, keyed opacity, groups, the direct path), w/ all 17 blend modes and the live filters as shader passes. The CPU path stays the reference and the fallback: content drawn through warp, distort, layer groups or masks, or row masks is rendered by the CPU and uploaded as one picture. Auto mode turns the GPU on only when WebGL2 exists, a probe frame matches the CPU and a heavy frame is no slower; `?gpu=force` skips the speed test. Against the CPU: blend modes max 24 levels on rotated edges (mean under 0.06), Hue up to 121 on near-grey pixels (0.05%), filters within 24 (mean 0.31), text 73 at glyph edges (resampled). On this machine (software WebGL) the GPU is slower than the CPU raster, so auto leaves it off; a real GPU is unmeasured. Process note: its builder once rewrote regions of its own new compositor.ts w/ a Python script, against SEDO; logged and kept after review.

### src/engine/warp-draw.ts · Warp and Distort keys
- refers-to: src/engine/warp-draw.ts :: warpQuads, drawWarped; src/engine/keys.ts :: warp, distort; src/ui/warp-view.ts, warp-card.ts
- kind: explainer
- logged: v0.7.0 · 2026-10-30

Distort is a projective map of the content's own rectangle (8 channels); Warp is a Catmull-Rom surface through a 2x2 to 6x6 node mesh (node positions exact), resampled when the mesh size changes. Both draw as affine-textured triangles w/ a half-pixel overlap so no seams show. Offsets are in content pixels, applied before move, scale and rotation. In Perform, dragging a node while playing records its track (one undo step per take).

### src/ui/paint-* · the paint tool carries
- refers-to: src/paint/viewmath.ts; src/ui/paint-gestures.ts, paint-loupe.ts, paint-drop.ts, paint-predict.ts; src/paint/transform.ts :: Bend, refineGridBent, nudgePoints
- kind: explainer
- logged: v0.7.0 · 2026-10-30

Eyedropper loupe (Alt or touch-and-hold), color drop threshold by dragging and continue-fill, Transform nudge (1 px, Shift 10 px) and an 8x8 mesh w/ bending handles, canvas rotate (two fingers, Shift w/ the hand, R resets), hold to repeat undo and redo, quick pinch fit, and predicted points drawn as a screen-only tail never written to the layer. A 4K stroke stays about 0.4 ms median per move.

### src/engine/flip-draw.ts, src/ui/flip-preview.ts · Flipbook carries
- refers-to: src/engine/flip-draw.ts :: drawMaskedRows; src/ui/flip-preview.ts :: FlipPreview; src/engine/engine.ts :: setRegion, playSpan
- kind: explainer
- logged: v0.7.0 · 2026-10-30

A row can mask the row below it (alpha or luminance, invert); onion skins can blend over the primary frame; scrubbing the strip follows the Scrub speed preference; a floating mini preview loops the flipbook and keeps its place; Playback can loop only the Timeline's visible region (saved in the movie), and the sound restarts at the region start. Process note: its builder appended to its own new flip-preview.css w/ a shell redirect once, against SEDO; logged.

### src/ui/i18n.ts · tp, dateText, RTL
- refers-to: src/ui/i18n.ts :: tp, dateText; src/styles/shell.css (logical properties, RTL chevrons); src/ui/timeline.ts (ruler labels)
- kind: explainer
- logged: v0.7.0 · 2026-10-30

`tp()` translates a label before a trailing " (shortcut)" group and keeps the group. Plurals go through `tn()` w/ the categories each language needs; dates use the app language. In Arabic, the status bar parts and the frame counter are isolated left to right, the Home sidebar follows the page direction (logical properties), chevrons flip, path fields are left to right. The ellipsis of a label like "Reset..." sits at the logical end in Arabic, as Arabic interfaces write it.

### media and export debt (v0.7.0)
- refers-to: src/media/video.ts :: lane eviction, exact waiters; src/media/import.ts :: animated streaming; src/export/engine-jobs.ts; src/io/recovery.ts :: heartbeat
- kind: fix
- logged: v0.7.0 · 2026-10-30

Lanes held by an exact() waiter are never evicted, and a waiter whose lane goes asks again (6 blocks of one clip exported: 180 of 180 exact tiles, was 73). Animated WebP, APNG and AVIF stream under the GIF budget. Recovery snapshots carry a heartbeat; only one silent for over 60 s is offered as a crash. A restore renamed to "name 2" says so; the open movie cannot be deleted from Home.

---

## Phases 16 to 19 (v0.8.0) {#p1619}

### src/ui/graph-editor.ts, src/engine/graph-ops.ts · custom eases
- refers-to: src/engine/keys.ts :: bezierSeg, evalChannel 'custom'; src/engine/key-ops.ts :: withEase, mirrorSpan
- kind: explainer
- logged: v0.8.0 · 2026-10-30

A key may carry `ease: 'custom'` w/ `out` / `in` handles (x clamped to 0..1, y may overshoot); presets map onto handles, so switching to Custom starts from the preset's shape. Reverse mirrors and swaps handles. The Graph view shows value and speed curves of one active channel (others as ghosts); each drag is one undo step.

### src/engine/path.ts · motion paths and pivots
- refers-to: src/engine/path.ts; src/engine/types.ts :: Key.sp, Content.pivot; px / py channels
- kind: rationale
- logged: v0.8.0 · 2026-10-30

Spatial tangents live on the x key (`sp`); a span is curved only when an end has `sp` or the lane's Smooth path is on, so older movies render as before. The x key's ease gives the fraction, mapped through a 64-step arc-length table. Pivot: stage = P + pos + R·S·(p − P), the same in render.ts, the GPU path and warp-draw. Known gap: reverseKeys drops `sp`.

### src/engine/transform.ts, camera.ts, parenting.ts · parents and the camera
- refers-to: src/engine/transform.ts :: worldMatrix, topMatrix, memberMatrix; camera.ts; parenting.ts :: setParent, unparent
- kind: rationale
- logged: v0.8.0 · 2026-10-30

One source for a content's world matrix: own transform and pivot, then each parent's, then the camera unless the track is fixed to the screen. Movies w/o camera or parents take the old path. Loops and cross-group parents are refused w/ a message; unparent bakes the world pose. The camera is keyed through a stand-in content so key-ops are reused.

### src/engine/bones.ts · bones
- refers-to: src/engine/bones.ts :: skinOf, boneMatrices, boneQuads; warp-draw.ts :: drawTriangles
- kind: rationale
- logged: v0.8.0 · 2026-10-30

Weights are inverse-square distance to each bone segment, softened near the bone, faded to zero at 0.4 x its length, top 2 bones, normalised, so far parts stay exactly put. Bones draw first, then Warp / Distort; both through the CPU raster. The Bones card is a Stage panel because the Action menu popover closes on any outside press.

### lip-sync, boil, round trips
- refers-to: src/media/lipsync.ts; src/engine/lipsync-ops.ts; src/paint/boil.ts; src/ui/boil-make.ts; src/io/formvis-doc.ts, formvfx-doc.ts, round-trip.ts
- kind: explainer
- logged: v0.8.0 · 2026-10-30

Lip-sync classifies 8 mouth shapes per frame from RMS, zero crossings and the two strongest spectral peaks (radix-2 FFT, Hann windows), smoothed to 2-frame holds, written as a new Lip-sync row (the chart row survives). Boil displaces w/ hash-lattice value noise whose seed cycles every `rate` frames; CPU and GPU share the maths (max 2 levels apart). Pool surfaces now use `willReadFrequently`, which made every CPU filter readback faster under software GL. formvis `.fvd` (zip manifest + PNGs) and formvfx `.fvxproj` (JSON, footage beside it, so the export is a zip w/ Footage/) round-trip as far as each format carries; a toast lists what was left out.

### process exceptions (v0.8.0)
- kind: warning-context
- logged: v0.8.0 · 2026-10-30

Two builders appended to existing files w/ a shell heredoc instead of the Edit tool: one CSS rule at the end of `styles/flip-strip.css` (lip-sync) and the FS_BOIL shader const at the end of `engine/gpu/shaders.ts` (boil). Both are pure appends, reviewed and kept; logged here as SEDO breaches. Phase 19 added more: the brush builder rewrote `paint/brushes.ts` and `ui/brush-panel.ts` whole and copied formvis's `engine/abr.ts` to `io/abr.ts` w/ `cp`; three builders appended CSS to their own new stylesheets w/ a heredoc (`paint-feel.css`, `timeline-extras.css`). Reviewed and kept; the skill pack's laws already say SEDO covers a builder's own new files.

### Phase 19 · reference parity, first wave
- refers-to: src/ui/stage-nav.ts, stage-options.ts; src/engine/transform-ops.ts; src/ui/stage-snap.ts, stage-box-menu.ts, shortcuts-dialog.ts, recovery-dialog.ts; src/ui/flip-select.ts, flip-mini.ts, flip-canvas.ts, flip-convert.ts; src/paint/feel.ts; src/ui/paint-feel.ts, paint-clip.ts, paint-keys.ts; src/io/brush-import.ts, abr.ts; src/ui/brush-store.ts; src/engine/blend.ts, track-ops.ts, key-sel-ops.ts; src/ui/timeline-extras.ts, home-theater.ts
- kind: explainer
- logged: v0.8.0 · 2026-10-30

Measured against the reference inventory and audit in the planning sidecar. The Stage has one view transform (stage-nav.ts); overlays read the pointer through `stageLocal`, and a rotated view turns the `.fm-stage-space` wrapper w/ CSS. Backstage visibility is a movie field (default 20%, `BACKSTAGE_DEFAULT`). Snapping uses Shift as the reference's second finger; Alt turns snapping off. Key combos are canonical (`canonCombo`), so duplicates are caught. Undo depth defaults to 250 w/ a Recent share kept one by one. Luminance masks use 0.299 / 0.587 / 0.114 on the CPU and GPU alike. The nine extra blend modes are pixel maths on the CPU (engine/blend.ts) and shader ids 17 to 25 on the GPU; pass-through groups really pass through. A mouse paints at full pressure. Brushes live in the engine data folder (`/api/brushes`), w/ an IndexedDB copy as fallback. A plain drag on the Timeline ruler now scales time (the reference's behaviour); scrub w/ the Playhead handle or Shift.

### Phases 20 to 22 (v0.9.0)
- refers-to: src/engine/text-layout.ts, src/ui/text-stage.ts, text-card.ts; src/ui/whats-new*.ts, about-dialog.ts, examples*.ts, tour.ts, onboarding.ts, theater-*.ts, library-folder.ts; src/export/still-formats.ts, src/ui/export-preview.ts; src/io/psd-import.ts, ora-import.ts, kra-import.ts, pdn-import.ts, layered-import.ts; src/media/tga-decode.ts, transcode.ts; src/engine/canvas.ts, src/ui/paint-crop.ts; src/ui/gestures.ts; src/paint/brushes-animation.ts; src/ui/paint-sliders.ts, flip-wheel.ts, brush-drop.ts, anchor-mode.ts
- kind: explainer
- logged: v0.9.0 · 2026-10-30

One text layout (`layoutText`) serves the renderer, the GPU text texture (keyed w/ `fontEpoch`), warp rects and the Stage box. `Content.canvas` (movie pixels) is written only when it differs from the movie rect; paint docs load at canvas size. The PSD reader is written from the spec (formvis uses a library this repo does not carry). Layered imports become movie-sized PNG assets per layer and mask. Videos and sounds the window cannot decode go through the engine's `/api/transcode` (the person's own ffmpeg). The gesture hub (`gestures.ts`) recognises multi-touch and turns a second finger into Shift. The Animation brush library is original (180 brushes); `.brush` import keys beyond spacing, jitter, scatter, rotation, texture, dynamics and opacity are assumptions, listed in BUILD_NOTES. Text defaults to #111111 so it reads on the default Stage. `--glass-bg` went to 99% opacity so popovers over a white canvas read as one piece. Process: the text builder rewrote `ui/text-card.ts` whole (SEDO), logged and kept.

### Phases 23 to 25 (v0.10.0)
- refers-to: src/ui/theater-carry.ts, home-theater.ts, home-files.ts, theater-preview.ts; src/ui/paint-crop-surface.ts, paint-view.ts; src/io/brush-export.ts, bplist-write.ts, safe-unzip.ts; src/media/font-bundle.ts, fonts.ts, video.ts; src/engine/push-ops.ts, flip-order.ts, normalize.ts, render.ts, blend.ts, transform.ts, text-layout.ts; src/app/push-commands.ts, loop-commands.ts; src/ui/pen-play.ts, paint-tools.ts, tour.ts, whats-new-data.ts
- kind: explainer
- logged: v0.10.0 · 2026-10-30

Theater carry is pointer-based (6 px or a 380 ms hold), one ghost moved by transform; a 650 ms hover enters a stack, stacks never nest. The manual order is the engine's (`.order.json` per folder); old localStorage orders are handed over once. The on-canvas crop surface shares the bake maths w/ the old dialog, which stays as the fallback under 560 x 420; Ctrl+Z falls through to the movie history when the paint document has nothing left and the top step is the crop. Brush export writes keyed binary plists; the value scales and the newer dynamics keys are assumptions (header of brush-export.ts). Fonts: one dynamic CSS import per family, Noto faces loaded per script as text needs them (`fontCss` falls back per glyph; Japanese before Chinese in the fallback order). Alpha video needed only `alpha: true` on every CanvasSink. Every movie entry point goes through `unpackMovie`, which runs `normalizeMovie` on the movie and its history states. Pixel-only blend surfaces are sized to the destination, never stretched; the Warp / Distort / Bones flat surface is capped at 8192 a side and 48 MP (`flatScale`, `WarpView.srcScale`). `levelFrameOf` gives the group-local frame for parenting. Text layouts are cached per style, text and movie size, cleared w/ the font epoch. The GPU probe drops only its own textures (`dropLive`). `paint-tools.ts` builds each variant once and toggles it. A Home DOM growth seen in review is the Recent grid filling to its 20-item cap, not a leak. Process: no SEDO breach was reported by this turn's builders.

### Phases 26 to 28 (v0.11.0)
- refers-to: src/engine/layer-split-ops.ts, frame-cache.ts, warp-draw.ts, flip-draw.ts, flip-ops.ts :: pasteIntoFree; src/ui/theater-storage.ts, paint-sample-all.ts, warp-drag-preview.ts, brush-thumb.ts, canvas-words.ts, stage-gesture-cache.ts, title-name.ts, tips.ts, text-edit-menu.ts; src/media/key-thumbs.ts; src/paint/brushes.ts :: keepCorners, stroke.ts :: pixelPerfect
- kind: explainer
- logged: v0.11.0 · 2026-10-30

Stage view changes go through `scheduleView()`, which keeps the cached picture and moves it w/ a CSS transform; a real render follows 160 ms after the gesture or past a 2x scale change; every other change marks the picture stale. The frame cache keeps finished Stage frames as ImageBitmaps (384 MB cap), never incomplete frames or frames w/ video, is dropped on any change of movie object, view, background, preview, camera mode or GPU state, and renders ahead only while cheap; look-ahead uses an HTML canvas because an OffscreenCanvas anti-aliases clip edges differently. The profile showed 72% of playback time in software `drawImage`, so a worker adds nothing on a loaded machine w/o spare cores; export still yields per frame. Filmstrip tiles decode from the nearest key frame (exact within 0.2 s), over 3 decoders, cache tag k2 (older entries dropped). Warp triangles are pushed out 0.75 px against seams; `options.resample` is written only when not the default. Shipped brushes keep corners: `keepCorners` lowers smoothing so the card's Stabilization (now read by the stroke as `stabilizationRope`) adds back to the old total. Escape no longer finishes a Drawing. Process: a third-audit auditor appended its item table to its own planning file w/ a shell `cat` (planning sidecar, not the repo); logged.

### Phases 29 to 31 (v0.12.0)
- refers-to: src/engine/sparse.ts, render.ts :: drawFrame exact, drawLayers, composeLayer; src/ui/stage-drag-cache.ts, stage-view.ts :: content signature, dispose; src/media/video.ts :: VideoSampleSink, toCanvas, EXACT_BEHIND; src/ui/brush-disk.ts, brush-store.ts, brush-panel.ts :: Show brush folder; src/io/recovery.ts :: keepLive (WebSocket); src/engine/layer-split-ops.ts; src/ui/colour-panel.ts :: split reticle; src/ui/flip-strip.ts :: Paste and Insert; src/ui/dropdown.ts, timeline.ts :: holdFor, thumbStale; src/ui/stage-fringe.ts :: dispose
- kind: explainer
- logged: v0.12.0 · 2026-10-30

Playback cost here is per destination pixel (about 3 ns), not per source pixel: a proxy (downscaled source) cache was built, measured to give nothing and removed (`engine/proxy-cache.ts` and its `opts.proxy` hooks in render.ts; `composeLayer` keeps an ignored `_proxy` parameter its caller passes). What helped: `sparse.ts` scans each decoded bitmap of 160k px or more once for ink bands and clips the draw to them (axis-aligned, plain composite only), T200 cold 12 to 17.7 fps, UHD 20 to 23.7. The clip moves 4 to 11 anti-aliased edge pixels a frame by up to 16 levels, so exports and the export preview pass `exact: true` and draw whole. Dropping `willReadFrequently` on pooled surfaces measured no change and was reverted. The drag cache composites the tracks below and above the moved blocks once per gesture; the mid-drag picture can differ on about 1,000 low-alpha edge pixels (8-bit premultiplied storage of the above bitmap), gone at release. Stage redraws are keyed by a content signature, so a Timeline edit that changes nothing visible draws nothing; Timeline thumbnails are renewed once at pointerup (`thumbStale`). Video seeks decode samples and convert only frames kept in the window. Brush sync deletes only ids the window knew, runs under a Web Lock and tells other windows through a BroadcastChannel. The frame cache key carries the font epoch. Process: the brush-files builder rewrote `backend/app/routers/brushes.py` largely in place (320 lines added); reviewed by the review round, logged and kept.

### Phases 32 to 35 (v0.13.0)
- refers-to: src/engine/gpu/mesh.ts, gpu/tree.ts, render.ts :: needsCpu; src/export/export-worker.ts, worker-host.ts, worker-protocol.ts; src/ui/a11y.ts; src/engine/asset-gc.ts, io/fmo.ts :: MAX_SAVED_STEPS; src/ui/help-center.ts, tutorials.ts, tutorial-steps.ts; src/ui/brush-studio*.ts, paint/studio-render.ts; src/media/recorder.ts, audio-edit.ts, ui/voice-panel.ts, sound-card.ts; src/paint/grains-lib.ts, tips-lib.ts, brush-materials.ts, wet.ts, render-modes.ts, curves.ts, tiles.ts, pump.ts; src/engine/snap.ts, fit-ops.ts, marker-ops.ts, retime*.ts, time-stretch.ts, transitions.ts, transition-draw.ts, key-fast-ops.ts
- kind: explainer
- logged: v0.13.0 · 2026-10-31

The owner judged parity by depth, not rows, so depth analyses (`DEPTH_GAPS_*.md` in the sidecar) drove the second half of this release. GPU: meshes (Warp, Distort, Bones) and layer trees / row masks left `needsCpu`; parity w/ the CPU raster is within rounding except a few hundred pixels of the discontinuous blends (hard mix, darker / lighter color) used as clip or group blends; on software GL the GPU is slower and the auto switch keeps it off. Transition frames bypass the GPU and mix on the CPU. Export renders in a Worker w/ the same `Run` and `Renderer`; sound is mixed on the main thread and sent as PCM; movies w/ video fall back to the main thread. Grains (54) and tips (79) are generated at runtime from seeded noise and cached, not shipped as images. Wet paint mixes in a Kubelka-Munk-style model written here; a big blending brush at 4K still costs about 2 s per 40 samples. Paint layers park as 128 px tiles when idle and unpark on first read, so the paint API is unchanged. Brush fields and their export keys are optional and `fm`-prefixed. Saved history keeps the newest 2,000 steps and halves on a string-size error. Process: no repo SEDO breach reported.

### Phases 36 to 39 (v0.14.0)
- refers-to: src/engine/fx/ (registry.ts, shadow, glow, colorcorrect, vignette, pixelate, directional-blur, radial-blur, motion-blur, key, fx2-cpu, fx2-glsl); src/engine/text-rich.ts, text-anim.ts, text-phase.ts; src/engine/shape*.ts, gpu/shaders-shape.ts; src/media/audio-dsp.ts, audio-dsp-worker.ts, audio-dsp-client.ts, engine/audio-fx.ts; src/export/delivery.ts, anim-image.ts, psd.ts, worker-video.ts, audio-export.ts; src/engine/bin-ops.ts, ui/media-bin.ts; src/paint/paint-worker.ts, ui/paint-bridge.ts, paint/shine.ts, dry-media.ts, io/palette-io.ts; src/engine/flip-time.ts, ui/flip-xsheet.ts, flip-tools.ts, flip-underlay.ts; src/engine/normalize.ts :: unknownLanes
- kind: explainer
- logged: v0.14.0 · 2026-10-31

Effects plug into one registry (`engine/fx/registry.ts`): an effect is a file that calls `registerEffect`, w/ params, a pure CPU function and a GLSL twin; lanes are `fx:<id>`; uniforms must not be named `uSize` or `uBox`. Lanes of an unknown kind (a removed effect, a newer file) move to `unknownLanes` on load and come back when the kind exists, so nothing is lost and nothing throws. Motion blur averages sub-frame poses in float on the CPU raster. Text runs, shadow, box and animators share `layoutText`; the GPU text signature includes the animation phase. Shapes are a content kind w/ 33 keyable channels and draw on the CPU raster under the GPU. Audio effects are our own DSP (no Web Audio nodes) run in a worker on the used span only, so playback equals export sample for sample. Exports w/ video decode in the worker (`WorkerVideo`, same frame choice as `VideoPool`). The paint worker owns a mirror of the active layer and returns dirty rects as transferables (no cross-origin isolation, so no SharedArrayBuffer); undo / redo wait for a landing stroke; the selection cache is 4 ids on both sides w/ a miss message. PSD and APNG writers stream and cap memory. Process: the wet-paint builder ran one `sed -i` on `paint/wet.ts` for a debug switch and reverted it by Edit (SEDO breach, logged; the reviewer found no residue).

- refers-to: src/ui/brush-import-dialog.ts, brush-drop.ts, brush-panel.ts, paint-view.ts :: importFileWithPreview
- kind: decision
- logged: v0.15.0 · 2026-10-31

Every brush file import (.abr, .brush, .brushset, .brushlib) opens one import preview (Dialog, built once, rows filled while hidden and patched in place; thumbnails drawn lazily for visible rows in idle time with the engine's own `renderBrushPreview`). Only a lone plain brush with no notes skips it. "Tips only" is applied at landing by `tipOnly` (the old plain-tip brush) so the parser needs no option. "Add to the current library" reuses `addImportedSet` per set, so no new store method. Two small hooks: the paint view's key handler ignores keys inside `.fm-bi-list` (it ate Space and Enter), and the Brushes panel no longer closes on pointer or Escape inside a dialog scrim, so it is still open after an import.

### Phase 40 (v0.15.0) · Timeline gaps (FT-GAP-01, 02, 03, 06, 08, 09, 11, 12, 15, 16, 17, 27)
- refers-to: src/ui/timeline.ts, timeline-heads.ts, timeline-marks.ts, timeline-view.ts, content-menu.ts, popover.ts :: openSub, track-menu.ts; src/engine/lock-ops.ts, ops.ts, types.ts :: Track.locked; src/app/timeline-view-commands.ts
- kind: decision
- logged: v0.15.0 · 2026-10-31

The chip checkbox hides the track (the model hides tracks), not one block; an Alt-click per-block hide was left out. A drag dropped between lanes or past the last lane moves the block onto a new track and removes the track it emptied, so a lone block just reorders. Track lock is `Track.locked`, enforced in ops (move, trim, split, delete, paste) and in the Timeline hit test. The header column shifts frame zero (LEFT) instead of resizing the canvases, so nothing relayouts; it cycles off, full, narrow and is kept in localStorage. Block menu sections are nested submenus: `Popover.openSub` now keeps a parent submenu open when the row lives inside it. Removed: the right-end-only group arrow stays, the old red Free Trim stub handles became bracket handles (small blocks keep the stub). The ruler shows seconds under 3 px a frame, frame numbers at every tick from 20 px.

### Phase 41 (v0.15.0) · pen tablets
- refers-to: src/paint/pen-sample.ts, pen-device.ts, pen-arbiter.ts, input.ts; src/ui/pen-settings.ts, paint-feel.ts :: attachPenStorage, paint-view.ts :: barrelAction, settings-dialog.ts; src/styles/pen-settings.css
- kind: explainer
- logged: v0.15.0 · 2026-10-31

One pipeline for every pen: `PenInput` reads each PointerEvent with `readPointer` (raw pressure, 1-pole smoothing in ms so 60 and 240 Hz feel alike, the device curve w/ min and max from a 256-entry table, then the older global curve, which stays and defaults to linear). A pen touching down with pressure 0 is a missing value, not a light touch: that sample is held and back-filled w/ the next real pressure (after 6 missing in a row the device is taken to have none and gets 0.5). The lift event's pressure 0 is replaced by the last pressure. The device key is the driver id when given, else `pen:w{min}-{max}:t{0|1}` (contact size range, tilt ever seen; tilt is learned and stored so the key does not flip on a stroke drawn upright). A profile saved for a key owns the curve, range and smoothing; editing while one exists edits the profile. Settings live in `formmorpheus.pen`; `paint/` stays pure because storage is handed in (`attachPenStorage` in paint-feel.ts). Arbiter: pen in range (any pen event within 500 ms) or down makes touch navigate only; a touch 44 px or wider (after a pen was ever seen) or within 24 px plus its width of a pen that is down is dropped at its pointerdown and ignored until it lifts; two fingers no longer cancel a pen stroke. Eraser end (button 5 or buttons 32) erases for that stroke; barrel 1 (button 2) and barrel 2 (button 1 or buttons 4) run an action: eyedropper, right-click menu, undo, pan, cycle tool, none. Pen button 1 no longer pans on its own (barrel 2 can). Pen settings win over the older Draw & Paint rows ("Pen button", "Pen eraser end erases") once set; unset they follow those rows. Events the app dispatches itself (isTrusted false, source 'link') are read like real pen events; the canvas wraps set and release pointer capture because a synthetic pointerId has none and the call throws. Chromium CDP cannot send eraser or barrel bits (`buttons` is derived from `button`: left 1, middle 4, right 2), so the eraser was verified w/ synthetic PointerEvents. The Stage records motion and does not paint, so pressure and tilt apply only in Draw & Paint. Not done: the WebView2 press-and-hold right click and flicks have no verified switch (no browser argument known to turn them off; a wrong `additional_browser_args` replaces Tauri's defaults), so only `touch-action: none`, no callout and a `contextmenu` preventDefault on the canvas and test pad are in place. No native tablet crate (see research section 2: only if a hardware test shows pen arriving as mouse).

### Phase 42 (v0.15.0) · Draw & Paint interface (GP-001 to GP-014)
- refers-to: src/paint/quickshape.ts, src/ui/paint-quick.ts, paint-size.ts, paint-bubble.ts, paint-drop.ts, paint-tools.ts, paint-view.ts, paint-settings.ts, flip-strip.ts, layers-panel.ts; src/styles/paint-ui15.css
- kind: explainer
- logged: v0.15.0 · 2026-10-31

QuickShape: a 500 ms dwell at stroke end fits line, arc, ellipse, rectangle or polygon (pure fitting in `paint/quickshape.ts`), the live stroke is cancelled and restamped from the shape with the pressure profile resampled by arc length; Shift regularizes, Shift+click draws a line from the last point; pref `quickShape` (pen only by default). The size slider uses a power curve (exponent 2) applied in the host (`paint-size.ts`), because `paint/dynamics.ts` belongs to the wet-media builder and keeps its linear 0..1. The default brush is the animation set's lead stub at about 10 px. Flipbook strip header keeps six controls, the rest sit in a More panel that reuses the same buttons. Blend list is grouped with live preview and commits on a tap outside. ColorDrop: "Continue filling" pill and tick, threshold line, remembered threshold clamped to 0.976. Select defaults to Automatic with a threshold line and cyan candidate tint. Layers: Alt-click alpha lock, Alt+Shift merge, swipe-left actions by mouse and touch. Hold-to-pick for pen and mouse behind pref `holdPick`. Filter screen is a dimmed interface with a title chip, a bottom pill and a right column of tiles. Finish menu has a Help submenu and Discard asks first. Not done: Select capsule trim (GP-015), strip cell tiers (GP-020), prefs order (GP-012); hold-to-pick and Edit Shape menu not exercised in the browser.

Follow-up, QuickShape lost strokes: not reproduced on the current tree. With CDP pen strokes on Lead stub, Chalk, Ink, Paint, Bristle, Airbrush, Graphic, Texture, Sponge and Script a circle held 1.8 s (still, or moving, or moving then still) snapped to its ellipse, a second stroke landed, and four strokes took four undo steps; Wash (a wet brush) did not snap and drew normally; Shift+click line plus a later stroke also undid in two steps. The likely cause was a wet or drying brush, which the `allowed` callback now keeps out (kept as is). One hole was closed in paint-view.ts: `qsPointer` was never cleared, so a late dwell timer or frame after the stroke ended could start a stroke nobody would lift and swallow the next pointer. `qsRestamp` now returns when no stroke is live and no Shift line is under way, and `qsPointer` is reset in `up`, `cancelStroke` and `qsReplace`. The toast text, Edit Shape and the kind names already go through `tr()`.

### v0.15.0 shell (G01 to G07, G11, G17, G20, G22): the reference's document model

**Decision (G01).** A movie is a file in the Theater from the moment it exists; there is no unsaved state. Why: the reference has no Save, and the old model lost work and hid new movies from the Theater. How, in `app/app.ts`: (1) `adopt()` runs whenever `engine.open` leaves `libraryName` null (New Movie, a Start-page size, a `.fmo` opened from outside, a recovered movie): it picks a free library name ("Untitled Movie", "Untitled Movie 2", checked against the library listing, never overwriting), sets `libraryName` and writes the file with a poster before anything else happens. (2) Every step (`engine` event `history` while `modified`) calls `scheduleSave()`: write 400 ms after the last step, at most 3 s after the first, longer for a movie that is slow to write (3 times the last write time, capped by 6 times), run from `requestIdleCallback` (1.5 s timeout) so a stroke is never held up; one write at a time through a promise chain; the engine's PUT writes a part file, fsyncs and renames, so a kill leaves the old or the new file. A step made while a write is in flight keeps `modified` true and schedules another. A failed write toasts once, keeps the work in memory (and in the crash snapshot, which only clears when the movie is no longer modified), and retries in 5 s. The 30 s interval stays as a safety net; the Preferences "Autosave" row now only sets that net. A hidden tab writes at once. (3) Ctrl+S ("Save") writes now with a fresh poster and a 1.2 s "Saved" notice. Save As became "Duplicate as..." (`Shift+Mod+S`): a copy in the library under a free name with a new movie id; the open movie stays open. (4) Closing, leaving for the Theater and opening another movie never ask: `askToKeep()` now only guards a running export and writes the movie. Leaving for the Theater (`toTheater()`) waits up to 700 ms for the write so the tile is current when the wall shows. (5) The poster is the Stage drawn at the Playhead frame (`stage.snapshot(480)`), taken fresh on leave and on Ctrl+S, reused up to 5 s on autosaves. (6) `.fmo` export and share are unchanged. (7) The title bar lost its unsaved dot (`movieLabel`).

**Removed.** The "Save Movie" name prompt on the normal path, the "Unsaved changes" confirm, and the dirty dot. `beforeunload` still guards the few hundred ms between a step and its write.

**G17 posters.** A movie without a poster (recovered, old) gets one when the Theater first draws its card: `ui/poster-maker.ts` reads the movie, draws the first frame that shows something on a private `Renderer` (the open movie is untouched), and PUTs it to the new engine route `PUT /api/library/{name}/poster`, which rewrites the zip with every other entry copied across, writes only when none exists, keeps the file's modified time (a poster is not an edit, so the Theater order holds), and replaces atomically. Not done: the Playhead frame is not stored in the movie header, so a lazily made poster uses the first busy frame.

**G02, G04.** `ui/undo-banner.ts`: hold-repeat on the Stage and status-bar buttons (`HoldRepeat`, delay = the Rapid undo delay, 80 ms step), the first step on press and the click that follows swallowed; the two- and three-finger hold reads the same delay. The banner names the step ("Undo Add Solid", "Undo Add Solid, 6 steps" while a burst runs, 1.5 s) for every source because it listens to the engine's own undo and redo notices; the gesture toasts were removed as duplicates.

**G03, G05, G20, FV-211.** Movie settings is one 372 px panel of a fixed height computed once per opening (room above the toolbar button, 300 to 560 px): a scrolling body over a bottom tab bar (icon over label, order Project, Stage, Timeline, Share, Prefs) that never moves; the open state fills the toolbar button. Playback is three radio rows with a check circle. About this artwork is a row with a small picture; Author a row. Prefs: Rapid undo delay slider (150 to 1000 ms, step 50) with a value chip, "Undo and redo buttons" toggle, Keyboard shortcuts, a Gestures page (six toggles with generic pen wording) and More settings. The Name field renames the library file. G22: the status-bar Undo and Redo give way while the Stage pair shows.

**G06, G21.** Theater poster wall (`styles/theater-wall.css`, top bar in `ui/home.ts`): gradient ground, wordmark at the left with a sidebar toggle (closed by default, remembered, closes after a choice), Select and "+" at the right, 16:9 borderless posters (radius 8, soft shadow), centred 13 px caption, kind and age in the tooltip. Filter, sort and view sit behind the "..." button, and appear by themselves while selecting or inside a stack. The hover delete waits 450 ms. Select-mode buttons do not wrap. Not done: the Gallery/Library layout setting (G06 asked for it); the Library look is reachable through the "..." row only.

**G07.** New Movie: Wide screen opens at 4K on a display of 1440p or more (HD below that); "Flipbook" and "Empty" are the two primary buttons and create at once; Enter creates with the last choice.

**G11.** Already padded in `clampScroll` (switch height plus 24 px): verified in the browser that scrolling to the end clears the last lane.

## v0.15.0 brush engine (FB-G01 to G10, G12)

**Decision.** Charge, burnout and fall off decay per distance in brush diameters, not per dab (`wet.ts` prepare, `stroke.ts`): a glaze runs low over 70 diameters at charge 0 and never below 0.3 load, a blending brush over 24. Fall off now fades opacity (it shrank the size before); `scatter` keeps meaning position (renaming it needs the Studio and `.brush` import, owned elsewhere: not done).
**Decision.** New `paint/bristle.ts`: a bundle of 10 to 72 hairs, each a continuous capsule with its own tone, length, wobble and paint, picking up the canvas as it was before the stroke (`Brush.bristle`, optional). Moving grain at movement under 0.9 slides with the brush; at 0.9 and over it is canvas anchored (the rotated frame made swirls on curves). Brushes with `bristle` skip `WetPaint`.
**Decision.** Watercolor: `wet-dry.ts` works in 192 px blocks with a margin (only blocks the stroke touches), rim from a crisp mask of the per-dab-flow coverage map (`edge`, one byte per pixel, pooled), rim 1.5x and interior 0.8x at wetEdges 1, pen-up bead, granulation by the paper tooth. Glaze alpha is `1 - exp(-1.6 f)` scaled to 1. `wetmap.ts` keeps a per-layer wet map (64 px tiles, dry time from pen sample times, no timers): a wash over a wet one bleeds (premultiplied blur near the stroke) and skips the rim. The wet map lives in the thread that paints, so worker and main thread agree for a session.
**Cause of the straight-edged tone blocks (G07).** Not the dirty rect: the worker returned only the last call's rectangle after `dryWash` had reworked the whole stroke. `paint-worker.ts` now returns the patch rectangle for `dries(brush)` brushes.
**Decision (G06).** A blend mode and luminance blend now apply inside `WetPaint.paint`; the wet model is no longer turned off by them.
**Decision (G09, G10).** `dry-media.ts` sets the pen floors to a response table (a 0.15 press against a full press: size 0.45 to 0.6, flow 0.25 to 0.45). Tilt shading: long axis 1+3k along the lean, short axis 1+k, so a pen leaning along the stroke still widens it.
**Known.** Faint 1 px vertical ticks on some bristle strokes; oil stroke ends are cut square; tilt size compression and per-pen grain are not done.

## v0.15.0 visual pass (FV-204, 205, 207, 209, 210, 202)
**Decision (FV-209 motion).** Popovers, menus, dialogs and the Edit pill animate with CSS keyframes that fire when `hidden` turns off on an already-mounted node: `scale .96 to 1` plus opacity, 140 ms (`--dur-pop`, `--ease-glass`), dialogs rise 8 px in 180 ms, the pill pops from 0.9 in 100 ms. `scale` is the individual property so it composes with the `translate()` transform that places the card and the `translate` property a dialog drag uses. `backwards` fill, so frame 0 is opacity 0 and nothing flashes. `popover.ts` and `menu.ts` now measure with `offsetWidth/offsetHeight` (a scaled card must not shift its own place) and set `--fm-ox/--fm-oy`, the anchor point the card grows from. Closing is instant on purpose: a lingering card would sit over the next press. Reduced motion: `animation: none` here and the global rule in `a11y.css`.
**Decision (FV-210).** Tokens `--radius-2xl` 24 (Stage, Timeline, dialogs, Movie Settings), `--radius-pop` 18 (popovers, menus), `--radius-row` 12; `--glass-menu-bg` (82 percent) and `--glass-menu-filter` for `.fm-pop` and the `.cv-menu` family. `--glass-bg` stays dense for panels over the white canvas. `--radius-xl` is left at 12: it is used in too many places to move in one pass.
**Decision (FV-204).** `ui/create-menu.ts` replaces the plain list: "Add new", four tiles, Photo, Video, File rows, and a More row whose rows are built on first open (the commands are registered after the menu is made). The "+" button holds `is-on` (solid accent) while it is open.
**Decision (FV-202).** `add-drawing`, `add-flipbook` and the frame-rate Flipbooks only insert and select; the Edit pill opens Draw & Paint. The old behaviour is the checked command "Open Draw & Paint after adding" (Create > More), stored per viewer by `ui/create-pref.ts`. A Settings row for it was left to the settings owner.
**Decision (FV-205).** `a11y.css`: the Stage shows a 1 px quiet inset hairline on keyboard focus only; a container that only holds focus (`tabindex=-1`) shows none. **Not done here:** the paint canvas frame (accent 2 px stroke over a dark 4 px rim, drawn in `paint-view.ts` draw(), "the canvas edge is a clear accent outline") belongs to the Draw & Paint file; it should become one 1.5 px `rgba(255,255,255,.9)` round stroke, radius 12, no rim.
**Decision (FV-207).** `.fm-modes` is a fully round capsule, three items of min 76 to 100 px, 24 px glyphs, no box behind the active item: glyph accent and filled, label white, color crossfade 120 ms. The Edit pill is 32 px high, 14 px bold, with a checkbox glyph drawn as a CSS mask.
**Removed.** The accent tint box behind the active mode; `CREATE_ITEMS` in `app/app.ts`.

### Phase 43 core (v0.15.0) · brush presets from .abr files
- refers-to: src/io/abr.ts, abr-desc.ts, abr-patt.ts, abr-map.ts, brush-import.ts :: brushesFromAbr, ImportResult.notes
- kind: explainer
- logged: v0.15.0 · 2026-10-31

An .abr import now makes one brush per preset (the `Brsh` list), not per tip: `abr.ts` reads the binary layer into `AbrFile` (samples, patterns, presets with folder paths, legacy v1/v2 brushes, warnings), `abr-desc.ts` reads every descriptor type (a type with no length, `ObAr`, stops the walk and keeps the partial tree; presets cut short without a tip are dropped), `abr-patt.ts` decodes patterns, `abr-map.ts` maps keys to Brush fields group by group and returns notes plus unread keys. Folders come from nested `Brsh` lists or from `phry` (used only when its preset count equals the preset count). `brushesFromAbr(buf, base, {applySettings, absoluteSizes})` returns `sets` (one per folder, nested folders joined as "A / B", root presets in a set named after the file), `libName` = the file name, `notes` per brush id and `skippedKeys`; `parseAbr` stays as a pictures-only view.
**Decision (calibrated by painting a synthetic file, `scratchpad/w15_abr/make_abr.py`).** Angle: the file turns counter-clockwise, the canvas clockwise, so `baseRot = -Angl`; with Direction control the engine's angle 0 lies across the stroke, so `baseRot` also gets -90 degrees and an arrow tip then points along the stroke in both axes. Grain: the pattern is mapped into the 0.3 to 0.7 band of the 256 tile (the stroke reads tooth from that band), light = tooth holds paint; a 64 px pattern at 100 percent paints dots of its own size (tile repeated 4 x, `fit` factor 1); a pattern over 256 px is shrunk to the tile (`fit` = w/256) and blended seamless; a flat pattern (range under 96) is stretched. Size fade: `fallOff = (1 - minimumDiameter) / 0.85` (min 0.15); the engine's fade length is about 25 dabs at the default size, so the file's step count is not carried (noted). Size jitter: `jitterSize = jitter * (1 - minimumDiameter) / 0.7` because the engine drops size by up to 0.7 of the jitter. Roundness jitter sets only `roundJitterH` (both axes would also turn the stamp). Sideways scatter: `pathJitter = jitter / 50` (the engine offsets by half the amount). Tilt size uses `tiltSize`, not `tilt`, so the dab does not widen. 16-bit tips: levels 0 to 32768 scale by 255/32768 (65535 if any value is higher). Tips over 512 px are box-reduced, `maxSize` capped at 400 with a note. Sizes scale with the canvas unless `absoluteSizes`. Tips-only mode keeps the old pressure defaults ([0.5,1] size, [0.7,1] flow); with settings, pressure is off unless the preset's controls say so.
**Not carried (noted per brush).** Dual brush, brush pose, purity, build-up, mixer settings, stylus wheel, pen rotation on angle, size/flow control by anything but pressure, tilt, fade and rotation, scatter and count controls, zip-compressed patterns, bristle and erodible tip shapes (drawn as this app's bristle tip or a soft round tip), the real fade length. Bitmap-mode patterns treat a set bit as black (unverified against a real file). The control numbering (5 rotation, 6 initial direction, 7 direction) follows the community table and was not checked against a real file.
**Removed.** `readDescSpacing` and the per-sample spacing/name matching in `abr.ts` (the preset descriptor now carries them), the fixed `Computed`-to-sample baking in the import path, and the 16,000,000 pixel drop.

### Phase 44 keys (v0.15.0) · Stage transforms, Action card, Perform takes
- refers-to: src/ui/stage-view.ts, stage-compose.ts, stage-hud.ts, key-lanes.ts, key-snap.ts, action-menu.ts, perform-ui.ts, popover.ts :: toCentre, fromCentre, StageHud, snapKeyFrame, setEasePreview
- kind: explainer
- logged: v0.15.0 · 2026-10-31

**Decision.** Compose edits only the base `transform` and never writes keys. The pivot is real data, so Compose converts: with pivot P and linear part M, t0 = t + (I-M)P, and the store inverts it (`stage-compose.ts`). The old "Compose follows animation" lane condition in `keyedFor` is removed; keys still drive the picture and a toast says so once per content.
**Decision.** Scale channels (scaleX, scaleY) have min -20 in `engine/keys.ts` so a side node pulled past the opposite side flips; the size floor is `0.02 * abs(base)`.
**Decision.** Anchor is editable only in Perform and Keyframe; Compose rotates and scales about the centre.
**Decision.** `Popover` gained `keep` (elements whose presses do not close it) so the parameter card stays open during Stage drags. The Action menu is two steps (Move, Filter) with a back button, replacing the combined list.
**Decision.** Frame snapping on Stage drags only while the snap modifier is held, with a "Snapping on" chip. The old always-on behaviour is the preference `stageSnapAlways`.
**Decision.** `key-lanes.ts` keeps module-level ease-preview state (`setEasePreview`) so the lane menu can show the easing name and ticks without a rebuild. Dragged keys snap to the Playhead (captured at pickup as `keyHome`, since the live Playhead follows the key) and to other keys.
**Decision.** Perform: roll default 100 percent, banner "Ready" then "Action", R/Ctrl turns and S scales with the mouse during a take, Retake and punch range and pre-roll in `perform-ui.ts`; a take is one undo step via history depth (`perform.markTake`). Dense keys returned when filtering is 0.
**Decision (tester round).** R and S are remembered by `StageView.modsHeld` from any keydown (cleared on window blur), so a key held before the pen comes down applies from the first sample. Perform S-drag scale is linear (`k = 1 + zoom`, 0.004 per px) instead of exponential, so it passes through zero and mirrors. One Escape closes a `Popover` and any submenu the pointer had opened (before, the first Escape only closed the submenu, which read as ignored). The reported sheared Solid was checked: the box and fill agree and are a rotated rectangle; the frame clip made it look like a parallelogram, so no composition change (`ownMatrix` is T R S T, no skew).
**Not done.** Group-drag ghost for several keys, inline numeric field at a key, `perform-retake` command entry (Shift+R is handled in the banner), union box for multi-selection.

### v0.15.0 review pass (code review and fixes)
- refers-to: src/app/app.ts :: askToKeep; src/ui/paint-view.ts :: draw; src/ui/movie-settings.ts :: openPaint row; src/paint/wetmap.ts :: layerOf; backend/app/penlink_static/pen.js :: deviceName
- kind: explainer
- logged: v0.15.0 · 2026-10-31

**Fixed (FV-205).** The Draw & Paint canvas edge is one 1.5 px `rgba(255,255,255,.9)` stroke on the picture's own edge (radius 12 where the canvas is rounded); the 4 px dark rim and the 2 px accent outline are gone.
**Added.** Movie settings > Prefs row "Open Draw & Paint after adding" (`create-pref.ts`), the same choice as the Create card's More row.
**Fixed.** `askToKeep` (leaving or closing a movie) now only asks when the final write failed or the engine is down; before, a failed write was silently discarded on close because the document model never prompts.
**Fixed.** `wetmap.ts` kept a wet map per layer id forever (worker lifetime); it now keeps the 24 most recent layers.
**Fixed.** The paired-device label no longer names a tablet brand: `Tablet` or `Browser`. Comment in `pen-link.ts` likewise.
**Not reproducible.** `touchMove is not a function` from `layers-panel.ts`: the method exists and one-finger and two-finger touches on a row run clean in Chromium; it came from a Vite hot update caught mid-edit.
**Known, left.** Console warning "shortcut P is the default of both shape-pen and paint-play" is older than v0.15.0 (the two commands live in different modes).

### v0.15.0 brush engine, tester round (watercolor in the real app)
- refers-to: src/paint/wet.ts :: WetPaint; src/paint/wet-dry.ts :: dryBlock; src/paint/wet-dry.ts :: bleed; src/paint/stroke.ts :: finish
- kind: explainer
- logged: v0.15.0 · 2026-10-31

**Cause of the fade.** Every dab mixed paper-white into the brush reservoir, slowly diluting the pigment, so a long stroke ran dry. Pickup now skips bare paper (`pg < 0.05`), and the glaze load decays per distance with `D = 250 * diameter` and a floor of 0.7 (`wet.ts`). A 4700 px stroke now reads 0.98 to 1.01 of its first 500 px.
**Decision.** Rim multiplier 2.6 (was lower) so the edge is clearly darker. Bleed reach `R = 3.2 * radius` with the work rectangle expanded by `0.7 * diameter` so a wet neighbour is inside the block; a stroke started within 4 s of a touching stroke now runs colour into it (3 s apart bleeds, 30 s apart stays crisp).
**Decision.** Pen-rest beads: `Stroke.pools` records a rest (gap over 120 ms and movement under max(3 px, 0.03 px per ms)), passed to `dryWash` as `ends`; the end of the stroke gets a bead of 0.6 times the pool strength. Worker and main thread give 0 differing bytes with a pause.
**Found, not mine (ui/paint-quick.ts, DWELL_MS = 500).** With QuickShape on `Pen` (the default), holding the pen still for 500 ms snaps and replaces the stroke, so a 1.8 s pause in the real app never reaches the brush: the stroke is thrown away and the next one is lost. The tester must set QuickShape to Off for pools; with it off a 1.8 s rest gives a dark bead. Suggest the owner skip the snap for wet brushes or lengthen the dwell.
