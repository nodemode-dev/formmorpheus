// How far speech to text has come, worked out from what the speech library does report: it hears a long sound in
// windows and says when each one is done, and says nothing inside a window. Pure, shared by the page and the Worker.

/** The rate the speech model hears at. */
export const LISTEN_RATE = 16000;
/** The length of one window, and the part of it shared with each neighbour (the library's own default, a sixth). */
export const WINDOW_SECONDS = 30;
const STRIDE_SECONDS = WINDOW_SECONDS / 6;
/** Share of the progress bar given to reading the files; the rest is the listening. */
export const LOAD_SHARE = 0.3;

/** How many windows a sound of `length` samples at 16 kHz is heard in. */
export function windowCount(length: number): number {
  const size = LISTEN_RATE * WINDOW_SECONDS;
  const jump = size - 2 * LISTEN_RATE * STRIDE_SECONDS;
  return length <= size ? 1 : Math.ceil((length - size) / jump) + 1;
}

/**
 * The bar's fraction once `done` of `total` windows are heard. Null while there is no number to give: a sound that
 * fits one window is heard in one step, so the card shows that it is working and not a figure that stands still.
 */
export function listenFraction(done: number, total: number): number | null {
  if (total <= 1) return done >= 1 ? 1 : null;
  return LOAD_SHARE + (1 - LOAD_SHARE) * Math.min(1, Math.max(0, done / total));
}
