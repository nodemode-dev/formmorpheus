# Contributing

## The rules

1. **Single-region hand edits.** Change an existing file by editing one region at a time. New files are written whole. No patches, diffs, `sed`, codemods or edit scripts.
2. **Zero DOM flash.** Build UI once and patch it in place. Never rebuild a mounted subtree. Use the helpers in `frontend/src/ui/dom.ts`.
3. **Tokens only.** Colors, spacing, radii and z-index come from `frontend/src/styles/tokens.css`.
4. **No emoji and no em dash** anywhere. Use a comma, a colon or the interpunct `·`.
5. **No icon libraries.** Inline SVG with `currentColor`.
6. **No new dependency** without a license check; every shipped one is listed in `NOTICE.md`.
7. **Pure cores.** `engine/` and `paint/` never touch the DOM.
8. **Generic words** for features, never other vendors' product names.
9. **Tests** are written only when the owner asks. The plan for them is kept apart from the tree.

## Check your work

```shell
cd frontend && npx tsc --noEmit
cd frontend && npm run build
python3 setup/lint_text                            # no em dash, emoji, trailers or other vendors' names
backend/venv/bin/python setup/window_check         # the built page opens in Chrome with no error
backend/venv/bin/python setup/api_contract_dump    # docs/api-contract.json from the engine's routes (--check in CI)
python3 setup/api_contract_check                   # the routes the iPad engine serves against that contract
./formmorpheus agents sync --check                 # the shared dock, the finder and the skill pack are in step
```

CI runs the same: the frontend, backend, Tauri, lint, contract and window jobs in `.github/workflows/ci.yml`. The window check starts the engine on a free loopback port with an empty data folder, opens the page in headless Chrome or Chromium through the DevTools protocol, and fails on an uncaught error, a console error or anything the page policy refuses.

Then run `./formmorpheus`, open http://localhost:5194 and look at the change in dark and light themes, at a narrow window, and with a movie open.

## Logs

Decisions and removed code go in the log next to the code: `frontend/HASHOUT_LOG.md`, `backend/HASHOUT_LOG.md` or `src-tauri/HASHOUT_LOG.md`. Read it before editing there.

## Commits

Conventional Commits. Author and committer are `nodemode-ai <mackin@nodemode.ai>`. No `Co-Authored-By` or other attribution trailers, and no "Generated with" line in pull request text.

## Docs

Keep `README.md`, `docs/MANUAL.md` (also the in-app Help, bundled at build time) and these wiki pages true to what the app does. Do not describe features that are not built.
