// The seam the features of 0.37.0 are added through: each file in app/features/ exports one install function that
// takes this kit, registers its own commands and builds its own interface. app.ts makes the kit once and calls them.
import type { Engine } from '../engine/engine';
import type { Renderer } from '../engine/render';
import type { Commands } from '../ui/commands';
import type { MenuItem } from '../ui/menu';
import type { StageView } from '../ui/stage-view';

export type BuildTab = 'characters' | 'actions' | 'scenes' | 'props' | 'effects' | 'create' | 'camera';
export type TopMenu = 'File' | 'Edit' | 'Movie' | 'Content' | 'View' | 'Help';

export interface FeatureKit {
  /** The app's root element (`.cv-app`). */
  root: HTMLElement;
  engine: Engine;
  renderer: Renderer;
  commands: Commands;
  stage: StageView;
  /** Appends `node` to the end of a Build panel tab. `patch` runs whenever the panel patches while that tab shows
   *  (selection, movie, history, mode, the Playhead while stopped on Camera), and once when the tab is first shown. */
  buildSection(tab: BuildTab, node: HTMLElement, patch?: () => void): void;
  /** Opens the Build panel on a tab. */
  showBuild(tab: BuildTab): void;
  /** Appends items (command ids, '-' or a submenu) to the end of a menu of the menu bar. */
  menu(menu: TopMenu, items: MenuItem[]): void;
  /** Adds rows that run these commands to the content's right-click menu, under Apply Action...; a row shows only
   *  while its command is enabled, with the command's label and icon. */
  contentMenu(ids: string[]): void;
  /** Where the Stage was last right-clicked, in client pixels; null before the first. */
  lastContext(): { x: number; y: number } | null;
  /** Adds a character to the movie at the Playhead: `starter:<id>`, `cast:<id>` or `mine:<name>`. */
  addCharacter(key: string): Promise<void>;
  /** Brings files in as the import does, at the Playhead on a new track. */
  importFiles(files: File[]): Promise<void>;
}
