import { describe, expect, it } from 'vitest';
import { poseAt, removeCamera, setCameraFollow, setCameraShake, setTrackDepth, setTrackScreen } from '@src/engine/camera';
import { content, newMovie, track } from '@src/engine/model';
import { OpError } from '@src/engine/ops';
import { CAMERA_REST } from '@src/engine/transform';
import type { Movie } from '@src/engine/types';

function setup(): { movie: Movie; trackId: string; contentId: string } {
  const c = content('solid', 0, 10);
  const t = track('A', [c]);
  return { movie: { ...newMovie(), tracks: [t, track('B')] }, trackId: t.id, contentId: c.id };
}

describe('camera settings', () => {
  it('rests when the movie has no camera', () => {
    expect(poseAt(setup().movie, 12)).toEqual(CAMERA_REST);
  });

  it('stores a shake with negative values floored at zero and a whole seed', () => {
    const m = setCameraShake(setup().movie, { amp: -3, freq: 2.5, seed: 7.9 });
    expect(m.camera?.shake).toEqual({ amp: 0, freq: 2.5, seed: 7 });
    expect(m.camera?.keys).toEqual([]);
  });

  it('drops the whole camera when the shake was all it held', () => {
    const { movie } = setup();
    const on = setCameraShake(movie, { amp: 4, freq: 2, seed: 1 });
    const off = setCameraShake(on, null);
    expect('camera' in off).toBe(false);
    expect(setCameraShake(movie, null)).toBe(movie);
  });

  it('keeps the follow when the shake is turned off', () => {
    const { movie, contentId } = setup();
    const both = setCameraShake(setCameraFollow(movie, { id: contentId, amount: 0.5 }), { amp: 4, freq: 2, seed: 1 });
    const off = setCameraShake(both, null);
    expect(off.camera?.shake).toBeUndefined();
    expect(off.camera?.follow).toEqual({ id: contentId, amount: 0.5 });
  });

  it('clamps the follow amount to 0 to 1', () => {
    const { movie, contentId } = setup();
    expect(setCameraFollow(movie, { id: contentId, amount: 9 }).camera?.follow?.amount).toBe(1);
    expect(setCameraFollow(movie, { id: contentId, amount: -2 }).camera?.follow?.amount).toBe(0);
  });

  it('refuses to follow content that is not in the movie', () => {
    expect(() => setCameraFollow(setup().movie, { id: 'ghost', amount: 1 })).toThrow(OpError);
  });

  it('stops following and removes an otherwise empty camera', () => {
    const { movie, contentId } = setup();
    const off = setCameraFollow(setCameraFollow(movie, { id: contentId, amount: 1 }), null);
    expect('camera' in off).toBe(false);
    expect(setCameraFollow(movie, null)).toBe(movie);
  });

  it('removes the camera and leaves a movie without one untouched', () => {
    const { movie } = setup();
    expect(removeCamera(movie)).toBe(movie);
    expect('camera' in removeCamera(setCameraShake(movie, { amp: 1, freq: 1, seed: 1 }))).toBe(false);
  });
});

describe('track camera options', () => {
  it('rounds the depth to two decimals and clamps it to 0 to 4', () => {
    const { movie, trackId } = setup();
    expect(setTrackDepth(movie, trackId, 0.456).tracks[0].depth).toBe(0.46);
    expect(setTrackDepth(movie, trackId, 99).tracks[0].depth).toBe(4);
    expect(setTrackDepth(movie, trackId, -1).tracks[0].depth).toBe(0);
    expect(setTrackDepth(movie, trackId, 2).tracks[1].depth).toBeUndefined();
  });

  it('stores no depth at the neutral value of one', () => {
    const { movie, trackId } = setup();
    const back = setTrackDepth(setTrackDepth(movie, trackId, 2), trackId, 1.001);
    expect('depth' in back.tracks[0]).toBe(false);
  });

  it('pins a track to the screen and releases it again', () => {
    const { movie, trackId } = setup();
    const on = setTrackScreen(movie, trackId, true);
    expect(on.tracks[0].screen).toBe(true);
    expect('screen' in setTrackScreen(on, trackId, false).tracks[0]).toBe(false);
  });

  it('refuses a track that does not exist', () => {
    const { movie } = setup();
    expect(() => setTrackDepth(movie, 'ghost', 1)).toThrow(OpError);
    expect(() => setTrackScreen(movie, 'ghost', true)).toThrow(OpError);
  });
});
