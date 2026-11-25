// Which expanded group new content goes into. The Timeline sets `target` (the open group the person is working in);
// Create, import and Add Track read it. Shared state of the view, never saved with the movie.
export const groupCtx: {
  /** The id of the open group that receives new tracks and content, or null for the top level. */
  target: () => string | null;
  /** The block inside a group that is picked (outlined on the Timeline, edited by the Stage's box); its outermost group stays the selection. Set it through `engine.pick` or `engine.select`. */
  picked: string | null;
} = { target: () => null, picked: null };
