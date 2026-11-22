# Desktop

`src-tauri/` is a Tauri 2 shell around the same interface.

## What it does

- Starts the engine on port 9496 when it is free, another free port when it is not, and loads the interface from it.
- Gives the window a key the engine made for this launch. Every `/api` request needs it, so another program on the computer cannot drive the engine.
- Shows a splash for at least 2.6 seconds, then reveals the main window whole, with no white frame.
- Says why in a native message when the engine cannot start or stops, with the engine's last lines and the path of its log.
- Ends the engine when the app closes, however it closes, and replaces an engine left over from a crash.
- Remembers the window place and size.
- Adds saved and opened movies to the system's recent documents, and opens a `.fmo` that you double-click, including in an app that is already running (single instance).
- Offers a custom title bar, and on macOS menus in the system menu bar or in the window.

## Source

| File | Role |
|---|---|
| `main.rs` | startup, engine process, splash, open requests, commands |
| `engine_start.rs` | the ways a start can fail and the message for each |
| `win_job.rs` | Windows: the job that ends the engine with the app |
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

The engine travels inside the bundle: a folder in Resources on macOS, an `engine` folder beside the app on Windows, one program beside the app on Linux. Bundles are a `.app` and a `.dmg` on macOS, an `.msi` and a setup `.exe` on Windows, and a `.deb`, an AppImage and an `.rpm` on Linux. A release build has no web inspector and no source maps. The desktop shell compiles on Linux; macOS and Windows builds have not been tested on those systems yet. macOS builds are meant to be signed.

## Debug

`FORMMORPHEUS_DEV_URL` makes a debug desktop build load the interface from a URL (for example the Vite server) instead of the engine's.
