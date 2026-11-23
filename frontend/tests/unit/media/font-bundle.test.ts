import { describe, expect, it } from 'vitest';
import { extraFaces, extraKind, isExtraFamily, loadExtraFace, scriptFamilies } from '@src/media/font-bundle';

describe('bundled families', () => {
  it('knows a bundled family and refuses an unknown one', () => {
    expect(isExtraFamily('Lora')).toBe(true);
    expect(isExtraFamily('No Such Family')).toBe(false);
  });

  it('lists the weights in ascending order and whether italics exist', () => {
    expect(extraFaces('Lora')).toEqual({ weights: [400, 700], italic: true });
    expect(extraFaces('Roboto Slab')).toEqual({ weights: [400, 700], italic: false });
    expect(extraFaces('Sora')).toEqual({ weights: [400, 600, 700], italic: false });
  });

  it('has no faces and no kind for an unknown family', () => {
    expect(extraFaces('No Such Family')).toBeNull();
    expect(extraKind('No Such Family')).toBe('');
  });

  it('describes the kind of a family', () => {
    expect(extraKind('Caveat')).toBe('Handwriting');
  });

  it('resolves at once for an unknown family', async () => {
    await expect(loadExtraFace('No Such Family', 400, false)).resolves.toBeUndefined();
  });
});

describe('scriptFamilies', () => {
  it('needs nothing for Latin text', () => {
    expect(scriptFamilies('Hello, world 123')).toEqual([]);
  });

  it('picks the Arabic face for Arabic text', () => {
    expect(scriptFamilies('مرحبا')).toEqual(['Noto Sans Arabic']);
  });

  it('reads Han without kana or hangul as Chinese', () => {
    expect(scriptFamilies('中文')).toEqual(['Noto Sans SC']);
  });

  it('reads Han beside kana as Japanese, once', () => {
    expect(scriptFamilies('日本語のテキスト')).toEqual(['Noto Sans JP']);
  });

  it('reads Han beside hangul as Korean, once', () => {
    expect(scriptFamilies('韓國 한국어')).toEqual(['Noto Sans KR']);
  });

  it('covers Greek and Cyrillic with one face', () => {
    expect(scriptFamilies('Ελληνικά Привет')).toEqual(['Noto Sans']);
  });

  it('lists every script found in a mixed text', () => {
    expect(scriptFamilies('สวัสดี नमस्ते')).toEqual(['Noto Sans Thai', 'Noto Sans Devanagari']);
  });
});
