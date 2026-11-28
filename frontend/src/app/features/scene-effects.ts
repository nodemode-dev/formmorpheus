import { uid } from '../../engine/model';
import { SCENE_FX, addSceneFx, newSeed, patchSceneFx, removeSceneFx, sceneFxKind } from '../../engine/scene-fx';
import type { Movie } from '../../engine/types';
import { t } from '../../ui/i18n';
import type { MenuItem } from '../../ui/menu';
import { SceneFxPanel } from '../../ui/scene-fx-panel';
import type { FeatureKit } from '../feature-kit';
import '../../styles/scene-fx.css';

const fxOf = (m: Movie | null, id: string) => m?.sceneFx?.find((x) => x.id === id);

export function installSceneEffects(kit: FeatureKit): void {
  const { engine, commands } = kit;
  let panel: SceneFxPanel | null = null;

  const add = (kind: string, amount?: number): boolean => {
    const k = sceneFxKind(kind);
    if (!k || !engine.movie) return false;
    const id = uid('sfx');
    const a = typeof amount === 'number' && Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : k.amount;
    const ok = engine.run('Add Scene Effect', (m) => addSceneFx(m, { id, kind, start: 0, end: m.duration, amount: a, seed: newSeed() }));
    if (ok) {
      engine.notice('{name} is over the whole movie. Its strength, start and end are under Effects.', 'info', { name: t(k.name) });
      panel?.reveal(id);
    }
    return ok;
  };

  const actions = {
    add: (kind: string) => { add(kind); },
    strength: (id: string, amount: number, done: boolean) => {
      engine.run('Scene Effect Strength', (m) => patchSceneFx(m, id, { amount }), `scene-fx-amount:${id}`);
      if (done) engine.endGesture();
    },
    from: (id: string) => {
      const fx = fxOf(engine.movie, id);
      if (!fx) return;
      const f = engine.frame;
      engine.run('Scene Effect Start', (m) => patchSceneFx(m, id, f >= fx.end ? { start: f, end: m.duration } : { start: f }));
    },
    to: (id: string) => {
      const fx = fxOf(engine.movie, id);
      const f = engine.frame;
      if (!fx || f <= fx.start) return;
      engine.run('Scene Effect End', (m) => patchSceneFx(m, id, { end: f }));
    },
    remove: (id: string) => { engine.run('Remove Scene Effect', (m) => removeSceneFx(m, id)); },
  };

  panel = new SceneFxPanel(engine, actions);
  kit.buildSection('effects', panel.root, () => panel?.patch());

  const has = (): boolean => !!engine.movie?.sceneFx?.length;
  commands.add(
    {
      id: 'scene-fx.show', label: 'Scene Effects...', icon: 'sun', enabled: () => !!engine.movie, run: () => kit.showBuild('effects'),
      group: 'Movie', description: 'Opens the Effects tab of the Build panel: weather, particles and light over the whole frame.',
    },
    {
      id: 'scene-fx.add', label: 'Add Scene Effect', icon: 'sun', mutates: true, enabled: () => !!engine.movie,
      run: (p) => (typeof p?.kind === 'string' ? add(p.kind, typeof p.amount === 'number' ? p.amount : undefined) : kit.showBuild('effects')),
      group: 'Movie', description: 'Lays a scene effect over the whole movie; with no kind it opens the Effects tab.',
      when: 'Use to add weather, particles or a light mood over every frame.',
      params: {
        kind: { type: 'string', enum: SCENE_FX.map((k) => k.kind), description: 'The effect.' },
        amount: { type: 'number', min: 0, max: 1, description: 'Strength, 0 to 1.' },
      },
    },
    {
      id: 'scene-fx.clear', label: 'Remove All Scene Effects', icon: 'delete', mutates: true, enabled: has,
      run: () => engine.run('Remove All Scene Effects', (m) => { if (!m.sceneFx) return m; const { sceneFx: _gone, ...rest } = m; return rest as Movie; }),
      group: 'Movie', description: 'Takes every scene effect out of the movie in one step.',
    },
    ...SCENE_FX.map((k) => ({
      id: `scene-fx.${k.kind}`, label: k.name, mutates: true, enabled: () => !!engine.movie, run: () => add(k.kind),
      group: 'Movie', description: `Lays ${k.name.toLowerCase()} over the whole movie as a scene effect.`,
    })),
  );

  const byGroup = (g: string): string[] => SCENE_FX.filter((k) => k.group === g).map((k) => `scene-fx.${k.kind}`);
  const items: MenuItem[] = ['scene-fx.show', '-', ...byGroup('weather'), '-', ...byGroup('particles'), '-', ...byGroup('light'), '-', 'scene-fx.clear'];
  kit.menu('Movie', ['-', { label: 'Scene Effects', items }]);
}
