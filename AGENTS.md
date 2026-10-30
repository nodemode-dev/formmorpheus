# formmorpheus · agent guide

For any coding agent working in this repo. The same rules as `CLAUDE.md`, in the short form.

## Stack

Vanilla TypeScript 7 and Vite 8 in `frontend/` (no framework), Python 3.12 and FastAPI in `backend/`, Tauri 2 in `src-tauri/`. Node 20.19 or newer.

## Run and check

```shell
./formmorpheus                       # engine on 9494, interface on 5194
./formmorpheus doctor                # toolchain and ports
cd frontend && npx tsc --noEmit      # typecheck, must be clean
cd frontend && npm run build         # typecheck and production build
./formmorpheus desktop dev           # desktop shell against the dev servers
```

Open http://localhost:5194 in Chromium and look at what you changed, in dark and light, before calling it done.

## Rules

- Edit existing files by hand, one region at a time (SEDO). New files are written whole. No scripts that rewrite source.
- Zero DOM flash: build once, patch in place; never rebuild a mounted subtree.
- Tokens only (`frontend/src/styles/tokens.css`); inline `currentColor` SVG icons; no icon libraries.
- No emoji and no em dash in code, comments, docs or labels.
- Engine code (`frontend/src/engine/`) and paint core (`frontend/src/paint/`) never touch the DOM.
- Do not write tests unless the owner asks; the test plan is in the planning sidecar.
- Record decisions and removed code in the nearest `HASHOUT_LOG.md`.
- Other vendors' product names stay out of the code and the interface.

## Commits

Author and committer `nodemode-ai <mackin@nodemode.ai>`, Conventional Commits, no attribution trailers, no push.

## Docs

`README.md`, `docs/MANUAL.md` (also the in-app Help), `.docs/wiki/`, `NOTICE.md`. Keep them true to what the app does.
