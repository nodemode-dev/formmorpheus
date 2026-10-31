// The guided tutorials of the Help Center: each is a short list of steps that point at the real control, wait for the
// person to use it, then move on. Every string here goes through `t` when shown (tutorials.ts), so the translator can
// read all of them from this file. Steps only read the movie; they never change it (the practice movie is set up by
// `prepare`, once, before the first step).

import type { Engine } from '../engine/engine';
import type { Content, Movie } from '../engine/types';

export interface TutorialStep {
  title: string;
  text: string;
  /** The control to ring: a selector, or a function for a control found by its words. */
  target: string | (() => HTMLElement | null);
  /** Done when this turns true (checked a few times a second and on every movie change). */
  until?: () => boolean;
  /** Done when the person clicks the ringed control. */
  click?: boolean;
  /** Runs when the step begins (to note where the person started). */
  enter?: () => void;
}

export interface Tutorial {
  id: string;
  title: string;
  blurb: string;
  /** About how long it takes, in minutes. */
  minutes: number;
  prepare: () => void;
  steps: TutorialStep[];
}

const contents = (m: Movie | null): Content[] => (m ? m.tracks.flatMap((tr) => tr.content) : []);
const visible = (n: Element | null): boolean => !!n && (n as HTMLElement).offsetParent !== null;
const shown = (sel: string): boolean => visible(document.querySelector(sel));

/** A menu or popover row by its words (the English label or its translation); the Create menu and the File menu use it. */
function rowByLabel(english: string, tr: (s: string) => string): HTMLElement | null {
  const want = new Set([english, tr(english)]);
  for (const n of document.querySelectorAll<HTMLElement>('.fm-pop-row, .cv-menu-item')) {
    if (!visible(n)) continue;
    const lab = n.querySelector('.fm-pop-label, .cv-menu-label')?.textContent?.trim() ?? '';
    if (want.has(lab)) return n;
  }
  return null;
}

/** Strokes drawn on the Draw and Paint canvas: the picture is written into the movie later than the stroke, so a drag
 *  that ends on the canvas is what counts (set up once). */
const strokes = { n: 0 };
if (typeof window !== 'undefined') {
  let from: { x: number; y: number } | null = null;
  window.addEventListener('pointerdown', (e) => { from = (e.target as Element | null)?.closest?.('.fm-paint-canvas') ? { x: e.clientX, y: e.clientY } : null; }, true);
  window.addEventListener('pointerup', (e) => { if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) >= 6) strokes.n++; from = null; }, true);
}

/** Set when playback starts; each step that waits for Play clears it first (watchPlay). */
const played = { v: false };
const watched = new WeakSet<Engine>();

export function buildTutorials(engine: Engine, tr: (s: string) => string): Tutorial[] {
  const mv = (): Movie | null => engine.movie;
  const first = (kind: Content['kind']): Content | undefined => contents(mv()).find((c) => c.kind === kind);
  if (!watched.has(engine)) { watched.add(engine); engine.on('playing', (p) => { if (p) played.v = true; }); }
  const f0 = { v: 0 };
  const s0 = { v: 0 };
  const n0 = { v: 0 };
  const markStroke = (): void => { s0.v = strokes.n; };
  const gotStroke = (): boolean => strokes.n > s0.v;
  const watchPlay =(): void => { played.v = engine.playing; };
  const keyed = (min: number): boolean => contents(mv()).some((c) => c.keys.some((l) => Object.values(l.channels).some((k) => k.length >= min)));

  /** A new unsaved practice movie, with one text block unless asked not to. It is never written to the library. */
  const scratch = (withText: boolean): void => {
    engine.create({ name: 'Practice movie', width: 1280, height: 720, fps: 24, seconds: 6, flipbook: false });
    if (withText) engine.insert('text', { name: 'Practice text', start: 0, duration: 144, text: { text: 'Hello', font: 'Inter', size: 200, weight: 700, color: '#1d1d22', align: 'center' } });
    engine.select([]);
  };

  const playStep = (text: string): TutorialStep => ({ title: 'Play it', text, target: '[data-act="play"]', until: () => played.v, enter: () => { engine.stop(); engine.seek(0); played.v = false; } });
  const selectStep: TutorialStep = { title: 'Select the block', text: 'Click the block on the Timeline. It is the bar with the word Hello. A selected block shows a box on the Stage.', target: '.fm-tl-host', until: () => engine.selected.length === 1 };

  return [
    {
      id: 'keyframes', title: 'Your first animation with Keyframes', minutes: 3,
      blurb: 'Move a word across the Stage by setting two Keyframes.',
      prepare: () => scratch(true),
      steps: [
        selectStep,
        { title: 'Switch to Keyframe', text: 'Keyframe mode lets you set where a block is at the moments you choose.', target: '.fm-mode[data-mode="keyframe"]', until: () => engine.mode === 'keyframe' },
        { title: 'Move the Playhead', text: 'Click or drag along the ruler at the top of the Timeline to a later moment, about one second in.', target: '.fm-tl-ruler', enter: () => { f0.v = engine.frame; }, until: () => engine.frame >= 12 && engine.frame !== f0.v },
        { title: 'Drag the block', text: 'Drag the word to a new place on the Stage. A Keyframe is written here and at the start, so the word travels between them.', target: '.fm-stage', until: () => keyed(2) },
        playStep('Press Play to watch the word glide from its first place to its new one.'),
        { title: 'Choose an ease', text: 'Tap the clapperboard pill on the Playhead to open the Action menu. Set easing there to make the motion start slowly or end softly. When you are ready, finish this step by pressing Play again, or skip it.', target: '.fm-key-pill', click: true },
      ],
    },
    {
      id: 'flipbook', title: 'A Flipbook with Onion skins', minutes: 4,
      blurb: 'Draw two frames and see the faint onion of the one before.',
      prepare: () => scratch(false),
      steps: [
        { title: 'Open the Create menu', text: 'The plus button adds new content to the Timeline.', target: '[data-act="create"]', click: true },
        { title: 'Choose Flipbook', text: 'A Flipbook is a block made of drawings that play one after another.', target: () => rowByLabel('Flipbook', tr), until: () => !!first('flipbook') },
        { title: 'Draw the first frame', text: 'Drag on the canvas to draw a short line. Any mark will do.', target: '.fm-paint-canvas', enter: markStroke, until: gotStroke },
        { title: 'Add a frame', text: 'Frame adds a new empty drawing after this one.', target: '.fm-fs-ib[data-act="frame"]', enter: () => { n0.v = first('flipbook')?.flip[0]?.frames.length ?? 0; }, until: () => (first('flipbook')?.flip[0]?.frames.length ?? 0) > n0.v },
        { title: 'Draw the second frame', text: 'The pink ghost is the Onion skin: the frame before, shown faintly. Draw the line a little further along from it.', target: '.fm-paint-canvas', enter: markStroke, until: gotStroke },
        { title: 'Open Settings', text: 'Onion skins are set in Settings.', target: '.fm-paint-word[data-w="settings"]', until: () => shown('.fm-ps-tabs') },
        { title: 'Choose Onions', text: 'Here you choose how many frames show before and after, their opacity and their color.', target: '.fm-ps-tab[data-tab="onions"]', until: () => shown('.fm-ps-pane[data-pane="onions"]') },
        { title: 'Play the Flipbook', text: 'Press Play on the frame strip to see the two drawings in a loop.', target: '.fm-fs-play', click: true },
        { title: 'Finish drawing', text: 'Double-click the name at the top left, or open it and choose Finish, to go back to the Stage.', target: '.fm-paint-mode', until: () => !shown('.fm-paint') },
      ],
    },
    {
      id: 'perform', title: 'Perform a motion', minutes: 2,
      blurb: 'Record a move by dragging while the movie plays.',
      prepare: () => scratch(true),
      steps: [
        selectStep,
        { title: 'Switch to Perform', text: 'Perform records your drag as motion, in real time.', target: '.fm-mode[data-mode="perform"]', until: () => engine.mode === 'perform' },
        { title: 'Drag on the Stage', text: 'Press on the word and drag it around in a loop. The movie plays while you drag, and the motion is kept when you let go.', target: '.fm-stage', until: () => keyed(4) },
        playStep('Press Play to see your performance.'),
        { title: 'Refine in Keyframe', text: 'Switch to Keyframe mode: the performance became Keyframes you can adjust one by one.', target: '.fm-mode[data-mode="keyframe"]', until: () => engine.mode === 'keyframe' },
      ],
    },
    {
      id: 'paint', title: 'Draw & Paint basics', minutes: 4,
      blurb: 'Color, brush size, layers and undo in a Drawing.',
      prepare: () => scratch(false),
      steps: [
        { title: 'Open the Create menu', text: 'The plus button adds new content.', target: '[data-act="create"]', click: true },
        { title: 'Choose Drawing', text: 'A Drawing is a single picture with layers.', target: () => rowByLabel('Drawing', tr), until: () => !!first('drawing') },
        { title: 'Open the Color panel', text: 'The round button holds your current color.', target: '.fm-paint-colour', until: () => shown('.fm-col') },
        { title: 'Draw a stroke', text: 'Choose a color in the panel, then drag on the canvas to paint.', target: '.fm-paint-canvas', enter: markStroke, until: gotStroke },
        { title: 'Change the brush size', text: 'Drag the upper slider on the left edge up or down, then draw again to feel the difference.', target: '.fm-paint-slider[data-s="size"]', click: true },
        { title: 'Open the Layers', text: 'Layers keep parts of a picture apart so you can change one without the rest.', target: '.fm-paint-tool[data-tool="layers"]', until: () => shown('.fm-lp') },
        { title: 'Add a layer', text: 'The plus in the Layers panel adds an empty layer above the current one.', target: '.fm-lp-addlayer', enter: () => { n0.v = document.querySelectorAll('.fm-lp-row').length; }, until: () => document.querySelectorAll('.fm-lp-row').length > n0.v },
        { title: 'Paint on the new layer', text: 'Draw another stroke. It lands on the new layer only.', target: '.fm-paint-canvas', enter: markStroke, until: gotStroke },
        { title: 'Undo', text: 'Press Undo to take the last stroke back.', target: '.fm-paint-side-btn[data-a="undo"]', click: true },
        { title: 'Finish drawing', text: 'Double-click the name at the top left, or open it and choose Finish, to go back to the Stage.', target: '.fm-paint-mode', until: () => !shown('.fm-paint') },
      ],
    },
    {
      id: 'export', title: 'Export a video', minutes: 2,
      blurb: 'Turn the movie into a video file you can share.',
      prepare: () => scratch(true),
      steps: [
        { title: 'Open the File menu', text: 'Export lives in the File menu.', target: '.cv-menubar .cv-menu-btn', click: true },
        { title: 'Choose Export', text: 'Export opens the sharing window.', target: () => rowByLabel('Export...', tr), until: () => shown('.fm-ex-seg') },
        { title: 'Pick a way to share', text: 'The tiles are the common choices. Click the first one, a video.', target: '.fm-ex-tile', click: true },
        { title: 'Look at the options', text: 'Advanced holds size, quality, frame range and format. Open it to see what can be changed.', target: '.fm-ex-segbtn:last-child', click: true },
        { title: 'Close the window', text: 'You can export when you have a movie of your own. Close this window for now.', target: '.cv-dialog [data-close]', until: () => !shown('.fm-ex-seg') },
      ],
    },
  ];
}
