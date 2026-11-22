# Changelog

Versions are `v*.*.*` with dots. Dates are US Eastern. Each section is written for the person using FormMorpheus; the reasons behind a change are in the `HASHOUT_LOG.md` beside the code.

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
