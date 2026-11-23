# Changelog

Versions are `v*.*.*` with dots. Dates are US Eastern. Each section is written for the person using FormMorpheus; the reasons behind a change are in the `HASHOUT_LOG.md` beside the code.

## 0.24.0 · 2026-11-23

FormMorpheus has a test suite. Nothing in the app changes.

### Tests
- Interface: unit tests in `frontend/tests/unit`, run by vitest with happy-dom. They cover the animation engine, its effects and GPU bookkeeping, the paint engine, file input and output, export, media, the platform layer, the agent dock, the app shell, the interface's own logic and the translation tables.
- Engine: tests in `backend/tests`, run by pytest against the FastAPI app in process. They cover the loopback and origin guard, the window key, the page policy, start-up, the library, export jobs, the MCP surface, agents, brushes, fonts, ideas, Pen Link, ffmpeg handling, the remaining routes and the repository's own scripts.
- One test holds every version site to the same version.

### Running them
- `./formmorpheus test` runs both layers; `./formmorpheus test interface` and `./formmorpheus test engine` run one.
- CI runs both on every push and pull request, in a new `tests` job.
- `docs/TESTING.md` says how to run the tests and what a test must do.

### Not covered
- The desktop shell (Rust) and the iPad app (Swift) have no tests yet. Code that needs a real GPU, real codecs or a real browser is left to the window check.

## 0.23.3 · 2026-11-22

The repository has the family's community files. Nothing in the app changes.

### Documents
- `CODE_OF_CONDUCT.md`: how people in the project treat each other, and where to report.
- `CONTRIBUTING.md`: how to set up, the checks to run before a pull request, how changes land, and the rules on licences and other people's IP.
- `SECURITY.md` names the latest release as the supported one, as the other Form apps do, so it does not go stale with each version.
- The README points to all three.

## 0.23.2 · 2026-11-22

A fix release for the builds: the Mac and Linux apps finish building, so this is the version that gets published.

### Fixed
- macOS: Apple accepts the app for notarization. The engine now carries its Python library once, as a plain file signed for where it sits. Before, a second copy inside a framework folder had a signature that did not hold there, and Apple refused the app.
- macOS: a build stops early, with the reason, if a file in the engine would not pass Apple's check where it sits.
- Linux: the build goes on when one of the GStreamer plug-in sets is not installed on the computer that builds it; that set is left out of the AppImage and the build log names it. Before, the build stopped right after freezing the engine, without a message.
- Linux: the AppImage no longer carries GStreamer's two text-art video outputs, nor the S-Lang, GPM and ncurses libraries they brought with them.

## 0.23.1 · 2026-11-22

FormMorpheus is called by its name, in every language, and says plainly what it ships.

### Changed
- Messages, Help, About, the menus and the Pen Link page write the app's name as FormMorpheus. The title bar, Home and the About wordmark keep the lower-case "formmorpheus", as the family writes its wordmarks.
- About says who made it: by nodemode.ai.
- All 30 languages have every string, including the terminal and agents, Video Tools, the new frame rate and brush names and What's New. Nothing falls back to English. What's New says so.
- The installers name the publisher, NodeAgentc, Inc., and the file type "FormMorpheus Movie".
- Two Classic brush sets have names that read right in every language, where the old ones were also the words for other things (a theme, a font weight, the brush size markers): Markers is Pens and markers, Light is Glow. A set you renamed keeps your name.

### Fixed
- The Linux AppImage carries only GStreamer's core, base, good and gl plug-ins (LGPL), whatever else is installed on the computer that builds it.
- The Linux engine no longer carries GNU Readline, which it never used.
- The manual and the wiki said 17 blend modes; there are 26.

### Documents
- `SECURITY.md`: how to report a security problem privately, and what the app guards.
- `NOTICE.md` lists every third-party part the app carries, with its version and licence, including the Rust crates, the Python runtime and the Linux bundle's libraries.
- `docs/api-contract.json` is written from the engine itself, and CI fails when it is stale.
- CI opens the built app in a headless browser and fails if the window does not draw or the page reports an error.

## 0.23.0 · 2026-11-22

The iPad catches up, ffmpeg is one click away, and FormMorpheus uses its own names.

### New
- iPad: ProRes and transparent video come in. The iPad converts them with its own video tools: ProRes 4444 with transparency becomes HEVC with transparency, other video it cannot play becomes H.264. If a converted clip shows no transparency on this iPad, a notice says so.
- iPad: the movie library can live in iCloud Drive. Home's two places are On This iPad and iCloud Drive; a movie saved there opens on your other iPads once it has downloaded.
- iPad: runs from iPadOS 16.4 (it asked for iPadOS 26 before). Pencil squeeze, roll and the hover preview need iPadOS 17.5; before that the Pencil's double tap still works.
- Preferences, Video Tools: where ffmpeg was found and what it can make, and a button that downloads the family's ffmpeg build (LGPL, about 12 MB, from the formai-binaries releases on GitHub) into your data folder, checks every file and can remove it again. An ffmpeg already on your computer is used first.
- Export and Sound only say when ProRes, HEVC or MP3 need ffmpeg, and open Video Tools.
- New Movie: 25 fps (European video) joins the frame rates.
- The README and the manual say what comes over from another animation app: layered `.procreate` artwork with its layers, and a movie as the video, numbered PNG frames or GIF it exports.

### Changed
- Frame rates have FormMorpheus's own labels: 12 Frame by frame is now On twos, 15 Anime is Web and GIF, 24 Cinema is Film, 30 Television is Video, 50 PAL is Smooth (Europe), 60 NTSC is Smooth, 120 Mobile is Extra smooth. The Home size cards follow them. Movies keep their rate.
- Brush sets have FormMorpheus's own names and order. Brushes you chose, sets you renamed and your own order are kept; on disk, a set's folder takes the new name at the next save.
  - Animation: Sketch is Pencil, Chalk is Pastel, Outline is Line art, Monoline is Even line, Wiggle is Boiling line, Ink is Pens, Script is Lettering, Wash is Watercolor, Paint is Thick paint, Bristle is Rough brush, Airbrush is Spray, Sponge is Dabbing, Noise is Grain, Texture is Surfaces, Graphic is Stamps, Pattern is Motifs, Metro is Geometric, Environment is Scenery.
  - Classic: Sketching is Graphite, Charcoals is Charcoal, Drawing is Markers, Inking is Comic ink, Calligraphy is Nibs, Painting is Studio paint, Water is Wet media, Airbrushing is Mist, Spraypaints is Graffiti, Artistic is Mark making, Textures is Grit, Materials is Finishes, Vintage is Printmaking, Industrial is Metalwork, Abstract is Shapes, Luminance is Light, Elements is Atmosphere, Organic is Nature.
- The layered artwork reader's file is now `io/tiled-artwork-import.ts` (it was named after the other app), and the text lint catches other vendors' names in any case.
- New Movie's Screen size follows the way the screen is held.

### Fixed
- The export progress and the Close button no longer move while an export runs.
- The status bar no longer shifts when Draw and Paint opens.

## 0.22.0 · 2026-11-22

AI programs on your computer can work with FormMorpheus, and only as far as you allow.

### New
- A terminal panel beside the Stage and the Timeline: View, Terminal, or Ctrl+` (Cmd+` on a Mac). It runs a shell, and Claude Code, Codex, Cursor and Antigravity when they are installed on your computer. FormMorpheus does not install them or sign you in. Type a request in the line at the bottom and Claude Code opens with it. The panel can sit at the bottom or on the right and keeps its size.
- An MCP server, so an agent can read your library, create, rename, duplicate, delete and restore movies, and export or import. Desktop only.
- Agents ask first. Preferences, Agents has Outside agents: Ask (the default), Allowed or Blocked. Under Ask, a change waits for your yes in a box in the window. An export or an import always asks, whatever you chose.
- Preferences, Agents shows the MCP address and the `./formmorpheus mcp` command for clients that start their own server. `./formmorpheus agents install` sets up Claude Code, Codex, Cursor and Antigravity for you.
- A `formmorpheus` skill for agents, so they know how a movie is made and how to export it.

### Fixed
- The text in the status bar no longer shifts when a movie opens.
- The first-run tour moves its highlight without shifting the page.

## 0.21.0 · 2026-11-22

FormMorpheus looks like the rest of the Form family, in its own violet.

### New
- A violet accent, FormMorpheus's own. An accent you picked yourself is kept; only the old default changes.
- AMOLED Black joins the themes, 29 in all.
- Home opens with a side column: the app's name, Movies, Recent, Start, Exports and Recently Deleted with their counts, the ways to start something new, and Preferences and Help at the foot. The poster wall is still there: Preferences, General, Theater layout, Gallery.

### Improved
- Colours, corner sizes and text sizes are the family's across the whole interface, so every theme recolours every part of it. Before, about 240 colours were fixed and ignored the theme.
- Lists in menus and dropdowns update in place when their contents change, with nothing redrawn around them.

### Changed
- Text is one pixel smaller where it was one pixel larger than the family's, and muted text is a little darker.
- The Italic button shows its "I" in the interface font.

### Fixed
- Chips in dialogs draw their border in the border colour. Before, three colour names they used did not exist.

## 0.20.0 · 2026-11-22

Only the FormMorpheus window can talk to its engine, and a release build carries nothing it does not need.

### Improved
- Your library is the window's alone: the engine answers only requests that carry a key it made for this launch and gave to its own window. Before, another program on the same computer could ask the engine for your movies.
- The engine listens on this computer only, always. The setting that could open it to the network is gone.
- The page the window shows can load code, pictures and sound only from the app itself.
- macOS: the installer asks for macOS 13 or later, which the app has needed since 0.17. Before, it installed on macOS 11 and 12 and then could not start.

### Changed
- From source, the page opens in one browser tab at a time. A second tab says that FormMorpheus is already open.
- `FORMMORPHEUS_HOST` is no longer read.

### Fixed
- Linux: a message about the engine shows web addresses as they are. Before, parts of them came out as digits.

### Under the hood
- Release builds have no web inspector and no source maps.
- The desktop window's permissions are granted to the engine's own address only.
- Two background clean-up jobs write their errors to the engine's log.
- `CLAUDE.md` and the wiki list every configuration variable.

## 0.19.0 · 2026-11-22

FormMorpheus starts and closes dependably on every system: when something goes wrong at the start it says what, and nothing is left running after you close it.

### New
- When the app cannot start, a message says why: the engine program is missing, it could not be started, it stopped, or another copy already has your movies open. The message shows the engine's last lines and where its log is. Before, the app closed without a word.
- When the engine stops while you work, the app tells you and closes, in place of a window that no longer answers.
- The engine keeps a log in the app's data folder, in `Logs/formmorpheus-engine.log`.

### Improved
- Your theme, language and preferences are kept from one launch to the next on every system.
- A window in a light theme opens in that theme's colour from its first frame.
- Linux: the window appears whole when the splash closes, as it does on macOS.

### Fixed
- Windows: closing the app, or ending it in Task Manager, also ends its engine. Before, the engine could stay behind.
- Windows: no console window opens beside the app.
- If the app crashed and left its engine running, the next start replaces it. Before, two engines could run.
- Opening the engine program by itself opens FormMorpheus.

### Changed
- Windows: a portable copy keeps everything in `FormmorpheusData` beside the app.

### Under the hood
- For the people who build it: the Windows launcher `formmorpheus.bat` has the same commands as `./formmorpheus`, both have `install-desktop`, and `build_app` and `build_app.bat` take `--config`. The Windows engine is built as a folder; set `FORMMORPHEUS_ENGINE_WINDOWED=0` to build it with a console. `setup/desktop_build` is removed; `./build_app` is the one build.

## 0.18.4 · 2026-11-22

A small release that makes the first public build dependable: Help has no dead links, a Mac finds ffmpeg, and every build uses the same packages.

### Fixed
- Help: every button in the Help Center opens something. Manual and Send an idea open inside the app, and "FormMorpheus on the web" opens `https://formai.studio/formmorpheus/` in your browser. Before, five buttons and three Help menu items pointed at web pages that did not load.
- macOS: FormMorpheus opened from Finder or the Dock finds an ffmpeg installed with Homebrew or MacPorts, so ProRes, HEVC and MP3 export are offered. Before, they were offered only when the app was started from a terminal.
- macOS: the last lines of a build name the app that was built.

### Changed
- Help menu: "Handbook on the Web", "Community" and "Video Tutorials" are replaced by one item, "FormMorpheus on the Web". The handbook is the Manual, which is inside the app and works offline.

### Under the hood
- Every build installs exactly the packages recorded in the repository: the interface from its lock file, the engine from a list that pins every package, and Rust 1.97.0.
- A Windows build signs its files one way only.

## 0.18.3 · 2026-11-22

A small release that prepares the first builds for macOS, Windows and Linux.

### Fixed
- Windows: Pen Link's page for the tablet is part of the app. Before, a Windows build left it out and the tablet got an empty page.

### Under the hood
- The interface's Tauri packages are the same version line as the desktop shell, which the build requires.
- The installer prefers Python 3.12, the version the engine is built and checked with.
