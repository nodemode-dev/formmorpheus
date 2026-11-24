# Testing FormMorpheus

Two layers, each run where its code lives.

| Layer | Where | Runner | What it tests |
| --- | --- | --- | --- |
| Interface | `frontend/tests/unit` | vitest with happy-dom | The TypeScript logic under `frontend/src`: engine, paint, file formats, export, media, platform, dock, app, interface logic and translations |
| Engine | `backend/tests` | pytest | The FastAPI engine in process: guards, routes, services, limits, and the repository's own scripts |

## Running

```bash
./formmorpheus test              # both layers
./formmorpheus test interface    # vitest only
./formmorpheus test engine       # pytest only
```

By hand, inside each side:

```bash
cd frontend && npm test                              # every interface test
cd frontend && npx vitest run tests/unit/engine      # one folder
cd backend && python -m pip install -r requirements-test.txt
cd backend && python -m pytest                       # every engine test
cd backend && python -m pytest tests/core            # one folder
```

CI runs both in the `tests` job of `.github/workflows/ci.yml` on every push and pull request.

## Layout

- An interface test mirrors its source: `frontend/src/engine/fx/blur.ts` is tested in `frontend/tests/unit/engine/fx/blur.test.ts`. Tests import the code through the `@src` alias set in `frontend/vitest.config.ts`. Shared stand-ins live in `frontend/tests/unit/_support`.
- Engine tests are grouped by area: `backend/tests/core`, `library`, `jobs`, `mcp`, `agents`, `assets`, `penlink`, `media`, `routes`, `scripts`.
- `backend/tests/conftest.py` gives every test a fresh data folder (`data_dir`), a client that carries the window key on a loopback host (`client`), and one without the key (`anon_client`). The real home folder is never touched.

## What a test must do

- Assert behaviour a person or a caller can observe: results for inputs, refusals, edge cases, round trips, limits.
- Be able to fail. A test that cannot go red when the behaviour breaks is removed.
- Be hermetic: no network, no real sleeping, no real child programs, no dependence on order or on today's date, nothing written outside a temporary folder.
- Never hardcode the app version. `frontend/tests/unit/version.test.ts` is the one test that reads every version site and holds them equal.
- Follow the house rules: no emoji, no em dash, near-zero comments, test names as plain sentences.
- When a test finds a real fault, the fault is reported and fixed in the source; a test never blesses wrong behaviour.

## Not covered

- The desktop shell under `src-tauri` and the iPad app under `ios` have no tests yet.
- Code that needs a real GPU, real codecs or a real browser. `setup/window_check` opens the built page in Chrome and stays the check for that.
- `tsc` checks `frontend/src` only; the test files are run, not type checked.
