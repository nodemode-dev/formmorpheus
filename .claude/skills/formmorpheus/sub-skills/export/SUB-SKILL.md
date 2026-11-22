---
name: export
description: "FormMorpheus export: which formats the window encodes itself, which go to the engine's export jobs through the person's own ffmpeg, the fallbacks between them, sound, and where files land. Use when choosing an export format, explaining why an export needs ffmpeg, or changing frontend/src/export or backend/app/routers/jobs.py."
---

# Export

## Formats

The format names are `ExportFormat` in `frontend/src/export/types.ts`; the options are `ExportOptions` in the same file. `export_movie` takes the same names.

| Who encodes | Formats | Where |
| --- | --- | --- |
| The window, with the browser's `VideoEncoder` | `mp4`, `webm`, `mov` | `frontend/src/export/route.ts` (`browserEncodesVideo`), the worker in `frontend/src/export/worker-video.ts` |
| The window, in code | `gif`, `apng`, `webp-anim`, `psd`, the picture sequences (`png-frames`, `jpg-frames`, `webp-frames`, `tiff-frames`, `tga-frames`, `bmp-frames`) and `png-still` | `frontend/src/export/run.ts`, `gif.ts`, `anim-image.ts`, `psd.ts`, `still-formats.ts` (TIFF, TGA and BMP, which a canvas cannot write) |
| The engine's ffmpeg | `prores-mov`, `prores4444-mov`, `hevc-mp4`, `hevc-mov`, `h264-mp4`, `h264-mov` | the `ENGINE` map in `frontend/src/ui/export-dialog.ts`; `frontend/src/export/engine-jobs.ts` uploads frames to `backend/app/routers/jobs.py` |

Fallback: when the window cannot encode `mp4` or `mov` at the asked size, `startExportRouted` (`route.ts`) sends the export to the engine as H.264; `webm` has no engine target, so it fails with a sentence that says to choose MP4.

## ffmpeg

- FormMorpheus never ships ffmpeg. The engine runs the person's own as a separate program with an argument list, never a shell (`backend/app/services/ffmpeg.py`, `backend/app/routers/jobs.py`).
- It is found at `FORMMORPHEUS_FFMPEG`, beside a frozen engine, on the PATH, then on macOS in the Homebrew and MacPorts folders (`MAC_INSTALL_DIRS`).
- `GET /api/jobs/capabilities` (and the `export_capabilities` command over MCP) says, for each target in `TARGETS`, whether it is available and which encoder it uses: `libx264` for H.264, `prores_ks` for ProRes, the first of `HEVC_ORDER` for HEVC. HEVC with transparency needs `hevc_videotoolbox` (macOS).
- Sound: MP3 has no browser encoder, so `frontend/src/export/audio-export.ts` sends the WAV mixdown to `/api/audio-encode/mp3` (libmp3lame); Opus and AAC go to `/api/audio-encode/lossy` when the window has no `AudioEncoder` for them.

## Where files land

- Exports go to the `Exports` folder in the data folder (`config.exports_dir()`); the window saves a file there with `PUT /api/exports/{name}`, an engine job keeps its own result there. A taken name becomes "name 2".
- On iPad there is no ffmpeg: the routes that need it are listed as desktop-only in `setup/api_contract_check` (`DESKTOP_ONLY`), and the export dialog hides what needs them.

## Through MCP

`export_movie` asks the person first and is carried out by the open window, which uses the same paths as the Export dialog. With no window open it is refused at once. The answer names the file in Exports and any warnings the exporter gave (a codec fallback, sound left out).
