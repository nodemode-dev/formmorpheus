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

`FORMMORPHEUS_DATA_DIR`, `FORMMORPHEUS_LIBRARY_DIR` and `FORMMORPHEUS_PORT` are set in the shell. `FORMMORPHEUS_DEV_URL` is for debug desktop builds. No `.env` file is read.

## First movie

Open the Home screen, choose New movie, add a Drawing from the Create button, and press Space. The manual walks through the rest.
