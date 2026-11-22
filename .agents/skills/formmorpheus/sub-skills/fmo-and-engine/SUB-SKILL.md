---
name: fmo-and-engine
description: "The .fmo movie file and the FormMorpheus engine's routes: the zip entries and their JSON, the library folder with its stacks and tags, Recently Deleted, and the window key every /api/ route needs. Use when reading or writing a .fmo outside the app, when calling the engine over HTTP, or when changing a router in backend/app/routers."
---

# The .fmo file and the engine

## The .fmo file

A movie is a zip. The writer is `packMovie` and the reader is `unpackMovie` in `frontend/src/io/fmo.ts`.

| Entry | What it holds |
| --- | --- |
| `manifest.json` | `app` (always `formmorpheus`), `format` (the file format number), `version` (the app version that saved it), `saved` (milliseconds since the epoch), `history` (whether history was saved), `playhead` (optional: the frame shown when it was saved) |
| `movie.json` | the movie: the `Movie` type in `frontend/src/engine/types.ts` |
| `history.json` | optional: undo steps and recovery points (`labels`, `recovery`, `states`), at most `MAX_SAVED_STEPS` steps (`frontend/src/io/fmo.ts`) |
| `assets/` plus an asset id | the bytes of each picture, video, sound, painted pixels or font the movie uses; the asset's record is `movie.assets[id]` |
| `poster.png` | optional: the movie's poster |
| `preview.png` | optional: a preview frame |

Rules the reader enforces: `manifest.json` must exist with `app` equal to `formmorpheus`, and a `format` above `FORMAT_VERSION` (`frontend/src/engine/types.ts`) is refused as a newer file. Fields that `movie.json` lacks are filled in memory by `normalizeMovie` (`frontend/src/engine/normalize.ts`); the file changes only when it is saved again.

`movie.json` top level: `format`, `id`, `name`, `width`, `height` (pixels, at most `MAX_SIDE` in `types.ts`), `fps` (between `MIN_FPS` and `MAX_FPS` in `frontend/src/engine/time.ts`), `duration` (movie frames), `background`, `transparent`, `playback` (`loop`, `pingpong` or `oneshot`), `addKeyAtStart`, `onion`, `tracks`, `assets`, and optional fields documented in the `Movie` interface. A track is `{id, name, hidden, content}`; each content item has a `kind` from `ContentKind` (`types.ts`), `start` and `duration` in movie frames, and kind-specific fields (`layers` for drawings, `flip` rows for flipbooks, `text`, nested `tracks` for groups). A new movie's defaults are `newMovie` in `frontend/src/engine/model.ts`.

The engine reads movies without loading media in `backend/app/services/movies.py` (`read_meta`, `picture`) and writes a new empty movie with the same entries and defaults the interface writes (`empty_movie`).

## The library on disk

- The library folder is `config.library_dir()` (`backend/app/core/config.py`): `FORMMORPHEUS_LIBRARY_DIR`, else the folder chosen in Preferences (`libraryDir` in `settings.json`), else `Library` in the data folder.
- A movie is addressed by its name alone; names are unique across the whole library. Stacks are real folders one level deep (`backend/app/routers/library.py`, `find_movie`, `_stack_dirs`). Tags live in `.tags.json` beside the movies, order in `.order.json`.
- Name rules: `clean_name` in `library.py`. Writes go to a part file and are swapped in atomically under `library._lock`.
- Delete moves the file to `Recently Deleted` in the data folder with a record in its `index.json` (`backend/app/routers/trash.py`); items go after `KEEP_DAYS`. Restore never overwrites: a taken name gets a number.
- Exports live in `Exports` in the data folder (`backend/app/routers/exports.py`); a taken name becomes "name 2".

## The engine's routes

The routers and their prefixes are registered in `backend/app/main.py`; each router file is the reference for its routes. `docs/api-contract.json` is the engine's OpenAPI schema used by `setup/api_contract_check` for the iPad engine.

| Prefix | File |
| --- | --- |
| `/api/library` | `routers/library.py`: list, read, write, poster, preview, rename, duplicate, copy-to, delete, stacks, tags |
| `/api/exports` | `routers/exports.py` |
| `/api/jobs` | `routers/jobs.py`: export jobs through ffmpeg |
| `/api/trash` | `routers/trash.py` |
| `/api/recovery` | `routers/recovery.py` |
| `/api/fonts`, `/api/brushes`, `/api/ideas`, `/api/save-to`, `/api/files` | the router of that name |
| `/api/transcode`, `/api/proxy`, `/api/audio-encode` | ffmpeg conversions |
| `/api/health`, `/api/capabilities`, `/api/system/library` | `routers/system.py` |
| `/api/window` | `core/window_key.py` |
| `/api/agents`, `/api/terminal`, `/api/agent` | `routers/agents.py`, `routers/terminal.py`: the dock |
| `/mcp`, `/api/mcp/bridge` | `routers/mcp.py`: the MCP server and the window bridge |

## Who may call

- `core/guard.py`: every request needs a loopback Host, and a state-changing one an absent Origin or one of the app's own.
- `core/window_key.py`: every request under `/api/` needs the window's key in the `x-formmorpheus-window-key` header, reads included, except `/api/window/key` and `/api/health`. A socket under `/api/` needs a one-use `?ticket=` from `POST /api/window/ticket`. The key is made per engine launch and given to one window only.
- `/mcp` is outside `/api/`: it has the Host and Origin guard and its own consent rules (the `mcp-tools` sub-skill). An agent uses `/mcp`, never the `/api/` routes.
