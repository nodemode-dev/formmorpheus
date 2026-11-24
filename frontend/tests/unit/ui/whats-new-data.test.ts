import { describe, expect, it } from 'vitest';
import { RELEASES } from '@src/ui/whats-new-data';

const parts = (v: string): number[] => v.split('.').map(Number);
const compare = (a: string, b: string): number => {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

describe('RELEASES', () => {
  it('has at least one release', () => {
    expect(RELEASES.length).toBeGreaterThan(0);
  });

  it('uses a plain three part version number for every release', () => {
    for (const r of RELEASES) expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('lists releases newest first with no version twice', () => {
    for (let i = 1; i < RELEASES.length; i++) {
      expect(compare(RELEASES[i - 1].version, RELEASES[i].version), `${RELEASES[i - 1].version} before ${RELEASES[i].version}`).toBeGreaterThan(0);
    }
  });

  it('gives every release a name and at least one addition', () => {
    for (const r of RELEASES) {
      expect(r.name.trim(), r.version).not.toBe('');
      expect(r.additions.length, r.version).toBeGreaterThan(0);
    }
  });

  it('gives every addition a title, a text and a command to run', () => {
    for (const r of RELEASES) {
      for (const a of r.additions) {
        expect(a.title.trim(), r.version).not.toBe('');
        expect(a.text.trim(), r.version).not.toBe('');
        expect(a.command, `${r.version} ${a.title}`).toMatch(/^\S+$/);
      }
    }
  });

  it('does not repeat an addition title within one release', () => {
    for (const r of RELEASES) {
      const titles = r.additions.map((a) => a.title);
      expect(new Set(titles).size, r.version).toBe(titles.length);
    }
  });
});
