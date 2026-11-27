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

The rule: the engine process never imports the Kokoro packages (`kokoro_onnx`, `numpy`, `onnxruntime`). They run in the voice's own runtime as a separate program, because the loader they use brings eSpeak NG under GPL terms, and importing them would put that into the frozen engine.
