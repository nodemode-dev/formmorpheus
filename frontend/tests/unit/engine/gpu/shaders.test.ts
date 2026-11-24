import { describe, expect, it } from 'vitest';
import * as shaders from '@src/engine/gpu/shaders';
import { FS_ADJUST } from '@src/engine/gpu/shaders-shape';
import { FS_TMASK } from '@src/engine/gpu/tree';

const sources: [string, string][] = [
  ...Object.entries(shaders).filter((e): e is [string, string] => typeof e[1] === 'string' && /^(VS|FS)_/.test(e[0])),
  ['FS_ADJUST', FS_ADJUST],
  ['FS_TMASK', FS_TMASK],
];

const count = (s: string, ch: string): number => s.split(ch).length - 1;

describe('shader sources', () => {
  it('finds the shader table', () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it('puts the version directive on the very first line of the shared head', () => {
    expect(shaders.HEAD.split('\n')[0]).toBe('#version 300 es');
    expect(shaders.HEAD).toContain('precision highp float;');
    expect(shaders.HEAD.endsWith('\n')).toBe(true);
  });

  it.each(sources)('%s starts with the head and has one entry point', (_name, src) => {
    expect(src.startsWith(shaders.HEAD)).toBe(true);
    expect(src.match(/void\s+main\s*\(/g)).toHaveLength(1);
    expect(count(src, '#version')).toBe(1);
  });

  it.each(sources)('%s has balanced braces and brackets', (_name, src) => {
    expect(count(src, '{')).toBe(count(src, '}'));
    expect(count(src, '(')).toBe(count(src, ')'));
    expect(count(src, '[')).toBe(count(src, ']'));
  });

  it.each(sources.filter(([n]) => n.startsWith('FS_')))('%s declares an output colour', (_name, src) => {
    expect(src).toMatch(/out\s+vec4\s+\w+\s*;/);
  });

  it.each(sources.filter(([n]) => n.startsWith('VS_')))('%s writes a position', (_name, src) => {
    expect(src).toContain('gl_Position');
  });

  it('declares every uniform the adjustment mix reads', () => {
    for (const u of ['uF', 'uW', 'uHasW', 'uOp', 'uPass']) expect(FS_ADJUST).toMatch(new RegExp(`uniform\\s+\\w+\\s+${u};`));
  });

  it('declares every uniform the tree mask pass sets', () => {
    for (const u of ['uMask', 'uSize', 'uKind', 'uInvert', 'uScale']) expect(FS_TMASK).toMatch(new RegExp(`uniform\\s+\\w+\\s+${u};`));
  });
});
