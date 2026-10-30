# HASHOUT_LOG · backend · formmorpheus

Living log of comment content, rationale, TODOs & removed code for the engine service. Read this first, then edit code surgically.

Current build version: v0.3.0
Last updated: 2026-10-30 · library service for .fmo movies

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
