import { describe, expect, it, vi } from 'vitest';
import { MP3_MISSING, VIDEO_TOOLS, ffmpegChip, openVideoTools } from '@src/ui/video-tools';

const listen = (): { sections: unknown[]; off: () => void } => {
  const sections: unknown[] = [];
  const fn = (e: Event): void => { sections.push((e as CustomEvent<{ section: string }>).detail.section); };
  document.addEventListener('fm:open-settings', fn);
  return { sections, off: () => document.removeEventListener('fm:open-settings', fn) };
};

describe('openVideoTools', () => {
  it('asks for Preferences opened at the Video Tools section', () => {
    const l = listen();
    openVideoTools();
    l.off();
    expect(l.sections).toEqual([VIDEO_TOOLS]);
  });
});

describe('ffmpegChip', () => {
  it('starts hidden with a notice text', () => {
    const chip = ffmpegChip(() => undefined);
    expect(chip.hidden).toBe(true);
    expect(chip.querySelector('.fm-vt-chip-text')?.textContent).not.toBe('');
  });

  it('shows a different notice when given one', () => {
    const plain = ffmpegChip(() => undefined).querySelector('.fm-vt-chip-text')?.textContent;
    const mp3 = ffmpegChip(() => undefined, MP3_MISSING).querySelector('.fm-vt-chip-text')?.textContent;
    expect(mp3).not.toBe(plain);
  });

  it('runs the caller step first and then opens Video Tools when clicked', () => {
    const order: string[] = [];
    const fn = (): void => { order.push('open'); };
    document.addEventListener('fm:open-settings', fn);
    const before = vi.fn(() => { order.push('before'); });
    ffmpegChip(before).click();
    document.removeEventListener('fm:open-settings', fn);
    expect(before).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['before', 'open']);
  });
});
