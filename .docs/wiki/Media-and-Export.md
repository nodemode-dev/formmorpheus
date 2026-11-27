# Media and export

## Import (`frontend/src/media/`)

`import.ts` turns a dropped or picked file into assets and content, and the caller places the result as one undo step.

| Input | Path |
|---|---|
| PNG, JPEG, WebP, AVIF, BMP | the browser decodes |
| TIFF | `tiff-decode.ts`: uncompressed, PackBits, LZW, Deflate; grey, RGB, RGBA, palette; strips and tiles |
| Animated GIF | `gif-decode.ts`, placed as a Flipbook with holds from the delays |
| Video | `video.ts` (VideoPool) over mediabunny and WebCodecs |
| Sound | `audio.ts` decodes, draws waveforms, plays on one AudioContext |
| Fonts | `fonts.ts` registers them with the document |

## AI Voice

`frontend/src/app/voice-commands.ts` (`speakToTimeline`) asks the engine to speak, fetches the sound and brings it in through the same import as any sound file, at the Playhead or a given frame. The new sound's asset carries `spoken`: the text, the engine, the voice and the cues, one per sentence in seconds inside the sound. They are saved in the `.fmo`; the subtitles of the next version read them.

| Engine | What speaks | Sound |
|---|---|---|
| `builtin` | Kokoro in its own runtime in the data folder (`services/voice_runtime.py`) | 16-bit mono WAV, with cues |
| `local` | a voice app on a loopback address that answers `POST /v1/audio/speech` (`services/voice_remote.py`) | what the app returns, no cues |
| `online` | ElevenLabs with the person's own key, text up to 2000 characters (`services/voice_remote.py`) | MP3, no cues |

Files live in `voice/` of the data folder: `runtime/` and `models/` for the built-in voice, and `out/` for a spoken sound until the window fetches it (swept after an hour). Keys are in the system keyring, never in `settings.json`.

## Sync

The AudioContext is the clock while sound plays. Loop turns restart the sound from the new frame without a clock jump. Output latency leaves sound a constant frame or two behind the Playhead readout.

## Export (`frontend/src/export/`)

`run.ts` renders frames offscreen on the main thread, yielding every frame, and hands them to an encoder. `cancel()` stops within a frame.

| Format | Encoder |
|---|---|
| MP4, WebM, MOV | mediabunny with the browser's encoders; sound is AAC where the browser has it, else Opus with a warning |
| Animated GIF | `gif.ts`, our own writer: median-cut quantiser, Floyd-Steinberg and ordered dithers, frame differencing, LZW |
| PNG, JPG, WebP frames | one picture per frame in a zip |
| ProRes, ProRes 4444, HEVC | `engine-jobs.ts` |

## Engine jobs

The browser cannot encode ProRes or HEVC. For those the window draws each frame offscreen, uploads it to the engine as a PNG with the sound as a WAV, and the engine runs the person's own ffmpeg as a separate program (an argument list, never a shell). formmorpheus never ships or links ffmpeg, and never asks for a GPL build. The result is kept in Exports. If ffmpeg is not installed, those formats report what is missing.

HEVC can be made as MP4 or as MOV. The engine takes an exact rational frame rate such as 24000/1001. When one video fills more than four blocks, export takes exact frames and a lane being waited on is never evicted. Animated WebP, APNG and AVIF stream on import under the same budget as GIF.

## Where exports go

Every export downloads and is also kept by the engine in Exports, never overwritten. The Home screen lists them. Deleting one moves it to Recently Deleted for 30 days. A restore whose name is taken is renamed and says so.
