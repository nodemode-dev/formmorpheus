# formmorpheus notices

formmorpheus is licensed under the Apache License 2.0 (`LICENSE`). It includes or depends on the following work. Every new dependency, binary, model or data file gets a row here before it ships.

| Component | Use | License |
| --- | --- | --- |
| formvis design system and shell (NodeMode Studio Dark tokens, shell, panel and dialog styles, theme boot, DOM helpers, menus, native menus, caption buttons, Home screen, dialogs, toasts, command registry and palette, number fields, controls), by nodemode-ai | `frontend/src/styles`, `frontend/src/ui`, `frontend/index.html` | Apache-2.0 |
| formvis desktop shell (splash and reveal sequence, traffic light placement, text edit routing, packaged engine lookup, window state), by nodemode-ai | `src-tauri/src`, `frontend/public/splash.html`, `setup/` | Apache-2.0 |
| formvfx engine patterns (typed event emitter, timeline mapping, ruler ticks, gesture merge for undo), by nodemode-ai | `frontend/src/engine/events.ts`, `frontend/src/ui/timeline.ts`, `frontend/src/engine/history.ts` | Apache-2.0 |
| formvis dock module 2.2.1 (terminal panel, agent tabs, the question an outside agent raises; version in `frontend/src/dock/MANIFEST.json`) and the shared agent program finder 1.0.1, shared Form family code copied unchanged, by nodemode-ai | `frontend/src/dock/`, `backend/app/services/agent_lookup.py` | Apache-2.0 |
| Remix Icon paths in `frontend/src/ui/icons.ts` (via formvis) | inline SVG icons | Apache-2.0 |
| fflate | `.fmo` movie files (zip), exported frame archives | MIT |
| mediabunny 1.61.5 (Vanilagy), used unmodified from npm; source: https://github.com/Vanilagy/mediabunny | reading video and sound files, writing MP4, WebM and MOV exports | MPL-2.0 (file-level copyleft: its files are shipped unedited) |
| xterm.js: `@xterm/xterm` 6.0.0 and `@xterm/addon-fit` 0.11.0, used unmodified from npm | the terminal panel's screen and its fit to the panel | MIT |
| Inter and JetBrains Mono (`@fontsource`) | interface fonts | SIL Open Font License 1.1 |
| Built-in text fonts through `@fontsource` 5.3.0 (5.3.1 for Noto Sans JP, SC, KR): Lora, Nunito, Bebas Neue, Caveat, Press Start 2P, VT323, Noto Sans, Noto Sans Arabic, Thai and Devanagari, Noto Sans JP, SC and KR (SIL Open Font License 1.1); Roboto Slab and Permanent Marker (Apache-2.0); loaded on demand | Text card Fonts list, Stage and export | OFL-1.1, Apache-2.0 |
| Anton, Sora, Space Grotesk and Poppins through `@fontsource` 5.3.0 (npm `license` field OFL-1.1, each package ships its OFL text); loaded on demand | Text card Fonts list, Stage and export | SIL Open Font License 1.1 |
| FastAPI, Starlette, Uvicorn | the engine service | MIT (FastAPI), BSD-3-Clause (Starlette, Uvicorn) |
| keyring 25.7.0, with jaraco.classes 3.4.0, jaraco.context 6.1.2, jaraco.functools 4.6.0 and more-itertools 11.2.1 | the system keychain keeps the key that seals the Outside agents choice | MIT |
| SecretStorage 3.5.0, jeepney 0.9.0, cryptography 50.0.2, cffi 2.1.1 and pycparser 3.12 (Linux only) | keyring's Linux backend, the Secret Service, and what it needs | BSD-3-Clause (SecretStorage, pycparser), MIT (jeepney), MIT-0 (cffi), Apache-2.0 OR BSD-3-Clause (cryptography) |
| pywin32-ctypes 0.2.3 (Windows only) | keyring's Windows backend | BSD-3-Clause |
| ptyprocess 0.7.0 (every system but Windows) and pywinpty 3.0.5 (Windows only) | the pseudo-terminal behind the terminal panel's shell and agent program tabs | ISC (ptyprocess), MIT (pywinpty) |
| PyInstaller (build only, `backend/requirements_desktop.txt`) | freezes the engine for the desktop app | GPL-2.0 with the bootloader exception: the frozen program is not covered by the GPL |
| Vite, TypeScript, Tauri API, CLI and plugins (shell, dialog, single instance) | build and desktop | MIT, Apache-2.0, MIT OR Apache-2.0 |
| gtk-rs `gtk` 0.18 (Linux desktop only, already in the tree through Tauri) | the OS recent documents list | MIT |
| ffmpeg (not included) | ProRes and HEVC export jobs run the copy the person installed, as a separate program; formmorpheus never ships or links it, so its license (LGPL or GPL, as built) stays theirs | not distributed |

formmorpheus is not affiliated with the makers of any other animation software. Its movie format is its own (`.fmo`).
