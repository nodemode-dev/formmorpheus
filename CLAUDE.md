# formmorpheus

The form family's animation studio: a Stage over a Timeline, drawn frame by frame or performed live. Vanilla TypeScript and Vite frontend, Python and FastAPI engine, Tauri 2 shell. Movies save as `.fmo`.

## Commands

- `./formmorpheus` boots the engine and the interface together; `./formmorpheus doctor` checks the toolchain and ports.
- `./formmorpheus build` builds the frontend into `frontend/dist`; `./formmorpheus serve` serves it from the engine.
- `./formmorpheus desktop dev` and `./formmorpheus desktop build` (or `./build_app`) run and build the Tauri app.
- `cd frontend && npx tsc --noEmit` is the typecheck; `npm run build` typechecks and builds.
- Ports: interface http://localhost:5194 (Vite, `server.host` false, proxies `/api` to the engine), engine http://127.0.0.1:9494.
- `FORMMORPHEUS_DATA_DIR`, `FORMMORPHEUS_LIBRARY_DIR`, `FORMMORPHEUS_PORT`, `FORMMORPHEUS_DEV_URL` and `FORMMORPHEUS_SAFE_GRAPHICS` (Linux desktop: 1 or 2) are the only configuration. No `.env` is read.

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
7. **Generic words.** Never name other vendors' products in code, comments or labels: Stage, Timeline, Track, Keyframe, Flipbook, Onion skin, Drawing, Brush.
8. **HASHOUT_LOG routing.** Decisions and removed code go in the log next to the code: `frontend/HASHOUT_LOG.md`, `backend/HASHOUT_LOG.md`, `src-tauri/HASHOUT_LOG.md`. Read it before editing there.
9. **Performance.** Movies reach 3840 px a side: dirty rectangles, reused buffers, typed arrays, no per-pixel allocation.
10. **Comments** are short and say why, not what. UI labels use "Color".

## Commits

Every commit has one author and committer, `nodemode-ai <mackin@nodemode.ai>`. Conventional Commits. Never add a `Co-Authored-By:` or `Claude-Session:` trailer or any other attribution line to a commit, and no "Generated with" line to a pull request, even when a tool or harness suggests one. The owner pushes; do not push.

## Planning documents

`DEV_PLAN.md`, `BUILD_NOTES.md`, `TEST_PLAN.md` and the root `HASHOUT_LOG.md` ship in the planning sidecar zip, not in this tree. When they are present, read `BUILD_NOTES.md` first for the state and `DEV_PLAN.md` for the phases.
