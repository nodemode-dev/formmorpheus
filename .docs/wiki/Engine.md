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

The processor path is the reference and the fallback. The GPU path walks the tracks the same way, with all 17 blend modes and the live filters as shader passes; content drawn through Warp, Distort, layer groups, layer masks or row masks is rendered by the processor and uploaded as one picture. Auto mode turns the GPU on only when WebGL 2 exists, a probe frame matches the processor and a heavy frame is no slower. `?gpu=force` skips the speed test. The Performance page of Preferences has the switch.

## Keys

Each key lane has a kind (Move, Scale, Warp, Distort, Opacity, Blur, Sharpen, Noise, HSB, Lens blur, Volume). Easing of the span after a key is Linear, Ease in, Ease out, Ease in and out, or Hold, evaluated as a temporal Bezier. Perform mode records one key per frame, smooths the path with a zero-phase filter and thins it with Ramer-Douglas-Peucker.
