# HASHOUT_LOG · backend · formmorpheus

Living log of comment content, rationale, TODOs & removed code for the engine service. Read this first, then edit code surgically.

Current build version: v0.14.0
Last updated: 2026-10-30 · brush libraries as files, recovery presence over a WebSocket, streamed duplicates

---

## v0.18.3 · installer Python

- `oc_install` tried Python 3.14, then 3.13, then 3.12, so a runner that carries a newer Python built the venv, and with it the frozen engine (PyInstaller ships the interpreter it runs under), on a version CI never runs. CI (`.github/workflows/ci.yml`) and the stack line in `AGENTS.md` are 3.12, so the order is now 3.12, 3.13, 3.14, then `python3`; any of them still has to be 3.12 or newer. An existing `backend/venv` is still reused as it is.
- Not changed: `../build_app` walks 3.13, 3.12 for its own check, but it only reads `tauri.conf.json` with that interpreter and prints its version; the engine is frozen from the venv.

## v0.17.2 · media fallbacks

- `routers/audio_encode.py`: `POST /api/audio-encode/lossy?kind=opus-webm|opus-ogg|aac-m4a&kbps=` turns the window's WAV mixdown into Opus (WebM or OGG) or AAC (M4A) with the person's ffmpeg, for a web component with no `AudioEncoder`. Same shape and limits as the MP3 route; 503 with the install hint when the encoder is missing.
- `services/ffmpeg.py`: `libopus` added to WANTED; `routers/jobs.py` capabilities now carry `opus`.

---

## v0.17.2 · pen link

- `penlink_static/pen.js`: a stroke now always ends with a plain lift (`endStroke`). Triggers: pointerup, pointercancel (no longer a discard, the leave flag is dropped on cancel), lostpointercapture, pagehide, window blur, visibilitychange to hidden, socket close, a pointerdown with a new pointerId while one is down (old stroke lifts first, then the new one starts). There is no idle timeout on purpose: Safari sends no pointermove while a pen rests still, so a timer would end real strokes during a held rest (wet media pooling, QuickShape hold). Hover leave is sent on the same page-leaving events.
- Secure context: not done, by decision. `cryptography` is installed in this environment but is not in `requirements.txt`, and Python's standard library cannot make a certificate; adding a dependency plus a one-time certificate warning on the tablet is more friction than it saves. Instead `pen.js` is confirmed to work without coalesced events: `getCoalescedEvents` is absent on plain http, the code falls back to the event itself, and every pointermove the page gets is sent at full rate with pressure, tilt, twist and altitude/azimuth. `penlink.py` is unchanged.
- Desktop side (`frontend/src/ui/pen-link.ts`): a socket drop mid-stroke ends the stroke as a lift at the last place seen (was a cancel at 0,0, which discarded the half stroke).
- Verified in Chromium (tablet context plus desktop page): normal stroke, cancel, pagehide, blur, pointerId switch, socket drop and a stroke after reconnect each give one pointerdown and one pointerup on the desktop canvas, no cancel. A 3 s still hold mid-stroke stays down until the real release.

---

## v0.17.0 · Fonts and export folders

### v0.17.0 · review
- routers/save_to.py: Windows device names (CON, NUL, COM1, LPT1 ...) and names ending in a dot or space are refused for files, frames folders and each frame in a zip; a `//` or `\\` folder (network share, device path) is refused; a zip may unpack to 16 GB at most, by header and by bytes actually written (a header can lie); a failed frames save removes what it made. Checked by request: `..`, `/`, `\`, `:`, absolute and relative folders, `/etc`, entries named `../../x` or with a backslash all stay inside the chosen folder or get 400.
- routers/fonts.py: a font upload must start with a font signature (sfnt, OTTO, true, ttcf, wOFF, wOF2), not only carry the extension; control characters are refused in the family name.

- routers/fonts.py (new, `/api/fonts`): the app-wide Fonts library, `<data>/Fonts/<file>` plus `.fonts.json` (file to family). GET list, GET/PUT/DELETE one file (`?family=` on PUT; the same file name with another family gets "name 2"). Only .ttf .otf .woff .woff2, 64 MB each.
- routers/save_to.py (new, `/api/save-to/file`, `/api/save-to/frames`): writes an export into a folder the desktop dialog chose, using `_safe_folder` (no system folders, the folder must exist). Never replaces: a taken name or folder becomes "name 2". Frames: the zip is cut into `<dir>/<folder>/`, taking each entry's last path segment only (an entry like `a/../../x` stays inside). Checked with curl: two runs gave `Mov` and `Mov 2`, `evil.png` stayed inside, `/etc` refused.
- routers/jobs.py: `targets.hevc.alpha` and `alpha_reason` in capabilities; a HEVC job with alpha runs only `hevc_videotoolbox` (`format=bgra`, `-alpha_quality 0.75`) and is accepted only where that encoder exists.

---

## v0.16.0 · Media, sound and delivery

- routers/proxy.py (new, `POST /api/proxy/make?height=360|540|720`): uploads a video, returns a small H.264 copy (short side scaled to `height`, crf 27, keyframe each second, no sound, faststart) made by the person's ffmpeg; the temp folder goes with the response. Checked: 1920x1080 3 s (1,830,739 B) gave 960x540 h264 24 fps 3.000 s (133,621 B); 1080x1920 gave 540x960. The window plays proxies while editing; exports read the original blobs.
- routers/library.py: `GET /api/library/_tags` and `POST /api/library/_tags/{name}` keep movie tags in `.tags.json` beside the library (12 tags a movie, 32 characters each, de-duplicated without regard to case, entries of movies that are gone are dropped). A rename does not carry the tags over; a library entry also reports `created`.

- routers/audio_encode.py (new, `/api/audio-encode/mp3?kbps=`): MP3 for sound-only export. The browser has no MP3 encoder and none is written here (a clean-room encoder was judged not worth the licence and quality risk); the window posts its WAV mixdown, the person's own ffmpeg (libmp3lame, run as a separate program, never bundled) answers with the MP3, and the temp folder goes with the response. 503 with a reason when ffmpeg or libmp3lame is missing; `/api/jobs/capabilities` now reports `mp3`.
- routers/jobs.py rate control. `video_kbps` or `target_bytes` on a new job. libx264 and libx265 run two passes (statistics, then the file) whenever a bitrate is set; a file size becomes a bitrate after the sound (192 kbps AAC, or 1.41 Mbps PCM) with 1.5 percent for the container. Hardware HEVC encoders get `-b:v` in one pass. ProRes has no bitrate switch: the family member nearest below the target (scaled from the published 1080p rates by pixels and fps) is picked and `-bits_per_mb` caps each frame; prores_ks refuses under about 135, so 140 is the floor. The job reports a `note` and `pass` / `passes`, which the window shows as a warning line.
- Chapters: markers inside the exported range become chapters of the engine's files (ffmetadata, `-map_chapters`). The browser-encoded MP4 has none (mediabunny writes no chapter atom).
- Measured: HEVC 3 s 640x360 with `target_bytes` 150000 gave 149,247 bytes; 800 kbps gave 298,777 (target 300,000); H.264 150000 gave 156,144 (+4 percent); ProRes at 1,000,000 gave 1,010,594 with Proxy.

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

### v0.7.0 · jobs and recovery
- refers-to: app/routers/jobs.py :: abandoned sweep, rational fps, mov container; app/routers/recovery.py :: alive
- kind: fix
- logged: v0.7.0 · 2026-10-30

A job w/ no upload or poll for 10 min is cancelled and removed, checked every minute while the engine runs (the loop starts in main.py). Frame rates go to ffmpeg as exact rationals (24000/1001, 30000/1001, 60000/1001). HEVC can be written as MOV. Recovery sidecars carry `alive`, refreshed by `POST /api/recovery/{session}/alive` every 20 s from the window that owns the snapshot; the list reports `idle` so a live window's snapshot is never offered as a crash.

### v0.8.0 · brushes and stacks
- refers-to: app/routers/brushes.py; app/routers/library.py :: _stacks routes
- kind: explainer
- logged: v0.8.0 · 2026-10-30

`GET` / `PUT /api/brushes` keeps the person's brush library (imported and edited brushes, tips as data) in `brushes.json` in the data folder, so it survives a cleared browser profile and the desktop app shares it. Theater stacks (non-nested folders, as the reference) live under `/api/library/_stacks`; rename and delete follow a movie's stack entry.

### v0.9.0 · transcode, library folder, job codecs
- refers-to: app/routers/transcode.py; app/routers/system.py :: library; app/routers/library.py :: preview, poster 204; app/routers/jobs.py :: h264 target, audio_codec, ProRes profile; app/services/ffmpeg.py :: WANTED (libx264)
- kind: explainer
- logged: v0.9.0 · 2026-10-30

`/api/transcode` turns video the window cannot decode into H.264 MP4 (VP9 WebM when the source has alpha) and sound into 48 kHz WAV, w/ the job pattern of jobs.py. The library folder is chosen at runtime (`settings.json` in the data folder); `FORMMORPHEUS_LIBRARY_DIR` still wins; system and relative paths are refused. A movie w/o a poster or preview answers 204, not 404. Jobs can write H.264, choose AAC or PCM (PCM only in .mov) and a ProRes profile; libx264 had to be added to the encoders the probe looks for.

### v0.10.0 · stack folders, the host guard, safe moves, caps
- refers-to: app/routers/library.py :: stacks, order; app/core/guard.py; app/core/fsmove.py :: safe_move; app/core/upload.py; app/core/config.py :: window_origins; app/routers/jobs.py :: sweep_abandoned; app/routers/transcode.py :: heic, cap; app/routers/recovery.py; app/routers/system.py :: library copy; app/routers/trash.py :: restore
- kind: explainer
- logged: v0.10.0 · 2026-10-30

A stack is a folder `Library/<Stack>/<movie>.fmo`, one level deep; movie names stay unique across the whole library so open, save and trash keep addressing by name. `.stacks.json` migrates once to folders and is renamed `.stacks.json.migrated`. `.order.json` per folder holds the manual order. The guard is the outermost middleware: loopback hosts only, and state-changing requests need no Origin, one of `window_origins()` or the request's own scheme and host (the desktop engine's random port); a new window origin must be added to `window_origins()`. `safe_move` falls back to copy, fsync, replace and remove on EXDEV. Uploads are streamed w/ size checks while reading. The jobs sweep skips folders owned by either job registry and keeps orphans and unfetched results 30 minutes. Transcodes run at most 2 at a time, probes time out after 30 s, and a cancel before the process exists still kills it. HEIC goes through pillow-heif if installed, else ffmpeg 7.1+ (older builds return one tile, so they are refused). A library folder change copies stack folders and order files too; Recently Deleted restores to a name free across the library.

### v0.11.0 · copy-to, recovery live stream, job outputs
- refers-to: app/routers/library.py :: copy_to, duplicate (_copy_with_new_id); app/routers/recovery.py :: live; app/routers/jobs.py :: _prune, fetched
- kind: explainer
- logged: v0.11.0 · 2026-10-30

`POST /api/library/{name}/copy-to` copies a movie to a folder the person picked (the `_safe_folder` checks, never overwrites: a taken name becomes "Name 2", a `.part` file renamed into place). A duplicate gets a fresh movie id and its own inner name (since the 0.10.0 tester found copies sharing an id). Each window holds `GET /api/recovery/{session}/live` open; a closed stream counts as gone after 4 s, and after an engine restart a session that has not reconnected in 15 s counts as gone, so a crashed window's work is offered at once. A finished job's output is kept until fetched or 24 h old even past the 40-job record cap. The 10-minute sweep in transcode.py (import conversions) is unchanged: imports fetch their result at once.

### v0.12.0 · brush files, presence socket, streamed copies
- refers-to: app/routers/brushes.py; app/routers/recovery.py :: live (WebSocket); app/routers/library.py :: _copy_with_new_id, copy_to; app/routers/system.py :: _safe_folder(create); boot_backend, setup/serve, formmorpheus_engine.py :: timeout_graceful_shutdown
- kind: explainer
- logged: v0.12.0 · 2026-10-30

Brush libraries live as `Brushes/<Library>/<Set>/<Brush>.brush` (the export format plus a `formmorpheus/` folder w/ the exact settings, tip and grain), w/ `.order.json` per level and a one-time migration of `brushes.json` (renamed `.migrated`). Only brushes the person made or changed get files. Deletes remove only `*.brush`, `.order.json` and `.*.part` and then an empty folder; symlinks are never followed; Windows device names (CON, NUL, COM1 and the rest) and paths over 240 characters are refused; names that differ only by case are a 409. The recovery presence moved from a held GET to a WebSocket: a held HTTP/1.1 request per window blocked shutdown and, at about six windows, used up the browser's connections per host. Its registry is per process, so the engine must run as one worker. All boot scripts pass a 3 s graceful shutdown. Duplicates and copies stream zip entries and publish w/ an exclusive create; copy-to never creates folders.

### v0.13.0 · ideas, part sweep, atomic writes
- refers-to: app/routers/ideas.py; app/core/partsweep.py; app/routers/library.py, recovery.py :: unique part files
- kind: explainer
- logged: v0.13.0 · 2026-10-31

`/api/ideas` stores notes from the Help Center's Send an idea as `Ideas/idea-YYYYMMDD-HHMMSS.txt` under the data folder (add, list, delete). Library and recovery writes use a unique part file, fsync and replace; `partsweep.py` removes part files older than an hour and recovery snapshots unanswered for 30 days. Killing the engine mid-write 40 times left no corrupt file.

### v0.15.0 · Pen Link (tablet as a drawing tablet)
- refers-to: app/penlink.py; app/penlink_static/ (index.html, pen.js, pen.css); app/main.py :: router + shutdown hook; frontend/src/ui/pen-link.ts
- kind: explainer
- logged: v0.15.0 · 2026-10-31

**What runs.** `POST /api/penlink/start` (loopback API, guarded as the rest) opens a second uvicorn Server in the engine's own loop on 0.0.0.0, default port 9495, and answers `{code, urls, port}`. `POST /stop`, `POST /code` (new code; forgets a paired tablet), `GET /status`, and the WebSocket `/api/penlink/desk` (one desktop at a time; a second replaces the first). The listener exists only between start and stop, or engine exit (shutdown hook). The Server subclass skips uvicorn's signal capture so the engine keeps its Ctrl-C handling. A reload or crash of the engine ends it with the process; it is never started at boot and no setting remembers "on".

**What the LAN listener answers.** A tiny raw ASGI app, not FastAPI: `GET /penlink/` (+ `pen.js`, `pen.css`), `POST /penlink/pair`, WebSocket `/penlink/ws`. Anything else is 404, so no `/api/...` path exists there (checked: `/api/penlink/status`, `/api/library`, `/` all 404). Host must equal one of the advertised `<lan-ip>:<port>` (loopback and foreign hosts get 403: DNS rebinding). Pair and WebSocket need `Origin` equal to `http://<that host>`; a missing Origin is refused. Responses carry no-store, nosniff, frame deny, no referrer, and a CSP of 'self' only (inline script and style are not used by the page). No CORS.

**Pairing.** 6-digit code from `secrets`, valid 120 s, 5 tries, then dead until a new code (a correct code after 5 wrong ones is refused). On a right code the code is consumed and a 128-bit token (`token_urlsafe(16)`, memory only) is returned; the WebSocket's first message must be `hello` with that token within 5 s. One tablet: while a token exists, further pairing is a 409 and a second socket is closed. A dropped tablet keeps its token 30 s (reconnect), then it is revoked. Disconnect on the desktop = new code = revoke. Comparisons use `hmac.compare_digest`.

**Limits.** Tablet messages max 64 KB (uvicorn `ws_max_size`), pair body max 512 bytes, 1500 messages a second then dropped; desk to tablet frames max 4 MB. Tablet JSON is relayed only for known types (`tool`, `undo`, `redo`, `lat`, `ack`, `view`); `ping` is answered by the engine.

**Wire format.** Samples (tablet to engine to desktop, binary, little endian): header `u8 type=1, u8 count (max 16), u16 seq`; per sample 20 bytes: `u16 dt_ms, f32 x, f32 y` (0..1 of the mirrored canvas rectangle), `u16 pressure (0..65535), i8 tiltX, i8 tiltY, u16 twist*10, u8 flags, u8 pointerId, u8 altitude (0..255 = 0..90 deg), u8 azimuth (0..255 = 0..360 deg)`; flags 1 down, 2 up, 4 hover, 8 eraser, 16 barrel, 32 enter, 64 leave (up+leave = cancel). Mirror frames (desktop to tablet): `u8 type=2, u8 format (0 WebP), u16 seq`, then the image. Tablet answers `{"t":"ack","seq"}`; the desktop keeps one frame in flight, spaces frames by the measured ack time (70 to 200 ms, so 5 to 14 fps) and lowers WebP quality from 0.72 to 0.5 when acks are slow. Unchanged pictures are not resent (a 24 px signature), except one a second and while the pen was active in the last 800 ms.

**Desktop receiver.** Samples become synthetic `PointerEvent`s (`pointerType: 'pen'`, fixed pointerId 7731, pressure, tilt, twist, altitude and azimuth, buttons 1 on contact, 32 for the eraser end, +2 barrel) dispatched on the visible `.fm-paint-canvas`: pointerover, pointerenter, pointermove (hover, buttons 0), pointerdown, pointermove, pointerup or pointercancel, pointerout, pointerleave. The browser refuses `setPointerCapture` for an id it never saw, so Pen Link wraps capture calls for its own id as no-ops on the canvas; paint input needs no change for that. `PaintView.penLinkState/penLinkApply` drive the tool (erase or paint), size, opacity and undo or redo from the tablet's toolbar; the tablet's sliders follow the desktop (state is pushed when it changes).

**Decisions.** Plain HTTP and WS only. A token and a code cross the LAN unencrypted, so anyone on the same Wi-Fi who can sniff traffic can take over the session, and secure-context features (`getCoalescedEvents` on some browsers, wake lock) may be missing in Safari on plain http; the page uses them when present. Self-signed HTTPS was left out: it needs a certificate prompt on the tablet and a key store, and the session is short and opt-in. The LAN address list is the outgoing interface plus the host name's IPv4 addresses (no link-local); with none, it falls back to 127.0.0.1. Binary frame size is fine for Wi-Fi (about 20 bytes a sample). The mirror is the paint canvas element as drawn (including its surround), so pen coordinates map 1:1 to the element's client rectangle.

**Packaging.** `app/penlink_static/` is read from disk at request time; the frozen engine (`setup/freeze_backend`) must add it as data (`--add-data app/penlink_static`), not done here (not this change's file). Port 9495 may need an allow rule in the OS firewall prompt on first use.

**Verified** (Chromium, second page on the LAN URL http://192.0.2.2:9495/penlink/; this sandbox sets an HTTPS proxy that breaks WebSocket upgrades to that address, so the test ran with proxy variables unset): wrong code 401, five wrong tries lock the code, pairing, pen strokes with pressure ramp and tilt reach the paint canvas, mirror shows them, tablet Eraser and Undo drive the desktop, `/api/*` 404 on the LAN listener, port closed after stop, loopback Host 403.

**For the manual (written later), say:** what Pen Link is and that it is off until turned on (Edit, Pen Link); same Wi-Fi needed; open the address on the tablet, type the code (valid 2 minutes, 5 tries); one tablet at a time; Disconnect and Turn off end it, closing the app does too; the traffic is not encrypted, use it on a network you trust and turn it off when done; the tablet shows a mirror of the Draw & Paint canvas, strokes appear at once on the tablet and are replaced by the mirror; toolbar: Brush, Eraser, Undo, Redo, Size, Opacity follow the desktop's current brush; two-finger tap is Undo, three-finger tap is Redo; Apple Pencil pressure and tilt work, barrel roll (twist) depends on the device and iPadOS version; turn off Scribble on the iPad; add the page to the Home Screen for full screen; the first start may ask the OS firewall to allow the engine; if the port is busy it says so; latency shown in the panel, expect about 20 to 50 ms on Wi-Fi.

### v0.15.0 library poster route

`PUT /api/library/{name}/poster` (routers/library.py): gives a movie that has no `poster.png` one (a recovered or old file) without touching anything else. Body must be a PNG (max 8 MB). Every zip entry is streamed into a part file, the poster added, the part flushed and fsynced, the file's modified time copied from the original (a poster is not an edit, the Theater sorts by it), then `os.replace`. A movie that already has a poster is left alone (`written: false`). Done under the library lock. Autosave itself needs no engine change: `PUT /api/library/{name}` already writes a part file and renames.

**Review fix (v0.15.0).** The poster route held the library lock for the whole zip copy while `PUT /api/library/{name}` took no lock, so an autosave that landed during the copy was overwritten by the older movie plus its poster (lost work). Now the copy runs in a thread without the lock; just before the swap, under the lock, the movie's mtime and size are compared with those the copy started from, and a changed movie means `written: false` (the next save has its own poster). `write_project` takes the same lock for its `os.replace`. Pen Link's LAN listener was probed (wrong Host 403, wrong or missing Origin 403, only `/penlink/` assets, `POST /penlink/pair` and `/penlink/ws` answer, five wrong codes lock, stop closes the port); no change needed.

## v0.16.0 · Pen Link

- refers-to: app/penlink.py :: _pair, _new_code, _code_live, _view; app/penlink_static/ (index.html, pen.js, i18n.js)
- kind: decision
- logged: v0.16.0 · 2026-10-31

**Pairing tries are per address.** One device on the network could spend the five shared tries and lock the tablet out. Now each client address (the ASGI `scope["client"]`) gets `CODE_TRIES` = 5 wrong tries (the sixth answers 429 "Too many wrong tries from this device"), and all addresses together get `CODE_CEILING` = 25, after which the code is spent and the panel shows "locked" as before. A right code does not count as a try. Checked from two source addresses against one code (the LAN address, and loopback with the LAN Host header): the first spent its five (401 x5, then 429); the other still got 401 on a wrong code and 200 on the right one, and the global status stayed unlocked. The code still lives 120 seconds and is six digits, so 25 tries is 25 in a million. A device that spoofs addresses on the same network could still reach the ceiling, which only costs a new code.
**Companion language.** `penlink_static/i18n.js` holds the page's words for the app's language codes (regional codes fall back to their language; zh-Hant and its regions to zh-TW; pt, sr and no map to pt-BR, sr-Latn, nb) and picks one from `navigator.languages`; English is the fallback and Arabic sets `dir=rtl`. Undo, Redo, Brush, Size and Opacity are the app translator's own words from `frontend/src/ui/i18n/*`; the other eleven strings are short sentences written for this page. The server's plain-text refusals (expired, spent, already paired, too many tries) are no longer shown: the page maps every non-401 failure to one "Could not pair. Ask for a new code on the computer." line, so it can be translated. Served from `/penlink/i18n.js` (added to `FILES`; no inline script, so the CSP is unchanged; `setup/freeze_backend` already adds the whole folder). Checked in a German-locale page: sub line, Connect, Undo, Brush and the status read in German.
**Taps.** The companion's two-finger tap (undo) and three-finger tap (redo) were driven with CDP touch events (one touchStart with two or three points, touchEnd 60 ms later) on a touch-emulated page: the socket sent exactly one `undo` for two fingers, one `redo` for three, and nothing for one finger.
**Coalesced points need a secure page.** `getCoalescedEvents` is used on every pen move when it exists, but Chromium exposes it only in a secure context, and the companion is plain HTTP on a LAN address: measured `typeof PointerEvent.prototype.getCoalescedEvents` is `function` on `http://127.0.0.1` and `undefined` on `http://192.0.2.2`. So on a tablet browser opened on the LAN address the page sends the frame's one pointermove, as before; nothing breaks, the stroke is just sampled at the display rate. Getting the extra points needs HTTPS (a certificate the tablet trusts) or the browser's own "treat this origin as secure" flag; not done, because a self-signed certificate would make the pairing page show a warning on first open.

## v0.16.0 · review

- Renaming a movie dropped its tags (they are keyed by movie name in `.tags.json`, and `set_tags` prunes names with no file). `library.rename_project` now moves the tag entry to the new name inside the same lock.
- Checked: `/api/audio-encode/mp3` and `/api/proxy/make` sit behind `GuardMiddleware` (a foreign Origin or Host gets 403), take no path (input and output are fixed names in a fresh job folder that is removed after the response), allow only listed rates and sizes, and never pass user text to ffmpeg. Pen Link per-address tries and the 25-try ceiling read correctly.
- Hardened (was "known and left"): the proxy and MP3 routes pass `-protocol_whitelist file`, and the proxy refuses an upload that starts as a text playlist (`#EXTM3U`, `ffconcat`, `<`, `file `); the MP3 route already requires a RIFF/WAVE header. Input stays the fixed `in.media` / `in.wav` in the job folder. curl: a real mp4 still makes a 640x360 proxy (200), a playlist gets 400.
