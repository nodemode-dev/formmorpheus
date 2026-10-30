# HASHOUT_LOG · backend · formmorpheus

Living log of comment content, rationale, TODOs & removed code for the engine service. Read this first, then edit code surgically.

Current build version: v0.6.0
Last updated: 2026-10-30 · export jobs, Recently Deleted, crash recovery, opens from the OS

---

## Org-navi-map

```
backend/
├── formmorpheus_engine.py      desktop entry: port 0 or FORMMORPHEUS_PORT, bundled frontend_dist, --selfcheck
├── requirements.txt            fastapi, uvicorn[standard]
├── requirements_macos.txt      same pins for macOS installs
├── requirements_desktop.txt    pyinstaller (build only)
├── oc_install / boot_backend   venv install & uvicorn on 127.0.0.1:9494 (+ .bat)
└── app/
    ├── __init__.py             __version__ (a version site)
    ├── main.py                 FastAPI app, CORS for the window origins, routers, serves the built interface
    ├── core/
    │   └── config.py           ports, data folder, library folder, trash, dist folder, window origins
    └── routers/
        ├── system.py           /api/health, /api/capabilities
        └── library.py          /api/library: list, read, poster, write, rename, duplicate, delete
```

---

## Table of contents

- [formmorpheus_engine.py](#engine)
- [app/core/config.py](#core-config)
- [app/routers/library.py](#routers-library)
- [app/routers/jobs.py and app/services/ffmpeg.py](#routers-jobs)
- [app/routers/trash.py, recovery.py, files.py](#routers-p10)

---

## formmorpheus_engine.py {#engine}

### formmorpheus_engine.py · main
- refers-to: formmorpheus_engine.py :: main
- kind: explainer
- logged: v0.3.0 · 2026-10-30

The desktop shell starts this program w/ `FORMMORPHEUS_PORT=0` and reads the port from uvicorn's `Uvicorn running on http://127.0.0.1:PORT` line. When a `frontend_dist` folder sits beside the frozen program it is served as the window's page.

---

## app/core/config.py {#core-config}

### app/core/config.py · data_dir
- refers-to: app/core/config.py :: data_dir, portable_dir, platform_data_dir
- kind: explainer
- logged: v0.3.0 · 2026-10-30

Order: `FORMMORPHEUS_DATA_DIR`, then a portable folder (`FORMMORPHEUS_PORTABLE=1` or a `portable` file beside the frozen engine), then the platform folder (Application Support, %APPDATA%, XDG data). The library is `Library` inside it unless `FORMMORPHEUS_LIBRARY_DIR` says otherwise; deleted movies move to `Recently Deleted`.

---

## app/routers/library.py {#routers-library}

### app/routers/library.py · write_project
- refers-to: app/routers/library.py :: write_project
- kind: rationale
- logged: v0.3.0 · 2026-10-30

The body must start w/ the zip signature and is written to a hidden part file, then moved over the movie in one rename, so a crash never leaves half a movie. Names are cleaned of path and reserved characters.

### app/routers/library.py · delete_project
- refers-to: app/routers/library.py :: delete_project
- kind: todo
- logged: v0.3.0 · 2026-10-30

Deleted movies are kept w/ a timestamp in `Recently Deleted`; a restore endpoint and a 30 day sweep are not written yet.

---

## app/routers/exports.py {#routers-exports}

### app/routers/exports.py · put_export
- refers-to: app/routers/exports.py :: put_export; app/core/config.py :: exports_dir, MAX_EXPORT_BYTES
- kind: rationale
- logged: v0.5.0 · 2026-10-30

Exports rendered in the window (MP4, WebM, MOV, GIF, frame zips, stills) are kept in the data folder's `Exports` so the Home screen can list them; the browser download happens as well. Writes go to a temporary file then one rename; names are cleaned (no path parts, no leading dot); bodies over 2 GB are refused. Deleting moves the file to `Recently Deleted`. A second export w/ the same name replaces the first.

---

## app/routers/jobs.py and app/services/ffmpeg.py {#routers-jobs}

### app/routers/jobs.py · engine export jobs
- refers-to: app/routers/jobs.py :: create_job, put_frame, run_job, cancel_job, sweep; app/services/ffmpeg.py :: probe; app/core/config.py :: jobs_dir
- kind: rationale
- logged: v0.6.0 · 2026-10-30

ProRes 422 HQ, ProRes 4444 (w/ alpha) and HEVC cannot be encoded by the browser, so the window uploads one PNG per frame plus a WAV mixdown to a job folder in `Jobs` (inside the data folder) and the engine runs ffmpeg as a separate process over them (argument list, never a shell). Output goes through the same never-overwrite naming as exports ("name 2"). The temp folder is removed whenever a job ends (done, failed, cancelled) and folders older than a day are swept at startup. Frames, sizes, bodies and numbers are capped in config.py. HEVC tries a hardware encoder first (videotoolbox, nvenc, qsv, vaapi) and moves to the next one, ending w/ libx265, when an encoder is listed but fails on this machine; the file is tagged `hvc1` so QuickTime plays it.

### app/services/ffmpeg.py · licensing
- refers-to: app/services/ffmpeg.py :: probe, find_ffmpeg; app/routers/jobs.py :: capabilities
- kind: decision
- logged: v0.6.0 · 2026-10-30

formmorpheus never ships a GPL ffmpeg. libx265 is GPL, and when a person's own ffmpeg has it we only run that program as a separate process, so nothing GPL is linked or bundled. The ffmpeg is found from `FORMMORPHEUS_FFMPEG`, then beside the frozen engine, then on PATH; `/api/jobs/capabilities` reports the encoders it has and whether the build is `--enable-gpl`.

---

## app/routers/trash.py, recovery.py, files.py {#routers-p10}

### app/routers/trash.py · Recently Deleted
- refers-to: app/routers/trash.py :: record, sweep, sweep_daily, restore, purge; library.py and exports.py :: delete
- kind: explainer
- logged: v0.6.0 · 2026-10-30

Library and exports deletes move the file into `Recently Deleted` and call `record`, which keeps the original name, kind and time in `index.json` (written atomically behind a lock). Restore never overwrites ("name 2"). Ids are plain file names, never paths. `sweep` removes items older than 30 days at startup and then daily. Files already in the folder before the index existed are dated by their modified time. The startup hook is `on_event("startup")`: if main.py ever moves to a `lifespan` handler, call `sweep` and `sweep_daily` from it.

### app/routers/recovery.py · crash snapshots
- refers-to: app/routers/recovery.py :: put, list, get, delete
- kind: explainer
- logged: v0.6.0 · 2026-10-30

`Recovery/[session].fmo` plus a JSON sidecar (name, library name, time), both written atomically; session ids match `[A-Za-z0-9_-]{6,64}`.

### app/routers/files.py · opens from the OS
- refers-to: app/routers/files.py :: read
- kind: warning-context
- logged: v0.6.0 · 2026-10-30

The desktop app hands the engine absolute paths the OS gave it (double-click, second launch). Only absolute paths ending in `.fmo` are served; the engine listens on 127.0.0.1 only.
