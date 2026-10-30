# HASHOUT_LOG · src-tauri · formmorpheus

Living log for the desktop shell (Tauri 2). Source stays comment-free; rationale lives here. The splash and reveal reproduce the owner's formvis splash and boot map exactly.

Current build version: v0.3.0
Last updated: 2026-10-30 · desktop shell from formvis

---

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
    └── window_state.rs         window size and place kept between launches
```

---

## Table of contents

- [src/main.rs](#main)
- [src/reveal.rs](#reveal)

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
