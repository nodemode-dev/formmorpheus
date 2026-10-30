# formmorpheus Manual

formmorpheus is an animation studio: a **Stage** on top, a **Timeline** below. You arrange blocks of content on tracks, draw frame by frame, animate with keyframes, or perform a move live and let the app record it. This manual covers the whole app in short sections. In the app, open it from Help · formmorpheus Manual, or press F1.

On macOS use Cmd where this manual says Ctrl. The table of keys is under Keyboard shortcuts.

## Getting started

1. Start the app. The **Home** screen opens first.
2. Choose **New movie** (Ctrl+N), pick a size and a frame rate, and press create. Or choose **New flipbook** to start a frame by frame animation.
3. Add content with the round **Create** button at the right of the Timeline: Drawing, Flipbook, Text, Track, or Import.
4. Press Space to play. Press Space again to pause.
5. Save with Ctrl+S. The first save asks for a name.

You can also drop pictures, video or sound anywhere on the window to bring them into the movie.

## The screen

- **Title bar and menus**: File, Edit, Movie, Content, View and Help. On macOS the menus can sit in the system menu bar, or in the window (View · Menus in Window).
- **Stage**: the movie frame, with a dimmed backstage around it. Content shows here as it will export. A timecode shows the Playhead position.
- **Timeline**: tracks of content blocks, with the Playhead, the play controls, the Movie settings button, Multi-select and the Create button.
- **Split**: drag the line between Stage and Timeline to give either more room. The place is remembered.
- **Status bar**: shows the engine state, running jobs and short notices.
- **Command search**: Ctrl+K lists every command. Type a few letters and press Enter.

Drag the Timeline with the wheel: the wheel scrolls tracks, Shift+wheel or a sideways swipe moves in time, Ctrl+wheel zooms. Ctrl+= and Ctrl+- zoom, Ctrl+0 fits the whole movie.

## Modes

The three modes change what dragging on the Stage does. Switch with Ctrl+1, Ctrl+2 and Ctrl+3, or from the View menu.

| Mode | Keys | Dragging a block on the Stage |
|---|---|---|
| Compose | Ctrl+1 | moves, scales and rotates it as a plain edit |
| Perform | Ctrl+2 | plays the movie and records your gesture as keys |
| Keyframe | Ctrl+3 | writes keys at the Playhead for the change you make |

## Movies and .fmo files

A movie is saved as a single `.fmo` file. It holds every track, drawing, picture and sound, and the full undo history, so you can undo after reopening.

- **Save** (Ctrl+S) writes to the movie library. **Save As** (Shift+Ctrl+S) saves a copy under a new name.
- **Open** (Ctrl+O) shows your movies. **Open Movie File** (Shift+Ctrl+O) opens a `.fmo` from anywhere.
- **Open Recent** in the File menu lists your latest movies.
- **Share Movie File** downloads a `.fmo`; with history, it keeps the undo steps too.
- **Autosave** can write the open movie every 10 seconds to 5 minutes (Preferences · General).
- **Movie settings** (Ctrl+J): size up to 3840 pixels a side, frame rate presets from 12 to 120 and custom, duration by timecode, transparent background, and playback as loop, ping pong or one shot.

Where the library lives is shown in Preferences · General. The `FORMMORPHEUS_LIBRARY_DIR` variable moves it.

## Compose

In Compose you build the structure of the movie.

- **Select** a block by clicking it. Shift, Ctrl or Cmd adds to the selection. Multi-select (Shift+M) turns every click into an add. Drag in an empty area to box select. Ctrl+A selects all.
- **Move** a block in time by dragging it along its track, or to another track.
- **Trim** by dragging either edge. Hold Alt for **Free Trim**, which ripples the neighbours.
- **Split** at the Playhead with Ctrl+B.
- **Duplicate** (Ctrl+D) or **Duplicate After** (Alt+Ctrl+D), **Fill Duration** to stretch a block to the next one.
- **Group** (Ctrl+G) and **Ungroup** (Shift+Ctrl+G).
- **Copy, Cut, Paste** with Ctrl+C, Ctrl+X, Ctrl+V.
- **Delete** with Delete or Backspace. A Preferences option asks first.
- **Right-click** a block for its options: opacity, volume, rename, highlight color, blend mode, mask, invert, reverse keyframes, convert to Flipbook, group, and track options.
- **Right-click** a track name for track options: rename, show all, hide all, add track above, move up or down, remove an empty section, delete.

On the Stage, drag a selected block to move it, drag a corner handle to scale, and drag the rotate handle to turn it. Shift snaps rotation to 15 degrees. Moves snap to the centre and quarter lines.

**Content options**: opacity, 17 blend modes (and passthrough for groups), clipping, alpha and luminance masks with invert, and highlight colors for finding blocks.

**Undo** (Ctrl+Z) and **Redo** (Shift+Ctrl+Z or Ctrl+Y) step through your edits. A drag counts as one step. The depth is set in Preferences · Timeline, from 10 to unlimited.

## Draw and Paint

Add a **Drawing** and open it (double-click it, or use the Edit pill that appears on the Timeline) to enter the full-area canvas. Press Enter or Escape to finish and return to the Stage.

### Brushes

The library has 18 brushes in 7 sets: Sketch, Ink, Paint, Chalk, Airbrush, Texture and Wash. Three tools use them:

- **Paint** (B), **Smudge** (S) and **Erase** (E). Click an active tool again to open the brush panel.
- The side bar has two sliders, brush **size** and **opacity**. `[` and `]` change the size.
- Pen pressure, tilt and streamline smoothing shape the stroke.

### Layers

Press L for the layers panel. Each Drawing has its own layers with:

- a blend mode and opacity
- **clipping** to the layer below
- **alpha lock** to paint only where there is paint
- rename, duplicate, merge down, clear and delete

### Color

Click the color swatch for the color panel: a disc, classic squares, harmony, value sliders and palettes. Drag the swatch onto the canvas to fill a shape or an enclosed area.

### Select

The bottom capsule switches between Paint, Select, Transform and Filters. Select has four ways to pick: **Automatic** (by color area), **Freehand**, **Rectangle** and **Ellipse**. Add to or subtract from a selection, invert it, clear it (Ctrl+D), fill it, clear its pixels, or copy it to a new layer.

### Transform

Move, scale and turn the selection or the layer. The modes are **Freeform**, **Uniform**, **Distort** and **Warp**. Choose Nearest, Bilinear or Bicubic for the resampling. Enter applies. Escape cancels.

### Filters

Adjustment filters with live preview and a slider for each value: Hue, Saturation, Brightness, Gaussian Blur, Sharpen, Noise and Lens Blur. They apply to the layer or the selection.

### Zoom and pan

Use the wheel to pan, Ctrl+wheel to zoom, hold Space to drag the canvas, and press 0 to fit.

## Flipbooks and onion skins

A **Flipbook** is frame by frame animation inside one block on the Timeline. It has one or more tracks, each a row of frames that play in order and loop.

- Open a Flipbook to draw. The **frame strip** floats over the canvas.
- **Add frame** and **Add track** are the two buttons at its left.
- Select a frame to draw on it. Use the arrow keys or `,` and `.` to step.
- Right-click a frame or track: copy, cut, paste, duplicate, insert, clear, delete, rename, hide, move up or down.
- A frame can **hold** for several movie frames, so you animate on twos or threes.
- **Onion skins** show the frames around the current one, tinted for before and after. Their settings are on the **Onions** tab of the Draw and Paint settings panel.
- **Convert to Flipbook** turns a set of drawings on tracks into one. **Convert Flipbook to tracks** goes the other way.
- Play inside the Flipbook with the strip's play button to see just the loop.

## Keyframes and easing

Switch to Keyframe mode (Ctrl+3). Move or scale a block at a chosen Playhead frame and a **key** is written. Each kind of change sits on its own **lane** under the block.

- **Move** and **Scale** keys come from the Stage.
- **Live filters** are keyed from the block's card: Opacity, Gaussian Blur, Sharpen, Noise, Hue Saturation Brightness, and Lens Blur.
- **Volume** (Level) keys change a sound over time.
- **Easing** of the span that leaves a key: Linear, Ease in, Ease out, Ease in and out, or Hold.
- Expand a lane to see its channels as separate rows.
- Copy and paste keys, or choose **Reverse keyframes** from the block's menu.

Warp and Distort keys are not built yet.

## Perform

Perform records a gesture instead of placing keys by hand.

1. Select a block and switch to Perform (Ctrl+2). A banner says Ready.
2. Press on the block on the Stage and drag. The movie plays and your motion is recorded as keys at the movie's frame rate. The banner says Recording.
3. Lift to pause. Press and drag again to continue. A take stops at the movie's end.
4. Undo once to remove the whole take.

**Modifications** (the gear in the banner): **Motion filtering** thins the keys while keeping the visible motion, and **Roll sensitivity** sets how much a pen's barrel roll turns the block. Sliders on the block's card (opacity, blur and the other filters) also record while the movie plays.

## Importing media

Use Import (Ctrl+I) or drop files on the window.

| Kind | Formats | Notes |
|---|---|---|
| Video | MP4, WebM and what the browser can decode | frame-accurate; a video the browser cannot decode is refused |
| Sound | WAV, MP3, AAC, FLAC, Ogg and Opus where decodable | waveform on the block |
| Pictures | PNG, JPEG, WebP, AVIF, BMP | placed as a picture block |
| Animated GIF | GIF | becomes a Flipbook, holds taken from the frame delays |
| TIFF | TIFF | decoded by the app itself |
| Fonts | TTF, OTF, WOFF, WOFF2 | ready in the Text card |
| Movies | `.fmo` | opens the movie |

Video blocks show a filmstrip. Sound shows its waveform. Choose **Separate audio and video** on a video block to split the sound onto its own block. **Volume** is on the block's menu, and a Volume lane lets you key it.

Sound is the clock during playback, so picture and sound stay together. A sound can sit a frame or two behind the Playhead readout because of the speaker delay.

## Text

Add Text from Create. Type the words, and the Text card opens: **font** (the bundled fonts and any you imported), **size**, **weight**, **color** and **alignment**. Double-click the block to edit again. Each change is one undo step.

## Export

Open Export with Ctrl+E (File · Export). The dialog has **Quick share** tiles and **Advanced** options.

- **Quick share**: MP4 video, Animated GIF, PNG frames, Current frame, Movie file (.fmo).
- **Advanced**: movie size, 720p, 1080p, 4K, square or custom aspect-locked size; the whole movie or In and Out; one shot or ping pong; include sound; transparent background; quality from Low to Very high.

### Formats

| Format | What you get |
|---|---|
| MP4 video | H.264; sound as AAC where the browser can encode it, otherwise Opus with a warning |
| WebM video | VP9, with transparency if you ask for it |
| MOV video | the QuickTime container |
| Animated GIF | its own palette of 2 to 256 colors, Floyd-Steinberg or ordered dither, loop forever or not, exact or even frame timing, an alpha threshold, and an optional custom palette |
| PNG, JPG or WebP frames | one picture per frame, in a zip |
| PNG still | the current frame |
| Movie file | a `.fmo` to keep editing later |

### Engine formats

ProRes, ProRes 4444 (with alpha) and HEVC cannot be encoded by the browser. The desktop engine makes them with **your own ffmpeg**, which it runs as a separate program. Install ffmpeg yourself and the engine finds it; formmorpheus never ships or links it. If ffmpeg is not found, those formats are listed as unavailable with a note on what is missing. The window renders each frame, the engine encodes them, and the result appears on the Exports page.

### Where exports go

Every export downloads and is also kept in the engine's **Exports**, never overwritten (a second export of the same name sits beside the first). While an export runs you can cancel. Close the movie only after it ends.

## Home

Open Home with Shift+Ctrl+H, the Theater pill in the Timeline bar, or View · Theater (Theater is the menu's name for Home). The left list has:

- **Start**: New movie, New flipbook, Open, and a short guide.
- **Recent**: the movies you opened lately.
- **Movies**: the whole library, as thumbnails or a list, with a filter box and sorting. Rename, duplicate and delete are on each item.
- **Exports**: everything you exported. Open, save a copy or delete.
- **Recently Deleted**: deleted movies and exports stay here for 30 days. Restore one, delete it for good, or empty the list. Items past 30 days are swept away.
- **Preferences** and **Help** at the foot.

## Preferences

Open with Ctrl+, (File or Edit menu). The pages:

- **General**: show Home at launch and when the last movie closes, What's New, Autosave, the settings and library folders, and Reset All Preferences.
- **Interface**: theme (28 themes, light and dark, or match the system), accent color and intensity, language, text size, interface scale, animations, notice time.
- **Timeline**: undo steps, scrub speed, two and three-finger tap for undo and redo, and ask before deleting.

## Languages

The interface comes in 29 languages besides English: Spanish (and Mexican), Brazilian Portuguese, French (and Canadian), German, Italian, Dutch, Danish, Finnish, Norwegian, Swedish, Russian, Polish, Czech, Hungarian, Ukrainian, Turkish, Greek, Serbian (Latin), Simplified and Traditional Chinese, Japanese, Korean, Indonesian, Thai, Vietnamese, Arabic and Hindi. Pick one in Preferences · Interface · Language. Arabic switches the window to right to left. Names you give movies, layers and tracks stay as you wrote them. This manual is in English.

## Crash recovery

formmorpheus keeps a recovery copy of the open movie while you work. After a crash or a closed window, the next start offers the movie as it was. Choose to restore it, or discard it. Edit · Restore Last Recovery Point is a different thing: it returns to an automatic point saved when you made a new edit after three or more undos.

## Keyboard shortcuts

Ctrl is Cmd on macOS.

### Everywhere

| Action | Keys |
|---|---|
| New movie | Ctrl+N |
| Open | Ctrl+O |
| Open movie file | Shift+Ctrl+O |
| Save | Ctrl+S |
| Save As | Shift+Ctrl+S |
| Import | Ctrl+I |
| Export | Ctrl+E |
| Close movie | Ctrl+W |
| Home | Shift+Ctrl+H |
| Preferences | Ctrl+, |
| Search commands | Ctrl+K |
| Help | F1 |
| Open the menus | F10 |

### Editing

| Action | Keys |
|---|---|
| Undo | Ctrl+Z |
| Redo | Shift+Ctrl+Z or Ctrl+Y |
| Cut, Copy, Paste | Ctrl+X, Ctrl+C, Ctrl+V |
| Duplicate | Ctrl+D |
| Duplicate After | Alt+Ctrl+D |
| Split at the Playhead | Ctrl+B |
| Group | Ctrl+G |
| Ungroup | Shift+Ctrl+G |
| Add track | Shift+Ctrl+T |
| Select all | Ctrl+A |
| Deselect | Escape |
| Delete content | Delete or Backspace |
| Multi-select | Shift+M |
| Movie settings | Ctrl+J |

### Playback and Timeline

| Action | Keys |
|---|---|
| Play or pause | Space |
| Previous frame | Left or , |
| Next frame | Right or . |
| Go to start | Home |
| Go to end | End |
| Compose mode | Ctrl+1 |
| Perform mode | Ctrl+2 |
| Keyframe mode | Ctrl+3 |
| Zoom Timeline in | Ctrl+= |
| Zoom Timeline out | Ctrl+- |
| Fit Timeline | Ctrl+0 |
| Free Trim | hold Alt while trimming |

### Draw and Paint

| Action | Keys |
|---|---|
| Paint | B |
| Smudge | S |
| Erase | E |
| Layers panel | L |
| Smaller or larger brush | `[` and `]` |
| Fit canvas | 0 |
| Pan | hold Space and drag |
| Undo, Redo | Ctrl+Z, Shift+Ctrl+Z |
| Deselect | Ctrl+D |
| Finish | Enter or Escape |
| Previous or next frame (Flipbook) | Left or `,`, Right or `.` |

On a touch screen, a two-finger tap undoes and a three-finger tap redoes (Preferences can turn this off).

## Troubleshooting

**The app says Engine offline.** The engine service saves and opens movies. Start the app with `./formmorpheus`, or check that port 9494 is free. In the desktop app the engine starts itself.

**A video will not import.** The browser has to be able to decode it. Convert it to H.264 in an MP4 or to VP9 in a WebM and try again.

**Export has no sound in QuickTime.** MP4 sound falls back to Opus when the browser has no AAC encoder, and QuickTime does not play Opus. Export MOV, or use a browser with AAC.

**ProRes or HEVC are greyed out.** Install ffmpeg on your computer and restart the engine. See Engine formats.

**A GIF is huge.** Lower the colors, the size or the frame rate in the Export dialog. Very large animated GIFs are decoded whole on import, so a long 4K GIF needs a lot of memory.

**The picture lags after a loop turn.** A full-length video can hold its last picture for about 3 frames, and scrubbing a long clip can take a moment to show the new frame. This is known.

**I lost changes.** Use Edit · Restore Last Recovery Point, or reopen the movie: the undo history is saved inside the `.fmo`. After a crash, the next start offers the recovery copy.

**Reset everything.** Preferences · General · Reset All Preferences. Movies and the library are kept.

**Still stuck.** Open an issue at the project page, and say your version (Help · About), your system and what you did.
