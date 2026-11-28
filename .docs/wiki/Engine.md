# Engine (the movie engine)

`frontend/src/engine/` is the part that knows what a movie is. It never touches the DOM.

| File | Role |
|---|---|
| `types.ts` | the movie model: Movie, Track, Content, FlipTrack, Key, KeyLane, Ease |
| `model.ts` | constructors, ids, size and duration limits |
| `ops.ts` | pure edits on tracks and content: move, trim, split, duplicate, group, masks, blend |
| `flip-ops.ts` | Flipbook edits: frames, holds, tracks, conversion to and from tracks of drawings |
| `key-ops.ts`, `keys.ts` | keyframe edits and evaluation of lanes |
| `perform.ts` | capture of a drag as keys, smoothing and reduction |
| `history.ts` | undo steps, merging of drags, recovery points |
| `engine.ts` | the live object: movie, selection, mode, playhead, playback, jobs, events |
| `render.ts` | draws a movie frame to a canvas, on the processor or through the GPU compositor |
| `gpu/` | the WebGL2 compositor: shaders, textures and a probe that decides whether it is used |
| `warp-draw.ts` | draws Warp and Distort as textured triangles |
| `flip-draw.ts` | draws Flipbook rows, including row masks |
| `subtitles.ts` | the subtitle cues and their one look (`Movie.subtitles`): edits that return a new movie, cues from a sound's `spoken` words or from timed lines, and `drawSubtitles`, which `render.ts` calls over the finished frame |
| `scene-fx.ts` | scene effects (`Movie.sceneFx`): the 13 kinds, edits that return a new movie, and `drawSceneFx`, which `render.ts` calls over the content, outside the camera and before the subtitles |
| `scene-marks.ts`, `scene-ops.ts` | scenes (`Movie.scenes`): named stretches of the one timeline, and the edits that move, copy, open up or drop a stretch with the content, keys, camera keys, markers, subtitles and scene effects in it |
| `camera-moves.ts` | the ready-made camera moves, each written as camera keys from a frame for a length |
| `walk-to.ts` | Walk To Here, Walk In and Walk Off: move keys for the stretch plus the walk action over the same frames |
| `cast/views.ts` | the front, three-quarter, side and back views of a built character, and the flip (`CastSpec.view`, `CastSpec.flip`) |
| `time.ts` | frame rates and timecode |
| `events.ts` | a small typed emitter |

## Rules

- Every edit returns a new movie and shares what did not change. Nothing mutates.
- `Engine.run(label, fn, mergeKey)` applies an edit as one undo step. A repeated merge key folds a drag into one step.
- Playback is driven by a ticker the shell supplies. While sound plays, the audio clock is the ticker, so picture follows sound.
- History is saved inside the `.fmo`. Making a new edit after three or more undos saves an automatic recovery point.

## Keys

Distort is a projective map of the content's own rectangle. Warp is a Catmull-Rom surface through a 2x2 to 6x6 mesh of nodes. Both apply before move, scale and rotation.

## The GPU compositor

The processor path is the reference and the fallback. The GPU path walks the tracks the same way, with all 26 blend modes and the live filters as shader passes; content drawn through Warp, Distort, layer groups, layer masks or row masks is rendered by the processor and uploaded as one picture. Auto mode turns the GPU on only when WebGL 2 exists, a probe frame matches the processor and a heavy frame is no slower. `?gpu=force` skips the speed test. The Performance page of Preferences has the switch.

## Keys

Each key lane has a kind (Move, Scale, Warp, Distort, Opacity, Blur, Sharpen, Noise, HSB, Lens blur, Volume). Easing of the span after a key is Linear, Ease in, Ease out, Ease in and out, or Hold, evaluated as a temporal Bezier. Perform mode records one key per frame, smooths the path with a zero-phase filter and thins it with Ramer-Douglas-Peucker.

## The voice routes (`/api/voice`)

`backend/app/routers/voice.py` is the router; the work is in two services. `services/voice_runtime.py` is the built-in voice: it finds a Python 3.10 to 3.13, makes the voice's own runtime in `voice/runtime` of the data folder, downloads the Kokoro model to `voice/models` with a SHA-256 check, and speaks through that runtime. `services/voice_remote.py` is a voice app on this computer (loopback addresses only) and the online voice, with the keys in the system keyring. Both use only the standard library.

| Route | Does |
|---|---|
| `GET /status` | the three engines' state in one answer |
| `POST /builtin/setup`, `GET` and `DELETE /builtin/job`, `DELETE /builtin` | start, watch, cancel the one-time setup; remove the built-in voice |
| `GET /builtin/voices` | the built-in voice's voices |
| `PUT /local`, `POST /local/probe` | save the voice app's address, model and voice; ask it what it has |
| `PUT` and `DELETE /online/key`, `GET /online/voices` | keep or clear the online key; list its voices |
| `POST /speak` | speak `{engine, text, voice, language, speed, model}`; answers the sound's id, voice, seconds and cues |
| `GET` and `DELETE /audio/{id}` | the window fetches the spoken sound, then drops it |
| `GET /transcribe/status` | whether listening is ready: the runtime, the model (Whisper base) and any download |
| `POST /transcribe/setup`, `GET` and `DELETE /transcribe/job`, `DELETE /transcribe` | start, watch, cancel the one-time model download; remove the model |
| `POST /transcribe?language=` | the body is a 16 kHz mono 16-bit WAV; answers the language, the seconds and phrases `{start, end, text}` in seconds (up to 256 MB of body) |

The rule: the engine process never imports the Kokoro packages (`kokoro_onnx`, `numpy`, `onnxruntime`). They run in the voice's own runtime as a separate program, because the loader they use brings eSpeak NG under GPL terms, and importing them would put that into the frozen engine. The same rule holds for listening: `services/voice_transcribe.py` runs Whisper base in the voice's own runtime (`voice_runtime.runtime_python()`), with the model in `voice/listen/whisper-base`, so the engine process never imports `numpy` or `onnxruntime` for it either, and listening needs the built-in voice set up first.

## The scenes routes (`/api/scenes`)

`backend/app/routers/scenes.py` is the router and `services/scenes.py` keeps the files: the person's own scenery, one `.fmo` each in the `Scenes` folder of the data folder. A scene is a small movie of the tracks the person ticked in Save as Scene, so the same reader opens it. It mirrors the Characters library: the same name cleaning, a check that the body is a zip, a poster picture beside the file and a delete that moves the file to Recently Deleted with the kind `scene` (a restore puts it back in `Scenes`). The interface side is `io/my-scenes.ts` (`scenesApi`, packing a scene from the open movie, and laying one behind a movie) and `app/features/my-scenes.ts` (the card and the Scenes tab).

| Route | Does |
|---|---|
| `GET /api/scenes` | the folder and the scenes, newest first, each with name, file, path, size and times |
| `GET /api/scenes/{name}` | the scene's `.fmo` bytes |
| `GET /api/scenes/{name}/poster` | the scene's picture; `?v=` is the modified time, so a changed scene is fetched again |
| `PUT /api/scenes/{name}` | write a scene from the body (a zip, up to the same limit as a character); answers its entry |
| `POST /api/scenes/{name}/rename` | `{to}`; 409 when that name is taken |
| `DELETE /api/scenes/{name}` | move the scene to Recently Deleted |

## Fields the movie file gains

`Movie.sceneFx` is the list of scene effects (`id`, `kind`, `start` and `end` frame, `amount` from 0 to 1 as the strength, and a `seed` for the drawing) and `Movie.scenes` is the list of scenes (id, name, start frame; a scene runs to the next one's start). Both are optional, read back through `engine/normalize.ts`, and saved in the `.fmo` like any other field of the movie. A scene saved with Save as Scene keeps neither, and keeps its size, length, background, floor guide and the ticked tracks.
