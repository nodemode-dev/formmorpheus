# formmorpheus notices

formmorpheus is licensed under the Apache License 2.0 (`LICENSE`). It includes or depends on the following work. Every new dependency, binary, model or data file gets a row here before it ships.

| Component | Use | License |
| --- | --- | --- |
| formvis design system and shell (NodeMode Studio Dark tokens, shell, panel and dialog styles, theme boot, DOM helpers, menus, native menus, caption buttons, Home screen, dialogs, toasts, command registry and palette, number fields, controls), by nodemode-ai | `frontend/src/styles`, `frontend/src/ui`, `frontend/index.html` | Apache-2.0 |
| formvis desktop shell (splash and reveal sequence, traffic light placement, text edit routing, packaged engine lookup, window state), by nodemode-ai | `src-tauri/src`, `frontend/public/splash.html`, `setup/` | Apache-2.0 |
| formvfx engine patterns (typed event emitter, timeline mapping, ruler ticks, gesture merge for undo), by nodemode-ai | `frontend/src/engine/events.ts`, `frontend/src/ui/timeline.ts`, `frontend/src/engine/history.ts` | Apache-2.0 |
| Remix Icon paths in `frontend/src/ui/icons.ts` (via formvis) | inline SVG icons | Apache-2.0 |
| fflate | `.fmo` movie files (zip) | MIT |
| Inter and JetBrains Mono (`@fontsource`) | interface fonts | SIL Open Font License 1.1 |
| FastAPI, Starlette, Uvicorn | the engine service | MIT (FastAPI), BSD-3-Clause (Starlette, Uvicorn) |
| PyInstaller (build only, `backend/requirements_desktop.txt`) | freezes the engine for the desktop app | GPL-2.0 with the bootloader exception: the frozen program is not covered by the GPL |
| Vite, TypeScript, Tauri API, CLI and plugins (shell, dialog, single instance) | build and desktop | MIT, Apache-2.0, MIT OR Apache-2.0 |

formmorpheus is not affiliated with the makers of any other animation software. Its movie format is its own (`.fmo`).
