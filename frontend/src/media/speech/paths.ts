// Engine addresses of the speech model files. On its own, with no import, so a worker can use it without taking the
// page's engine client along.

export const MODELS_BASE = '/api/speech-models';

/** Where the window reads one installed file of a set. */
export function fileUrl(set: 'voice' | 'listen', path: string): string {
  return `${MODELS_BASE}/${set}/file/${path.split('/').map(encodeURIComponent).join('/')}`;
}
