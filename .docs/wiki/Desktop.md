# Desktop

`src-tauri/` is a Tauri 2 shell around the same interface.

## What it does

- Starts the engine as a sidecar on a free port (`FORMMORPHEUS_PORT=0`) and loads the interface from it.
- Shows a splash, then reveals the main window with no white frame.
- Remembers the window place and size.
- Adds saved and opened movies to the system's recent documents, and opens a `.fmo` that you double-click, including in an app that is already running (single instance).
- Offers a custom title bar, and on macOS menus in the system menu bar or in the window.

## Source

| File | Role |
|---|---|
| `main.rs` | startup, engine process, splash, open requests, commands |
| `packaged.rs` | finds the frozen engine folder in a bundle |
| `recent.rs` | the system recent list |
| `window_state.rs` | window place and size |
| `reveal.rs` | the first reveal |
| `traffic_lights.rs` | macOS title bar buttons |
| `text_edit.rs` | native text editing commands |

## Building

```shell
./formmorpheus freeze          # freezes the engine with PyInstaller
./formmorpheus desktop dev     # run against the dev servers
./formmorpheus desktop build   # installers; same as ./build_app
```

The one-folder engine travels inside the bundle (Resources on macOS). Bundles are a `.app` on macOS, an `.msi` on Windows and an AppImage on Linux. The desktop shell compiles on Linux; macOS and Windows builds have not been tested on those systems yet. macOS builds are meant to be signed.

## Debug

`FORMMORPHEUS_DEV_URL` makes a debug desktop build load the interface from a URL (for example the Vite server) instead of the engine's.
