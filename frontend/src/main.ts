import { missingCapabilities, showUnsupported } from './app/capability';
import { startLanguage, startPageTranslator } from './ui/i18n';
import { applyTheme } from './ui/themes';

applyTheme();
// The app loads only when the web component has what it needs, so a missing piece shows a message, not a broken window.
const missing = missingCapabilities();
const app = missing.length ? null : import('./app/app');
void startLanguage().finally(() => {
  if (!app) {
    showUnsupported(missing);
    void import('./ui/dom').then((m) => m.revealApp());
    return;
  }
  void app.then((m) => {
    m.startApp();
    startPageTranslator();
  });
});
