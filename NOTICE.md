# formmorpheus notices

formmorpheus is licensed under the Apache License 2.0 (`LICENSE`). It includes or depends on the following work. Every new dependency, binary, model or data file gets a row here before it ships.

| Component | Use | License |
| --- | --- | --- |
| formvis design system and shell (NodeMode Studio Dark tokens, shell, panel and dialog styles, theme boot, DOM helpers, menus, native menus, caption buttons, Home screen, dialogs, toasts, command registry and palette, number fields, controls), by nodemode-ai | `frontend/src/styles`, `frontend/src/ui`, `frontend/index.html` | Apache-2.0 |
| formvis desktop shell (splash and reveal sequence, traffic light placement, text edit routing, packaged engine lookup, window state), by nodemode-ai | `src-tauri/src`, `frontend/public/splash.html`, `setup/` | Apache-2.0 |
| formvfx engine patterns (typed event emitter, timeline mapping, ruler ticks, gesture merge for undo), by nodemode-ai | `frontend/src/engine/events.ts`, `frontend/src/ui/timeline.ts`, `frontend/src/engine/history.ts` | Apache-2.0 |
| Remix Icon paths in `frontend/src/ui/icons.ts` (via formvis) | inline SVG icons | Apache-2.0 |
| fflate | `.fmo` movie files (zip), exported frame archives | MIT |
| mediabunny 1.61.5 (Vanilagy), used unmodified from npm; source: https://github.com/Vanilagy/mediabunny | reading video and sound files, writing MP4, WebM and MOV exports | MPL-2.0 (file-level copyleft: its files are shipped unedited) |
| Inter and JetBrains Mono (`@fontsource`) | interface fonts | SIL Open Font License 1.1 |
| Built-in text fonts through `@fontsource` 5.3.0 (5.3.1 for Noto Sans JP, SC, KR): Lora, Nunito, Bebas Neue, Caveat, Press Start 2P, VT323, Noto Sans, Noto Sans Arabic, Thai and Devanagari, Noto Sans JP, SC and KR (SIL Open Font License 1.1); Roboto Slab and Permanent Marker (Apache-2.0); loaded on demand | Text card Fonts list, Stage and export | OFL-1.1, Apache-2.0 |
| Anton, Sora, Space Grotesk and Poppins through `@fontsource` 5.3.0 (npm `license` field OFL-1.1, each package ships its OFL text); loaded on demand | Text card Fonts list, Stage and export | SIL Open Font License 1.1 |
| FastAPI, Starlette, Uvicorn | the engine service | MIT (FastAPI), BSD-3-Clause (Starlette, Uvicorn) |
| PyInstaller (build only, `backend/requirements_desktop.txt`) | freezes the engine for the desktop app | GPL-2.0 with the bootloader exception: the frozen program is not covered by the GPL |
| Vite, TypeScript, Tauri API, CLI and plugins (shell, dialog, single instance) | build and desktop | MIT, Apache-2.0, MIT OR Apache-2.0 |
| gtk-rs `gtk` 0.18 (Linux desktop only, already in the tree through Tauri) | the OS recent documents list | MIT |
| ffmpeg (not included) | ProRes and HEVC export jobs run the copy the person installed, as a separate program; formmorpheus never ships or links it, so its license (LGPL or GPL, as built) stays theirs | not distributed |

formmorpheus is not affiliated with the makers of any other animation software. Its movie format is its own (`.fmo`).
