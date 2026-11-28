import type { FeatureKit } from '../feature-kit';
import { focusedScene, freeSceneName, sceneAt, sceneSpan, scenesOf } from '../../engine/scene-marks';
import { addEmptyAfter, addSceneAt, deleteCut, deleteScene, duplicateScene, focusScene, moveScene, renameScene, sceneStart } from '../../engine/scene-ops';
import type { Movie } from '../../engine/types';
import { tf } from '../../ui/i18n-fill';
import { SceneStrip, type SceneAct } from '../../ui/scene-strip';

const EMPTY_SECONDS = 3;

const IDS: Record<SceneAct, string> = {
  go: 'scene-go', rename: 'scene-rename', focus: 'scene-focus', duplicate: 'scene-duplicate', earlier: 'scene-earlier', later: 'scene-later',
  'add-after': 'scene-add-after', 'delete-cut': 'scene-delete-cut', delete: 'scene-delete',
};

export function installSceneStrip(kit: FeatureKit): void {
  const { engine, commands } = kit;
  const sceneName = (n: number): string => tf('Scene {n}', { n });
  const here = (): string => { const m = engine.movie; return m ? sceneAt(m, engine.frame)?.mark.id ?? '' : ''; };
  const target = (p?: Record<string, unknown>): string => (typeof p?.scene === 'string' ? p.scene : here());

  const can = (act: SceneAct, id: string): boolean => {
    const m = engine.movie;
    if (!m) return false;
    const list = scenesOf(m);
    const i = list.findIndex((s) => s.id === id);
    if (i < 0) return false;
    if (act === 'earlier') return i > 0;
    if (act === 'later') return i < list.length - 1;
    if (act === 'delete-cut') return i > 0 || list.length === 1;
    if (act === 'delete') return list.length > 1;
    return true;
  };
  const checked = (act: SceneAct, id: string): boolean => {
    const m = engine.movie;
    return act === 'focus' && !!m && focusedScene(m)?.mark.id === id;
  };
  const goTo = (id: string): void => {
    const m = engine.movie;
    if (!m) return;
    engine.stop();
    engine.seek(sceneStart(m, id));
  };
  const change = (label: string, id: string, fn: (m: Movie) => Movie, follow?: () => string): void => {
    engine.stop();
    if (!engine.run(label, fn)) return;
    const to = follow ? follow() : id;
    if (to) goTo(to);
  };

  const run = (act: SceneAct, id: string): void => {
    const m = engine.movie;
    if (!m || !can(act, id)) return;
    if (act === 'go') { goTo(id); return; }
    if (act === 'rename') { strip.rename(id); return; }
    if (act === 'focus') {
      if (checked('focus', id)) {
        engine.run('Show Whole Movie', (mv) => focusScene(mv, null));
        commands.run('timeline-fit');
      } else {
        engine.run('Focus on Scene', (mv) => focusScene(mv, id));
        goTo(id);
        commands.run('timeline-zoom-loop');
      }
      return;
    }
    if (act === 'duplicate') {
      const name = tf('{name} copy', { name: sceneSpan(m, id)?.mark.name ?? '' });
      let made = '';
      change('Duplicate Scene', id, (mv) => { const r = duplicateScene(mv, id, name); made = r.id; return r.movie; }, () => made);
      return;
    }
    if (act === 'earlier' || act === 'later') { change(act === 'earlier' ? 'Move Scene Earlier' : 'Move Scene Later', id, (mv) => moveScene(mv, id, act === 'earlier' ? -1 : 1)); return; }
    if (act === 'add-after') {
      let made = '';
      const name = freeSceneName(m, sceneName);
      change('Add Empty Scene', id, (mv) => { const r = addEmptyAfter(mv, id, Math.round(mv.fps * EMPTY_SECONDS), name); made = r.id; return r.movie; }, () => made);
      return;
    }
    if (act === 'delete-cut') {
      const i = scenesOf(m).findIndex((s) => s.id === id);
      const before = i > 0 ? scenesOf(m)[i - 1].id : '';
      change('Delete Cut', id, (mv) => deleteCut(mv, id), () => before);
      return;
    }
    if (act === 'delete') {
      const list = scenesOf(m);
      const i = list.findIndex((s) => s.id === id);
      const next = list[i + 1]?.id ?? list[i - 1]?.id ?? '';
      change('Delete Scene', id, (mv) => deleteScene(mv, id), () => next);
    }
  };

  const addAtPlayhead = (): void => {
    let made = '';
    if (engine.run('New Scene', (m) => { const r = addSceneAt(m, engine.frame, sceneName); made = r.id; return r.movie; })) {
      requestAnimationFrame(() => strip.rename(made));
    }
  };

  const strip = new SceneStrip(engine, kit.renderer, {
    can, checked, run,
    rename: (id, name) => { if (engine.movie && sceneSpan(engine.movie, id)) engine.run('Rename Scene', (m) => renameScene(m, id, name)); },
    addAtPlayhead,
  });
  const host = kit.root.querySelector<HTMLElement>('.fm-tl-host');
  if (host) { host.classList.add('has-scene-strip'); host.prepend(strip.root); }

  const canNew = (): boolean => { const m = engine.movie; return !!m && !scenesOf(m).some((s) => s.start === engine.frame); };
  const step = (dir: 1 | -1): void => {
    const m = engine.movie;
    if (!m) return;
    const list = scenesOf(m);
    const i = list.findIndex((s) => s.id === here());
    const to = list[i + dir];
    if (to) goTo(to.id);
  };
  const has = (): boolean => !!engine.movie && scenesOf(engine.movie).length > 0;

  const LABELS: Record<SceneAct, string> = {
    go: 'Go to Scene Start', rename: 'Rename Scene', focus: 'Focus on Scene', duplicate: 'Duplicate Scene', earlier: 'Move Scene Earlier', later: 'Move Scene Later',
    'add-after': 'Add Empty Scene After', 'delete-cut': 'Delete Cut, Keep Content', delete: 'Delete Scene and Content',
  };
  const ICONS: Record<SceneAct, string> = {
    go: 'play', rename: 'rename', focus: 'eye', duplicate: 'duplicate', earlier: 'chevronLeft', later: 'chevronRight', 'add-after': 'plus', 'delete-cut': 'cut', delete: 'trash',
  };
  commands.add(
    { id: 'scene-new', label: 'New Scene at Playhead', icon: 'clapper', enabled: canNew, run: addAtPlayhead, group: 'Scenes', mutates: true, description: 'Cuts the movie into scenes at the Playhead.' },
    { id: 'scene-prev', label: 'Previous Scene', icon: 'chevronLeft', enabled: () => has() && scenesOf(engine.movie as Movie).findIndex((s) => s.id === here()) > 0, run: () => step(-1), group: 'Scenes' },
    { id: 'scene-next', label: 'Next Scene', icon: 'chevronRight', enabled: () => { if (!has()) return false; const l = scenesOf(engine.movie as Movie); return l.findIndex((s) => s.id === here()) < l.length - 1; }, run: () => step(1), group: 'Scenes' },
    ...(Object.keys(IDS) as SceneAct[]).map((act) => ({
      id: IDS[act], label: LABELS[act], icon: ICONS[act], group: 'Scenes', mutates: act !== 'go',
      params: { scene: { type: 'string' as const, description: 'The scene id; the scene at the Playhead when left out.' } },
      enabled: () => can(act, here()),
      checked: act === 'focus' ? () => checked('focus', here()) : undefined,
      run: (p?: Record<string, unknown>) => run(act, target(p)),
    })),
  );
  kit.menu('Movie', ['-', { label: 'Scenes', items: ['scene-new', 'scene-prev', 'scene-next', '-', 'scene-go', 'scene-rename', 'scene-focus', '-', 'scene-duplicate', 'scene-earlier', 'scene-later', 'scene-add-after', '-', 'scene-delete-cut', 'scene-delete'] }]);
}
