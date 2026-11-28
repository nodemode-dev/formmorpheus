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

`frontend/src/app/voice-commands.ts` (`speakToTimeline`) asks the engine to speak, fetches the sound and brings it in through the same import as any sound file, at the Playhead or a given frame. The new sound's asset carries `spoken`: the text, the engine, the voice and the cues, one per sentence in seconds inside the sound. They are saved in the `.fmo`; the subtitles read them (see Subtitles).

| Engine | What speaks | Sound |
|---|---|---|
| `builtin` | Kokoro in its own runtime in the data folder (`services/voice_runtime.py`) | 16-bit mono WAV, with cues |
| `local` | a voice app on a loopback address that answers `POST /v1/audio/speech` (`services/voice_remote.py`) | what the app returns, no cues |
| `online` | ElevenLabs with the person's own key, text up to 2000 characters (`services/voice_remote.py`) | MP3, no cues |

Files live in `voice/` of the data folder: `runtime/` and `models/` for the built-in voice, and `out/` for a spoken sound until the window fetches it (swept after an hour). Keys are in the system keyring, never in `settings.json`.

## Scene effects

`Movie.sceneFx` holds the weather, particles and light laid over the movie (`engine/scene-fx.ts`, 13 kinds). `render.ts` calls `drawSceneFx` after the content is drawn and before the subtitles, outside the camera, so the Stage and every export draw them through the same call and a camera move does not shift them. Each effect has a start and end frame, a strength and a seed, so a frame draws the same every time it is drawn. The Effects tab of the Build panel (`ui/scene-fx-panel.ts`) lays, sets and removes them.

## Subtitles

`Movie.subtitles` holds whether they show, one look and the cues. `engine/subtitles.ts` draws them: `render.ts` calls `drawSubtitles` over the finished frame, after the camera, for the Stage and for every export, so every export carries them while they are shown, and none when `show` is off or no cue covers the frame. `subtitleFonts` lists the families the export must have loaded.

- **Units.** A cue is in movie frames, `end` not included. Lines from a voice, a listening or a subtitle file are in seconds, and `linesToCues` maps seconds inside a sound to frames through the block's start, its trimmed beginning and its speed. `size` is a percent of the movie's height (2 to 15, default 5).
- **Sources.** An AI voice's sound carries `spoken` (see AI Voice), and `cuesForSound` turns it into cues, estimating the timing by sentence length when the sound has none. A recording or a sound file is listened to by `media/speech-pcm.ts`, which makes a 16 kHz mono WAV of the whole asset, and the engine's `POST /api/voice/transcribe` (Whisper base in the built-in voice's runtime).
- **Files.** `io/subtitle-files.ts` reads `.srt` and `.vtt` (told apart by content, tags stripped) and writes either.

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

The Export card's Save to row sends the file to the browser's download folder, to a folder the person chose, or to a save dialog each time; the window does that, and a taken name in a chosen folder becomes "name 2". Every export is also kept by the engine in Exports, never overwritten. The Home screen lists them. Deleting one moves it to Recently Deleted for 30 days. A restore whose name is taken is renamed and says so.
