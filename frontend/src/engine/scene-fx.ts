// Scene effects (weather, light, particles): Movie.sceneFx, drawn over the content and under the subtitles.
import type { Movie, SceneFx } from './types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export interface FrameView { scale: number; ox: number; oy: number; width: number; height: number }

/** The list as read from a file, made safe; null when there is none. */
export function tidySceneFx(_raw: unknown): SceneFx[] | null {
  return null;
}

/** Draws every effect that is on at `frame`. Called at the end of Renderer.drawFrame, before the subtitles. */
export function drawSceneFx(_ctx: Ctx, _m: Movie, _frame: number, _view: FrameView): void {
}
