# FormMorpheus Manual

FormMorpheus is an animation studio: a **Stage** on top, a **Timeline** below. You arrange blocks of content on tracks, draw frame by frame, animate with keyframes, or perform a move live and let the app record it. This manual covers the whole app in short sections. In the app, open it from Help · FormMorpheus Manual, or press F1.

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

**Content options**: opacity, 26 blend modes (and passthrough for groups), clipping, alpha and luminance masks with invert, and highlight colors for finding blocks.

**Undo** (Ctrl+Z) and **Redo** (Shift+Ctrl+Z or Ctrl+Y) step through your edits. A drag counts as one step. The depth is set in Preferences · Timeline, from 10 to unlimited.

## Draw and Paint

Add a **Drawing** and open it (double-click it, or use the Edit pill that appears on the Timeline) to enter the full-area canvas. Press Enter or Escape to finish and return to the Stage.

### Brushes

The brush library holds several hundred brushes in libraries of sets (sketching, inking, painting, airbrushing, charcoals, textures, water and more), plus Recent and any libraries you import. Three tools use them:

- **Paint** (B), **Smudge** (S) and **Erase** (E). Click an active tool again to open the brush panel.
- The side bar has two sliders, brush **size** and **opacity**. `[` and `]` change the size.
- Each slider has four small markers, the remembered values of that brush. Tap a marker to recall its value. Press and hold it (or Shift or Alt click) to store the current value there.
- Pen pressure, tilt and streamline smoothing shape the stroke.

### Layers

Press L for the layers panel. Each Drawing has its own layers with:

- a blend mode and opacity
- **clipping** to the layer below
- **alpha lock** to paint only where there is paint
- rename, duplicate, merge down, clear and delete
- **groups**: the New Group button at the top of the panel makes one, and a layer's menu has Group. A group has its own blend mode and opacity.
- **masks**: a layer's menu has Add Mask. Tap the mask thumbnail to paint on it, and open its menu for Mask Enabled, Invert Mask, Apply Mask and Delete Mask.

### Color

Click the color swatch for the color panel: a disc, classic squares, harmony, value sliders and palettes. Drag the swatch onto the canvas to fill a shape or an enclosed area.

- **Threshold**: after the drop, keep the pointer down and drag sideways. A bubble shows the threshold, and the fill follows it. Lift to keep the fill as one undo step.
- **Continue fill**: later taps fill with the same color until you pick another tool.
- **Eyedropper loupe**: hold Alt (or touch and hold) over the canvas for a round magnifier that shows the color under it. Release to pick.

### Select

The bottom capsule switches between Paint, Select, Transform and Filters. Select has four ways to pick: **Automatic** (by color area), **Freehand**, **Rectangle** and **Ellipse**. Add to or subtract from a selection, invert it, clear it (Ctrl+D), fill it, clear its pixels, or copy it to a new layer.

### Transform

Move, scale and turn the selection or the layer. The modes are **Freeform**, **Uniform**, **Distort** and **Warp**. Choose Nearest, Bilinear or Bicubic for the resampling. Enter applies. Escape cancels.

- The arrow keys **nudge** by 1 pixel, and Shift+arrow by 10.
- Warp has a mesh from 4 x 4 up to 8 x 8. Tap the Mesh row to change the size; each node also has bending handles to shape the curve through it.

### Filters

Adjustment filters with live preview and a slider for each value: Hue, Saturation, Brightness, Gaussian Blur, Sharpen, Noise and Lens Blur. They apply to the layer or the selection.

### Zoom and pan

Use the wheel to pan, Ctrl+wheel to zoom, hold Space to drag the canvas, and press 0 to fit. With two fingers you can pan, zoom and turn the canvas at once; a quick pinch in fits it to the screen. Shift+drag with the Space hand turns the canvas, and R sets it upright again.

## Flipbooks and onion skins

A **Flipbook** is frame by frame animation inside one block on the Timeline. It has one or more tracks, each a row of frames that play in order and loop.

- Open a Flipbook to draw. The **frame strip** floats over the canvas.
- **Add frame** and **Add track** are the two buttons at its left.
- On a frame that holds for several movie frames, **Add frame** ends the hold at the Playhead and adds there. **Press and hold** Add frame (or Alt-click it) to jump to the end of the hold and add the new frame after it.
- **Paste** fills the next free (blank) frame of the track, or goes on the end of the track; later frames do not move. Use Duplicate to insert a copy right after a frame.
- Drag frames into the gap between two tracks, or above the first or below the last, to make a new track; the gap is about 14 px tall and shows a drop line.
- Select a frame to draw on it. Use the arrow keys or `,` and `.` to step. On a touch screen or with a pen, dragging the strip left moves forward in time, and a flick keeps going and settles on a frame.
- Right-click a frame or track: copy, cut, paste, duplicate, insert, clear, delete, rename, hide, move up or down.
- A frame can **hold** for several movie frames, so you animate on twos or threes.
- **Onion skins** show the frames around the current one, tinted for before and after. Their settings are on the **Onions** tab of the Draw and Paint settings panel. **Blend primary frame** lets the skins blend over the frame you draw on.
- **Row masks**: right-click a row for No mask, Alpha mask, Luminance mask and Invert mask. A masking row cuts the row below it and is not drawn itself.
- Scrubbing the frame strip follows **Scrub speed** in Preferences · Timeline.
- The **Mini preview** button on the strip opens a small floating window that loops the Flipbook while you draw. Drag it where you like; it keeps its place and whether it was open.
- In Movie settings, **Loop only the visible region** makes playback loop just the part of the Timeline you see. The sound restarts at the start of that region.
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

### Warp and Distort

Both are on the **Action** menu in Keyframe mode, each with a card and handles on the Stage.

- **Distort** skews the picture by its four corners. Drag a corner.
- **Warp** bends it through a mesh of nodes. Drag a node. **Mesh size** on the card picks 2x2 up to 6x6; the shape you made is kept when the size changes.
- Each drag writes a key at the Playhead. **Reset** puts every node back at the Playhead, and **Done** closes the card.
- The offsets are in the picture's own pixels and apply before move, scale and rotation.
- In Perform mode, dragging a node while the movie plays records its keys, and one undo removes the take.

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
| Video | MP4, MOV, WebM and what the window can decode | frame-accurate; on the desktop, a video the window cannot decode (ProRes, some HEVC) is converted by ffmpeg, and without ffmpeg it is refused with the reason |
| Sound | WAV, MP3, AAC, FLAC, Ogg and Opus where decodable | waveform on the block |
| Pictures | PNG, JPEG, WebP, AVIF, BMP | placed as a picture block |
| Animated GIF | GIF | becomes a Flipbook, holds taken from the frame delays |
| TIFF | TIFF | decoded by the app itself |
| Fonts | TTF, OTF, WOFF, WOFF2 | ready in the Text card |
| Movies | `.fmo` | opens the movie |

Video blocks show a filmstrip. Sound shows its waveform. Choose **Separate audio and video** on a video block to split the sound onto its own block. **Volume** is on the block's menu, and a Volume lane lets you key it.

Sound is the clock during playback, so picture and sound stay together. A sound can sit a frame or two behind the Playhead readout because of the speaker delay.

### Coming from another animation app

- **Layered artwork** in a `.procreate` file opens as a Drawing with its layers, blend modes and groups.
- **A movie project from another app** cannot be opened: its file format is not public, so its timeline, keyframes and drawings cannot be read. Bring the movie over as what that app exports instead:
  - a **video** (MP4 or MOV, in H.264, HEVC or ProRes). Transparency is kept when the video has it. On the desktop, HEVC and ProRes that the window cannot play are converted by ffmpeg (see Engine formats).
  - a folder of **numbered PNG frames**, which becomes one Flipbook at the frame rate you choose.
  - an **animated GIF**, which becomes a Flipbook with its holds.
- Fonts and sound files come over as they are.

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
| HEVC as MOV or MP4 | made by the engine (see Engine formats) |
| Animated GIF | its own palette of 2 to 256 colors, Floyd-Steinberg or ordered dither, loop forever or not, exact or even frame timing, an alpha threshold, and an optional custom palette |
| PNG, JPG or WebP frames | one picture per frame, in a zip |
| PNG still | the current frame |
| Movie file | a `.fmo` to keep editing later |

### Engine formats

ProRes, ProRes 4444 (with alpha) and HEVC (in an MP4 or a MOV) cannot be encoded by the browser. The desktop engine makes them with **ffmpeg**, which it runs as a separate program. When there is no ffmpeg on your computer, those formats are listed as unavailable and the Export dialog says: "ProRes and HEVC need ffmpeg, which is not on this computer. Get it in Preferences, Video Tools." Click that notice, or open **Preferences, Video Tools**, and choose **Download ffmpeg**. It downloads ffmpeg 7.1.5 (about 12 MB) from the formai-binaries releases on GitHub into FormMorpheus's data folder, and every file is checked against its recorded SHA-256 before it is used. Its licence is LGPL-2.1-or-later. It is a separate program that FormMorpheus runs, not a part of FormMorpheus, and **Remove** takes it away again. That build makes ProRes, and HEVC where the computer has a hardware encoder FormMorpheus can use (on Windows, only some graphics cards); it has no MP3 or H.264 encoder. An ffmpeg you installed yourself is always used first, so for MP3, or HEVC on a computer without such an encoder, install your own. When you choose MP3 in Export sound and no ffmpeg with an MP3 encoder is found, the dialog says: "MP3 needs an ffmpeg with an MP3 encoder, which is not on this computer. The downloadable build has none, so install your own. See Preferences, Video Tools." Video Tools shows which ffmpeg is used and what it can encode. Nothing needs restarting. The window renders each frame, the engine encodes them, and the result appears on the Exports page.

### Where exports go

Every export downloads and is also kept in the engine's **Exports**, never overwritten (a second export of the same name sits beside the first). While an export runs you can cancel. Close the movie only after it ends.

## Home

Open Home with Shift+Ctrl+H, the Theater pill in the Timeline bar, or View · Theater (Theater is the menu's name for Home). The left list has:

- **Start**: New movie, New flipbook, Open, and a short guide.
- **Recent**: the movies you opened lately.
- **Movies**: the whole library, as thumbnails or a list, with a filter box and sorting. Rename, duplicate and delete are on each item.
- **Exports**: everything you exported. Open, save a copy or delete.
- **Recently Deleted**: deleted movies and exports stay here for 30 days. Restore one, delete it for good, or empty the list. Items past 30 days are swept away. If a name is taken, the restore gets a new one such as "name 2" and a notice tells you. The movie that is open cannot be deleted from Home: close it first.
- **Preferences** and **Help** at the foot.

## Preferences

Open with Ctrl+, (File or Edit menu). The pages:

- **General**: show Home at launch and when the last movie closes, What's New, Autosave, the settings and library folders, and Reset All Preferences.
- **Interface**: theme (29 themes, light and dark, or match the system), accent color and intensity, language, text size, interface scale, animations, notice time.
- **Timeline**: undo steps, scrub speed (Precise, Medium or Fast, which also sets how fast scrubbing the frame strip moves), two and three-finger tap for undo and redo, and ask before deleting.
- **Pen and Tablet**: the test pad, the pressure curve and what the pen's eraser end and buttons do (see Pen tablets).
- **Video Tools** (desktop only): which ffmpeg FormMorpheus uses and what it can encode, and Download ffmpeg and Remove for the family's build (see Engine formats).
- **Agents** (desktop only): whether outside agents may work on your movies, the address and command that connect a client, and a button that opens the terminal panel (see Agents).
- **Interface** (GPU): **GPU compositing** draws the Stage and exports on the graphics card. It is on when the card is faster and gives the same picture as the processor, and otherwise the processor does the work. Open the app with `?gpu=force` at the end of the address to skip the speed test.

## Languages

The interface comes in 29 languages besides English: Spanish (and Mexican), Brazilian Portuguese, French (and Canadian), German, Italian, Dutch, Danish, Finnish, Norwegian, Swedish, Russian, Polish, Czech, Hungarian, Ukrainian, Turkish, Greek, Serbian (Latin), Simplified and Traditional Chinese, Japanese, Korean, Indonesian, Thai, Vietnamese, Arabic and Hindi. Pick one in Preferences · Interface · Language. Arabic switches the window to right to left. Names you give movies, layers and tracks stay as you wrote them. This manual is in English.

## Crash recovery

FormMorpheus keeps a recovery copy of the open movie while you work. Each window keeps its own copy and marks it alive every minute. After a crash, the next start offers only the copies of windows that stopped, never one that is still open in another window. Choose to restore it, or discard it. If a movie cannot be recovered, the app says so and keeps the copy for the next start. Edit · Restore Last Recovery Point is a different thing: it returns to an automatic point saved when you made a new edit after three or more undos. Edit · Recovery Points... lists every kept point (the last three, saved inside the movie) and restores any of them; Undo takes the restore back.

## Pen tablets

Any drawing tablet whose driver passes pen pressure to apps works in Draw and Paint: pressure, tilt, twist, the eraser end and the barrel buttons. Preferences · Pen and Tablet has a test pad that shows the live pressure, tilt, twist and rate your pen sends, a pressure curve (Soft, Normal, Firm, Linear or drag your own points), minimum and maximum pressure, smoothing, whether tilt shapes the brush, what the eraser end and each barrel button do (eyedropper, right-click menu, undo, pan, cycle tool or nothing), and palm rejection: while the pen is near the screen, fingers only pan and zoom. Save for this pen keeps the settings for that pen. If strokes show no pressure, the page says so: on Windows turn on Windows Ink in your tablet driver's settings, on macOS install your tablet's driver, and on Linux the system view may not pass pressure through.

## Pen Link: a tablet as a drawing tablet

Edit · Pen Link... turns a tablet with a pen and a web browser (an iPad, for example) into a pressure-sensitive drawing tablet for FormMorpheus over your local network. Turn it on, open the address it shows in the tablet's browser, and type the six-digit code (it lasts two minutes and allows five tries). The tablet shows your canvas and draws on it with the pen's pressure and tilt; its toolbar switches brush and eraser, undoes and redoes, and sets size and opacity. One tablet pairs at a time. Pen Link is off until you turn it on, it listens on your network only while it is on, and it serves nothing but its own page: the rest of FormMorpheus stays private to your computer. The connection is not encrypted, so use it on a network you trust.

## Brush files

Drop a brush file on the brush library, or use its import button, to see what is inside before it lands: a tree of the file's folders with a stroke preview of every brush. Untick what you do not want, choose a new library or the current one, and Import. Brush files with presets (.abr) bring their settings along, not just the tip picture: size, hardness, angle, roundness, spacing, size and angle jitter and what drives them (pressure, tilt, fade, direction), scatter and count, the texture from the file's patterns, color jitter, opacity and flow by pressure, noise and wet edges. A badge marks brushes with settings the brush engine can only approximate; its tooltip lists them. Tips only imports just the tip pictures.

## Agents

An outside agent is a program on your computer, such as Claude Code, Codex, Cursor or Antigravity, that works on your movies through MCP. FormMorpheus has an MCP server for them, and a terminal panel that can run these programs beside the Stage and the Timeline. Agents are for the desktop: on iPad there is no terminal panel and no Agents page in Preferences.

### What an agent can do

- **Reads** run at once: the version, the library folder and what your ffmpeg can encode (`get_context`), the movie list (`list_movies`), one movie's size, frame rate, length, tracks and content (`get_movie`), a movie's poster and preview (`get_movie_picture`), and the other commands (`list_commands`). `run_command` also reads Recently Deleted, the Exports folder, stacks, fonts and the encoders your ffmpeg has.
- **Changes to the library** are made by `manage_movie`: create an empty movie, rename, duplicate, delete and restore. Delete moves a movie to Recently Deleted and never erases it. `run_command` also sets a movie's tags and its stack.
- **Two always ask first**: `export_movie` makes a file in the Exports folder, and `import_file` brings a picture, video, sound or font file into a movie and saves it. Both need the FormMorpheus window open. You approve each one in it, and the window opens that movie to carry it out.

Agents work only on FormMorpheus's own data: your movie library, Recently Deleted, the Exports folder and the added fonts. None of these tools reads another file or folder on your computer, and an import takes only a file that is already inside the library folder. A program you run in the terminal panel can still do whatever it can do on its own, as in any terminal.

### Outside agents

Open Preferences (Ctrl+,) and choose **Agents**. **Outside agents** has three choices:

| Choice | What happens |
|---|---|
| Ask | The default. Reads work. A change to the library asks you in the FormMorpheus window first. With no window open, the change is refused and the agent is told to ask you to open FormMorpheus. |
| Allowed | Changes to the library go ahead without asking. An export or an import still asks each time. |
| Blocked | Every agent is refused, reads included, and so are the agents in the terminal panel. A question that was waiting is answered Deny. |

An agent you open yourself in the terminal panel is treated as yours: under Ask or Allowed it makes library changes without asking, and an export or an import still asks. Where the system has a keychain, FormMorpheus seals the choice with a key kept there. If the setting is changed from outside the app to allow agents, FormMorpheus ignores that change, asks again, and says so in Preferences.

### Connect a client

1. Start FormMorpheus: the app, or `./formmorpheus` from source. An export or an import needs the window to be open.
2. Open Preferences and choose **Agents**. **Connect a Client** shows two ways in.
3. A client that connects by address takes the **MCP address**, `http://127.0.0.1:<port>/mcp`. The engine listens on this computer only. The desktop app shows its own port there (it tries 9496 first). From source the engine's port is 9494, so the address is `http://127.0.0.1:9494/mcp`.
4. A client that starts its own server takes **Standard input and output**: the command `./formmorpheus mcp` (`formmorpheus.bat mcp` on Windows), run in the FormMorpheus folder. It passes each message on to the running engine, which it finds at `FORMMORPHEUS_MCP_URL` or `FORMMORPHEUS_PORT` when you set one, and otherwise on port 9494 or 9496. When no engine answers, it starts the engine of that FormMorpheus folder once; `FORMMORPHEUS_MCP_AUTOSTART=0` turns that off.

`./formmorpheus agents` sets up clients for you:

- `./formmorpheus agents install` writes FormMorpheus's entry for Claude Code (`.mcp.json`), Codex (`.codex/config.toml`) and Cursor (`.cursor/mcp.json`) in the FormMorpheus folder, and in the folder you ran it from when that is another one. It adds Antigravity's entry in `~/.gemini/config/mcp_config.json` and copies the `formmorpheus` skill into the skills folders these programs read. Entries for other servers are kept, and a file it changes is first copied beside itself with `.bak` and the date added to its name. `--dry-run` lists what it would do and writes nothing.
- `./formmorpheus agents sync` is for people who change FormMorpheus itself: it mirrors the skill pack to `.agents/skills` and writes `agents/manifest.json` from the server's code. `--check` changes nothing and exits with 1 when something is out of date.

After `install`, open the client in your folder, approve the `formmorpheus` server when it asks, and try "List my movies and export the newest as MP4". The export asks you in the window.

### The question in the window

When an agent needs your yes, a box opens in the middle of the FormMorpheus window. It names the agent (or says an outside agent), says what it asked to do, such as "rename the movie Intro to Opening", and reminds you that you can turn this off in Preferences, Agents. When several questions wait, it shows them one at a time.

- **Deny**: nothing is done. For the next 2 minutes the agent's requests that need your yes are refused without asking again. Escape also denies.
- **Allow once**: this one request goes ahead.
- **Always allow all outside agents**: sets Outside agents to Allowed. It is not offered for an export or an import, which always ask.

If nobody answers within 2 minutes, the question closes and nothing is done.

### The terminal panel

The terminal panel runs a shell and the agent programs beside the Stage and the Timeline.

- **Open it** from View · Terminal, or press Ctrl+`. Press Ctrl+` again, or the close button, to hide it; the programs in it keep running. View also has New Terminal and Claude Code (Shift+Ctrl+`).
- **Tabs**: the plus button opens a shell in your home folder, and the Claude Code button opens Claude Code. Codex, Cursor and Antigravity each get a button in the panel's head when they are on this computer, and a row in the More agents menu. Every program has its own tab. **Restart this tab** runs a program again, and **Close this tab** ends it. A tab whose program has ended is struck through.
- **Ask Claude Code**: type a request in the line at the bottom of the panel and press Enter. Claude Code opens in a tab with your words, the open movie's name, the frame and the ids of the selected content.
- **Move and resize**: the side button moves the panel to the right of the window, and back to the bottom. The right side needs a window at least 900 pixels wide. Drag the panel's edge to make it larger or smaller. FormMorpheus keeps its side, its size and whether it was open.
- **Installing**: Claude Code, Codex, Cursor and Antigravity must already be installed on your computer. FormMorpheus neither installs them nor signs you in to them. When one is missing, the panel says so and shows the line to run in your own terminal to install it. Sign in once there too; for Claude Code, run `claude` and type /login.
- **Where they work**: Claude Code, Codex and Cursor work in the `Agent` folder inside your settings folder (Preferences · General shows where it is); `FORMMORPHEUS_AGENT_DIR` picks another. Antigravity works in a folder of its own there. When a program is installed but not found, set its path in `FORMMORPHEUS_CLAUDE_BIN`, `FORMMORPHEUS_CODEX_BIN`, `FORMMORPHEUS_CURSOR_BIN` or `FORMMORPHEUS_ANTIGRAVITY_BIN`.

Closing FormMorpheus ends every tab.

## New in 0.18.0

**A new icon.** FormMorpheus has a new app icon on the desktop, in the browser tab and in About.

**On iPad.** The iPad app is a beta that you build yourself on a Mac with Xcode and an Apple developer account (a free one works, and then the library stays on the iPad instead of iCloud Drive); the steps are in [Build FormMorpheus for iPad](ios/BUILD.md). On iPad, movies live in the FormMorpheus folder of the Files app, and movies, pictures, video and sound open from Files (a movie from elsewhere is copied into your Library, so the original is never changed). The menu bar and keyboard shortcuts work with a hardware keyboard. Apple Pencil Pro squeeze and double tap can switch to the eraser, show the color picker, undo, or follow the choice made in the iPad Settings app, and barrel roll turns brushes that follow the Pencil's angle. Draw with Pencil only keeps fingers for panning, zooming and gestures. Export uses the iPad's own video encoders, including HEVC with transparency where the iPad supports it. If iPadOS closes the app's drawing area to free memory, your latest snapshot opens again. Help > About FormMorpheus > Diagnostics checks the iPad and saves a report to send with any problem.

**On iPad, from 0.23.0.** The iPad app runs on iPadOS 16.4 or later; squeeze, barrel roll and the Pencil haptics need iPadOS 17.5. A ProRes video (422 or 4444) now imports: the iPad converts it with its own encoders, ProRes 4444 with transparency to HEVC with transparency and everything else to H.264, which takes a moment for a long clip. HEVC with transparency imports as it is. Whether the transparency shows depends on the iPad's video decoder: if the first frame comes out with none, a notice says so. A video the iPad cannot read at all, a video over 2 GB, and sounds or pictures the iPad cannot decode are still refused with the reason. On Home, the second place under Library is iCloud Drive: tap it to keep the library in iCloud Drive > FormMorpheus (On This iPad takes it back). Nothing is copied when you switch, so use Copy to iCloud Drive in the Theater to bring movies across. Movies saved there appear on your other iPads signed in to the same Apple Account; one that has not arrived yet downloads when you open it, or shows once iCloud has brought it over. When iCloud Drive is off or no one is signed in, Home says so.

## New in 0.17.2

**Brushes.** Bristle, oil and knife brushes keep their streaks along the stroke in every direction and around curves, with highlights that follow them. Paints no longer show a repeating pattern in their body, and Round paint and Gouache break up at a dry edge.

**Bringing work in.** Choose several numbered pictures, or drop a folder of them, and import them as one Flipbook at the frame rate you type. A project file from another animation app is explained: its timeline cannot be read, but any pictures and sounds found inside go to the media bin, and the message says how to export your work from that app.

**Pens and tablets.** A stroke is kept when the system interrupts the pen, a pen resting still never opens the color picker mid-stroke, and a palm on the screen gives way to the pen. A tablet that reports pressure as a mouse can turn on Use pressure from the mouse in Pen and Tablet. Pen Link lifts cleanly when the tablet's page is hidden or the connection drops.

**Systems.** On a system that cannot encode a video or sound format itself, export hands it to the engine. Text spacing, animated pictures and previews have fallbacks on older systems, and the graphics card path falls back to drawing without it when a movie is too large for it or the card resets. If the system is too old to run FormMorpheus at all, one message says what it needs.

## New in 0.17.1

**Brushes.** Chrome reads as polished metal, Rough hatch lays real diagonal hatching that keeps its angle on any stroke, and Sumi ends cleanly. Charcoal, chalk and pastel sticks shade wide whichever way the pen leans, and Grain airbrush starts as a soft cloud. Bristle brushes fray at the end of a tilted stroke, knives end in a rounded point, and the opaque paints widen with pressure and break up at a dry edge. Watercolor leaves no tint on bare paper and beads only where the pen really stops.

**Editing.** Copy blocks from one movie and paste them into another, with their pictures and sounds. Trimming several selected blocks trims them all at once. Ungroup waits until one group is selected.

**Help and export.** The manual in Help can show what each version added, and its search highlights matches and steps through them with Enter. The Export window names any font that is missing and offers to fix it.

## New in 0.17.0

**Groups.** Expand a Group on the Timeline to see its own tracks. Drag blocks into and out of it, and Create adds content inside the open Group.

**Timeline and Stage.** Hold the toolbar between the Stage and the Timeline, or the strip just above the ruler, and drag to resize them. H hides the selected content. Hold a blank part of a lane and drag to move the track. A one-finger drag on an empty lane pans. The track menu has Cut, Copy, Duplicate and Paste tiles. Blocks carry their mask kind as a label, video blocks show film edges, and Text blocks show their text. The Stage timecode reads hours, minutes, seconds and frames, and Enter duration takes hours, minutes and seconds. Changing the frame rate keeps every frame on its frame by default (the movie plays faster or slower); Keep timing moves blocks and keys so each keeps its length in seconds.

**Keyframes.** Ease in now starts slowly and Ease out ends slowly, as their names say (movies made earlier play exactly as before; only the labels moved). Reverse keyframes mirrors around the content or the selection, so lanes stay in step. Edit anchor never moves the picture. Warp meshes gain Add row and Add column. Swipe a red row left in the Action card to clear it.

**Draw and Paint.** Create · Drawing and Create · Flipbook open Draw and Paint (Preferences can keep you on the Timeline). Size and opacity markers start empty, Color history keeps ten colors and shows at the top of Palettes, and the brush panel has a search button. ColorDrop fills under soft stroke edges. Hold a second finger to make a square or circle selection. Crop and Resample show their progress.

**Brushes.** Oil and bristle brushes no longer show blocks or seams at light pressure, knives smear the paint below, glaze builds a film, watercolor bleeds into a wet wash and settles unevenly, inks pool and taper, gouache and acrylic show grain and a dry edge, texture brushes are continuous, spray is a mist, color pencil reaches full color, charcoal and pencil shade wide when tilted, and Charcoal roll, Marker roll and Calligraphy roll turn with the pen. Hold a brush to open its menu.

**Import, fonts and sharing.** Open `.procreate` artwork as a layered Drawing. An import goes onto the highlighted track when it fits. Fonts installed once are in every movie (Fonts library); a movie whose font is missing asks to replace or keep it; `.ttc` collections bring every face. Share in the Theater offers the movie file, a video or frames, and frames can be saved into a folder.

**Help.** Help links to the handbook, community and video tutorials on the web, and recovery points can be shared.

## New in 0.16.0

**Theater.** Choose Gallery or Library layout in Preferences. Right-click a movie for Info... (size, length, frame rate, tracks, file size, dates) and Tags...; filter the Theater by tag. A cloud folder you keep in sync can receive copies (Copy to Cloud). A movie reopens at the frame where you left it, and its poster is that frame. View can hide the menu bar and the status bar.

**Timeline.** Alt-click a block's checkbox to hide just that block. Right-click a track's header or empty lane for the track menu. J, K and L shuttle back, stop and forward. Hold Space and drag to pan. The ruler shows bold seconds and frame numbers together, and dragging it scrubs (hold Alt to scale time). Flipbook blocks show their drawings on paper cells with a color chip. Movie settings · Timeline has an Editing group for snapping and sound previews.

**Keyframes, Stage and camera.** Click a key in an expanded lane to type its value; drag several keys together; K adds a key, Shift+K and Alt+K step between keys, 1 to 4 set the easing. Pictures read 100 percent at their fit. Several selected blocks share one box in Compose. Moving the anchor keeps the picture still. The camera has shake, follow and a parallax depth per track, and Perform shows a count-in before a take.

**Effects and titles.** New effects: Ripple, Halftone, Outline, Gradient Map, Glitch, Kaleidoscope, Hue Range Shift, Sharpen Radius and Gaussian Blur X Y; each effect in a stack has its own on and off switch, and Color Correction's curve points can be keyed. Adjustment blocks work inside groups. Titles have presets, a gradient fill, glow, text on an arc, wave or circle, and animators that act on a range of letters, words or lines. Motion blur covers opacity, time remap and text.

**Drawing.** Watercolor pools where the pen rests, darkens at its rim and bleeds into a wet neighbour; oil frays at stroke ends and widens with tilt; chalk is grainier. Brush Studio has pressure and tilt popovers per setting, Position scatter beside rotation Scatter, a reset point and a Pressure and Smoothing card (double-click a brush). The canvas shows the brush outline as you hover. The Layers panel has swipe, two-finger and pinch gestures, the color disc cycles white, black and grey on a double-click, the Flipbook strip tears off into a Mini Flipbook, and a Libraries screen shows every brush library. Long painting sessions stall less.

**Export and sound.** Every export shows frames done, time elapsed and time left, with Cancel, and a chip keeps showing it when the dialog is closed. New: MP3 through your ffmpeg, size targets for HEVC and ProRes, chapters from markers, a sprite sheet, copy the current frame, and 480p. Safe areas are clearly drawn, with 1:1 and 4:5 frames. Meters read loudness and true peak, a ducked track shows its gain reduction, and View · Add Markers on Beats marks a sound's beats. The media bin can make proxies of large videos for smooth editing; exports always use the originals.

**Pens and Pen Link.** Pen Link shows a QR code of its address, limits pairing tries per device, and tells the tablet to open Draw and Paint when it is closed; its page follows the tablet's language. Brush files can keep their own pixel sizes, and a dual tip, zip-compressed patterns and 32-bit tips are read.

## New in 0.15.0

**Your movies save themselves.** A new movie is in the Theater the moment you make it, and every change is saved as you work. Leaving a movie never asks; its poster is the frame under the Playhead. Ctrl+S saves at once, and Duplicate as... makes a copy.

**Pens and tablets.** Pressure, tilt, eraser end and barrel buttons from drawing tablets, a Pen and Tablet page with a test pad and a pressure curve, palm rejection, and Pen Link to draw from a tablet's browser. See the sections above.

**Brushes.** Oil brushes paint with separate hairs that streak and pick up the paint below; watercolor pools and darkens at its edges, bleeds into a wash that is still wet, and no longer runs dry on a long stroke; pencils darken with pressure and shade wide when tilted. Brush files bring their presets (see Brush files).

**Draw and Paint.** Hold at the end of a stroke to snap it to a line, arc, ellipse, rectangle or polygon (QuickShape), Shift+click for a straight line, hold the pen or mouse still to pick a color, the size bubble previews the stroke, a grouped blend list previews as you go, ColorDrop can keep filling, Select starts on Automatic, and the Flipbook strip is simpler, with the rest under More.

**Timeline.** Track headers with names, hide, lock, mute and solo (View · Track Headers); dragging a block shows where it will land and makes a new track between lanes; the block menu is grouped; the ruler counts seconds when zoomed out; double-click steps the zoom; Z zooms to the selection and Shift+Z to the loop range.

**Keyframes and Perform.** Compose edits the base transform only, scale can flip past zero, the Action card has Move and Filter, the parameter card stays open while you drag, snapping waits for Shift, a readout shows position, scale and angle while dragging, and Perform has Retake (Shift+R), a pre-roll and a punch range, and keys to rotate (R) and scale (S) with a mouse.

**Look.** Popovers and dialogs grow from their button, menus are glass, the Create menu is a card of tiles, the Theater is a poster wall, and Movie settings keeps its tabs at the bottom.

## New in 0.14.0

**Effects.** The Action menu's Live Filters now include Drop Shadow, Glow, Color Correction (levels, curves, color balance, exposure, temperature and tint, vibrance), Vignette, Pixelate, Directional Blur, Radial Blur (drag its center on the Stage), Motion Blur, Chroma Key (pick the key color on the Stage, view the matte) and Luma Key. Every setting can be keyed. Movie settings · Timeline turns on motion blur for the whole movie.

**Titles, shapes and solids.** Select words in a text and use Edit Style to give them their own font, size, color and outline; the Effects tab adds a shadow and a background box, and the Animate tab builds text on and off by letter, word or line (fade, slide, scale, rotate, blur, typewriter). Create · Shape draws rectangles, ellipses, polygons, stars, lines and pen paths with gradient fills, dashed strokes and an animated trim; Create · Solid fills the movie with a color; an Adjustment block applies its filters to everything below it.

**Sound.** The Sound effects card adds EQ, compressor, reverb, noise gate and de-esser to a block or a track, a track can duck under another, the Timeline shows level meters, and Export · Sound only writes WAV, M4A or Opus, or one file per track.

**Export and media.** Presets for common shapes and limits (and your own), a target bitrate or file size with a size estimate, a frame rate and scale for the export, fit or fill into another shape, animated WebP and APNG, a layered PSD of the current frame and frame zips named by timecode. Every export, including movies with video, now renders in the background. View · Media Bin lists the movie's pictures, video, sound and fonts, where each is used, and replaces or relinks them.

**Drawing.** Painting now runs off the main thread. Wet brushes drag paint along the stroke, pencils and charcoal respond to light pressure, Materials can add shine (gloss, metal, light angle), and palettes import and export (including from a picture). In a Flipbook, Timing sets shooting on ones to fours, Exposure Sheet shows frames, holds, sound and notes in a grid, and Underlay puts a picture or video under the drawing as a reference.

**Keyboard.** A skip link is the first Tab stop on Home, in the editor and in Draw and Paint.

## New in 0.13.0

**Brush Studio.** Right-click a brush and choose Edit Brush, or New brush in the brush panel's menu. A live drawing pad sits beside the brush's sections: Stroke path, Taper, Shape, Grain, Rendering, Wet mix, Color dynamics, Dynamics, Pencil, Pressure curves, Properties, Materials and About this brush. Every slider has a number, double-click a label to reset it, Undo last change and Reset brush step back, and a built-in brush is saved as a copy. Shape and Grain have libraries of tips and paper grains to pick from, and brush size can follow the canvas size.

**Paint.** Wet brushes now carry paint: they pick up and mix the colors already on the canvas (blue over yellow makes green), drag them along and leave wet edges; the rendering modes really differ (glaze builds up thin films, blending mixes). Pencils, charcoal, chalk, bristles, sponges and airbrushes each have their own tip and grain. Big Drawings with many layers use less memory, and long strokes keep the screen moving.

**Sound.** Create · Record sound... records a voice-over onto the Timeline: pick the input, watch the level, count in, and the movie plays while you record. Each take gets its own track; Use or Delete picks between them, and a punch-in can replace part of a selected sound. Content · Sound... sets level, pan, fade in and out, normalize, mute and solo; fades also have handles on the block.

**Editing.** Blocks snap to other blocks, the Playhead, markers and keys (View · Snap, hold Ctrl or Cmd to move freely). M adds a marker at the Playhead; Alt with the period or comma jumps between them. Content · Speed changes speed (25% to 400%), reverses or freezes a block. Two blocks side by side on a track can have a crossfade, a dip to color, a wipe or a push between them, with a handle for its length. Pictures and video can Fit, Fill or keep their size. Keys can bounce, be elastic or overshoot, loop or ping-pong after the last key, turn along their path, and be thinned.

**Help and keyboard.** Help · Help Center has guided tutorials that run inside the app on a practice movie, the manual, and Send an idea (saved as a note you can share). Every control can be reached with Tab and the arrow keys, screen readers hear names and changes, and the system's reduce motion setting turns off animations. Exports now render in the background, so the app stays responsive.

## New in 0.12.0

**Speed.** Movies with many sparse drawings play faster from the first pass, moving, scaling or turning a block on the Stage stays smooth on big movies, and a far jump into a long video reaches the exact frame sooner. Exports are drawn exactly as before.

**Brush folders.** Your brush libraries are now folders in the engine's data folder: a folder per library, a folder per set and a `.brush` file per brush you have made or changed (the built-in brushes stay built in until you edit one). Show brush folder in the brush panel's menu opens it on the desktop, or shows where it is in a browser. Files you add there yourself are left alone.

**Flipbooks and color.** Paste and Insert (in the frame menu, or Alt with Paste) puts the copied frames after the current one and pushes the later frames along; plain Paste still fills the next blank frame. The color disc's ring shows the previous color on its left half and the current color on its right.

## New in 0.11.0

**The main screen.** The movie's name sits in the middle of the title bar ("Untitled" until saved); click it to rename. A short tip appears the first time you enter Perform, Keyframe, a Flipbook or Draw and Paint (Preferences · Show tips turns them off). Holding the mouse button still on a block, a key lane or empty track area opens the same menu as a right-click. Hover the ruler to see that dragging it scales time; it numbers frames once there is room. Zooming and panning the Stage now stay smooth on big movies: the picture follows your gesture and sharpens when you stop.

**Theater.** The Library folder button at the top shows where your movies live and changes it. Copy to Folder... (a movie's menu, or the Select bar) copies movies to another folder, or downloads them in a browser.

**Drawings and Flipbooks.** A layered Drawing (from a layered file) has Convert Layers to Tracks in its menu. The Color panel has a real secondary color (click its chip to pick it, the swap button trades them), and the current color's left half is the previous color. Select several layers w/ Ctrl or Shift and Transform moves them together; Sample all layers makes a selection from the whole picture. Each filter drag continues from the current amount. Pixel perfect in the brush card draws hard one-pixel strokes. Escape no longer leaves Draw and Paint; use Finish or Enter. On touch, the strip moves with your finger and a flick carries on. Paste fills the next blank frame. A mask row's opacity scales its mask, and a mask row with nothing in it hides the row below. You can keep painting on the next frame while holding the scrub wheel with the other hand.

**Keyframes.** Click a key to open its values. Warp and Distort cards take typed positions and have a Quality choice (Smooth, Nearest, High). Double-click Stage text for Cut, Copy, Paste, Select All and Edit Style.

**Recovery.** If a window closes unexpectedly, its unsaved work is offered again within seconds in the next window.

## New in 0.10.0

**Theater.** A stack is now a real folder in the library. Drag a movie onto another to make one, onto a stack to add to it, or between cards to reorder (the order is kept). Select several movies and carry them together; hover a stack while carrying to go in, hover the back control to come out. Click a movie or stack name to rename it. On touch, hold a card to pick it up, or hold and lift for its menu.

**Crop and resize.** Settings · Canvas · Crop and resize now works on the canvas itself: drag the edge and corner handles (Shift keeps proportions), type X, Y, W and H, zoom and pan, switch to Resample to scale, hold to see the original. In a Flipbook the time bar scrubs every frame so you can check they all fit. Ctrl or Cmd+Z undoes a crop from Draw and Paint.

**Brushes and text.** Right-click a brush for Export brush, a set for Export set, or use the library's ··· menu for Export library. The Text card's Fonts list has 15 built-in families, incl. Arabic, Japanese, Chinese, Korean, Thai and Devanagari faces that load only when text needs them.

**Video and pictures.** Video w/ transparency (VP9 w/ alpha, ProRes 4444) keeps it on the Stage and in export. HEIC pictures the window cannot open go through the engine when ffmpeg 7.1 or newer is installed. Settings · Add · Insert a file adds TGA, TIFF, HEIC, BMP, GIF, WebP and AVIF pictures to a Drawing.

**Timeline.** Content · Push Content moves a block one frame earlier or later w/ what it touches; Extend and Push and Contract and Pull change a block's length and move the rest of the track. Flip Content Order reverses two or more selected blocks. Set Loop Start and Set Loop End at the Playhead make playback loop inside a range (Clear Loop Range ends it). Preferences can make the pen button play and pause, and turn rotation from a twisting pen in Perform on or off. A four-finger tap toggles full-screen preview.

**Safety.** Edit · Recover Lost Movies... offers recovery snapshots again at any time. The engine accepts requests only from this computer and from FormMorpheus's own windows, moves files safely between drives, and checks the size of what it unpacks. Movies saved by older versions open cleanly.

## New in 0.9.0

**Start.** FormMorpheus opens on the Movies grid (the Theater). The brand name at the top of Home opens About, What's New, Help and Reset Examples. Three example movies are built at first run, and Help · Take the Tour points out the Stage, Timeline, modes, Create menu and Stage Options. Hover a movie to preview it; Share offers the movie w/ its full undo history or a smaller file. Preferences · Change Library Folder... moves the library.

**Text.** Create · Text places dark text ready to type on the Stage; double-click text to edit it in place. The Text card has Fonts (built in, in this movie, on this computer, and Import font...) and Format (bold, italic, underline, strikethrough, case, size, tracking, leading, baseline, kerning, alignment incl. justify, outline, vertical text, wrap). In Compose, the side nodes of a text box set its wrap width.

**Export.** Advanced export has a preview window (Preview renders the chosen settings; it goes stale when you change them). Video can be H.264, HEVC, ProRes (Proxy, LT, 422, HQ, 4444, 4444 XQ) or VP9, in .mp4, .mov or .webm, w/ AAC or Linear PCM sound. GIF has frame duration presets, Diffuse or Stable dithering, colours and a custom palette. Frames can be PNG, JPG, TIFF, TGA, BMP or WebP.

**Import.** TGA, PSD, ORA and KRA (as a Drawing w/ its layers), AIFF, CAF and AC3 sound, and ProRes or other video the window cannot play (converted by the engine). Drop a file on the Timeline to place it at that track and time, or on the Stage to place it at the Playhead. Brush files dropped anywhere are imported.

**Drawing and Flipbooks.** Settings · Canvas · Crop and resize gives a Drawing or Flipbook its own canvas, which may reach past the movie. The strip has Previous / Next Drawing, a scrub wheel w/ Scrub Lock, labelled buttons and a hide control; Esc closes a menu first and never leaves a Flipbook. The size and opacity sliders have fine control (drag sideways or hold Alt) and a bubble w/ memory markers; hold an unselected Paint, Smudge or Erase button to carry the brush across. Smudge has a strength slider. The brush panel has libraries (Animation, Classic, Imported, your own).

**Keyframes and the Stage.** Lanes start collapsed w/ a thumbnail; the Playhead shows a line in Compose, a record disc in Perform and a clapperboard in Keyframe; when a block is animated but not keyed at the Playhead the pill turns red and a click makes the key. Right-click a key for Set easing. The box ··· menu has Edit anchor (snaps to nine sectors; Shift skips). Full-screen preview only plays and scrubs. The Timeline has on-screen time zoom and track height buttons.

**Touch and pen.** Pinch and rotate on the Stage and Timeline, two-finger tap to undo, three to redo, touch and hold for menus, a second finger as Shift while dragging, three-finger swipe down for Copy & Paste and four-finger tap for full screen in Draw and Paint. Preferences · Gestures turns them on or off.

## New in 0.8.0

**The Stage.** Ctrl or Cmd with the wheel (or a trackpad pinch) zooms toward the pointer; the wheel pans, Space-drag or the middle button pans too; Ctrl or Cmd+0 or a double-click on the empty Stage fits; Alt+Ctrl with Left or Right turns the view in 15 degree steps; Shift+Ctrl+F shows the Stage alone and plays it (Esc leaves). The zoom cluster sits at the bottom right. Stage Options (View menu, Shift+Ctrl+J, or right-click the Stage) holds the background colour, transparency, Backstage visibility, the timecode and the movie's onion skins; Movie settings · Stage shows the same.

**The Compose box.** Side nodes stretch one way; drag a side past the other to flip; the box's ··· menu and the content menu have Flip horizontal, Flip vertical and Reset. Alt with the arrow keys nudges 1 px (Shift 10 px). Hold Shift while moving or turning to snap to the movie's edges, centre and other contents (15 degree steps in Compose, 30 in Keyframe and Perform); Alt turns snapping off. Undo and Redo buttons sit beside the timecode; the undo depth is 250 steps.

**Keyboard Shortcuts.** Edit · Keyboard Shortcuts... (also in Preferences) lists every command: search, add or remove keys, and set them back. A key taken from another command says so.

**Flipbooks.** Creating a Flipbook opens it. In the frame strip, click, Shift-click or lasso frames; the frame menu has Split content, Fill duration and Flip frames; drag a frame's edge to change its hold; drag frames to another row. Each row has Highlight, Blend mode, Clipping mask, Cut, Copy, Paste and Duplicate. The Mini Flipbook (double-click the strip head) floats, docks to an edge, scrubs w/ its wheel and has Scrub Lock. Settings · Crop and resize scales and crops a drawing.

**Draw and Paint.** A mouse paints at full pressure. I picks a colour, G fills, right-click or Ctrl or Cmd with X, C, V opens the clipboard (Cut, Copy, Duplicate, Cut & Paste, Paste, Clear). The brush library has 19 sets; right-click a brush to rename, duplicate, delete or edit its Pressure & Smoothing; Import brushes reads .abr, .brush and .brushset files.

**Animation tools.** The Graph Editor (Alt+Ctrl+G, or Graph on an expanded lane) edits ease curves w/ handles. In Keyframe mode a Move lane shows its motion path; drag keys and handles to curve it; the crosshair is the pivot that rotation and scale turn around. Content · Parent makes one block follow another. Camera mode (the camera button in the Timeline bar) keys a pan, zoom and turn of the whole movie; a track set Fixed to screen ignores it. Bones (Action menu) rig a picture or drawing. Lip-sync from Sound... (a sound block's menu) fills a mouth Flipbook. Boil makes lines wobble; Make Boil Frames... bakes it into a Flipbook. File · Round Trips sends a drawing to formvis or the movie to formvfx and brings them back.

**Timeline and Theater.** Drag the ruler to change the time scale (drag the Playhead or hold Shift to scrub); Ctrl+Shift with the wheel sets track height; hold a trim edge until it turns red for Free Trim. Multi-select draws a lasso; hold its button to bring back the last selection. Twenty-five blend modes, and groups can pass through. On the Home Movies page, Select picks several movies; right-click for Open, Rename, Duplicate, Share and Delete; drop one movie on another to make a stack.

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
| Move the selected block one frame earlier or later | Shift+Ctrl+Left, Shift+Ctrl+Right (with the Timeline focused) |
| Move the selected block one track up or down | Shift+Ctrl+Up, Shift+Ctrl+Down (with the Timeline focused) |
| Say the Playhead time | Alt+T |

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
| Eyedropper loupe | hold Alt, or touch and hold |
| Reset canvas rotation | R |
| Nudge the Transform 1 pixel | arrow keys |
| Nudge the Transform 10 pixels | Shift+arrow keys |
| Turn the canvas | two fingers, or Shift+drag with Space held |
| Repeat Undo or Redo | hold the button |

On a touch screen, a two-finger tap undoes and a three-finger tap redoes (Preferences can turn this off).

## Keyboard and screen readers

Everything can be done without a mouse. Tab and Shift+Tab move through the controls in reading order, and a ring shows where focus is. Escape closes a menu, a popover or a dialog and puts focus back where it was; Enter runs the focused control.

- **Menus:** F10 or Alt opens the menu bar. Left and Right move across it, Up and Down through a menu, Right opens a submenu, Escape steps back. Press A to open the Create menu and the arrows to choose.
- **Popovers** (Content Options, Create, Stage Options and the like): Up and Down move through the rows, Home and End jump to the first and last, Escape closes.
- **Dialogs** keep Tab inside themselves and give focus back when they close.
- **The Timeline** is one labelled region ("Tracks"). Focus it with Tab, select blocks with Ctrl+A or Tab through their commands, then move the selected block: Shift+Ctrl+Left and Right by a frame, Shift+Ctrl+Up and Down by a track. Each move is spoken, as in "Text, track 2 / 3, frames 5 - 28". Alt+T says the Playhead time.
- **Sliders** (brush size and opacity) take Up and Down for 1%, Shift for 10%, Home and End for the ends, and report their value.
- Icon-only buttons are named after their tooltip, in the language of the interface. Notices are read out as they appear.
- If your system asks for reduced motion, the reveal, the popover and menu transitions and flick momentum stop.

## Troubleshooting

**The app says Engine offline.** The engine service saves and opens movies. Start the app with `./formmorpheus`, or check that port 9494 is free. In the desktop app the engine starts itself.

**A video will not import.** The browser has to be able to decode it. Convert it to H.264 in an MP4 or to VP9 in a WebM and try again.

**Export has no sound in QuickTime.** MP4 sound falls back to Opus when the browser has no AAC encoder, and QuickTime does not play Opus. Export MOV, or use a browser with AAC.

**ProRes or HEVC are greyed out.** FormMorpheus found no ffmpeg. Open Preferences, Video Tools and choose Download ffmpeg, or install your own. See Engine formats.

**A GIF is huge.** Lower the colors, the size or the frame rate in the Export dialog. Very large animated GIFs are decoded whole on import, so a long 4K GIF needs a lot of memory.

**The picture lags after a loop turn.** A full-length video can hold its last picture for about 3 frames, and scrubbing a long clip can take a moment to show the new frame. This is known.

**I lost changes.** Use Edit · Restore Last Recovery Point, or reopen the movie: the undo history is saved inside the `.fmo`. After a crash, the next start offers the recovery copy.

**Reset everything.** Preferences · General · Reset All Preferences. Movies and the library are kept.

**Still stuck.** Open an issue at the project page, and say your version (Help · About), your system and what you did.
