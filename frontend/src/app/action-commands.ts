// Actions on the selected character: save its keys as an action, apply one at the Playhead or over the loop range,
// swap or clear a placed one (its strip on the Timeline), delete one of its own. Each change is one undo step.
import type { Engine } from '../engine/engine';
import { actionFromKeys, addAction, applyAction, characterOf, charFrame, clearAction, findAction, loopPasses, removeAction, swapAction } from '../engine/action-ops';
import { fmactBlob, fmactName, readFmact } from '../io/fmact';
import { groupCtx } from '../engine/group-ctx';
import { srcFrame } from '../engine/retime';
import { findContent } from '../engine/transform';
import type { ActSpan, Content, Movie } from '../engine/types';
import { locate } from '../engine/model';
import { pickAt, type ActionPicker } from '../ui/action-picker';
import { actLabel, actPick } from '../ui/act-strips';
import type { Command } from '../ui/commands';
import { promptName } from '../ui/dialogs';
import { tf } from '../ui/i18n-fill';

export interface ActionDeps {
  engine: Engine;
  picker: ActionPicker;
  /** A sentence for the status line (translated here). */
  note(text: string): void;
  anchor(): { x: number; y: number };
  /** Hands a file to the person (a download, or the share sheet on iPad). */
  download(blob: Blob, name: string): void;
  /** Opens the file picker for these types; picked files go through Import. */
  pickFile(accept: string): void;
}

/** Adds the action in an `.fmact` file to the selected character (Import, or a drop). */
export async function importActionFile(engine: Engine, file: File): Promise<void> {
  const g = selectedCharacter(engine);
  if (!g) { engine.notice('Select a character, then import the action onto it.', 'error'); return; }
  const def = await readFmact(file).catch((e: unknown) => { engine.notice(e instanceof Error ? e.message : 'That is not an action file.', 'error'); return null; });
  if (!def) return;
  engine.run('Import Action', (m) => addAction(m, g.id, def).movie);
}

/** The character being worked on: the one picked inside an open group, else the one selected block. */
export function selectedCharacter(engine: Engine): Content | null {
  const m = engine.movie;
  if (!m) return null;
  const picked = groupCtx.picked ? findContent(m, groupCtx.picked) : null;
  if (picked?.character) return picked;
  const s = engine.selected;
  return s.length === 1 && s[0].character ? s[0] : null;
}

/** The loop range (In and Out) as frames of the character's tracks, when one is set. */
function loopRange(m: Movie, g: Content): [number, number] | null {
  if (m.loopFrom === undefined || m.loopTo === undefined || m.loopTo <= m.loopFrom) return null;
  return [charFrame(m, g, m.loopFrom), charFrame(m, g, m.loopTo)];
}

export function actionCommands(d: ActionDeps): { commands: Command[]; openStrip(x: number, y: number, id: string, index: number): void; applySelected(actionId: string): void } {
  const { engine, picker } = d;
  let future = engine.history.future.length;
  engine.on('history', () => {
    const n = engine.history.future.length;
    if (n === future) return;
    future = n;
    actPick.id = null;
    actPick.index = -1;
  });
  const char = (): boolean => !!selectedCharacter(engine);
  const placed = (): { g: Content; index: number } | null => {
    const g = selectedCharacter(engine);
    if (!g || actPick.id !== g.id || !g.character?.acts?.[actPick.index]) return null;
    return { g, index: actPick.index };
  };
  const skippedText = (skipped: string[]): string => (skipped.length ? tf('This character has no {parts}, so that part of the action was skipped.', { parts: skipped.join(', ') }) : '');
  const skippedNote = (skipped: string[]): void => {
    if (skipped.length) d.note(skippedText(skipped));
  };

  // Play once: a placed action plays its span from its first frame, then the Playhead goes back and playback stops.
  // Only seek and play: no undo step. A stop by the person ends it where they stopped.
  let endOnce: (() => void) | null = null;
  const playOnce = (m: Movie, g: Content, s: ActSpan, from: number): void => {
    endOnce?.();
    if (engine.playing) return;
    const last = Math.max(0, m.duration - 1);
    // a reversed or remapped block can run its frames backwards: never play longer than the span at the block's speed
    const most = from + Math.ceil((s.to - s.from) / Math.max(0.01, Math.abs(g.speed ?? 1))) + 1;
    let to = from;
    while (to < last && to < most && charFrame(m, g, to) < s.to) to++;
    if (to <= from) return;
    const back = engine.frame;
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

  /** After an apply or a swap: the notice names the action and the character, then the span plays once. */
  const applied = (gid: string, index: number, from: number | null, skipped: string[]): void => {
    const m = engine.movie;
    const g = m ? findContent(m, gid) : null;
    const s = g?.character?.acts?.[index];
    if (!m || !g || !s) { skippedNote(skipped); return; }
    const text = '{action} applied to {character}', vars = { action: actLabel(g, s.action), character: g.name };
    engine.notice(text, 'info', vars);
    const more = skippedText(skipped);
    d.note(more ? `${tf(text, vars)} · ${more}` : tf(text, vars));
    let at = from;
    if (at === null) {
      // a swap keeps the span's frames: find the movie frame its first frame shows at, inside the block when it is top level
      const top = locate(m, g.id);
      const lo = top ? g.start : 0, hi = top ? Math.min(m.duration, g.start + g.duration) : m.duration;
      for (let f = lo; f < hi; f++) if (charFrame(m, g, f) >= s.from) { at = f; break; }
    }
    if (at !== null) playOnce(m, g, s, at);
  };

  const apply = (g: Content, actionId: string): void => {
    const m = engine.movie;
    if (!m || !g.character) return;
    const def = findAction(g.character, actionId);
    if (!def) return;
    const range = loopRange(m, g);
    const at = range ? range[0] : charFrame(m, g, engine.frame);
    const len = Math.max(1, Math.round(def.length * (def.fps ? m.fps / def.fps : 1)));
    const reps = range && def.loop ? loopPasses(len, range[1] - range[0]) : 1;
    const startsAt = range && m.loopFrom !== undefined ? Math.round(m.loopFrom) : engine.frame;
    let skipped: string[] = [];
    if (engine.run('Apply Action', (mv) => { const r = applyAction(mv, g.id, actionId, at, reps, range ? range[1] : undefined); skipped = r.skipped; return r.movie; })) {
      const acts = selectedCharacter(engine)?.character?.acts ?? [];
      actPick.id = g.id;
      actPick.index = acts.findIndex((s) => s.from === at && s.action === actionId);
      applied(g.id, actPick.index, startsAt, skipped);
    }
  };

  const swap = (g: Content, index: number, actionId: string): void => {
    let skipped: string[] = [];
    if (engine.run('Swap Action', (mv) => { const r = swapAction(mv, g.id, index, actionId); skipped = r.skipped; return r.movie; })) applied(g.id, index, null, skipped);
  };

  const clear = (g: Content, index: number): void => {
    if (engine.run('Clear Action', (mv) => clearAction(mv, g.id, index))) { actPick.id = null; actPick.index = -1; }
  };

  /** The card for a strip pressed on the Timeline: another action swaps it, Clear Action removes it. */
  const openStrip = (x: number, y: number, id: string, index: number): void => {
    const m = engine.movie;
    if (!m) return;
    let g: Content;
    try { g = characterOf(m, id); } catch { return; }
    const s = g.character?.acts?.[index];
    if (!s || !g.character) return;
    picker.open(x, y, g.character, 'swap', s.action, (aid) => swap(g, index, aid), () => clear(g, index));
  };

  // the content menu's row leaves the pointer in pickAt, so the card opens where the person right-clicked
  const at = (): { x: number; y: number } => {
    if (!Number.isFinite(pickAt.x) || !Number.isFinite(pickAt.y)) return d.anchor();
    const p = { x: pickAt.x, y: pickAt.y };
    pickAt.x = pickAt.y = Number.NaN;
    return p;
  };

  const commands: Command[] = [
    {
      id: 'action-apply', label: 'Apply Action...', enabled: char, mutates: true, group: 'Content',
      description: 'Puts an action on the selected character at the Playhead, or across the loop range when one is set.',
      run: () => { const g = selectedCharacter(engine); if (g?.character) { const p = at(); picker.open(p.x, p.y, g.character, 'apply', null, (id) => apply(g, id)); } },
    },
    {
      id: 'action-swap', label: 'Swap Action...', enabled: () => !!placed(), mutates: true, group: 'Content',
      description: 'Replaces the chosen action strip of the character with another action over the same frames.',
      run: () => { const p = placed(); const s = p?.g.character?.acts?.[p.index]; if (p && s && p.g.character) { const a = at(); picker.open(a.x, a.y, p.g.character, 'swap', s.action, (id) => swap(p.g, p.index, id), () => clear(p.g, p.index)); } },
    },
    {
      id: 'action-clear', label: 'Clear Action', enabled: () => !!placed(), mutates: true, group: 'Content',
      description: 'Removes the chosen action strip of the character and its keys; keys outside it stay.',
      run: () => { const p = placed(); if (p) clear(p.g, p.index); },
    },
    {
      id: 'action-save', label: 'Save Action...', enabled: char, mutates: true, group: 'Content',
      description: "Makes a named action from the character's keys across the loop range, or across its whole block.",
      run: () => {
        void (async () => {
          const g = selectedCharacter(engine), m = engine.movie;
          if (!g || !m) return;
          const range = loopRange(m, g) ?? [Math.round(srcFrame(g, 0)), Math.round(srcFrame(g, g.duration - 1))];
          const name = await promptName('Save Action', 'Action', 'Save');
          if (!name) return;
          engine.run('Save Action', (mv) => actionFromKeys(mv, g.id, range[0], range[1], name).movie);
        })();
      },
    },
    {
      id: 'action-delete', label: 'Delete Action...', enabled: () => !!selectedCharacter(engine)?.character?.actions.length, mutates: true, group: 'Content',
      description: "Removes one of the character's own actions; where it was placed, its keys stay as plain keys.",
      run: () => { const g = selectedCharacter(engine); if (g?.character) { const p = at(); picker.open(p.x, p.y, g.character, 'delete', null, (id) => { engine.run('Delete Action', (mv) => removeAction(mv, g.id, id)); }); } },
    },
    {
      id: 'action-export', label: 'Export Action...', enabled: char, group: 'Content',
      description: 'Saves one action as an .fmact file, to bring into another movie or share.',
      run: () => {
        const g = selectedCharacter(engine);
        const ch = g?.character;
        if (!ch) return;
        const p = at();
        picker.open(p.x, p.y, ch, 'export', null, (id) => { const a = findAction(ch, id); if (a) d.download(fmactBlob(a), fmactName(a)); });
      },
    },
    {
      id: 'action-import', label: 'Import Action...', enabled: char, mutates: true, group: 'Content',
      description: 'Adds the action in an .fmact file to the selected character.',
      run: () => d.pickFile('.fmact'),
    },
  ];
  /** Apply Action without the picker (the Build panel): the same path, so it plays once and says so. */
  const applySelected = (actionId: string): void => { const g = selectedCharacter(engine); if (g) apply(g, actionId); };
  return { commands, openStrip, applySelected };
}

/** The items of the Actions submenu. */
export const ACTION_MENU_ITEMS: string[] = ['action-apply', 'action-swap', 'action-clear', '-', 'action-save', 'action-delete', '-', 'action-import', 'action-export'];
