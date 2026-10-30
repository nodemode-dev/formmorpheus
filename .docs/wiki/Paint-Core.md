# Paint core

`frontend/src/paint/` is the Draw & Paint engine: typed arrays and maths, no `document`, no `window`. `OffscreenCanvas` is allowed only in `doc.ts`, which composites layers and encodes PNG.

## Pixels

A `Raster` is straight-alpha RGBA8 in `ImageData` layout, so it moves to and from a canvas with no conversion. Work is done in dirty rectangles on reused buffers.

## Parts

| File | Role |
|---|---|
| `types.ts` | the contract: Raster, Brush, PenSample, Mask, PixelPatch |
| `brushes.ts` | the library: 18 brushes in 7 sets (Sketch, Ink, Paint, Chalk, Airbrush, Texture, Wash) |
| `tips.ts` | procedural brush tips and paper grain |
| `dynamics.ts` | pressure curve, size and flow ranges, tilt, a seeded random generator |
| `input.ts` | pointer events to pen samples, coalesced points, streamline smoothing |
| `stroke.ts` | the CPU stroke engine: paint, smudge, erase |
| `doc.ts` | layers, structure edits, compositing, PNG encode and decode |
| `history.ts` | the paint document's undo: pixel patches and layer snapshots |
| `fill.ts` | flood fill, selection fill and clear |
| `select.ts` | masks: shapes, combine, extract, outline |
| `transform.ts` | affine, perspective and mesh resampling |
| `filters.ts` | Hue Saturation Brightness, Gaussian blur, sharpen, noise, lens blur |

## Filters shared with Keyframes

The same filter maths runs destructively on a layer in Draw & Paint and live per frame on a rendered surface for Keyframe filters.

## The UI side

`ui/paint-view.ts` hosts the canvas; `ui/paint-tools.ts` builds Select, Transform and Filters; `ui/brush-panel.ts`, `ui/colour-panel.ts` and `ui/layers-panel.ts` are the panels. Each finished action is one paint undo step, and finishing the drawing stores the result as one movie edit.
