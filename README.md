<p align="center">
  <img src="assets/app-icon/formmorpheus-256.png" width="128" height="128" alt="FormMorpheus icon: the Form family app icon for the animation studio">
</p>

<h1 align="center">FormMorpheus</h1>

<p align="center">
  <b>Animation; a Stage over a Timeline, drawn frame by frame, keyframed or performed live.</b><br>
  Drawings, flipbooks, pictures, text, video and sound on tracks,<br>
  in one window with no account. Offline, and yours.
</p>

<p align="center">
  <img alt="version 0.25.0" src="https://img.shields.io/badge/version-v0.25.0-eef0f4?style=flat-square">
  <img alt="TypeScript and Vite" src="https://img.shields.io/badge/TypeScript-Vite-3178c6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Python and FastAPI" src="https://img.shields.io/badge/Python-FastAPI-3776ab?style=flat-square">
  <img alt="macOS, Linux and Windows" src="https://img.shields.io/badge/macOS%20%C2%B7%20Linux%20%C2%B7%20Windows-native-2f7bf5?style=flat-square">
  <img alt="iPad: beta, build it yourself" src="https://img.shields.io/badge/iPad-beta%2C%20build%20it%20yourself-6b6b6b?style=flat-square">
  <img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-3a3a3a?style=flat-square">
  <img alt="Status: in development" src="https://img.shields.io/badge/status-in%20development-d69e2e?style=flat-square">
</p>

<p align="center">
  <a href="https://formai.studio/"><b>Download FormMorpheus on formai.studio</b></a> ·
  <a href="#run-it-from-source">Run it from source</a>
</p>

<br>

<p align="center">
  <img src="docs/images/formmorpheus-hero.webp" alt="FormMorpheus in the Compose view: a black Stage shows a tumbling hand-drawn magenta and violet gem with white scribble hatching and red sketch outlines above the hand-lettered word FORMAI, with the Solid, FORMAI and Glow tracks, their blocks and the playhead on the Timeline below" width="100%">
  <br>
  <sub>FORMAI: a 16-drawing tumbling gem and a stroke-by-stroke lettering write-on on three tracks (FORMAI, Solid, Glow), drawn in FormMorpheus.</sub>
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#everything-in-the-box">In the box</a> ·
  <a href="#under-the-hood">Under the hood</a> ·
  <a href="#download">Download</a> ·
  <a href="#run-it-from-source">Run from source</a>
</p>

<br>

<table>
  <tr>
    <td width="25%" valign="top">
      <h3>Stage over Timeline</h3>
      One screen: the movie frame above, tracks of content below, with a frame-accurate timecode.
    </td>
    <td width="25%" valign="top">
      <h3>Three ways to animate</h3>
      Compose blocks on tracks, set keyframes with easing, or perform a drag live and record it as keys.
    </td>
    <td width="25%" valign="top">
      <h3>Draw frame by frame</h3>
      Flipbooks with holds and onion skins, plus a full paint canvas with a brush library.
    </td>
    <td width="25%" valign="top">
      <h3>Safe by default</h3>
      Every edit is an undo step saved inside the movie, with Recently Deleted and crash recovery.
    </td>
  </tr>
</table>

## Features

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/images/formmorpheus-onion.webp" alt="The Flipbook editor on one drawing of the tumbling gem: magenta and violet hatched faces with cyan ghosts of the earlier drawings and amber ghosts of the next, above a frame strip" width="100%">
      <br><sub>Flipbook editing with onion skins tinted backwards and forwards.</sub>
      <h3>Flipbooks and onion skins</h3>
      Draw each frame, hold it as long as you need, and see the drawings before and after it as ghosts.
    </td>
    <td width="50%" valign="top">
      <img src="docs/images/formmorpheus-writeon.webp" alt="Keyframe mode with the FORMAI write-on block selected: the letters FORM are half drawn on the Stage and a Move lane with keys and eases sits under the block on the Timeline" width="100%">
      <br><sub>Keyframe mode: the FORMAI write-on with a Move lane and an ease between the keys.</sub>
      <h3>Keyframe mode</h3>
      Key Move and Scale and live filters on lanes under each block, with ease and hold curves between keys.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/images/formmorpheus-export.webp" alt="The Export dialog on its Quick share tab: video, animated GIF, frames as images, current frame, sprite sheet, movie file and sound only" width="100%">
      <br><sub>The Export dialog: quick share targets, with an Advanced tab for codec, resolution and range.</sub>
      <h3>Export</h3>
      Write video, animated GIF, image frames, a sprite sheet, a single frame or sound only, and save presets.
    </td>
  </tr>
</table>

## Everything in the box

<table>
  <tr>
    <td width="33%" valign="top">
      <h4>Content blocks</h4>
      Drawings · Flipbooks · Pictures · Video · Sound · Text · Shapes · Solids · Adjustments · Groups · Characters · Starter content
    </td>
    <td width="33%" valign="top">
      <h4>Animation tools</h4>
      Compose · Keyframe · Perform · Graph editor · Motion paths · Pivots · Parenting · Camera · Bones · Warp · Lip-sync · Actions
    </td>
    <td width="33%" valign="top">
      <h4>Formats</h4>
      Opens: video, sound, GIF, TIFF, PSD, ORA, KRA, SVG parts, fonts · Saves: MP4, WebM, MOV, GIF, image frames · Native: <code>.fmo</code>, <code>.fmact</code>
    </td>
  </tr>
</table>

**Coming from another animation app?** Layered `.procreate` artwork opens as a Drawing with its layers, blend modes and groups. Another app's movie project file cannot be read, so bring the movie over as what that app exports: a video (MP4 or MOV, in H.264, HEVC or ProRes, with its transparency), a folder of numbered PNG frames, which becomes one Flipbook, or an animated GIF, which becomes a Flipbook with its holds. See "Coming from another animation app" in [`docs/MANUAL.md`](docs/MANUAL.md).

## Under the hood

- **Stack:** a vanilla TypeScript and Vite interface, a Python and FastAPI engine and a Tauri 2 desktop shell.
- **Decoupled core:** the movie model, ops, history and renderer in `frontend/src/engine/` never touch the DOM.
- **Movies:** `.fmo` files hold the movie, assets and undo history; ProRes and HEVC export use your own ffmpeg, or the family's LGPL build that Preferences, Video Tools downloads on request.
- **Perform:** drag a block on the Stage while the movie plays and the gesture becomes keys at the movie's frame rate.
- **Characters:** an SVG with one group per body part opens as a character with parts, pivots and parenting; save it to the Characters library, apply actions to it, and send it to a vector app and back, where it updates by part name and keeps its animation. Starter characters and scenes are included.
- **Agents:** an MCP server at `/mcp` with a small core tool list, and a terminal panel for Claude Code, Codex, Cursor and Antigravity. A change waits for your yes in the window unless you allow agents; see [`.docs/wiki/Agents.md`](.docs/wiki/Agents.md).
- **In your language:** the interface ships in 30 languages, right to left included, with a manual on F1.
- **iPad:** the iPad app in `ios/` wraps the same interface in a Swift shell with Apple Pencil, Files and AVFoundation export. It is built and runs on an iPad Pro 13-inch (M5) with Apple Pencil Pro on iPadOS 26.3, where drawing, squeeze, barrel roll and hover were checked. It is a beta that you build yourself on a Mac with Xcode: see [`docs/ios/BUILD.md`](docs/ios/BUILD.md). An App Store version is planned only if the iPad app gets real adoption.

## Download

| Platform | Download | Release |
|---|---|---|
| macOS | [Download FormMorpheus for macOS](https://formai.studio/get/formmorpheus/macos) | [FormMorpheus releases on FormCompiler](https://github.com/nodemode-dev/formcompiler/releases?q=formmorpheus-v&expanded=true) |
| Windows | [Download FormMorpheus for Windows](https://formai.studio/get/formmorpheus/windows) | [FormMorpheus releases on FormCompiler](https://github.com/nodemode-dev/formcompiler/releases?q=formmorpheus-v&expanded=true) |
| Linux | [Download FormMorpheus for Linux](https://formai.studio/get/formmorpheus/linux) | [FormMorpheus releases on FormCompiler](https://github.com/nodemode-dev/formcompiler/releases?q=formmorpheus-v&expanded=true) |

All FormMorpheus builds are compiled and released from [FormCompiler](https://github.com/nodemode-dev/formcompiler); this repo holds the source.

## Run it from source

Prefer it in your browser, or want to contribute? Run the web UI straight from this repo.

**Requires:** Node 20.19+ or 22.12+ and Python 3.12+. `./formmorpheus doctor` checks them.

```sh
git clone git@github.com:nodemode-dev/formmorpheus.git
cd formmorpheus
./formmorpheus_oc_install   # installs the frontend and engine dependencies
./formmorpheus              # web UI at http://localhost:5194
```

`./formmorpheus desktop dev` opens the desktop window instead. On Windows use `formmorpheus_oc_install.bat` and `formmorpheus.bat`. On a Mac with Xcode, `./formmorpheus ios` builds the iPad app; see [`docs/ios/BUILD.md`](docs/ios/BUILD.md), with TestFlight and App Store steps beside it.

The interface runs on port 5194 and proxies `/api` and `/mcp` to the local engine on 127.0.0.1:9494. `FORMMORPHEUS_DATA_DIR` moves the engine's data and movie library, and `FORMMORPHEUS_PORT` sets the engine port.

> [!IMPORTANT]
> **Status:** in development. The Linux desktop build is tested; the macOS and Windows builds are configured but untested here.

**Contributing:** branch from `main`, keep changes to source here, and leave packaging and releases to formcompiler. See [`CONTRIBUTING.md`](CONTRIBUTING.md), the [code of conduct](CODE_OF_CONDUCT.md) and [`AGENTS.md`](AGENTS.md); security problems go through [`SECURITY.md`](SECURITY.md).

## Repository

| Path | What it is |
|---|---|
| `frontend/` | the interface: engine, paint core, Stage, Timeline, media and export |
| `backend/` | the engine service: movie library, exports, Recently Deleted, crash recovery |
| `src-tauri/` | the Tauri 2 desktop shell |
| `ios/` | the iPad app: Swift shell, engine bridge, Pencil, export and memory |

---

## Maintainers

| Maintainer | Role |
|---|---|
| [@nodemode-ai](https://github.com/nodemode-ai) | Owner |
| [@gbarnai](https://github.com/gbarnai) | Co-owner |

Code owners are set in [`.github/CODEOWNERS`](.github/CODEOWNERS).

## License

FormMorpheus is licensed under the Apache License 2.0 ([`LICENSE`](LICENSE), SPDX `Apache-2.0`). Third-party notices: [`NOTICE.md`](NOTICE.md).
