import type { Engine } from '../engine/engine';
import { serviceReady } from '../io/api';
import { VERSION } from '../version';
import type { Commands } from './commands';
import { anyDialogOpen, confirmAction } from './dialogs';
import { EXAMPLES, installExamples } from './examples';
import { loadPrefs, updatePrefs } from './prefs';
import { toast } from './toast';
import { Tour, tourSeen } from './tour';
import { WhatsNewDialog } from './whats-new';

/** First run and updates in one place: writes the example movies once, shows What's New once after an update (for a
 *  window that had been used before), starts the tour at the first movie opened on a fresh install, and registers the
 *  Help commands What's New, Take the Tour and Reset Examples. */
const KEY = 'formmorpheus.onboarding';

interface Onb { examples: boolean; tourArmed: boolean }

function read(): Onb {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Onb>; return { examples: v.examples === true, tourArmed: v.tourArmed === true }; } catch { return { examples: false, tourArmed: false }; }
}
function write(r: Onb): void {
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* repeated next start */ }
}

export interface OnboardingDeps {
  commands: Commands;
  engine: Engine;
  openMovie: (name: string) => Promise<void>;
  closeHome: () => void;
}

export function setupOnboarding(d: OnboardingDeps): { whatsNew: WhatsNewDialog; tour: Tour } {
  let used = false;
  try { used = localStorage.getItem('formmorpheus.prefs') !== null; } catch { /* treated as fresh */ }
  const whatsNew = new WhatsNewDialog({ run: (c) => { d.commands.run(c); }, enabled: (c) => { const cmd = d.commands.get(c); return !!cmd && d.commands.enabled(cmd); } });
  const tour = new Tour();

  const startTour = async (): Promise<void> => {
    try {
      if (!d.engine.movie) {
        await installExamples({ reset: false, only: EXAMPLES[0].name });
        await d.openMovie(EXAMPLES[0].name);
      } else d.closeHome();
      if (!d.engine.movie) { toast('Open or create a movie first, then take the tour.'); return; }
      window.setTimeout(() => tour.start(), 350);
    } catch (err) { toast((err as Error).message, 'error'); }
  };

  d.commands.add(
    { id: 'whats-new', label: 'What\'s New...', run: () => whatsNew.show() },
    { id: 'tour', label: 'Take the Tour', run: () => { void startTour(); } },
    {
      id: 'reset-examples', label: 'Reset Examples...', run: () => {
        void (async () => {
          const ok = await confirmAction('Reset Examples?', 'The example movies are written again as they came. Changes you made to them are replaced.', 'Reset', true);
          if (!ok) return;
          try {
            const open = d.engine.movie ? d.engine.libraryName : null;
            const done = await installExamples({ reset: true, skip: open });
            toast(open && EXAMPLES.some((e) => e.name === open) ? 'The examples were reset, except the one that is open. Close it and reset again to rebuild it.' : done.length === 1 ? 'The example was reset.' : 'The examples were reset.');
          } catch (err) { toast((err as Error).message, 'error'); }
        })();
      },
    },
  );

  // the tour begins at the first movie opened after a fresh install
  d.engine.on('projects', () => {
    const r = read();
    if (r.tourArmed && !tourSeen() && d.engine.movie && !tour.isActive) {
      write({ ...r, tourArmed: false });
      window.setTimeout(() => { if (d.engine.movie && !anyDialogOpen()) tour.start(); }, 900);
    }
  });

  void (async () => {
    if (!(await serviceReady())) return;
    const r = read();
    if (!r.examples) {
      try {
        await installExamples({ reset: false });
        write({ examples: true, tourArmed: !used && !tourSeen() });
      } catch { /* tried again next start */ }
    }
    const p = loadPrefs();
    if (p.whatsNewSeen !== VERSION) {
      updatePrefs({ whatsNewSeen: VERSION });
      if (used && p.whatsNewAuto) window.setTimeout(() => { if (!anyDialogOpen() && !tour.isActive) whatsNew.show(); }, 800);
    }
  })();

  return { whatsNew, tour };
}
