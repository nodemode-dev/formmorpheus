# HASHOUT_LOG · backend · formmorpheus

Living log of comment content, rationale, TODOs & removed code for the engine service. Read this first, then edit code surgically.

Current build version: v0.32.0
Last updated: 2026-11-27 · speech models on request and the speech server relay

---

## v0.32.0 · speech models on request and the speech server relay

- refers-to: app/services/speech_models_record.py (new); app/services/speech_models.py (new); app/services/speech_server.py (new); app/routers/speech_models.py (new); app/routers/speech_server.py (new); app/main.py (routers at /api/speech-models and /api/speech-server); tests/test_speech_models.py, tests/test_speech_server.py (new); ../setup/api_contract_check :: DESKTOP_ONLY; ../docs/api-contract.json (written by ../setup/api_contract_dump)
- kind: decision
- logged: v0.32.0 · 2026-11-27 (issue 31; written before the version was bumped to 0.32.0 with the rest of the feature)

- **Two sets, never bundled.** `voice` (34 files, Apache-2.0: the speech model, its tokenizer, 28 voices, four pronunciation dictionaries) and `listen` (7 files, Apache-2.0: the speech to text model. Corrected after review: the record said MIT, which is what the model's author states in its own repository for code and weights; the model card of the ONNX files pinned here states Apache-2.0, and the card shows what the publisher of the downloaded files states. `NOTICE.md` gives both). The record holds the served path, the pinned address (a commit, not a branch), the size and the SHA-256 of every file. The sizes of the `listen` files were read once with a HEAD request on 2026-11-27 and written into the record; the engine never asks the network for a size.
- **Modelled on the ffmpeg download** and importing its general helpers (`_HttpsOnly`, `_context`, `Cancelled`, `BLOCK`, `inside_app_bundle`): HTTPS only, a redirect that leaves HTTPS is refused, the recorded size is the cap, a part file then `os.replace`. Different on purpose: there is no archive, so each file is hashed while it streams and reaches its real name only after size and hash matched; a part file is named `.<name>.part`, which the hourly part-file sweep already knows.
- **No link inside a set's folder is followed** (added after review). A part file is made new with `os.open` (`O_WRONLY | O_CREAT | O_EXCL`, with `O_NOFOLLOW` where the platform has it and `O_BINARY` on Windows) after any leftover is unlinked; before, a leftover part file that was a link was written through to wherever it pointed. Each folder level from the set's folder down to a file is read with `lstat` before the file is written, counted as installed or served, and a link (or a Windows junction) at any level refuses it.
- **Installed means every pinned file is a regular file of the recorded size** (`lstat`, so a link does not count). The hash is checked when a file arrives, not on every read: 120 MB hashed per state request would be felt.
- **A cancelled or failed download keeps the files that verified**, so the next download takes only what is missing. `done` and `total` are bytes of the whole set, and a retry starts `done` at what is already there.
- **Task states are the contract's four** (`idle`, `downloading`, `failed`, `cancelled`). A finished download goes back to `idle`; `installed` says it worked. Each start makes a new task with its own stop flag, so a late cancel of an old run cannot stop a new one. The two sets may download at the same time.
- **Remove** deletes what is inside `speech/<set>` and then that folder. If the folder is a link, the link is unlinked and never followed. It answers 409 while that set downloads.
- **The file route cannot be walked out of.** The request path is compared, as exact text, with the set's pinned paths; the file path is then built from the record entry, never from the request. Anything else is 404, as is every path while the set is not completely installed. It sends `ETag` (the pinned SHA-256) with `Cache-Control: private, no-cache` and answers 304 on a match, not a long `max-age`: the served names stay the same when a later version pins other files, and a removed set must stop being served.
- **Speech server relay.** The window's page policy keeps it from calling another port, so the engine does. The address is judged as written, nothing is resolved: scheme `http` or `https`, host exactly `127.0.0.1`, `localhost` or `::1`, no user name or password, no query or hash, no space or backslash, and ASCII only (a character outside ASCII used to fail when the request line was written, an unhandled error and a 500; it is now a 400 with a sentence); the call uses an address rebuilt from the checked parts. A redirect is followed only to loopback. Proxies from the environment and the system are switched off for these calls. Standard library only.
- **Answers.** A refused address is 400 with a sentence. `check` answers 200 with `ok: false` and the reason when the server fails or is not there, since that is an answer about the server, and reads model names from `{"data": [...]}`, `{"models": [...]}` or a bare list. `speak` answers 502 with the upstream message trimmed to 300 characters and stripped of control characters, 504 on a timeout (check 5 s, speak 300 s), and 502 for a reply over 200 MB, an empty reply, or one whose type is not a listed sound type (an error page relayed as sound would only fail later in the decoder).
- **Relay hardening after review.** (1) The timeout was per wait on the socket only, so a reply sent a byte at a time never ended. Each call now also has a total deadline of the same length (check 5 s, speak 300 s): a timer shuts the call's socket down, which also ends headers that drip, and the reply is read in 64 KB blocks and given up one block past the 200 MB cap. (2) The upstream `Content-Type` is no longer passed through. Its part before any `;`, lower-cased, must be one of `audio/wav`, `audio/x-wav`, `audio/wave`, `audio/mpeg`, `audio/mp3`, `audio/ogg`, `audio/flac`, `audio/aac`, `audio/mp4`, `audio/webm` or `application/octet-stream`, and that plain value is what the window gets; before, anything starting `audio/` passed with its parameters, such as `audio/x, text/html`. A reply with no type is still taken as `audio/wav`. (3) Whatever is echoed from the server (its error text, the type it sent, the reason it could not be reached) is made one printable line first.
- **Guards.** Nothing to add: `WindowKeyGuard` covers every path under `/api/`, reads included, so the window must send its key when it fetches a model file (a plain URL handed to a worker or a library will be refused with 403), and `GuardMiddleware` refuses a foreign origin on writes.
- **iPad.** Both groups are listed as desktop only in `setup/api_contract_check`. `docs/api-contract.json` was regenerated with `setup/api_contract_dump`, not edited.
- **Tests** use no network: the model tests swap the record for three small files and the opener for a fake; the relay tests run a small server on 127.0.0.1 inside the test.

## v0.31.0 · the window's files keep their types on Windows

- refers-to: app/main.py :: the mimetypes.add_type calls after the last import
- kind: fix
- logged: v0.31.0 · 2026-11-25

- **The black window on Windows.** A tester on Windows 10 saw the desktop window load and stay black, from the website's installer and from the .msi alike. Python's `mimetypes` takes file types from the Windows registry (`HKEY_CLASSES_ROOT\.js`, value `Content Type`) over its own table, and some installers and editors set `.js` to `text/plain`. On those PCs the engine served the built window's scripts as `text/plain`, WebView2 refused every module script under strict MIME checking, and the window kept only its dark pre-paint background. macOS, Linux, dev mode (Vite serves the page) and Windows PCs with the default value never show it. FormVis met the same fault and fixed it in v1.98.6; FormMorpheus had not carried that fix.
- The calls pin `.js` and `.mjs` to `text/javascript` and `.css` to `text/css` (a script or stylesheet with another type is refused), and `.svg`, `.json`, `.woff2` and `.woff` to their own types, which the window also loads (the starter posters, the starter manifests, the fonts). They cover `StaticFiles`, `FileResponse` and any direct `guess_type`. They sit after the last import, so a module that re-reads the registry while importing cannot undo them. They look redundant off Windows; keep them.
- Repro on a Windows PC: `reg add "HKCU\Software\Classes\.js" /v "Content Type" /d "text/plain" /f`, then open the installed app; restore with `/d "text/javascript"`.
- Checked here: with the type table poisoned to `text/plain` for every one of these extensions, the engine serves `index.html`'s scripts as `text/javascript`, its stylesheets as `text/css`, a starter poster as `image/svg+xml`, the starter manifest as `application/json` and a font as `font/woff2`; without the calls the same run serves `text/plain`. Not run on a Windows PC.

## v0.25.0 · Recently Deleted names, movie and character

- refers-to: app/routers/library.py :: delete_project; app/routers/characters.py :: delete_character; app/routers/trash.py :: record
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **A movie and a character of the same name deleted in the same second** both went to `<name> <stamp>.fmo`, and the movie's move replaced the character's file and its trash index entry (kind `character` became `movie`). The library's delete now takes the same free-name loop as the characters route (`<name> <stamp> 2.fmo` and on), so each keeps its own file and its own kind in the index. The two routes still hold their own locks; two deletes landing in the very same instant from different routes could still pick one name, which the window never does (each delete is one request after a question).

## v0.25.0 · the linked SVG routes read one checked descriptor

- refers-to: app/routers/files.py :: _source_path, _read_source, stat_source, read_source (was _source_file); ../SECURITY.md (Files)
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **Why.** `_source_file` checked the path (`is_symlink`, `is_file`, `stat`) and then opened it again by name, so a file swapped for a link, a FIFO or a bigger file between the check and the open was read anyway, and `/stat` hashed the whole file whatever its size.
- **One descriptor.** Both routes go through `_read_source`: `os.open` with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` (and `O_BINARY` where it exists), `fstat` of that descriptor must be a regular file of at most 20 MB, then at most 20 MB plus one byte is read from it and more is 413. `/stat` hashes exactly those bytes and answers their length; the change time is the `fstat`'s. `O_NONBLOCK` keeps a FIFO named `.svg` from hanging the open; it is then refused as not a regular file (404).
- **Without `O_NOFOLLOW` (Windows).** An `os.lstat` is taken first and must not be a link; the opened descriptor's `(st_dev, st_ino)` must equal it, so a link put in its place between the two is refused (404).
- **Paths refused with 400.** After backslashes become slashes: anything starting with `//` (network shares and device paths, as `save_to._folder`), a colon past the drive letter (alternate data streams), a `..` segment, a relative path, a name not ending in `.svg`. A hard link is a regular file and is read.
- **`/source`** also sends `X-Content-Type-Options: nosniff`.

## v0.25.0 · the Characters library routes

- refers-to: app/routers/characters.py (new); app/main.py (router at /api/characters); app/core/config.py :: characters_dir, MAX_CHARACTER_BYTES; app/routers/trash.py :: _meta, restore; ../docs/api-contract.json (written by ../setup/api_contract_dump)
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **One file per character.** `<data folder>/Characters/<name>.fmo`, a movie the size of its source holding one track with the one character group, made by the window with `packMovie` and no history. The folder sits in the data folder, not the library folder, so a library moved to another drive leaves the characters where the Starter and the iPad expect them, and the hourly part-file sweep already covers it. It is made on first use.
- **Modelled on the library, with less.** Same name cleaning (`clean_name`, message says character), same `entry()` shape without `stack`, same zip magic check, part file with fsync and `os.replace` under a lock, same `read_limited` (512 MB here, not 4 GB: a character is a few parts, and a bigger file is a mistake), same rename with a 409 on a taken name (a change of letter case is allowed), same poster read (`library._picture`: 204 when the file has none). Left out on purpose: stacks, tags, order, duplicate, copy-to, the poster write route and preview. A character never needs them, and each is a route the iPad would have to copy.
- **Window key.** Nothing to add: `WindowKeyGuard` covers every path under `/api/`, reads as well as writes, and `GuardMiddleware` refuses a foreign origin on writes, so `/api/characters` is covered exactly as `/api/library` is. There is no allow or deny list by path.
- **Delete goes to Recently Deleted** as `<name> <stamp>.fmo` with kind `character` in the trash index; a second delete in the same second takes a number instead of replacing the first (the library's delete would replace). `trash.restore` puts a `character` back in Characters under a free name (`Name 2`), and `_meta` gives it the plain name like a movie. The window's Recently Deleted list must show the kind (it treats every kind but `movie` as an export today).
- **Contract file.** `docs/api-contract.json` was regenerated with `setup/api_contract_dump`, not edited. The iPad check now lists the new routes as not served until the Swift routes land.

## v0.25.0 · MCP tools for characters

- refers-to: app/routers/mcp.py :: TOOLS, t_list_characters, t_add_character, _character, _restore message; ../agents/manifest.json (written by ../setup/agents.py sync)
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **`list_characters` reads**: name, modified, size, optional `query`; no window needed, refused only when agents are blocked.
- **`add_character` is class `asks`, not `changes`.** It puts content into a movie in the window and needs the window to do it, which is what `import_file` does, and SECURITY.md says imports always ask. The `changes` class skips the question when the person allowed outside agents, and the window half is not a library change. It goes through `_window`, so it asks every time (deny or once), waits 2 minutes for the answer and 2 for the work, and says plainly when no window is open. The engine checks that the character exists and, when `movie` is given, that the movie does, before asking.
- **The message to the window** is `add_character` with `{character, movie?, at?}`. No file goes across the bridge: the bridge file route serves only the library folder, and the window holds the key to read `/api/characters/{name}` itself. The window answers `{ok: true, content, movie?, saved}`.
- **Restore wording.** `manage_movie restore` by an id from `list_deleted` says "to Characters." for a character. Restoring by name still looks at movies only.
- **SVG in the import list needs nothing here.** The window picks the importer from the bytes and the file name's extension (`media/import.ts` `sniff` and `EXT`); the engine only passes the file name through the bridge, and the window builds the file without a type. The character importer for SVG is a window change.

---

## v0.25.0 · the text of a character's linked SVG

- refers-to: app/routers/files.py :: read_source, _source_file, stat_source; ../setup/api_contract_check (DESKTOP_ONLY); ../docs/api-contract.json; ../SECURITY.md (Files)
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **What it is for.** When the stat of a linked SVG changes, the window needs the new text to read the character again. A page cannot read a file by its path, so `GET /api/files/source?path=` returns it as `image/svg+xml`.
- **Limits.** Exactly the stat route's: both call `_source_file` (window key in the route, absolute path, `.svg`, a regular file and not a symbolic link, at most 20 MB). The read stops at 20 MB plus one byte and refuses with 413 if the file grew past the limit between the check and the read.
- **Stat of what was sent.** `X-Source-Size`, `X-Source-Mtime` and `X-Source-Sha256` describe exactly the bytes in the answer, so the window stores the stat of the text it read and a save that lands between a stat and a read is caught on the next poll.
- **Served as.** `Cache-Control: no-store` and `Content-Security-Policy: sandbox`, so the SVG never runs as a page of the engine's origin even if opened directly (the guard already refuses a request without the window key).
- **iPad.** Not served there (`DESKTOP_ONLY`); the iPad picks the file again with Update from Source...

## v0.25.0 · the stat of a character's linked SVG

- refers-to: app/routers/files.py :: stat_source, MAX_SOURCE_BYTES; ../setup/api_contract_check (DESKTOP_ONLY); ../docs/api-contract.json; ../SECURITY.md (Files)
- kind: decision
- logged: v0.25.0 · 2026-11-25

- **What it is for.** The window polls `GET /api/files/stat?path=` every two seconds while it has focus, for each character whose `source` names a file, and updates the character when the answer differs from the stored `{size, mtime, sha256}`. A poll of stat, not a watcher library: no new dependency.
- **Limits.** The window key is checked in the route as well as by the guard, as the other window-only routes do. Refused: a path that does not end in `.svg` (400), a relative path (400), a missing file, a folder or a symbolic link (404), a file over 20 MB (413). A link is refused so a `.svg` name cannot point the hash at some other file. Only size, change time and hash come back, never the bytes.
- **Not checked against open movies.** The plan said "only for a path that a character in an open movie names"; the engine does not know which movies the window has open, so the decision in the dev plan (the `.svg`, regular file and size limits) is what holds.
- **The hash.** Read in 1 MB blocks. The change time alone is not enough: some editors write the same bytes again on save, and a copy over the file can keep its old time.
- **iPad.** Not served there (`DESKTOP_ONLY` in `api_contract_check`); the window sees 404 and offers Update from Source... only.

## v0.24.0 · the engine's test suite

- refers-to: pytest.ini (new); requirements-test.txt (new); tests/conftest.py (new); tests/core, library, jobs, mcp, agents, assets, penlink, media, routes, scripts (new); ../setup/test (new); ../.github/workflows/ci.yml :: tests
- kind: decision
- logged: v0.24.0 · 2026-11-23

- **Asked for by the owner.** Tests are still written only when the maintainers ask; this version is that ask.
- **Runner.** pytest 9.2.0 and httpx 0.28.1 (for FastAPI's TestClient), pinned with their own dependencies in `requirements-test.txt`, which starts from `requirements.txt`. Neither is frozen into the desktop engine: `freeze_backend` installs from `requirements.txt` and `requirements_desktop.txt` only.
- **Isolation.** `tests/conftest.py` sets `FORMMORPHEUS_DATA_DIR` to a temporary folder before `app.main` is imported and points `FORMMORPHEUS_DIST` at a folder that does not exist, so no test reads the real data folder and the built interface is never mounted over the routes. The `data_dir` fixture gives each test its own folder.
- **Clients.** `client` carries the window key and a loopback base address, so it passes both the guard and the window key check; `anon_client` has no key, for the refusals. Neither runs the start-up events (the sweeps and their tasks); a test that needs them enters `TestClient` as a context manager itself.
- **Never real.** No real ffmpeg, download, terminal, child program, keyring or home folder: tests replace them with `monkeypatch` and files in `tmp_path`.
- **`pythonpath = .`** in `pytest.ini` is why `from app...` imports work without installing the engine.

## v0.23.1 · the product's name, and the contract from the code

- refers-to: app/routers/files.py, library.py, recovery.py, save_to.py, system.py (messages); app/penlink_static/i18n.js, index.html; ../setup/api_contract_dump (new); ../setup/api_contract_check (DESKTOP_ONLY); ../docs/api-contract.json
- kind: decision
- logged: v0.23.1 · 2026-11-22

- **Messages.** Every engine sentence a person can read (a refused save, a library folder that cannot be used, a recovery that is not there, a system answer) says FormMorpheus. The Pen Link page's title and its sentence in all 28 of its languages say it too; the page's own language file was checked by parsing it with node after the edit.
- **What does not change.** Route paths, the `formmorpheus` MCP server name, the data folder name and the `.fmo` manifest value stay lower case: a program reads them.
- **The contract file is written, not kept by hand.** `setup/api_contract_dump` imports `app.main` with an empty temporary data folder and writes `docs/api-contract.json`: the OpenAPI document with one path and one schema per line, and an `x-websockets` list of the socket routes (FastAPI 0.141 keeps included routers behind `_IncludedRouter`, so the walk follows `original_router` and adds `include_context.prefix`). `--check` compares and exits 1 when the file is stale, which CI runs. The file before this was last written at 0.17.2 and had none of the window, agents, terminal, Video Tools or MCP routes.
- **Desktop only.** `api_contract_check` compares the interface's calls with what the iPad engine answers. The window key routes (`/api/window/*`) and `/mcp` are now listed as desktop only, with the agents, terminal and Video Tools routes; with them, no required route is missing on iPad and 31 of 101 are desktop only.

## v0.23.0 · ffmpeg from the family's builds

- refers-to: app/services/ffmpeg_fetch.py (new); app/services/ffmpeg_record.py (new); app/routers/video_tools.py (new); app/services/ffmpeg.py :: find_ffmpeg; app/routers/jobs.py :: capabilities (the not-found reason); app/main.py (router)
- kind: decision
- logged: v0.23.0 · 2026-11-22

**Where it comes from.** FormVFX's `app/ffmpeg_fetch.py` and `app/ffmpeg_record.py` (the same module in FormVis, FormWav, FormLit, FormPromo and FormDAM), adapted. The sources are the same ordered pair: `https://github.com/nodemode-dev/formai-binaries/releases/download/ffmpeg-7.1.5-2/ffmpeg-lgpl-7.1.5-2-<triple>.tar.gz`, then the same path under `nodemode-dev/formcut-binaries` (the repository's old name, which still answers). `FORMCUT_FFMPEG_RELEASE`, the family's mirror variable, is the only source when set, and must be HTTPS. Triples: `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`, `x86_64-pc-windows-msvc`; Windows on ARM and Linux on ARM have no build and are told so. The per-file pins in `ffmpeg_record.py` are FormVFX's, which were compared with formai-binaries' `ffmpeg-licence.json` (release `7.1.5-2`) and are identical. Added here: each archive's SHA-256 and size from the release's `SHA256SUMS` and the download headers (11,396,088 B Apple silicon, 12,685,606 B Intel Mac, 12,231,345 B Linux, 11,903,216 B Windows), so the panel can say the size and the archive is checked before it is opened.
**Licence.** The record and the release say `--disable-gpl --disable-nonfree`, no libx264, libx265 or libfdk: FFmpeg LGPL-2.1-or-later, libopus and libvpx BSD-3-Clause inside libavcodec, libva and libdrm MIT on Linux. The libraries are shared and sit beside the programs, so they stay replaceable. It is a download the person chooses, installed outside the app and run as a separate program, so nothing is bundled or linked; `NOTICE.md` has the row.
**The differences from FormVFX, and why.** FormVFX downloads by itself on first run in a frozen build and puts the shared family folder first on PATH. Here nothing is downloaded until the person presses Download ffmpeg in Preferences, Video Tools, where the size, the source and the licence are said first. The build is installed in this app's data folder (`<data>/ffmpeg/ffmpeg-lgpl-7.1.5-2/`), as the owner asked, and never in the app: the start is refused when the data folder is inside a `.app` (a portable build inside a Mac bundle). The engine runs `ffmpeg-<triple>` by its full path; nothing is added to PATH except on Windows, where the DLLs in `lib-<triple>` must be on the PATH of the process that starts it, so that folder is put first on the engine's PATH (the children inherit it), as FormVFX does.
**The person's own ffmpeg first.** `find_ffmpeg` keeps its order (FORMMORPHEUS_FFMPEG, beside the frozen engine, PATH, then the three Mac folders) and answers with the downloaded build only when none of those has one. A person's own ffmpeg is usually a fuller build (MP3, H.264 and HEVC in software, which the LGPL build cannot carry), and they chose it. The panel says so, offers no download while another ffmpeg is used, and still offers Remove for a download that is no longer used.
**How a download runs.** One thread; `urllib` from the standard library (FormVFX uses it too; no package added), a default SSL context (on macOS also `/etc/ssl/cert.pem`), a redirect handler that refuses any redirect that leaves HTTPS, a 60 s socket time-out, 1 MiB blocks into `<data>/ffmpeg/.download-<pid>.tar.gz.part`, refused if it grows past the recorded size. Then: the archive's SHA-256; extraction with the `data` filter into a `.staging-` folder beside the target; the pinned files and the three licence documents copied as plain files (no modes kept); every pinned file hashed again; only then the two programs made executable; one `os.replace` of the staged folder into place (an older install moved aside first and removed after). A mismatch anywhere installs nothing and the next source is tried. Cancel is read between blocks and between steps. Leftover `.staging-`, `.old-`, `.removing-` and `.download-` entries are swept when a download starts. Remove moves the folder aside in one rename and deletes it; if the rename fails (Windows, a running export holds a DLL) it answers 409 with a sentence.
**Routes, under `/api/video-tools`, so the window key guard covers them.** `GET` (`?refresh=true` probes again): `{ffmpeg: {found, path, version, source: "" | "download" | "computer", gpl, encoders}, formats: {prores, hevc, hevcAlpha, h264, mp3, aac, opus}, family: {release, version, licence, releases, platform, available, installed, folder, downloadBytes, installedBytes}, task: {state: idle | downloading | verifying | done | failed | cancelled, received, total, error}}`. `POST /download` starts (400 when there is no build for this computer or the data folder is in the app, 409 while one runs). `POST /cancel`. `DELETE /download` removes (409 while downloading or in use). Each answers with the state.
**Capabilities stay right without a restart.** `/api/jobs/capabilities` already probed with `refresh=True`, and `probe` calls `find_ffmpeg` on every call, so the downloaded build is seen by the next call and a removed one is gone from it. The not-found reason now names the panel: "ffmpeg was not found. Get it in Preferences, Video Tools."
**What the build can do.** On Linux it lists `prores_ks`, `aac`, `libopus`, `hevc_nvenc` and `hevc_vaapi`: ProRes yes, HEVC only with an nvenc or VA-API card, no HEVC alpha, no engine H.264 (`libx264` only), no MP3. On a Mac `hevc_videotoolbox` gives HEVC and HEVC with alpha. On Windows the build has `hevc_nvenc`, `hevc_amf` and `hevc_mf` (and `h264_amf`, `h264_mf`), but `HEVC_ORDER` knows only nvenc of those, so HEVC there needs an nvenc card. No family repo carries argument lists for amf or mf: FormVFX, FormVis, FormDeck and FormTools were searched, and only formai-binaries' `build/windows-cross.sh` (which enables them) and two FormTools encyclopedia pages (which name hardware encoders in prose) mention them. None were invented, so `jobs.py` is unchanged. The panel's build sentence and the manual say "HEVC where the computer has a hardware encoder FormMorpheus can use (on Windows, only some graphics cards)". When a family repo gains amf and mf argument lists, port them into `HEVC_ORDER` and the encoder branch of `jobs.py` in that repo's order, then widen the sentence.
**Checked here (Linux x86_64, from source, data folder under /tmp, PATH without ffmpeg).** The real download from formai-binaries: 12,231,345 B, archive and twelve file hashes matched, installed 28.7 MB; `/api/jobs/capabilities` switched from no ffmpeg to ffmpeg 7.1.5 with ProRes and HEVC available and `gpl: false`, no restart; the installed program encoded a ProRes 422 HQ clip that ffprobe read back; a second start answered 409; Cancel after 2 MB left `cancelled` and an empty folder; Remove took the folder away and capabilities went back to no ffmpeg; a changed file pin, a changed archive hash and an `http://` mirror each installed nothing, left nothing behind and said why; no window key answered 403. Not run on macOS or Windows.

## v0.22.0 · agents: the MCP server, consent, terminals

- refers-to: app/routers/mcp.py; app/routers/agents.py; app/routers/terminal.py; app/services/{bridge,agent_access,movies,terminal,claude_code,agent_programs,agent_lookup}.py; app/core/seal.py :: _no_ld_probe; app/main.py (routers, startup and shutdown hooks); setup/agents.py; setup/mcp_stdio.py; agents/manifest.json
- kind: decision
- logged: v0.22.0 · 2026-11-22

- **Where it comes from.** The handler and the consent rules follow FormDeck 0.46.3's `routers/mcp.py`; the queue the window polls follows FormVis 2.8.1's bridge; terminals, the agent programs and the seal follow FormDeck. `agent_lookup.py` is the family's finder copied byte for byte; `setup/agents.py` holds the hash of each released version and `./formmorpheus agents sync --check` fails when the copy differs.
- **Protocol.** `POST /mcp` is stateless JSON. Revision 2026-07-28 is answered from `_meta` and the version header with no `initialize`; `server/discover` carries `ttlMs` and `cacheScope`, which that revision needs. 2025-11-25 clients get `initialize`, and a session id only to remember the client's name. An unknown version is -32602, a batch -32600. `GET /mcp` is 405, `DELETE /mcp` 204.
- **`/mcp` is outside `/api/`,** so the window key does not apply to it; the Host and Origin guard does. A page in a browser cannot reach it; a program on this computer can, which is what MCP is for, and the consent rules below decide what such a program may do.
- **A lean tool list.** `tools/list` has nine tools. The rest of the engine's reach (reading Recently Deleted, the Exports list, stacks, fonts and encoders; setting tags and a stack) goes through `list_commands` and `run_command`, so an agent's context carries nine schemas, not sixteen. FormDeck lists all its tools; FormVis has a `?tools=core` filter. `agents/manifest.json` is written from this code by `agents sync`; the skill pack's tool table is written by hand and follows it.
- **Consent (`_gate`).** Blocked refuses everything, reads included. Otherwise reads run. Changes run when the choice is Allowed or the caller is an agent tab of this window (its token); otherwise they ask in the window (Deny, Allow once, Always), and with no window open they are refused with a sentence that tells the agent to ask the person. `export_movie` and `import_file` always ask, tabs included, and never offer Always. After a Deny the same kind of request is refused without asking for 120 seconds. A question waits 120 seconds.
- **The agent's name.** The consent box shows the name the client gives in `clientInfo` or in `_meta`. A client that gives none is shown as an outside agent; the engine no longer fills in the word "agent".
- **The window does two things the engine cannot.** Export renders in the window, and an import has to go through the interface's importer to land in the movie. The engine queues `export_movie` and `import_file` for the window (`GET /api/mcp/bridge/next`, a 20 second long poll), the window answers on `bridge/result`, and the engine checks that the exported file exists in Exports. An import's bytes reach the window only through `bridge/file/{id}` while that request waits, and only files already inside the library folder are offered. A window counts as open while it polled in the last 30 seconds or holds work it took in the last 900. Export may take 600 seconds, an import 120.
- **Consent goes the same way.** A question is a queue item of kind `consent`; the answer comes back on `/api/agents/consent/{id}`, and an expired, answered or dropped question is followed by a `consent_gone` item so the window takes its box down. When the client hangs up, its queued item is dropped.
- **The stored choice is sealed.** `agentsAllowed`, `agentsBlocked` and a seal over them live in `settings.json`. The seal key is kept in the system keychain through keyring. A file whose seal does not match reads as Ask with `changedOutside`, so a program that edits the settings file to allow itself gets asked again. Without a keychain (`seal: unavailable`) the value is used as written. On Linux keyring's macOS backend calls `ctypes.util.find_library` at import, which falls back to `ld -o /dev/null`; run as root, a failed link deletes `/dev/null` (FormVis 1.89.8). `_no_ld_probe` turns that fallback off before keyring is imported.
- **Terminals.** PTYs through ptyprocess, pywinpty on Windows; with neither, `tabs` is empty and the routes answer 503. A tab's environment drops `FORMMORPHEUS_WINDOW_KEY_STDOUT` and `FORMMORPHEUS_SHELL_PID` and gains `FORMMORPHEUS_TERMINAL`, `FORMMORPHEUS_URL` and `FORMMORPHEUS_MCP_URL`. Agent tabs get a token: Codex, Cursor and Antigravity in `FORMMORPHEUS_INAPP_TOKEN`, Claude Code through a generated `--mcp-config` file kept 0600 in `AgentTokens/`. A token dies with its tab; `AgentTokens/` is swept at start and every token is revoked at shutdown. Closing the engine ends every tab.
- **Stream route.** `/api/terminal/{id}/stream` takes the window's one-use ticket (the key guard spends it), always sends the replay first, even an empty one, then output as text frames; a binary `{"type":"exit"}` frame says the program ended.
- **No chat.** The dock contract's chat routes are not served; the ask line opens Claude Code with the typed words instead.
- **Stand-ins only.** No real agent program was started while building this. The four programs were a shell script set through `FORMMORPHEUS_*_BIN`.

## v0.20.0 · the window key, the page policy, loopback only

- refers-to: app/core/window_key.py; app/core/page_policy.py; app/main.py (middleware order, _part_sweep_loop); formmorpheus_engine.py :: serve; app/routers/jobs.py :: sweep_loop; boot_backend
- kind: decision
- logged: v0.20.0 · 2026-11-22

- **The window key.** The Host and Origin guard keeps web pages out, but any program on the computer could still call the engine with no Origin header and read the library or start an export. `window_key.KEY` is 32 random bytes made at import, kept in memory only, compared with `hmac.compare_digest`. `WindowKeyGuard` refuses every request under `/api/` that does not carry it in `x-formmorpheus-window-key`, reads included, with 403 and "Only the FormMorpheus window can do this". Open paths: `/api/window/key` (below) and `/api/health` (it says the app's name and version and nothing else, and build checks call it). `OPTIONS` passes so that CORS can answer a preflight. The pattern is FormVis's and FormDeck's; they leave reads open, this engine does not, because every read here is the person's own work and the interface reaches the engine through `fetch` only, which can carry a header.
- **How the window gets it.** Packaged: the shell sets `FORMMORPHEUS_WINDOW_KEY_STDOUT=1`, the entry prints `formmorpheus-window-key: <key>` once on standard output before the server starts, and the shell hands it to its own page (`src-tauri/HASHOUT_LOG.md`). The log file never sees that line: it is a `print`, not a log record. From source (`./formmorpheus`, `serve`): `POST /api/window/key` answers the key once per engine launch, then 409; with the variable set it answers 404. The first local program to ask gets it, which is the weaker mode by nature and is the development mode. `GET /api/window/key` reports `claimed`, so a second tab can say why it has no key.
- **Sockets.** A browser cannot set a header on a WebSocket, so `POST /api/window/ticket` (key needed) gives a ticket good for one use within 30 seconds, and the guard lets a socket under `/api/` through only with `?ticket=`. That covers `/api/penlink/desk` and `/api/recovery/{session}/live` with no change to either route. Pen Link's own listener for the tablet is a separate program on another port with its own pairing; it is untouched.
- **Order.** Middleware added last runs first: the Host and Origin guard, CORS, the key guard, then the page policy. A request with a foreign Host is refused before the key is looked at.
- **The page policy.** `PagePolicy` adds a Content-Security-Policy, `nosniff` and `no-referrer` to everything that is not under `/api/`. Scripts: the page's own files, WebAssembly, and the two inline scripts of `index.html` (the theme boot and the stage share) by SHA-256, computed from the built file and cached by its time and size, so a new build needs no edit here. Styles allow inline, since the interface sets style attributes. Pictures, media and fonts: own files, `data:` and `blob:`. Connections: own origin, loopback sockets, and Tauri's two IPC addresses. No remote host appears anywhere in the policy; the interface calls none. In development the page comes from Vite, which the policy does not touch.
- **Loopback only.** `boot_backend` read `FORMMORPHEUS_HOST` for uvicorn's `--host`. The guard only checks the Host header, which a client on the network writes itself, so that variable opened the whole API to the network. It is gone; every way of starting the engine binds 127.0.0.1.
- **Two silent failures now logged.** The hourly sweep of leftover part files and the sweep of abandoned export jobs each caught every exception and passed. Both now write the traceback to the engine log and carry on.
- Seen here with curl against a running engine: `/api/library` and `/api/capabilities` without the key 403, with it 200, a wrong key 403, a write without it 403, `/api/health` 200, a foreign Host 403, a second claim 409. In Chrome the page claims the key, every call succeeds, and the recovery socket is accepted with its ticket. In the real Linux app (WebKitGTK, built here) the window loads the library with the key from standard output while curl from outside gets 403.

## v0.19.0 · the engine's start and exit

- refers-to: formmorpheus_engine.py :: serve, watch_shell, free_port; app/core/startup.py; app/core/runtime.py
- kind: decision
- logged: v0.19.0 · 2026-11-22

`app/core/startup.py` and `app/core/runtime.py` are FormDeck 0.46.3's files (Apache-2.0) with this app's names; the entry script follows FormDeck's and FormTools'.

- **Streams first.** A Windows engine built with no console starts with `sys.stdin`, `sys.stdout` and `sys.stderr` set to `None`, and the first `print` or log line would raise. The entry replaces each missing stream with the null device right after `import os, sys`, before anything else is imported.
- **A log file.** `runtime.start_logging` writes `Logs/formmorpheus-engine.log` in the data folder (1 MiB, three kept) for the `formmorpheus` and `uvicorn` loggers. With no console, errors that would have gone to stderr go to `Logs/formmorpheus-engine-errors.log` (`startup.keep_errors`). The shell's failure dialog names the first file.
- **One engine per data folder.** `runtime.claim` writes `engine.lock` (process id, start time, the shell's process id and its start time). A second engine on the same folder reads it: when the holder and its shell are both alive it prints "formmorpheus is already running on ..." and exits 2; when the holder is alive but its shell is gone it is a leftover from a crashed app, so it is ended (TERM, then KILL after five seconds; `taskkill /T /F` on Windows) and the new engine takes over. Start times are compared so that a recycled process id is not mistaken for the old engine.
- **Leaving with the shell.** `watch_shell` polls the shell's process every two seconds (a wait on its handle on Windows) and exits when it is gone, releasing the lock. SIGTERM releases the lock too.
- **Started alone.** A frozen engine started by hand, with no `FORMMORPHEUS_SHELL_PID`, opens the app that sits beside it and exits 0; when there is none it says it is a part of FormMorpheus and exits 4. `FORMMORPHEUS_NO_SHELL=1` lets it serve alone, for someone who wants the page in a browser. formcompiler's Windows start check runs the engine alone and expects this.
- **The port.** `FORMMORPHEUS_PORT` set to a number is used as it is. With 0 or unset, `FORMMORPHEUS_PORT_PREFER` is tried first and a free port is taken when it is busy. The shell sets the preference to 9496 (reason in `src-tauri/HASHOUT_LOG.md`).
- Exit codes: 0 served and stopped, or opened the app; 2 another engine holds the folder; 3 the server never started; 4 started alone with no app nearby; 5 the data folder cannot be used.
- Seen here on Linux, unfrozen, with `sleep` processes standing in for the shell: the port line on 9496, the lock file, a second engine refused with code 2, the engine gone and the lock removed within five seconds of its shell ending, and a leftover engine replaced by the next start with the log line "an engine left running without its app was stopped".

## v0.18.4 · ffmpeg on a Mac, and every package pinned

- refers-to: app/services/ffmpeg.py :: find_ffmpeg, MAC_INSTALL_DIRS; requirements.txt; requirements_desktop.txt; oc_install
- kind: decision
- logged: v0.18.4 · 2026-11-22

**ffmpeg from Finder.** A Mac app opened from Finder or the Dock gets the system PATH only, so `shutil.which("ffmpeg")` missed a Homebrew or MacPorts ffmpeg and ProRes, HEVC, MP3 and the proxy routes reported no ffmpeg. The search order is now: `FORMMORPHEUS_FFMPEG`, a binary beside the frozen engine, the PATH, and then on macOS only `/opt/homebrew/bin` (Homebrew on Apple silicon), `/usr/local/bin` (Homebrew on Intel) and `/opt/local/bin` (MacPorts). The PATH stays ahead of the three folders so a person who put a particular ffmpeg first in a terminal still gets that one; the folders only answer when the PATH has none. Not run on a Mac from here: `TEST_PLAN.md` has the Finder step.
**Pins.** `requirements.txt` named only fastapi and uvicorn[standard], so starlette, pydantic and the uvicorn extras floated to whatever was newest on the day of the build. It now lists every package the two resolve to on Python 3.12 (19 lines after the two top lines, taken from `pip freeze` in a fresh venv on Linux, then checked for Windows and both Mac architectures with pip's platform resolver). Two lines carry markers copied from uvicorn's own metadata: `uvloop` is not installed on Windows and `colorama` only there. `requirements_desktop.txt` is pinned the same way: PyInstaller's `macholib` on macOS, `pefile` and `pywin32-ctypes` on Windows; `pefile` is 2023.2.7 because PyInstaller 6.16.0 excludes 2024.8.26. No hashes: pip's hash mode needs a hash for every wheel of every platform, pip itself included, and none of the Windows or Mac ones could be confirmed by installing here.
**requirements_macos.txt removed** (`git rm`). It was byte-identical to `requirements.txt` and nothing on macOS needs another list, so `oc_install` installs `requirements.txt` on every system. If a Mac-only pin is ever needed, a marker line in `requirements.txt` does it.
**To move a pin:** change the top line, make a fresh venv, `pip install -r` the two top lines alone, copy `pip freeze` back by hand, keep the marker lines.

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
