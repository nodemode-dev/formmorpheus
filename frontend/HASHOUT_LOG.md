# HASHOUT_LOG · frontend · formmorpheus

Living log of all comment content, explainers, rationale, TODOs, & removed code for the interface. Source files stay comment-free; everything they would have said lives here, indexed. Read this first, then edit code surgically.

Current build version: v0.7.0
Last updated: 2026-10-30 · phases 13 to 15 (paint and Flipbook carries, Warp and Distort, the GPU compositor, stability debt)

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
