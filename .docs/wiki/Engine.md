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
| `render.ts` | draws a movie frame to a canvas |
| `time.ts` | frame rates and timecode |
| `events.ts` | a small typed emitter |

## Rules

- Every edit returns a new movie and shares what did not change. Nothing mutates.
- `Engine.run(label, fn, mergeKey)` applies an edit as one undo step. A repeated merge key folds a drag into one step.
- Playback is driven by a ticker the shell supplies. While sound plays, the audio clock is the ticker, so picture follows sound.
- History is saved inside the `.fmo`. Making a new edit after three or more undos saves an automatic recovery point.

## Keys

Each key lane has a kind (Move, Scale, Opacity, Blur, Sharpen, Noise, HSB, Lens blur, Volume). Easing of the span after a key is Linear, Ease in, Ease out, Ease in and out, or Hold, evaluated as a temporal Bezier. Perform mode records one key per frame, smooths the path with a zero-phase filter and thins it with Ramer-Douglas-Peucker.
