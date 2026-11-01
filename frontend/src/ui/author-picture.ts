// "Picture in the Theater": the artist's own picture for a movie, chosen from a file and kept small inside the movie.

const SIDE = 192;

/** Opens the file chooser; resolves to a square data URL (192 px, cropped to fill) or null when nothing usable was chosen. */
export function pickAuthorPicture(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
    input.addEventListener('change', () => { const f = input.files?.[0]; if (!f) { resolve(null); return; } void squareDataUrl(f).then(resolve, () => resolve(null)); });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export async function squareDataUrl(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = SIDE; c.height = SIDE;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, SIDE, SIDE);
  bmp.close();
  return c.toDataURL('image/webp', 0.85);
}
