import { KEY_TAKEN, missingCapabilities, showUnsupported } from './app/capability';
import { platform } from './platform';
import { startLanguage, startPageTranslator } from './ui/i18n';
import { applyTheme } from './ui/themes';
import { keyTaken, loadWindowKey } from './io/window-key';

applyTheme();
// The app loads only when the web component has what it needs, so a missing piece shows a message, not a broken window.
const missing = missingCapabilities();
const app = missing.length ? null : import('./app/app');
let taken = false;
void loadWindowKey().catch(() => undefined).then(() => keyTaken()).then((is) => { taken = is; }).then(() => startLanguage()).finally(() => {
  if (!app || taken) {
    if (app) showUnsupported([KEY_TAKEN], 'FormMorpheus is already open in another window.', false);
    else showUnsupported(missing);
    void import('./ui/dom').then((m) => m.revealApp());
    return;
  }
  void app.then((m) => {
    m.startApp();
    startPageTranslator();
    platform.ready();
  });
});
