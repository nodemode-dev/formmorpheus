import { startApp } from './app/app';
import { startLanguage, startPageTranslator } from './ui/i18n';
import { applyTheme } from './ui/themes';

applyTheme();
void startLanguage().finally(() => {
  startApp();
  startPageTranslator();
});
