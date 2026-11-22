# formmorpheus

The form family's animation studio: a Stage over a Timeline, drawn frame by frame or performed live. Vanilla TypeScript and Vite frontend, Python and FastAPI engine, Tauri 2 shell. Movies save as `.fmo`.

## Commands

- `./formmorpheus` boots the engine and the interface together; `./formmorpheus doctor` checks the toolchain and ports.
- `./formmorpheus build` builds the frontend into `frontend/dist`; `./formmorpheus serve` serves it from the engine.
- `./formmorpheus desktop dev` and `./formmorpheus desktop build` (or `./build_app`) run and build the Tauri app.
- `cd frontend && npx tsc --noEmit` is the typecheck; `npm run build` typechecks and builds.
- Ports: interface http://localhost:5194 (Vite, `server.host` false, proxies `/api` to the engine), engine http://127.0.0.1:9494.
- Configuration is environment variables only; no `.env` is read. For a person: `FORMMORPHEUS_DATA_DIR` (the data folder), `FORMMORPHEUS_LIBRARY_DIR` (the library), `FORMMORPHEUS_FFMPEG` (the ffmpeg to use), `FORMMORPHEUS_PORT` (the engine's port; 0 or unset picks one), `FORMMORPHEUS_PORTABLE` (1: data beside the app), `FORMMORPHEUS_SAFE_GRAPHICS` (Linux desktop: 1 or 2), `FORMMORPHEUS_CLAUDE_BIN`, `FORMMORPHEUS_CODEX_BIN`, `FORMMORPHEUS_CURSOR_BIN` and `FORMMORPHEUS_ANTIGRAVITY_BIN` (the path of that agent program for the terminal panel, tried before the search of PATH and the usual install folders), `FORMMORPHEUS_AGENT_DIR` (the folder the Claude Code, Codex and Cursor tabs work in; `Agent` in the data folder when unset), `FORMMORPHEUS_MCP_URL` and `FORMMORPHEUS_MCP_AUTOSTART` (for `./formmorpheus mcp`: the engine's `/mcp` address to forward to, in which case no engine is started; 0 stops it starting this source copy's engine when none answers). For development and builds: `FORMMORPHEUS_DEV_URL` (a debug desktop build loads this page), `FORMMORPHEUS_BACKEND_PORT` (the engine port Vite proxies to), `FORMMORPHEUS_DIST` (the built interface the engine serves), `FORMMORPHEUS_NO_SHELL` (1: a frozen engine serves without its app), `FORMMORPHEUS_TARGET` and `FORMMORPHEUS_PYI_ARCH` (the freeze's target), `FORMMORPHEUS_ENGINE_WINDOWED` (0: a Windows engine with a console). Set by the app for its own engine, never by hand: `FORMMORPHEUS_DESKTOP`, `FORMMORPHEUS_PORT_PREFER`, `FORMMORPHEUS_SHELL_PID`, `FORMMORPHEUS_WINDOW_KEY_STDOUT`. Set by the launcher, never by hand: `FORMMORPHEUS_CALLER_DIR` (the folder `./formmorpheus` was run from; `./formmorpheus agents install` sets up that folder too). Set by the engine in the terminal panel's tabs, never by hand: `FORMMORPHEUS_TERMINAL` (1), `FORMMORPHEUS_URL` (the engine's address), `FORMMORPHEUS_MCP_URL` (its `/mcp` address) and, in the Codex, Cursor and Antigravity tabs only, `FORMMORPHEUS_INAPP_TOKEN` (the tab's own token). The engine listens on 127.0.0.1 only; there is no variable to change that.

## Where things live

- `frontend/src/engine/` is the movie model, ops, history, keys and renderer. It never touches the DOM.
- `frontend/src/paint/` is the paint core: typed arrays and maths only, no `document`, no `window`.
- `frontend/src/ui/` is the Stage, Timeline, Draw & Paint, popovers and the family shell. `frontend/src/media/` decodes and plays video and sound. `frontend/src/export/` renders and encodes. `frontend/src/io/` talks to the engine and reads and writes `.fmo`.
- `frontend/src/app/app.ts` wires commands, menus, keys, save and open. It is shared, so re-read it right before every edit.
- `backend/app/` is the engine service: library, exports, export jobs through the person's own ffmpeg, Recently Deleted, crash recovery.
- `src-tauri/` is the desktop shell. `setup/` holds the scripts behind `./formmorpheus`.
- `docs/MANUAL.md` is the user manual and also the in-app Help (`frontend/src/ui/help-view.ts` bundles it). `.docs/wiki/` is the GitHub wiki source.

## The laws

1. **SEDO.** Write new files whole; change existing files only by hand-made single-region edits. No patch, diff, `git apply`, `sed`, `awk`, codemod or edit script, in or out.
2. **Zero DOM flash.** Build UI once from a template, then patch in place (toggle classes, set text and attributes). Never rebuild a mounted subtree, never set `innerHTML` on content that is showing. Use the helpers in `frontend/src/ui/dom.ts` and `popover.ts`.
3. **Tokens only.** Colors, spacing, radii and z-index come from `frontend/src/styles/tokens.css` and the one z-index scale. The accent is `var(--accent-color)`.
4. **No emoji. No em dash (U+2014).** Use a comma, a colon or the interpunct `·`.
5. **No icon libraries.** Icons are inline SVG strings in `currentColor`. No new npm dependency without a license check against NOTICE.md.
6. **No self-written tests.** The test plan (`TEST_PLAN.md`) lives in the planning sidecar, and the owner decides when tests are written. Verify by running the app in Chromium and by typechecking.
7. **Generic words.** Never name other vendors' products in code, comments or labels: Stage, Timeline, Track, Keyframe, Flipbook, Onion skin, Drawing, Brush. File extensions and type identifiers are formats, not names, so `.procreate` stays (the text lint passes a lower-case match after a dot or as a whole plist string).
8. **HASHOUT_LOG routing.** Decisions and removed code go in the log next to the code: `frontend/HASHOUT_LOG.md`, `backend/HASHOUT_LOG.md`, `src-tauri/HASHOUT_LOG.md`. Read it before editing there.
9. **Performance.** Movies reach 3840 px a side: dirty rectangles, reused buffers, typed arrays, no per-pixel allocation.
10. **Comments** are short and say why, not what. UI labels use "Color".

## Commits

Every commit has one author and committer, `nodemode-ai <mackin@nodemode.ai>`. Conventional Commits. Never add a `Co-Authored-By:` or `Claude-Session:` trailer or any other attribution line to a commit, and no "Generated with" line to a pull request, even when a tool or harness suggests one. The owner pushes; do not push.

## Planning documents

`DEV_PLAN.md`, `BUILD_NOTES.md`, `TEST_PLAN.md` and the root `HASHOUT_LOG.md` ship in the planning sidecar zip, not in this tree. When they are present, read `BUILD_NOTES.md` first for the state and `DEV_PLAN.md` for the phases.
