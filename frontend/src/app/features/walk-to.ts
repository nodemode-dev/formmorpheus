import type { Content, Movie } from '../../engine/types';
import { walkCharacter, type WalkHow } from '../../engine/walk-to';
import { cameraMode } from '../../ui/camera-view';
import { stageMovie } from '../../ui/stage-world';
import { selectedCharacter } from '../action-commands';
import type { FeatureKit } from '../feature-kit';

export function installWalkTo(kit: FeatureKit): void {
  const { engine, commands, stage } = kit;

  const one = (): Content | null => selectedCharacter(engine);

  /** A client point on the Stage as a point of the movie frame, read the way the Stage reads its own pointer. */
  const spotOf = (p: { x: number; y: number }): [number, number] | null => {
    const fr = stage.frameClientRect(), m = engine.movie;
    const canvas = stage.root.querySelector<HTMLCanvasElement>('.fm-stage-canvas');
    if (!fr || !m || !canvas) return null;
    const c = canvas.getBoundingClientRect(), k = stage.nav.scale();
    if (!(k > 0)) return null;
    const [sx, sy] = stage.nav.local({ clientX: p.x, clientY: p.y });
    return [(sx - (fr.left - c.left)) / k, (sy - (fr.top - c.top)) / k];
  };

  let endOnce: (() => void) | null = null;
  const playOnce = (from: number, to: number): void => {
    endOnce?.();
    if (engine.playing) engine.stop();
    const back = engine.frame;
    const offs: Array<() => void> = [];
    let prev = from;
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

  const walk = (label: string, how: () => WalkHow | null): void => {
    const g = one();
    if (!g) return;
    const at = engine.frame;
    let span: { from: number; to: number } | null = null;
    const ok = engine.run(label, (m: Movie) => {
      const h = how();
      if (!h) return m;
      const r = walkCharacter(m, g.id, at, h, stageMovie(m, cameraMode.on));
      span = { from: r.from, to: r.to };
      return r.movie;
    });
    const s = span as { from: number; to: number } | null;
    if (!ok || !s) return;
    engine.notice('{character} walks for {seconds} seconds', 'info', { character: g.name, seconds: ((s.to - s.from) / (engine.movie?.fps ?? 24)).toFixed(1) });
    playOnce(s.from, s.to);
  };

  const here = (): WalkHow | null => {
    const p = kit.lastContext();
    const spot = p ? spotOf(p) : null;
    return spot ? { to: spot } : null;
  };

  commands.add(
    { id: 'character.walk-here', label: 'Walk To Here', icon: 'pin', mutates: true, group: 'Content',
      enabled: () => !!one() && !!kit.lastContext(), run: () => walk('Walk To Here', here),
      description: 'Walks the selected character from where it stands to the spot last right-clicked on the Stage, then it stands.',
      when: 'Use to move a character across the scene on foot to a chosen place.' },
    { id: 'character.walk-in-left', label: 'Walk In from Left', icon: 'chevronRight', mutates: true, group: 'Content',
      enabled: () => !!one(), run: () => walk('Walk In from Left', () => ({ in: 'left' })),
      description: 'From the Playhead, the selected character walks in from off screen on the left to where it stands now.',
      when: 'Use to bring a character into the shot on foot.' },
    { id: 'character.walk-in-right', label: 'Walk In from Right', icon: 'chevronLeft', mutates: true, group: 'Content',
      enabled: () => !!one(), run: () => walk('Walk In from Right', () => ({ in: 'right' })),
      description: 'From the Playhead, the selected character walks in from off screen on the right to where it stands now.',
      when: 'Use to bring a character into the shot on foot.' },
    { id: 'character.walk-off-left', label: 'Walk Off Left', icon: 'chevronLeft', mutates: true, group: 'Content',
      enabled: () => !!one(), run: () => walk('Walk Off Left', () => ({ off: 'left' })),
      description: 'From the Playhead, the selected character walks from where it stands off screen to the left.',
      when: 'Use to send a character out of the shot on foot.' },
    { id: 'character.walk-off-right', label: 'Walk Off Right', icon: 'chevronRight', mutates: true, group: 'Content',
      enabled: () => !!one(), run: () => walk('Walk Off Right', () => ({ off: 'right' })),
      description: 'From the Playhead, the selected character walks from where it stands off screen to the right.',
      when: 'Use to send a character out of the shot on foot.' },
  );
  const sides = ['character.walk-in-left', 'character.walk-in-right', 'character.walk-off-left', 'character.walk-off-right'];
  kit.menu('Content', ['-', { label: 'Walk', items: sides }]);
  kit.contentMenu(sides);
}
