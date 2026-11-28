import type { FeatureKit } from '../feature-kit';
import { mergeRebuild, prepareRebuild, viewOf, type CastSpec, type CastView } from '../../engine/cast';
import type { Content } from '../../engine/types';
import { selectedBuilt } from '../../ui/character-commands';
import { FLIP_ICON, VIEW_ICON, VIEW_LABEL } from '../../ui/character-builder';
import { el, q, setClass, setDisabled, setText } from '../../ui/dom';
import { t } from '../../ui/i18n';
import { tf } from '../../ui/i18n-fill';
import { toast } from '../../ui/toast';

const IDS: Record<CastView, string> = { front: 'character.view-front', three: 'character.view-three', side: 'character.view-side', back: 'character.view-back' };
const FLIP = 'character.view-flip';
const LABEL: Record<CastView, string> = { front: 'View Front', three: 'View Three-Quarter', side: 'View Side', back: 'View Back' };
const ORDER: CastView[] = ['front', 'three', 'side', 'back'];

export function installCharacterViews(kit: FeatureKit): void {
  const { engine, renderer } = kit;
  let busy = false;

  const current = (): Content | null => selectedBuilt(engine);

  /** Rebuilds the selected built character from its recipe with another view or flip, in place, as one undo step: the
   *  slow build first, then the merge inside the step against the movie as it is then. */
  const turn = async (next: (s: CastSpec) => CastSpec, done: (name: string) => string): Promise<void> => {
    const g = current(), spec = g?.character?.build, m = engine.movie;
    if (!g || !spec || !m || busy) return;
    busy = true;
    try {
      const want = next(structuredClone(spec));
      const prep = await prepareRebuild(want, m);
      for (const { asset, blob } of prep.assets) if (!engine.assets.has(asset.id)) engine.assets.set(asset.id, blob);
      const pics = new Map<string, Blob>();
      for (const { asset, blob } of prep.assets) if (asset.kind === 'image' || asset.kind === 'pixels') pics.set(asset.id, blob);
      await renderer.preload(pics);
      const ok = engine.run('Character View', (mv) => ({ movie: mergeRebuild(mv, g.id, prep).movie, select: [g.id] }));
      if (ok) toast(done(want.name));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('The character could not be built.'), 'error');
    } finally { busy = false; }
  };

  const setView = (v: CastView): Promise<void> => turn((s) => {
    if (v === 'front') delete s.view; else s.view = v;
    return s;
  }, (name) => tf('{name} now shows the {view} view.', { name, view: t(VIEW_LABEL[v]) }));

  const flip = (): Promise<void> => turn((s) => {
    if (s.flip) delete s.flip; else s.flip = true;
    return s;
  }, (name) => tf('{name} flipped.', { name }));

  for (const v of ORDER) {
    kit.commands.add({
      id: IDS[v], label: LABEL[v], icon: 'character', mutates: true,
      enabled: () => !!current(),
      checked: () => { const s = current()?.character?.build; return !!s && viewOf(s) === v; },
      group: 'Content',
      description: `Turns the selected character made in the Character Builder to its ${VIEW_LABEL[v].toLowerCase()} view, keeping its place, keyframes, actions and lip-sync.`,
      when: 'Use when a built character should face another way on the Stage.',
      run: () => { void setView(v); },
    });
  }
  kit.commands.add({
    id: FLIP, label: 'Flip Character', icon: 'character', mutates: true,
    enabled: () => !!current(),
    checked: () => current()?.character?.build?.flip === true,
    group: 'Content',
    description: 'Mirrors the selected character made in the Character Builder so it looks the other way, keeping its place, keyframes, actions and lip-sync.',
    when: 'Use when a built character should look left instead of right, or right instead of left.',
    run: () => { void flip(); },
  });

  const ids = [...ORDER.map((v) => IDS[v]), FLIP];
  kit.menu('Content', [{ label: 'Character View', items: [IDS.front, IDS.three, IDS.side, IDS.back, '-', FLIP] }]);
  kit.contentMenu(ids);

  const sec = el<HTMLElement>('<section class="fm-cv"><div class="fm-build-sec"></div><p class="fm-build-note"></p><div class="fm-build-rows" role="group"></div></section>');
  const head = q(sec, '.fm-build-sec'), note = q(sec, '.fm-build-note'), rows = q(sec, '.fm-build-rows');
  const btns = new Map<string, HTMLButtonElement>();
  const glyph: Record<string, string> = { ...Object.fromEntries(ORDER.map((v) => [IDS[v], VIEW_ICON[v]])), [FLIP]: FLIP_ICON };
  for (const id of ids) {
    const b = el<HTMLButtonElement>(`<button class="fm-build-row" type="button" aria-pressed="false"><span class="fm-build-rowicon">${glyph[id]}</span><span class="fm-build-rowlabel"></span></button>`);
    b.dataset.cmd = id;
    rows.appendChild(b);
    btns.set(id, b);
  }
  rows.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.fm-build-row');
    if (b && !b.disabled && b.dataset.cmd) kit.commands.run(b.dataset.cmd);
  });
  const patch = (): void => {
    const g = current(), s = g?.character?.build;
    setText(head, t('Character view'));
    setText(note, s ? t('Turn the selected character, or flip it to look the other way. Its keyframes and actions stay.') : t('Select a character made in the Character Builder to turn it to the front, three-quarter, side or back.'));
    for (const [id, b] of btns) {
      const v = ORDER.find((x) => IDS[x] === id);
      setText(q(b, '.fm-build-rowlabel'), t(v ? VIEW_LABEL[v] : 'Flip'));
      const on = !!s && (v ? viewOf(s) === v : s.flip === true);
      setDisabled(b, !s);
      setClass(b, 'is-on', on);
      if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
    }
  };
  kit.buildSection('characters', sec, patch);
}
