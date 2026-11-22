# Getting started

## Requirements

Node 20.19 or newer (or 22.12), and Python 3.12 or newer. Desktop builds also need Rust (https://rustup.rs). `./formmorpheus doctor` checks all of it.

## macOS and Linux

```shell
chmod +x formmorpheus_oc_install formmorpheus
./formmorpheus_oc_install
./formmorpheus
```

## Windows

```shell
formmorpheus_oc_install.bat
formmorpheus.bat
```

## Commands

| Command | What it does |
|---|---|
| `./formmorpheus` | boots the engine and the interface together |
| `./formmorpheus install` | installs the backend and the frontend |
| `./formmorpheus backend` | the engine only |
| `./formmorpheus frontend` | the interface only |
| `./formmorpheus build` | production build into `frontend/dist` |
| `./formmorpheus serve` | serves the built interface from the engine on 9494 |
| `./formmorpheus freeze` | freezes the engine for the desktop app |
| `./formmorpheus desktop dev` | the desktop app against the dev servers |
| `./formmorpheus desktop build` | builds the installers, same as `./build_app` |
| `./formmorpheus doctor` | checks the toolchain, installs and ports |
| `./formmorpheus clean` | removes build output (`--all` adds the venv and node_modules) |

## Ports

| Service | URL |
|---|---|
| Interface | http://localhost:5194 (Vite, local only, proxies `/api`) |
| Engine | http://127.0.0.1:9494 (FastAPI, local only) |

## Configuration

Everything is set through environment variables in the shell; no `.env` file is read.

| Variable | What it does |
|---|---|
| `FORMMORPHEUS_DATA_DIR` | the folder for the library, settings, exports and logs |
| `FORMMORPHEUS_LIBRARY_DIR` | the movie library alone, when it should live elsewhere |
| `FORMMORPHEUS_FFMPEG` | the ffmpeg program to use for ProRes, HEVC and MP3 |
| `FORMMORPHEUS_PORT` | the engine's port (9494 from source; the desktop app picks its own) |
| `FORMMORPHEUS_PORTABLE` | `1` keeps the data beside the app |
| `FORMMORPHEUS_SAFE_GRAPHICS` | Linux desktop: `1` or `2` for graphics drivers that draw wrongly |
| `FORMMORPHEUS_DEV_URL` | a debug desktop build loads this page instead of the engine's |
| `FORMMORPHEUS_BACKEND_PORT` | the engine port the Vite server proxies `/api` to |
| `FORMMORPHEUS_NO_SHELL` | `1` lets a frozen engine serve the page in a browser without the app |

The engine listens on 127.0.0.1 only. `CLAUDE.md` lists the build variables and the ones the app sets for its own engine.

## First movie

Open the Home screen, choose New movie, add a Drawing from the Create button, and press Space. The manual walks through the rest.
