// Actions on the selected character: save its keys as an action, apply one at the Playhead or over the loop range,
// swap or clear a placed one (its strip on the Timeline), delete one of its own. Each change is one undo step.
import type { Engine } from '../engine/engine';
import { actionFromKeys, applyAction, characterOf, charFrame, clearAction, findAction, removeAction, swapAction } from '../engine/action-ops';
import { groupCtx } from '../engine/group-ctx';
import { srcFrame } from '../engine/retime';
import { findContent } from '../engine/transform';
import type { Content, Movie } from '../engine/types';
import type { ActionPicker } from '../ui/action-picker';
import { actPick } from '../ui/act-strips';
import type { Command } from '../ui/commands';
import { promptName } from '../ui/dialogs';
import { tf } from '../ui/i18n-fill';

export interface ActionDeps {
  engine: Engine;
  picker: ActionPicker;
  /** A sentence for the status line (translated here). */
  note(text: string): void;
  anchor(): { x: number; y: number };
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

export function actionCommands(d: ActionDeps): { commands: Command[]; openStrip(x: number, y: number, id: string, index: number): void } {
  const { engine, picker } = d;
  const char = (): boolean => !!selectedCharacter(engine);
  const placed = (): { g: Content; index: number } | null => {
    const g = selectedCharacter(engine);
    if (!g || actPick.id !== g.id || !g.character?.acts?.[actPick.index]) return null;
    return { g, index: actPick.index };
  };
  const skippedNote = (skipped: string[]): void => {
    if (skipped.length) d.note(tf('This character has no {parts}, so that part of the action was skipped.', { parts: skipped.join(', ') }));
  };

  const apply = (g: Content, actionId: string): void => {
    const m = engine.movie;
    if (!m || !g.character) return;
    const def = findAction(g.character, actionId);
    if (!def) return;
    const range = loopRange(m, g);
    const at = range ? range[0] : charFrame(m, g, engine.frame);
    const len = Math.max(1, Math.round(def.length * (def.fps ? m.fps / def.fps : 1)));
    const reps = range && def.loop ? Math.max(1, Math.round((range[1] - range[0]) / len)) : 1;
    let skipped: string[] = [];
    if (engine.run('Apply Action', (mv) => { const r = applyAction(mv, g.id, actionId, at, reps); skipped = r.skipped; return r.movie; })) {
      const acts = selectedCharacter(engine)?.character?.acts ?? [];
      actPick.id = g.id;
      actPick.index = acts.findIndex((s) => s.from === at && s.action === actionId);
      skippedNote(skipped);
    }
  };

  const swap = (g: Content, index: number, actionId: string): void => {
    let skipped: string[] = [];
    if (engine.run('Swap Action', (mv) => { const r = swapAction(mv, g.id, index, actionId); skipped = r.skipped; return r.movie; })) skippedNote(skipped);
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

  const at = (): { x: number; y: number } => d.anchor();

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
  ];
  return { commands, openStrip };
}

/** The items of the Actions submenu. */
export const ACTION_MENU_ITEMS: string[] = ['action-apply', 'action-swap', 'action-clear', '-', 'action-save', 'action-delete'];
