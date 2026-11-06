/** The brand mark next to the app name: the app icon as a raster (the glossy ribbon cannot be drawn in currentColor).
 *  Width and height are set so nothing shifts while it loads. */
export function brandMark(size: number, label = 'formmorpheus'): string {
  return `<img class="cv-mark" src="/mark.png" width="${size}" height="${size}" alt="${label}" decoding="sync">`;
}
