# HASHOUT_LOG · src-tauri · formmorpheus

Living log for the desktop shell (Tauri 2). Source stays comment-free; rationale lives here. The splash and reveal reproduce the owner's formvis splash and boot map exactly.

Current build version: v0.14.0
Last updated: 2026-10-30 · reveal_folder for Show brush folder

---

## v0.18.4 · the build scripts

- refers-to: ../build_app; ../build_app.bat; ../setup/freeze_backend; ../rust-toolchain.toml; ../.github/workflows/ci.yml :: tauri
- kind: decision
- logged: v0.18.4 · 2026-11-22

- **keyring.** Both freeze commands passed `--collect-submodules keyring`. The engine neither depends on nor imports keyring, so PyInstaller only printed a warning that the package was not found. The argument is gone from `freeze_backend` and from `build_app.bat`; both now collect the submodules of `app` and `uvicorn` only.
- **One Windows signing route.** formcompiler's release run puts `WINDOWS_CERT_THUMBPRINT` in the environment and also writes `tauri.windows.conf.json` with a `signCommand`, after dropping any `certificateThumbprint` from that file. `build_app.bat` then added `certificateThumbprint` back through `--config`, so one build carried both. Now, when `tauri.windows.conf.json` exists and names `signCommand`, the script passes no signing `--config` and says which route it took; the thumbprint is used only when there is no `signCommand`. A build by hand with only the thumbprint set signs as before, and one with neither is unsigned as before.
- **The Mac app in the log.** `build_app` looked for `formmorpheus.app`, but `productName` is `FormMorpheus`, so the last lines of a macOS build never named the app. It now lists whatever `.app` is in `bundle/macos`, so the line cannot go stale with the product name again.
- **Rust pinned.** `rust-toolchain.toml` at the repository root names 1.97.0 (minimal profile), and the CI job installs the same version in place of `stable`. rustup reads the file from any folder below it, so `cargo` in `src-tauri`, `build_app` and a release runner all compile with one compiler. 1.97.0 is the version `cargo check --locked` was run with for this change; `rust-version` in `Cargo.toml` (1.77.2, the oldest that may build it) is unchanged. To move it: change the file and the CI line together and run `cargo check --locked`.

## v0.18.3 · Windows engine data

- `../build_app.bat` froze the engine without `app/penlink_static`, which `../setup/freeze_backend` has carried since v0.15.0, so a Windows build had no Pen Link page. The `pyinstaller` line now carries `--add-data "%~dp0backend\app\penlink_static;app\penlink_static"` beside the `frontend_dist` entry (same destination as the script, spelled the way `build_app.bat` spells paths).
- Compared the two freeze commands: the only other differences are macOS-only in `freeze_backend` (one-folder mode, code signing with the entitlements file, `FORMMORPHEUS_PYI_ARCH`). Neither passes `--hidden-import`; both collect the submodules of `app`, `uvicorn` and `keyring`.

## v0.18.0 · app icon

- `icons/` regenerated with `frontend/node_modules/.bin/tauri icon ../assets/icon_src/formmorpheus-icon-1024.png -o ../src-tauri/icons` (run from `frontend/`): `icon.icns`, `icon.ico` (16 to 256), `icon.png` (512), `32x32.png`, `128x128.png`, `128x128@2x.png`. The CLI also writes `android/`, `ios/`, `Square*Logo.png`, `StoreLogo.png` and `64x64.png`; they were deleted because `tauri.conf.json` lists only the five files and the CLI's iOS set is not used (the iPad icon is made separately). macOS keeps the supplied margin and shadow (the macOS icon grid); Windows and Linux use the same art.
- `tauri.conf.json` `bundle.icon` is unchanged and every path resolves. `setup/desktop_build` still checks `icons/icon.icns`.
- iPad: `ios/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` is the squircle scaled to fill 1024, opaque RGB, corners and rim filled with the squircle's own edge colour row by row (no seam under the system mask), plus a single-size universal `Contents.json` and `Assets.xcassets/Contents.json`.
- `splash.html` now draws `mark.png` (see `frontend/HASHOUT_LOG.md`); the radius and the formmorpheusSplashDone hook are unchanged.

## Org-navi-map

```
src-tauri/
├── Cargo.toml                  tauri 2 (macos-private-api), shell, dialog, single-instance; objc2 on macOS
├── Cargo.lock                  pinned crate versions
├── build.rs                    APP_COMMANDS: app_ready, set_window_title, text_edit, take_pending_opens
├── tauri.conf.json             splash window (360 x 200, transparent, hidden), bundle, .fmo association, externalBin engine
├── tauri.macos.conf.json       macOS overrides (engine folder as a resource)
├── capabilities/default.json   remote origins 127.0.0.1:* and localhost:5194, window and app command permissions
├── entitlements.plist          hardened runtime entitlements
├── icons/                      app icons (32, 128, 256, 512, icns, ico)
├── binaries/.gitkeep           frozen engine sidecar lands here (ignored)
└── src/
    ├── main.rs                 launch, engine spawn and port handshake, main window, open queue, single instance
    ├── reveal.rs               SPLASH_MIN 2600 ms, BAR_FINISH 220 ms, FALLBACK 20 s, round_splash, conceal, app_ready, show_main
    ├── traffic_lights.rs       lights centred in the 38 px title row, set_window_title
    ├── text_edit.rs            menu Edit actions sent to a focused text field (macOS)
    ├── packaged.rs             where the one-folder engine lives in the bundle
    ├── recent.rs               note_recent_document: the OS recent list
    └── window_state.rs         window size and place kept between launches
```

---

## Table of contents

- [src/main.rs](#main)
- [src/reveal.rs](#reveal)
- [src/recent.rs and distribution](#distribution)

---

## src/main.rs {#main}

### src/main.rs · dev_url
- refers-to: src/main.rs :: dev_url, build_main
- kind: explainer
- logged: v0.3.0 · 2026-10-30

Debug builds only: `FORMMORPHEUS_DEV_URL` (for example `http://localhost:5194`) skips the engine and loads the Vite dev server, so `./formmorpheus desktop dev` shows live edits. Release builds always start the engine and load what it serves.

### src/main.rs · dropped from formvis
- refers-to: src/main.rs :: whole file
- kind: removed-code
- logged: v0.3.0 · 2026-10-30

Not carried over from formvis 1.98.4 `src-tauri/src/main.rs`: the updater, system font commands, display and native wgpu renderer, the exit gate, run flags, recent documents (`note_recent_document`, which was registered but missing from build.rs and the capability), renderer crash recovery, interface zoom, display-server choice and the integration module. formmorpheus does not use them yet.

---

## src/reveal.rs {#reveal}

### src/reveal.rs · show_main
- refers-to: src/reveal.rs :: show_main
- kind: warning-context
- logged: v0.3.0 · 2026-10-30

The page must call `invoke('app_ready')` after its first paint (`revealApp` in `frontend/src/ui/dom.ts` does), or the window waits for the 20 s fallback. The finish hook name `formmorpheusSplashDone` must match `frontend/public/splash.html`. Keep the CSS radius in splash.html and the native 16 px mask equal.

### src/reveal.rs · BUILD_VISIBLE
- refers-to: src/reveal.rs :: BUILD_VISIBLE; tauri.conf.json :: app.windows[splash].alwaysOnTop
- kind: fix
- logged: v0.3.0 · 2026-10-30

Off macOS the main window is built visible (as in formvis), and the launch run on Linux showed it mapped over the splash at about 1.1 s, so the splash was seen for about 0.5 s instead of 2.6 s. Building it hidden was rejected: a hidden web view can stop its animation frames, and `revealApp` signals through them, which would leave the person on the splash until the 20 s fallback. Fix: the splash window is `alwaysOnTop`, so the empty main window waits behind it. Verified on Linux under Xvfb with openbox: the splash stays in front from 0.8 s until it closes over the finished Home screen. Windows is not run here.

---

## src/recent.rs and distribution {#distribution}

### src/recent.rs · note_recent_document
- refers-to: src/recent.rs :: note_recent_document; build.rs :: APP_COMMANDS; capabilities/default.json
- kind: explainer
- logged: v0.6.0 · 2026-10-30

Adds a saved or opened `.fmo` to the OS recent list: macOS NSDocumentController, Windows SHAddToRecentDocs, Linux gtk RecentManager (the gtk crate is now a direct dependency, already in the tree through Tauri). The frontend calls it after a save and after an open from a path, desktop only. The macOS and Windows branches come from formvis and are not compiled here.

### src/main.rs · pending opens consumed
- refers-to: src/main.rs :: take_pending_opens; frontend/src/app/app.ts :: openFromPath; backend/app/routers/files.py
- kind: fix
- logged: v0.6.0 · 2026-10-30

The single-instance queue existed since v0.3.0 but nothing read it. The frontend now drains it at start and on `formmorpheus://open-paths`, and reads each path through the engine's `GET /api/files/read` (absolute paths ending in `.fmo` only). On Linux the single-instance plugin needs a D-Bus session bus; without one a second window opens. Several paths at once open in turn and the last one stays.

### build_app · bundles and signing
- refers-to: ../build_app; ../build_app.bat; tauri.conf.json :: bundle
- kind: explainer
- logged: v0.6.0 · 2026-10-30

Tauri config cannot read env vars, so the conf keeps null signing placeholders and `build_app` passes `APPLE_SIGNING_IDENTITY` or `WINDOWS_CERT_THUMBPRINT` through `--config` only when set; unset gives an unsigned build (ad-hoc on macOS). `APPIMAGE_EXTRACT_AND_RUN=1` lets the AppImage build w/o FUSE. Verified: Linux deb and AppImage in 317 s, splash then Home, a second launch w/ a `.fmo` opened in the first window. `build_app.bat` and the macOS path are unrun; `setup/desktop_build` is no longer called.

### src/folder.rs · reveal_folder
- refers-to: src/folder.rs; src/main.rs; build.rs; capabilities/default.json
- kind: explainer
- logged: v0.12.0 · 2026-10-30

Show brush folder needs to open a folder. The shell plugin's default open scope accepts only mailto, tel and http(s) URLs, so a folder path was refused and the panel fell back to showing the path. `reveal_folder` opens a folder only when it lies inside the engine data folder, w/ xdg-open, open or explorer; its permission is generated by build.rs like the other app commands. Compiled (`cargo check`); not run in a desktop window here.

### Info.plist, entitlements.plist · microphone
- refers-to: Info.plist; entitlements.plist
- kind: explainer
- logged: v0.13.0 · 2026-10-31

Recording a voice-over needs the microphone: macOS asks w/ the `NSMicrophoneUsageDescription` text in `Info.plist`, and the hardened runtime needs `com.apple.security.device.audio-input` in the entitlements. Neither was built or run here (no macOS); the Linux and Windows webviews' microphone prompts are untested.

### Pen tablets · no shell change
- refers-to: src/main.rs :: build_main
- kind: explainer
- logged: v0.15.0 · 2026-10-31

Windows press-and-hold right click and pen flicks: no WebView2 browser argument is known to turn them off, and `WebviewWindowBuilder::additional_browser_args` replaces Tauri's default arguments, which could not be checked on Windows here. Left alone. The interface handles it in the page: `touch-action: none` and no text selection on the paint canvas, the same plus no touch callout on the Pen and Tablet test pad, and `contextmenu` is cancelled on both. If a held pen tap still opens a menu on a real Windows machine, try the browser argument then.

## v0.17.2 · platform

### src/main.rs · linux_graphics
- refers-to: src/main.rs :: linux_graphics, set_unless_set
- kind: explainer
- logged: v0.17.2

First thing in `main()`, Linux only. On NVIDIA (`/proc/driver/nvidia`) under Wayland it sets `__NV_DISABLE_EXPLICIT_SYNC=1`. `FORMMORPHEUS_SAFE_GRAPHICS=1` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`, `=2` also `WEBKIT_DISABLE_COMPOSITING_MODE=1`. A variable already set is never changed. Listed in README and CLAUDE.md.

### src/main.rs · allow_own_microphone
- refers-to: src/main.rs :: allow_own_microphone, origin_of; Cargo.toml :: webkit2gtk
- kind: explainer
- logged: v0.17.2

WebKitGTK has media stream off and denies unanswered permission requests, so Record sound failed. After the main window is built, `with_webview` turns on `enable-media-stream` and answers each permission request: allowed only when it is an audio-only user-media request and the page is on the origin the shell loaded (the engine address, or the dev URL); everything else is denied. `webkit2gtk = "2.0"` is a direct Linux dependency now, the version already in Cargo.lock through wry (one line added to the formmorpheus entry of the lock by hand; `cargo check --locked --offline` passes). Compiled only: not run against a real microphone here. macOS: `NSMicrophoneUsageDescription` (Info.plist) and `com.apple.security.device.audio-input` (entitlements.plist) are present.

### tauri.conf.json · Linux packages
- refers-to: tauri.conf.json :: bundle.linux
- kind: explainer
- logged: v0.17.2

Keys checked against `LinuxConfig`, `DebConfig`, `RpmConfig` and `AppImageConfig` in tauri-utils 2.10.2. deb depends `libwebkit2gtk-4.1-0 (>= 2.46)`, recommends the GStreamer good, bad and libav packages; rpm depends `webkit2gtk4.1 >= 2.46` and `gtk3` (Fedora names), recommends the matching GStreamer packages; the AppImage sets `bundleMediaFramework` true. `minimumSystemVersion` stays 11.0: the gate message, not the install check, covers an old engine. Recommendation: raise it to 13.0, since macOS 11 and 12 ship a WebKit without WebGL on offscreen surfaces and without audio encoding.

## v0.16.0 · Pen Link and .abr

### tauri.conf.json · WebView2 press-and-hold and flicks · researched again, no change
- refers-to: tauri.conf.json; src/main.rs :: build_main
- kind: explainer
- logged: v0.16.0 · 2026-10-31

Checked again, and `additionalBrowserArgs` stays unset. Facts found: the window option (`WindowConfig.additional_browser_args` in tauri-utils 2.8) hands wry the extra WebView2 arguments, and wry's own default is `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`; the docs say that using the option means those must be disabled again by hand, so a value would have to begin with that default to keep it. What was NOT found: any Chromium or WebView2 switch that turns off the pen's press-and-hold right click or the flick gestures. WebView2's own settings list (`CoreWebView2Settings`) and its environment option `AdditionalBrowserArguments` have no such entry, and the behaviour belongs to Windows (Pen and Windows Ink settings, "Press and hold for right-clicking", and the `WM_TABLET_QUERYSYSTEMGESTURESTATUS` reply of the window, which is native code, not a config string). With no verified flag, adding an argument could only risk a started-with-wrong-flags window, so the page-level guards from v0.15.0 stay the whole answer (`touch-action: none`, no callout, `contextmenu` cancelled on the canvas and test pad). If a Windows pen test still shows the menu, the next step is a native hook on the main window (answer `TABLET_DISABLE_PRESSANDHOLD | TABLET_DISABLE_FLICKS` to `WM_TABLET_QUERYSYSTEMGESTURESTATUS` through a window subclass), not a browser argument.
