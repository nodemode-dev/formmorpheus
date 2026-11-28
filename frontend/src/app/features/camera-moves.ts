import type { FeatureKit } from '../feature-kit';
import type { Command } from '../../ui/commands';
import { applyCameraMove, moveSpan, type CameraMoveId, type WorldBox } from '../../engine/camera-moves';
import { canvasOf } from '../../engine/canvas';
import { locate } from '../../engine/model';
import { stageBox } from '../../engine/shape-ops';
import { fontEpoch, layoutText } from '../../engine/text-layout';
import { TRANSITION_KINDS } from '../../engine/transitions';
import { apply, worldMatrix } from '../../engine/transform';
import type { Content, Movie, TransitionKind } from '../../engine/types';
import { hugBox, inkIndex, stageMovie } from '../../ui/stage-world';
import { el, q, setClass, setDisabled, setText, setTitle } from '../../ui/dom';
import { t } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { tf } from '../../ui/i18n-fill';
import '../../styles/camera-moves.css';

interface MoveDef { id: CameraMoveId; label: string; tile?: string; tip: string }

const MOVES: ReadonlyArray<MoveDef> = [
  { id: 'push-in', label: 'Push In', tip: 'The camera moves closer to the middle of the frame.' },
  { id: 'pull-out', label: 'Pull Out', tip: 'The camera moves back and shows more.' },
  { id: 'pan-left', label: 'Pan Left', tip: 'The camera turns to look left.' },
  { id: 'pan-right', label: 'Pan Right', tip: 'The camera turns to look right.' },
  { id: 'tilt-up', label: 'Tilt Up', tip: 'The camera tips to look up.' },
  { id: 'tilt-down', label: 'Tilt Down', tip: 'The camera tips to look down.' },
  { id: 'push-selection', label: 'Push In on Selection', tip: 'The camera moves in until the selected content fills the frame.' },
  { id: 'whip-pan', label: 'Whip Pan', tip: 'The camera swings in fast from the side and settles.' },
  { id: 'drift', label: 'Slow Drift', tip: 'The camera floats a little, as if held by hand.' },
  { id: 'shake', label: 'Shake', tip: 'The camera shakes hard, then calms down.' },
  { id: 'reset', label: 'Reset Camera Here', tile: 'Reset Camera', tip: 'The camera goes back to the whole frame.' },
];

const LENGTHS: ReadonlyArray<number> = [0.5, 1, 2, 4];
const STORE = 'formmorpheus.camera-moves';

const TRANS_TIPS: Record<TransitionKind, string> = {
  crossfade: 'The first block fades out while the next fades in.',
  dip: 'The picture fades to a color, then the next block fades in.',
  wipe: 'An edge sweeps across and reveals the next block.',
  push: 'The next block slides in and pushes the first one out.',
};

const SCENE = '<rect class="fm-cmv-sky" x="0" y="0" width="64" height="40"/><circle class="fm-cmv-sun" cx="50" cy="10" r="4"/><path class="fm-cmv-hill" d="M0 30 Q16 22 32 28 T64 26 V40 H0 Z"/><path class="fm-cmv-tree" d="M12 29 V22 M8.5 24 L12 17 L15.5 24 Z"/>';
const FIGURE = '<g class="fm-cmv-fig"><circle cx="36" cy="20.5" r="2"/><path d="M34.3 23.2 h3.4 v5 h-3.4 Z"/></g>';

function moveArt(id: CameraMoveId): string {
  const lines = id === 'whip-pan' ? '<g class="fm-cmv-speed"><path d="M4 14 H20 M2 20 H16 M5 26 H19"/></g>' : '';
  return `<svg class="fm-cmv-art" viewBox="0 0 64 40" aria-hidden="true" focusable="false">${SCENE}${FIGURE}${lines}<rect class="fm-cmv-ghost is-${id}" x="10" y="6" width="44" height="27" rx="1.5"/><rect class="fm-cmv-cam is-${id}" x="10" y="6" width="44" height="27" rx="1.5"/></svg>`;
}

function transArt(kind: TransitionKind): string {
  const a = '<g class="fm-cmv-a"><rect x="0" y="0" width="64" height="40"/><circle cx="22" cy="20" r="8"/></g>';
  const b = '<g class="fm-cmv-b"><rect x="0" y="0" width="64" height="40"/><path d="M36 30 L46 12 L56 30 Z"/></g>';
  const dip = kind === 'dip' ? '<rect class="fm-cmv-dip" x="0" y="0" width="64" height="40"/>' : '';
  return `<svg class="fm-cmv-art is-${kind}" viewBox="0 0 64 40" aria-hidden="true" focusable="false"><defs><clipPath id="fm-cmv-clip-${kind}"><rect x="0" y="0" width="64" height="40"/></clipPath></defs><g clip-path="url(#fm-cmv-clip-${kind})">${a}${b}${dip}</g></svg>`;
}

function loadLength(): number {
  try {
    const v = Number(JSON.parse(localStorage.getItem(STORE) ?? '{}').length);
    return LENGTHS.includes(v) ? v : 2;
  } catch { return 2; }
}

export function installCameraMoves(kit: FeatureKit): void {
  const { engine, commands } = kit;
  let seconds = loadLength();
  const ink = inkIndex((id) => kit.renderer.bitmap(id, 0.01));

  /** What one content draws at the Playhead, as a box in movie pixels with the camera left out. */
  const boxOfContent = (m: Movie, c: Content, frame: number): WorldBox | null => {
    let r: [number, number, number, number] | null = null;
    const sb = stageBox(c, frame, m);
    const at = (b: { w: number; h: number; cx: number; cy: number }): [number, number, number, number] => {
      const x = m.width / 2 + b.cx, y = m.height / 2 + b.cy;
      return [x - b.w / 2, y - b.h / 2, x + b.w / 2, y + b.h / 2];
    };
    if (sb) r = at(sb);
    else if (c.kind === 'group' || c.kind === 'drawing' || c.kind === 'flipbook') {
      const h = hugBox(m, c, frame, ink, fontEpoch());
      if (h) r = at(h);
      else { const k = canvasOf(c, m); r = [k.x, k.y, k.x + k.w, k.y + k.h]; }
    } else if ((c.kind === 'image' || c.kind === 'video') && c.asset && m.assets[c.asset]) {
      const a = m.assets[c.asset];
      r = [(m.width - a.width) / 2, (m.height - a.height) / 2, (m.width + a.width) / 2, (m.height + a.height) / 2];
    } else if (c.kind === 'text' && c.text) {
      const k = layoutText(c.text, m).inner;
      r = [k.x, k.y, k.x + k.w, k.y + k.h];
    }
    if (!r) return null;
    const bare = stageMovie(m, true);
    const mat = worldMatrix(bare, c, frame);
    const out: WorldBox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const [u, v] of [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]) {
      const [x, y] = apply(mat, u, v);
      out.x0 = Math.min(out.x0, x); out.y0 = Math.min(out.y0, y); out.x1 = Math.max(out.x1, x); out.y1 = Math.max(out.y1, y);
    }
    return Number.isFinite(out.x0) && out.x1 > out.x0 && out.y1 > out.y0 ? out : null;
  };

  const selectionBox = (): WorldBox | null => {
    const m = engine.movie;
    if (!m) return null;
    let acc: WorldBox | null = null;
    for (const id of engine.selection.content) {
      const c = locate(m, id)?.content;
      if (!c || c.kind === 'audio') continue;
      const b = boxOfContent(m, c, engine.frame);
      if (!b) continue;
      acc = acc ? { x0: Math.min(acc.x0, b.x0), y0: Math.min(acc.y0, b.y0), x1: Math.max(acc.x1, b.x1), y1: Math.max(acc.y1, b.y1) } : b;
    }
    return acc;
  };

  const frames = (m: Movie): number => Math.max(1, Math.round(seconds * m.fps));
  const room = (): boolean => { const m = engine.movie; return !!m && !!moveSpan(m, engine.frame, frames(m)); };
  const can = (id: CameraMoveId): boolean => room() && (id !== 'push-selection' || engine.selection.content.length > 0);

  let endOnce: (() => void) | null = null;
  /** Plays the stretch once and puts the Playhead back where the move starts; a stop by the person ends it there. */
  const playOnce = (from: number, to: number): void => {
    endOnce?.();
    const back = from;
    let prev = from;
    const offs: Array<() => void> = [];
    const finish = (restore: boolean): void => {
      for (const off of offs) off();
      offs.length = 0;
      endOnce = null;
      if (restore) { engine.stop(); engine.seek(back); }
    };
    endOnce = () => finish(false);
    engine.seek(from);
    offs.push(engine.on('time', (f) => { if (f >= to || f < prev) { finish(true); return; } prev = f; }));
    offs.push(engine.on('playing', (on) => { if (!on) finish(false); }));
    engine.play();
  };

  const run = (def: MoveDef): void => {
    const m = engine.movie;
    if (!m) return;
    endOnce?.();
    if (engine.playing) engine.stop();
    const n = frames(m), from = engine.frame;
    const span = moveSpan(m, from, n);
    if (!span) { engine.notice('There is no room for a camera move after the Playhead.', 'error'); return; }
    let target: WorldBox | null = null;
    if (def.id === 'push-selection') {
      target = selectionBox();
      if (!target) { engine.notice('Select something to push in on.', 'error'); return; }
    }
    if (!engine.run(`Camera Move: ${def.label}`, (mv) => applyCameraMove(mv, def.id, from, n, target))) return;
    engine.notice('{move} written from the Playhead', 'info', { move: t(def.label) });
    playOnce(span.f0, span.f1);
  };

  const moveCmds: Command[] = MOVES.map((def) => ({
    id: `camera-move-${def.id}`,
    label: def.id === 'reset' ? 'Reset Camera Here' : `Camera Move: ${def.label}`,
    icon: 'camera',
    group: 'Camera',
    description: def.tip,
    when: 'Use when the person wants a ready-made camera move written as camera keys from the Playhead.',
    mutates: true,
    enabled: () => can(def.id),
    run: () => run(def),
  }));
  commands.add(...moveCmds);
  kit.menu('Movie', ['-', { label: 'Camera Moves', items: moveCmds.map((c) => c.id) }]);

  // ---- the section ----
  const sec = el<HTMLElement>('<div class="fm-cmv"></div>');
  const head = (label: string): HTMLElement => { const h = el<HTMLElement>('<div class="fm-build-sec"></div>'); setText(h, t(label)); return h; };
  const note = (label: string): HTMLElement => { const n = el<HTMLElement>('<p class="fm-build-note"></p>'); setText(n, t(label)); return n; };

  const lenRow = el<HTMLElement>('<div class="fm-cmv-len" role="group"><span class="fm-cmv-lenlabel"></span><span class="fm-cmv-seg"></span></div>');
  setText(q(lenRow, '.fm-cmv-lenlabel'), t('Length'));
  lenRow.setAttribute('aria-label', t('Length'));
  const seg = q(lenRow, '.fm-cmv-seg');
  const lenBtns = LENGTHS.map((s) => {
    const b = el<HTMLButtonElement>('<button class="fm-cmv-segbtn" type="button" aria-pressed="false"></button>');
    const n = s.toLocaleString(document.documentElement.lang || undefined);
    setText(b, tf('{n} s', { n }));
    b.title = s === 1 ? t('1 second') : tf('{n} seconds', { n });
    b.addEventListener('click', () => {
      seconds = s;
      try { localStorage.setItem(STORE, JSON.stringify({ length: s })); } catch { /* this session only */ }
      patch();
    });
    seg.appendChild(b);
    return { s, b };
  });

  const moveTiles = el<HTMLElement>('<div class="fm-build-tiles fm-cmv-tiles" role="group"></div>');
  moveTiles.setAttribute('aria-label', t('Camera moves'));
  const moveNodes = MOVES.map((def) => {
    const b = el<HTMLButtonElement>(`<button class="fm-build-tile fm-cmv-tile" type="button"><span class="fm-build-thumb fm-cmv-thumb">${moveArt(def.id)}</span><span class="fm-cmv-name"></span></button>`);
    setText(q(b, '.fm-cmv-name'), t(def.tile ?? def.label));
    b.addEventListener('click', () => { if (!b.disabled) commands.run(`camera-move-${def.id}`); });
    moveTiles.appendChild(b);
    return { def, b };
  });
  const moveNote = el<HTMLElement>('<p class="fm-build-note fm-cmv-status is-two"></p>');

  const transTiles = el<HTMLElement>('<div class="fm-build-tiles fm-cmv-tiles" role="group"></div>');
  transTiles.setAttribute('aria-label', t('Transitions'));
  const transNodes = TRANSITION_KINDS.map((k) => {
    const id = `group-transition-${k.id}`;
    const b = el<HTMLButtonElement>(`<button class="fm-build-tile fm-cmv-tile" type="button"><span class="fm-build-thumb fm-cmv-thumb">${transArt(k.id)}</span><span class="fm-cmv-name"></span></button>`);
    setText(q(b, '.fm-cmv-name'), t(k.label));
    b.title = t(TRANS_TIPS[k.id]);
    b.addEventListener('click', () => { if (!b.disabled) commands.run(id); });
    transTiles.appendChild(b);
    return { id, b };
  });
  const noneRow = el<HTMLButtonElement>(`<button class="fm-build-row fm-cmv-none" type="button"><span class="fm-build-rowicon">${icon('remove', 18)}</span><span class="fm-build-rowlabel"></span></button>`);
  setText(q(noneRow, '.fm-build-rowlabel'), t('Remove Transition'));
  noneRow.addEventListener('click', () => { if (!noneRow.disabled) commands.run('group-transition-none'); });
  const transStatus = el<HTMLElement>('<p class="fm-build-note fm-cmv-status"></p>');

  sec.append(
    head('Camera moves'), moveNote, lenRow, moveTiles,
    head('Transitions'), transTiles, noneRow, transStatus,
    note('For two blocks side by side on a track, right-click the second block and choose Transition.'),
  );

  const enabledId = (id: string): boolean => { const c = commands.get(id); return !!c && commands.enabled(c); };

  function patch(): void {
    for (const { s, b } of lenBtns) {
      const on = s === seconds;
      setClass(b, 'is-on', on);
      if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
    }
    const hasRoom = room();
    for (const { def, b } of moveNodes) {
      setDisabled(b, !enabledId(`camera-move-${def.id}`));
      setTitle(b, def.id === 'push-selection' && hasRoom && !engine.selection.content.length ? `${t(def.tip)} ${t('Select something first.')}` : t(def.tip));
    }
    setText(moveNote, !engine.movie || hasRoom
      ? t('A move writes camera keys from the Playhead and plays once. Undo takes it back.')
      : t('Move the Playhead earlier: a move needs room after it.'));
    let any = false;
    for (const { id, b } of transNodes) { const on = enabledId(id); any = any || on; setDisabled(b, !on); }
    setDisabled(noneRow, !enabledId('group-transition-none'));
    setText(transStatus, any
      ? t('A transition goes between two touching blocks inside the selected group, at the cut nearest the Playhead.')
      : t('Select a group with two touching blocks inside it, and put the Playhead near where they meet.'));
  }

  kit.buildSection('camera', sec, patch);
}
