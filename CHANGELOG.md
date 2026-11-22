# Changelog

Versions are `v*.*.*` with dots. Dates are US Eastern. Each section is written for the person using FormMorpheus; the reasons behind a change are in the `HASHOUT_LOG.md` beside the code.

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
