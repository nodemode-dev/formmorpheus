import { setTrackDepth } from '../../engine/camera';
import type { Movie, Track } from '../../engine/types';
import { el, patchList, q, setClass, setDisabled, setText } from '../../ui/dom';
import { t } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { DEPTH_STEPS, depthStepOf } from '../../ui/track-menu';
import type { FeatureKit } from '../feature-kit';
import '../../styles/depth.css';

const hasPicture = (tr: Track): boolean => tr.content.some((c) => c.kind !== 'audio');
const pictureTracks = (m: Movie): Track[] => m.tracks.filter((tr) => !tr.screen && hasPicture(tr));
const listed = (m: Movie): Track[] => m.tracks.filter(hasPicture);

/** Step indices (far to near) for n tracks, back to front: few tracks take spread-out steps, many are spaced evenly. */
const SPREAD: ReadonlyArray<readonly number[]> = [[], [3], [1, 4], [0, 3, 5], [0, 2, 3, 5], [0, 1, 3, 4, 5]];
const stepFor = (rank: number, n: number): number => (n < SPREAD.length ? SPREAD[n][rank] : Math.round((rank * (DEPTH_STEPS.length - 1)) / (n - 1)));

function withDepths(m: Movie, depths: Map<string, number>): Movie {
  let out = m;
  for (const [id, d] of depths) out = setTrackDepth(out, id, d);
  return out;
}

export function installDepth(kit: FeatureKit): void {
  const { engine, commands } = kit;

  const canSpread = (): boolean => !!engine.movie && pictureTracks(engine.movie).length > 1;
  const canFlatten = (): boolean => !!engine.movie && engine.movie.tracks.some((tr) => tr.depth !== undefined);

  const spread = (): void => {
    engine.run('Spread Tracks by Depth', (m) => {
      const picks = pictureTracks(m);
      const n = picks.length;
      const depths = new Map<string, number>();
      picks.forEach((tr, i) => depths.set(tr.id, DEPTH_STEPS[stepFor(n - 1 - i, n)].depth));
      return withDepths(m, depths);
    });
  };
  const flatten = (): void => {
    engine.run('Flatten Depth', (m) => {
      const depths = new Map<string, number>();
      for (const tr of m.tracks) if (tr.depth !== undefined) depths.set(tr.id, 1);
      return withDepths(m, depths);
    });
  };

  commands.add(
    { id: 'depth.spread', label: 'Spread Tracks by Depth', icon: 'layers', mutates: true, enabled: canSpread, run: spread,
      group: 'Camera', description: 'Gives the movie\'s picture tracks depth steps from the back (far, moves least) to the front (close, moves most) in one step.', when: 'Use when a movie has several picture tracks and the camera pan should show parallax.' },
    { id: 'depth.flatten', label: 'Flatten Depth', icon: 'layers', mutates: true, enabled: canFlatten, run: flatten,
      group: 'Camera', description: 'Sets every track back to normal depth so the camera moves them all alike.', when: 'Use to remove parallax from a movie.' },
  );
  kit.menu('Movie', ['-', 'depth.spread', 'depth.flatten']);

  const root = el<HTMLElement>(
    `<div class="fm-depth"><div class="fm-build-sec"></div><p class="fm-build-note fm-depth-what"></p>` +
    `<div class="fm-depth-list"></div><p class="fm-depth-empty"></p>` +
    `<div class="fm-build-rows"><button class="fm-build-row fm-depth-spread" type="button"><span class="fm-build-rowicon">${icon('layers', 18)}</span><span class="fm-build-rowlabel"></span></button>` +
    `<button class="fm-build-row fm-depth-flat" type="button"><span class="fm-build-rowicon">${icon('layers', 18)}</span><span class="fm-build-rowlabel"></span></button></div></div>`);
  const list = q<HTMLElement>(root, '.fm-depth-list');
  const empty = q<HTMLElement>(root, '.fm-depth-empty');
  const spreadBtn = q<HTMLButtonElement>(root, '.fm-depth-spread');
  const flatBtn = q<HTMLButtonElement>(root, '.fm-depth-flat');
  spreadBtn.addEventListener('click', () => { if (canSpread()) spread(); });
  flatBtn.addEventListener('click', () => { if (canFlatten()) flatten(); });

  const rowOf = (tr: Track): HTMLElement => {
    const row = el<HTMLElement>(`<div class="fm-depth-row"><span class="fm-depth-bar"><i></i></span><span class="fm-depth-name"></span><select class="fm-depth-pick"></select></div>`);
    const pick = q<HTMLSelectElement>(row, '.fm-depth-pick');
    for (let i = 0; i < DEPTH_STEPS.length; i++) {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = t(DEPTH_STEPS[i].name);
      pick.appendChild(o);
    }
    const custom = document.createElement('option');
    custom.value = 'custom';
    custom.hidden = true;
    pick.appendChild(custom);
    const id = tr.id;
    pick.addEventListener('change', () => {
      const i = Number(pick.value);
      if (!DEPTH_STEPS[i]) return;
      engine.run(`Depth: ${DEPTH_STEPS[i].name}`, (m) => setTrackDepth(m, id, DEPTH_STEPS[i].depth));
    });
    row.addEventListener('click', (e) => { if (e.target !== pick) engine.select([], id); });
    return row;
  };
  const updateRow = (row: HTMLElement, tr: Track): void => {
    const pick = q<HTMLSelectElement>(row, '.fm-depth-pick');
    const step = depthStepOf(tr.depth);
    const d = tr.depth ?? 1;
    setText(q(row, '.fm-depth-name'), tr.name || tr.content[0]?.name || '');
    const custom = pick.options[DEPTH_STEPS.length];
    if (step < 0) setText(custom, `${Math.round(d * 100) / 100}x`);
    const want = step >= 0 ? String(step) : 'custom';
    if (pick.value !== want) pick.value = want;
    q<HTMLElement>(row, '.fm-depth-bar > i').style.inlineSize = `${Math.round((Math.min(d, 2) / 2) * 100)}%`;
    setClass(row, 'is-selected', engine.selection.track === tr.id);
    row.title = tr.screen ? t('Fixed to the screen: depth does not apply.') : '';
    pick.disabled = !!tr.screen;
  };

  const patch = (): void => {
    const m = engine.movie;
    const tracks = m ? listed(m) : [];
    setText(q(root, '.fm-build-sec'), t('Depth'));
    setText(q(root, '.fm-depth-what'), t('Depth makes the camera move far things less and near things more, so a pan shows layers sliding past each other.'));
    setText(q(root, '.fm-depth-spread .fm-build-rowlabel'), t('Spread Tracks by Depth'));
    setText(q(root, '.fm-depth-flat .fm-build-rowlabel'), t('Flatten Depth'));
    setText(empty, t('Add pictures on two or more tracks to give them depth.'));
    patchList(list, tracks, { key: (tr) => tr.id, create: rowOf, update: updateRow });
    empty.hidden = tracks.length > 0;
    setDisabled(spreadBtn, !canSpread());
    setDisabled(flatBtn, !canFlatten());
  };

  kit.buildSection('camera', root, patch);
}
