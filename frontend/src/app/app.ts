import { Engine } from '../engine/engine';
import { content as makeContent, flipTrack, textColorFor, uid } from '../engine/model';
import * as ops from '../engine/ops';
import * as groupInner from '../engine/group-inner-ops';
import { groupCtx } from '../engine/group-ctx';
import { Renderer } from '../engine/render';
import { convertToFlipbook } from '../ui/flip-convert';
import { setFlipServices } from '../ui/flip-services';
import type { Asset, Content } from '../engine/types';
import { api, ApiError, capabilities, onServiceChange, serviceReady } from '../io/api';
import { packMovie, unpackMovie } from '../io/fmo';
import { Recovery } from '../io/recovery';
import { drawingToFormvis, frameToFormvis, movieToFormvfx } from '../io/round-trip';
import { characterToSvg } from '../io/svg-export';
import { canLinkPaths, sourceApi, trustSource } from '../io/source-api';
import { setSourceLink } from '../engine/source-merge';
import { pickDestination, saveFileTo } from '../ui/export-where';
import { AudioEngine } from '../media/audio';
import { evictFonts, loadTextFonts, registerFont, registerFonts } from '../media/fonts';
import { loadLibrary } from '../io/fonts-library';
import { watchMissingFonts } from '../ui/fonts-missing';
import { createImporter, type ImportOptions } from './import-flow';
import { filesOfDrop } from '../io/drop-files';
import { VideoPool } from '../media/video';
import { firstFrames, planPrefetch } from '../media/plan';
import { ExportDialog } from '../ui/export-dialog';
import { TextCard } from '../ui/text-card';
import { ShapePanel } from '../ui/shape-panel';
import { shapeCommands, SHAPE_CREATE_ITEMS } from '../ui/shape-commands';
import { characterCommands, selectedCharacter } from '../ui/character-commands';
import { setupSourceLink } from './source-link';
import { CaptionButtons, wantsCustomTitleBar } from '../ui/caption-buttons';
import { CommandPalette } from '../ui/command-palette';
import { Commands, type Command } from '../ui/commands';
import { ContentMenu } from '../ui/content-menu';
import { LipsyncDialog } from '../ui/lipsync-dialog';
import { VoicePanel } from '../ui/voice-panel';
import { SpeechPanel } from '../ui/speech-panel';
import { SubtitlesPanel } from '../ui/subtitles-panel';
import { speechCommands } from './speech-commands';
import { SoundCard, loadScrubPref } from '../ui/sound-card';
import { anyDialogOpen, confirmAction, promptName } from '../ui/dialogs';
import { el, mountOnce, q, revealApp, setDisabled, setText, setTitle } from '../ui/dom';
import { enhanceAllSelects } from '../ui/dropdown';
import { HelpView } from '../ui/help-view';
import { AboutDialog } from '../ui/about-dialog';
import { PenLink } from '../ui/pen-link';
import { platform } from '../platform';
import { installIpadMenu } from '../platform/ipad-menu';
import { installIpadShell } from '../platform/ipad-shell';
import { setupOnboarding } from '../ui/onboarding';
import { setupHelpCenter } from '../ui/help-setup';
import { previewFor } from '../ui/preview-strip';
import { HomeScreen } from '../ui/home';
import { t } from '../ui/i18n';
import { tf } from '../ui/i18n-fill';
import { historyLabel } from '../ui/history-label';
import { icon } from '../ui/icons';
import '../ui/icons-morph';
import { MenuBar, PopupMenu, setMenuStyle, type MenuDef } from '../ui/menu';
import { CreateMenu, type CreateItem } from '../ui/create-menu';
import { openPaintOnCreate, setOpenPaintOnCreate } from '../ui/create-pref';
import { MovieSettings } from '../ui/movie-settings';
import { MENUS_IN_WINDOW_KEY, NativeMenus, menusInWindow, wantsNativeMenus } from '../ui/native-menu';
import { NewMovieDialog } from '../ui/new-movie-dialog';
import { StarterSceneDialog } from '../ui/starter-scene-dialog';
import { buildSceneMovie } from '../io/starter-scenes';
import { installNumberFields } from '../ui/number-fields';
import { applyShellPrefs, loadPrefs, updatePrefs, type Prefs } from '../ui/prefs';
import { SettingsDialog } from '../ui/settings-dialog';
import { PaintView } from '../ui/paint-view';
import { StageView } from '../ui/stage-view';
import { stageHovered } from '../ui/stage-nav';
import { StageOptions } from '../ui/stage-options';
import { CameraLane } from '../ui/camera-lane';
import { StatusBar } from '../ui/status';
import { TimelineView } from '../ui/timeline';
import { GraphEditor } from '../ui/graph-editor';
import { MediaBin } from '../ui/media-bin';
import { CharactersPanel } from '../ui/characters-panel';
import { CharacterBuilder } from '../ui/character-builder';
import { TitleTools } from '../ui/titlebar-tools';
import { installUndoUi } from '../ui/undo-banner';
import { installTextWarpNote } from '../ui/text-warp-note';
import { TitleName, movieLabel } from '../ui/title-name';
import { Tips } from '../ui/tips';
import { findContent } from '../engine/transform';
import { ShortcutsDialog } from '../ui/shortcuts-dialog';
import { RecoveryDialog } from '../ui/recovery-dialog';
import { ckCommands } from './ck-commands';
import { pushCommands } from './push-commands';
import { loopCommands } from './loop-commands';
import { ACTION_MENU_ITEMS, actionCommands, importActionFile } from './action-commands';
import { ActionPicker } from '../ui/action-picker';
import { deleteChosenKeys, keyCommands } from './key-commands';
import { edCommands } from './ed-commands';
import { installHeldZoom, timelineViewCommands } from './timeline-view-commands';
import { shuttleCommands } from './shuttle-commands';
import { a11yCommands, installA11y } from '../ui/a11y';
import { chromeCommands } from '../ui/shell-opts';
import { installPenPlay } from '../ui/pen-play';
import { toast } from '../ui/toast';
import { gestures } from '../ui/gestures';
import { TrackMenu } from '../ui/track-menu';
import { VERSION } from '../version';
import { Dock } from '../dock/dock';
import { formmorpheusDock, outsideAgents, reserveDock } from '../dock-adapter';
import { startAgentBridge } from './agent-bridge';

const SHELL = `<div class="cv-app fm-app">
<header class="cv-titlebar">
<nav class="cv-menubar" aria-label="Main menu"></nav>
<div class="cv-tb-doc"></div>
<div class="cv-tb-app">formmorpheus</div>
<div class="cv-zoom">
<button class="cv-tt-btn" type="button" data-cmd="settings">${icon('settings', 16)}</button>
</div>
</header>
<div class="cv-main fm-main">
<main class="cv-stage fm-stage-wrap"></main>
<div class="fm-split" role="separator" aria-orientation="horizontal" aria-label="Resize the Stage and the Timeline"></div>
<div class="fm-tl-host"></div>
<div class="cv-drop" hidden><div class="cv-drop-text">Drop pictures to add them to the movie</div></div>
</div>
<footer class="cv-status"></footer>
</div>`;

/** Create > Flipbook frame rates: the submenu under Flipbook. */
const FLIP_RATES = [6, 8, 12, 15, 24, 30];
const FLIP_FPS_MENU = { label: 'Flipbook at frame rate', items: FLIP_RATES.map((n) => `add-flipbook-${n}`) };
/** The Create menu: what to make, then what to bring in. */
/** Under the card's More row: what the four tiles and three rows leave out. */
const CREATE_MORE: CreateItem[] = [FLIP_FPS_MENU, ...SHAPE_CREATE_ITEMS, '-', 'import-audio', 'record-audio', 'generate-voice', 'subtitles', '-', 'create-opens-paint'];
const CUSTOM_TITLE_KEY ='formmorpheus.customTitleBar';
const stored = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* this session only */ } };

export function startApp(): void {
  const host = document.getElementById('app') as HTMLElement;
  mountOnce(host, SHELL);
  const root = q(host, '.cv-app');
  const engine = new Engine();
  engine.setTicker({ now: () => performance.now(), request: (fn) => requestAnimationFrame(fn), cancel: (id) => cancelAnimationFrame(id) });
  let prefs = loadPrefs();
  engine.setUndoDepth(prefs.undoDepth, prefs.recentUndo);
  document.body.classList.toggle('fm-no-stage-undo', !prefs.stageUndoButtons);

  let stage: StageView | null = null;
  let timeline: TimelineView | null = null;
  const renderer = new Renderer((id) => engine.assets.get(id), () => { stage?.schedule(); timeline?.refreshThumbs(); });
  const video = new VideoPool((id) => engine.assets.get(id), () => { stage?.schedule(); timeline?.refreshThumbs(); });
  renderer.setVideo(video);
  // GPU compositing turns on when WebGL2 is there and a probe frame matches the CPU path; the CPU stays the fallback
  let gpuWanted = true;
  const gpuForced = new URLSearchParams(location.search).get('gpu') === 'force';
  const syncGpu = (on: boolean): void => {
    gpuWanted = on;
    if (!on) renderer.useGpu(false);
    // a probe that matched the CPU but ran slower keeps the GPU off on later preference changes too (unless forced)
    else if (renderer.gpuProbe?.ok) { if (renderer.gpuProbe.fast || gpuForced) renderer.useGpu(true); }
    else if (!renderer.gpuProbe) void renderer.autoGpu(gpuForced).then(() => { if (!gpuWanted) renderer.useGpu(false); });
  };
  setTimeout(() => syncGpu(prefs.gpu), 1500);
  const audio = new AudioEngine((id) => engine.assets.get(id), () => timeline?.refreshThumbs());
  setFlipServices(engine, (id) => audio.peaks(id), (id) => audio.decode(id));
  // the sound card's clock drives playback whenever sound plays, so pictures and sound cannot drift apart
  engine.setTicker({ now: () => audio.now(), request: (fn) => requestAnimationFrame(fn), cancel: (id) => cancelAnimationFrame(id) });
  engine.on('playing', (on) => { const m = engine.movie; if (on && m) audio.play(m, engine.frame, 1); else audio.stop(); });
  engine.on('wrap', ({ frame, direction }) => { const m = engine.movie; if (!m) return; audio.stop(); audio.play(m, frame, direction); });
  engine.on('time', (f) => {
    const m = engine.movie;
    if (!m) return;
    if (!engine.playing) { audio.scrub(m, f); return; }
    // decode ahead; near the end of a looping movie the start too, so the picture after the wrap is ready
    planPrefetch(video, m, f);
  });
  engine.on('projects', () => { if (!engine.movie) { renderer.forget(); video.forget(); audio.forget(); } });
  stage = new StageView(q(root, '.fm-stage-wrap'), engine, renderer);
  const commands = new Commands();
  const contentMenu = new ContentMenu(engine);
  const lipsyncDialog = new LipsyncDialog(engine, () => audio);
  contentMenu.onLipsync = () => lipsyncDialog.show();
  audio.setScrub(loadScrubPref());
  const voicePanel = new VoicePanel(engine, () => audio);
  const speechPanel = new SpeechPanel(engine, () => audio);
  const subtitlesPanel = new SubtitlesPanel(engine, () => audio);
  const soundCard = new SoundCard(engine, () => audio);
  contentMenu.onSound = () => soundCard.show();
  contentMenu.onConvert = (ids) => { void convertToFlipbook(engine, renderer, ids); };
  contentMenu.onEditInFormvis = (id) => { void roundTripOut('drawing', id); };
  const trackMenu = new TrackMenu(engine);
  trackMenu.onRecord = () => voicePanel.show();
  const stageOptions = new StageOptions(engine);
  const movieSettings = new MovieSettings(engine, stageOptions.picker, () => stage?.snapshot(360) ?? Promise.resolve(null));
  const stageAt = (): { x: number; y: number } => { const r = q(root, '.fm-stage').getBoundingClientRect(); return { x: r.right - 360, y: r.top + 24 }; };
  const stageMenu = new PopupMenu(commands, null, true);
  stage.nav.onContext = (x, y) => { stageMenu.setItems(['stage-options', 'stage-background', '-', 'stage-fit', 'stage-zoom-100', '-', 'stage-timecode', 'stage-fullscreen']); stageMenu.openAt(x, y); };
  const newMovie = new NewMovieDialog(engine);
  // like New: the movie opens unnamed and the library adopts it under a free "Untitled Movie" name
  const starterScenes = new StarterSceneDialog(async (entry) => {
    const data = await buildSceneMovie(entry);
    if (!(await askToKeep())) return false;
    await prepareOpen(data);
    engine.open(data.movie, null, data.assets);
    home.hide();
    return true;
  });
  const createMenu = new CreateMenu(commands, CREATE_MORE);
  timeline = new TimelineView(q(root, '.fm-tl-host'), engine, renderer, {
    contentMenu: (x, y) => contentMenu.open(x, y),
    trackMenu: (x, y, id) => trackMenu.open(x, y, id),
    movieSettings: (a) => movieSettings.toggle(a),
    home: () => { void toTheater(); },
    create: (a) => { if (createMenu.isOpen) createMenu.close(); else createMenu.openFor(a); },
    edit: (c) => editContent(c),
    scrubSpeed: () => (prefs.scrubSpeed === 'precise' ? 0.4 : prefs.scrubSpeed === 'fast' ? 2 : 1),
    graph: (id, kind, channel) => graphEditor.open(id, kind, channel),
    actStrip: (x, y, id, index) => actions.openStrip(x, y, id, index),
  });
  const graphEditor = new GraphEditor(timeline.root, engine);
  const mediaBin = new MediaBin(engine, { renderer, video, timeline: () => timeline, stageWrap: () => q(root, '.fm-stage-wrap') });
  const charactersPanel = new CharactersPanel(engine, { renderer, timeline: () => timeline, stageWrap: () => q(root, '.fm-stage-wrap') });
  let characterBuilder: CharacterBuilder | null = null;
  const builder = (): CharacterBuilder => (characterBuilder ??= new CharacterBuilder(engine, { renderer, characters: charactersPanel }));
  charactersPanel.onBuild = () => builder().open();
  charactersPanel.onOpenPreset = (id) => builder().openPreset(id);
  new CameraLane(timeline, engine);
  timeline.setMedia({ video, audio });
  engine.setRegion(() => timeline?.visibleRange() ?? null);
  const textCard = new TextCard(engine);
  stage.onEditTextStyle = (id, x, y) => textCard.open({ x, y }, id, 'format');
  const shapePanel = new ShapePanel(engine);
  stage.onEditShape = (id, x, y) => shapePanel.open({ x, y }, id);
  textCard.onImportFont = () => { commands.run('import-font'); };
  // the app-wide Fonts library: installed fonts are registered once, and a movie opened with a missing font is asked about
  void serviceReady().then((up) => { if (up) void loadLibrary(registerFont); });
  watchMissingFonts(engine);
  const exportDialog = new ExportDialog({
    engine,
    renderer,
    audio: () => audio,
    commitOpen: () => (paint.isOpen() ? paint.done(true) : Promise.resolve()),
    saveOutput: async (blob, name) => { try { await api.writeOutput(name, blob); home.sync(); } catch { /* the download already happened; the Exports list is the engine's */ } },
    exportFmo: (withHistory) => { void exportFile(withHistory); },
  });
  // the Movie settings Share tab: one-click exports with the default settings
  document.addEventListener('fm:export-quick', (e) => { exportDialog.runQuick(String((e as CustomEvent).detail)); });
  // Theater Share > Video or Frames as images: the movie opens, then the export runs from the Export window
  document.addEventListener('fm:share-export', (e) => {
    const d = (e as CustomEvent<{ name: string; kind: 'video' | 'frames' }>).detail;
    void (async () => {
      const before = engine.movie;
      await openFromLibrary(d.name);
      if (!engine.movie || (engine.movie === before && engine.libraryName !== d.name)) return;
      home.hide();
      exportDialog.open('share');
      exportDialog.runQuick(d.kind === 'video' ? 'mp4' : 'png-frames');
    })();
  });
  const paint = new PaintView(q(root, '.fm-main'), {
    engine,
    renderer,
    onOpenChange: (open) => {
      root.classList.toggle('is-painting', open);
      const id = open ? paint.openId() : null, c = id && engine.movie ? findContent(engine.movie, id) : null;
      if (c) tips.enter(c.kind === 'flipbook' ? 'flipbook' : 'paint');
      if (!open) { stage?.schedule(); timeline?.refreshThumbs(); }
    },
  });
  const tips = new Tips();
  tips.frame = () => stage?.frameClientRect() ?? null;
  engine.on('mode', (m) => { if (engine.movie && (m === 'perform' || m === 'keyframe')) tips.enter(m); });
  newMovie.onFlipbook = (id) => { void paint.open(id); };
  const status = new StatusBar(q(root, '.cv-status'), engine);
  engine.on('notice', (n) => { if (n.kind === 'error') toast(n.vars ? tf(n.text, n.vars) : n.text, 'error'); });

  const remember = (name: string): void => {
    const recent = [name, ...prefs.recent.filter((r) => r !== name)].slice(0, 20);
    prefs = updatePrefs({ recent });
  };

  const home = new HomeScreen(q(root, '.cv-stage'), {
    engine,
    autoShow: () => prefs.autoShowHome,
    afterClose: () => prefs.homeOnLastClose,
    recent: () => prefs.recent,
    openRecent: (name) => { void openFromLibrary(name); },
    openPath: () => toast('Opening files by path arrives with the desktop file panels.'),
    removeRecent: (name) => { prefs = updatePrefs({ recent: prefs.recent.filter((r) => r !== name) }); },
    openName: () => engine.libraryName,
    run: (cmd) => { commands.run(cmd); },
  });

  const settings = new SettingsDialog((p: Prefs) => {
    prefs = p;
    syncGpu(p.gpu);
    applyShellPrefs(p);
    engine.setUndoDepth(p.undoDepth, p.recentUndo);
    document.body.classList.toggle('fm-no-stage-undo', !p.stageUndoButtons);
    home.sync();
    scheduleAutosave();
  });
  let helpView: HelpView | null = null;
  const menus: MenuDef[] = [];
  const palette = new CommandPalette(commands, () => menus);

  const askToKeep = async (): Promise<boolean> => {
    // an export reads this movie's pictures and sound until it finishes
    if (exportDialog.running) { toast('An export is running: wait for it, or cancel it, before closing this movie.'); return false; }
    // leaving a movie never asks: the work is written (poster from the Playhead frame) and the tile follows
    if (engine.movie && !(await save(false, { quiet: true, poster: true })) && engine.modified) {
      // the one case with something to lose: the write failed (or the engine is not running), so the choice is the person's
      return confirmAction('Could not save', t('"{name}" could not be written, so closing it now loses the latest changes.').replace('{name}', engine.movie.name), 'Close anyway', true, 'Stay');
    }
    return true;
  };

  /** Everything the first picture needs (fonts, pictures, each visible video's first frame) is decoded while the old movie or Home stays shown; then the old movie's media is dropped. */
  async function prepareOpen(data: Pick<Awaited<ReturnType<typeof unpackMovie>>, 'movie' | 'assets'>): Promise<void> {
    engine.stop();
    await registerFonts(data.movie, (id) => data.assets.get(id));
    await loadTextFonts(data.movie);
    await renderer.preload(data.assets, true);
    video.stage(data.assets);
    try {
      await firstFrames(video, data.movie, 0);
    } catch (e) {
      // the open fails: drop what was staged for the new movie, keep the current one's decoders
      video.stage(null);
      video.forgetExcept(new Set(engine.movie ? Object.keys(engine.movie.assets) : []));
      throw e;
    }
    const keep = new Set(data.assets.keys());
    renderer.forget(keep);
    video.forgetExcept(keep);
    audio.forget();
    evictFonts(keep);
  }

  async function openFromLibrary(name: string): Promise<void> {
    if (!(await askToKeep())) return;
    const job = engine.startJob(t('Open {name}').replace('{name}', name), 1);
    try {
      const file = await unpackMovie(await api.readMovie(name));
      await prepareOpen(file);
      // a copy made outside the app (or by an older duplicate) shares the open movie's id: give it its own
      if (engine.movie && file.movie.id === engine.movie.id && name !== engine.libraryName) {
        const id = uid('m');
        file.movie = { ...file.movie, id };
        file.past = file.past.map((p) => ({ ...p, movie: { ...p.movie, id } }));
      }
      // the library name is the movie's name (a copy or a rename outside the app leaves the old one inside)
      if (file.movie.name !== name) file.movie = { ...file.movie, name };
      engine.open(file.movie, name, file.assets, file.past, file.recovery);
      // the movie opens where it was left (the stored Playhead frame)
      if (file.playhead) engine.seek(file.playhead);
      // reopening the movie that is already loaded keeps its id, so the Theater would not notice: put it away here
      home.hide();
      remember(name);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The movie could not be opened.', 'error');
    } finally {
      engine.endJob(job);
    }
  }

  async function openFile(file: File): Promise<void> {
    if (!(await askToKeep())) return;
    try {
      const data = await unpackMovie(file);
      await prepareOpen(data);
      engine.open(data.movie, null, data.assets, data.past, data.recovery);
      home.hide();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The movie could not be opened.', 'error');
    }
  }

  // Desktop only: the system's recent list, and files the system hands the app (double-click, a second launch).
  function noteRecentDocument(path: string): void {
    if ('__TAURI_INTERNALS__' in window) void import('@tauri-apps/api/core').then((m) => m.invoke('note_recent_document', { path })).catch(() => undefined);
  }
  async function openFromPath(path: string): Promise<void> {
    if (/\.svg$/i.test(path)) {
      // an SVG handed over by its path becomes a character linked to that file
      try {
        const { text, link } = await sourceApi.read(path);
        trustSource(path);
        await importFiles([new File([text], path.split(/[\\/]/).pop() ?? 'character.svg', { type: 'image/svg+xml' })], { link });
      } catch (e) {
        toast(e instanceof Error ? e.message : 'The file could not be imported.', 'error');
      }
      return;
    }
    if (!/\.fmo$/i.test(path)) return;
    try {
      await openFile(new File([await api.readFile(path)], path.split(/[\\/]/).pop() ?? 'movie.fmo'));
      noteRecentDocument(path);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The movie could not be opened.', 'error');
    }
  }
  if ('__TAURI_INTERNALS__' in window) {
    const openAll = async (paths: string[]): Promise<void> => { for (const p of paths) await openFromPath(p); };
    void import('@tauri-apps/api/event').then((ev) => ev.listen<string[]>('formmorpheus://open-paths', (e) => { void openAll(e.payload); }))
      .then(() => import('@tauri-apps/api/core')).then((m) => m.invoke<string[]>('take_pending_opens')).then((paths) => openAll(paths)).catch(() => undefined);
  }

  // The document model (G01): a movie is a file in the Theater from the moment it is made, and every step writes it
  // (debounced, one write at a time, the movie file replaced atomically by the engine). There is no unsaved state.
  interface SaveOpts { quiet?: boolean; poster?: boolean; notice?: boolean }
  let writeChain: Promise<boolean> = Promise.resolve(true);
  let posterCache: { frame: number; at: number; rev: number; blob: Blob | null } | null = null;
  let lastCost = 0;
  let failedOnce = false;
  const freeLibraryName = async (base: string): Promise<string> => {
    const taken = new Set((await api.library().catch(() => [])).map((i) => i.name));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  };

  /** Writes the open movie now. `poster` takes a fresh poster from the Playhead frame (leaving); otherwise one up to 5 s old is reused. */
  function save(asCopy: boolean, opts: SaveOpts = {}): Promise<boolean> {
    if (asCopy) return saveCopy();
    writeChain = writeChain.then(() => writeOnce(opts), () => writeOnce(opts));
    return writeChain;
  }

  async function writeOnce(opts: SaveOpts): Promise<boolean> {
    const movie = engine.movie, name = engine.libraryName;
    if (!movie || !name) return false;
    const frame = Math.min(engine.frame, movie.duration - 1);
    const stalePoster = !posterCache || (opts.poster ? posterCache.frame !== frame || engine.modified || posterCache.rev !== engine.revision : Date.now() - posterCache.at > 5000);
    if (!engine.modified && !(opts.poster && stalePoster)) { if (opts.notice) toast(t('Saved'), 'info', { ms: 1200 }); return true; }
    const t0 = performance.now();
    try {
      const past = engine.history.past.slice(), rec = engine.history.recovery.slice(), assets = new Map(engine.assets);
      // `rev` is read before the snapshot: an edit made during it leaves the poster marked old, so leaving the movie draws it again
      if (stalePoster) { const rev = engine.revision; posterCache = { frame, at: Date.now(), rev, blob: stage ? await stage.snapshot(480) : null }; }
      const preview = await previewFor(name, renderer, movie, engine.revision);
      const blob = await packMovie(movie, past, rec, assets, posterCache?.blob ?? null, true, preview, frame);
      const saved = await api.writeMovie(name, blob);
      if (engine.libraryName === name) {
        const moved = engine.movie !== movie;
        engine.markSaved(saved.name);
        if (moved) { engine.modified = true; scheduleSave(); }
      }
      remember(saved.name);
      noteRecentDocument(saved.path);
      lastCost = performance.now() - t0;
      failedOnce = false;
      document.dispatchEvent(new CustomEvent('fm:library-changed'));
      if (opts.notice) toast(t('Saved'), 'info', { ms: 1200 });
      return true;
    } catch (e) {
      // the work stays in memory (and in the crash snapshot); one notice per streak, a retry in a few seconds
      if (!failedOnce) toast(e instanceof Error ? e.message : 'The movie could not be saved.', 'error');
      failedOnce = true;
      scheduleSave(5000);
      return false;
    }
  }

  /** "Duplicate as...": a copy in the library under a new name; the open movie stays open and keeps its name. */
  async function saveCopy(): Promise<boolean> {
    const m = engine.movie;
    if (!m) return false;
    const asked = await promptName('Duplicate as...', await freeLibraryName(`${m.name} copy`), 'Save');
    if (!asked) return false;
    try {
      await save(false, { quiet: true, poster: true });
      const name = await freeLibraryName(asked);
      const poster = stage ? await stage.snapshot(480) : null;
      const blob = await packMovie({ ...(engine.movie ?? m), name, id: uid('m') }, engine.history.past, engine.history.recovery, engine.assets, poster, true);
      const saved = await api.writeMovie(name, blob);
      remember(saved.name);
      document.dispatchEvent(new CustomEvent('fm:library-changed'));
      toast(t('Saved a copy as "{name}"').replace('{name}', saved.name), 'info');
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The movie could not be saved.', 'error');
      return false;
    }
  }

  let saveTimer = 0, saveSince = 0;
  /** Debounced write after a step: 400 ms after the last one, at most 3 s after the first, longer for a movie that is slow to write. */
  function scheduleSave(delay?: number): void {
    if (!engine.movie || !engine.libraryName) return;
    const now = performance.now();
    if (!saveSince) saveSince = now;
    window.clearTimeout(saveTimer);
    const wait = delay ?? Math.min(Math.max(400, lastCost * 3), saveSince + Math.max(3000, lastCost * 6) - now);
    saveTimer = window.setTimeout(() => {
      saveTimer = 0;
      saveSince = 0;
      const go = (): void => { void save(false, { quiet: true }); };
      // off the main path: when the page is idle, within 1.5 s
      if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 1500 }); else go();
    }, Math.max(0, wait));
  }
  engine.on('history', () => { if (engine.modified) scheduleSave(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && engine.modified && engine.libraryName) void save(false, { quiet: true }); });

  /** Puts a movie that has no library name into the library at once (New Movie, a file opened from outside, a recovered movie). */
  let adopting = false;
  async function adopt(): Promise<void> {
    if (adopting) return;
    adopting = true;
    let id = '';
    try {
      await Promise.resolve();
      const m = engine.movie;
      if (!m || engine.libraryName || !(await serviceReady())) return;
      id = m.id;
      const name = await freeLibraryName(m.name || 'Untitled Movie');
      if (engine.movie?.id !== id || engine.libraryName) return;
      engine.nameMovie(name);
      engine.libraryName = name;
      engine.modified = true;
      await save(false, { quiet: true, poster: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The movie could not be saved.', 'error');
    } finally {
      adopting = false;
      if (engine.movie && !engine.libraryName && engine.movie.id !== id) void adopt();
    }
  }
  engine.on('projects', () => { if (engine.movie && !engine.libraryName && !adopting) void adopt(); });

  /** Leaving for the Theater: the poster is taken from the Playhead frame and the file written first (a slow write does not hold the Theater back for more than a moment). */
  async function toTheater(): Promise<void> {
    if (engine.movie && engine.libraryName) await Promise.race([save(false, { quiet: true, poster: true }), new Promise((r) => window.setTimeout(r, 700))]);
    home.show();
  }

  async function exportFile(withHistory: boolean): Promise<void> {
    const m = engine.movie;
    if (!m) return;
    const poster = stage ? await stage.snapshot(480) : null;
    const blob = await packMovie(m, engine.history.past, engine.history.recovery, engine.assets, poster, withHistory);
    platform.files.download(blob, `${m.name}.fmo`);
  }

  // the interval is only a safety net now: steps already write the movie (see scheduleSave)
  let autosaveTimer = 0;
  function scheduleAutosave(): void {
    window.clearInterval(autosaveTimer);
    autosaveTimer = 0;
    if (prefs.autosaveSeconds > 0) autosaveTimer = window.setInterval(() => { if (engine.movie && engine.modified && engine.libraryName && !engine.playing) void save(false, { quiet: true }); }, prefs.autosaveSeconds * 1000);
  }
  scheduleAutosave();

  const recovery = new Recovery({
    engine,
    pack: async () => (engine.movie ? packMovie(engine.movie, [], [], engine.assets, null, false) : null),
    openRecovered: async (blob, name) => {
      const data = await unpackMovie(blob);
      await prepareOpen(data);
      engine.open(data.movie, null, data.assets, data.past, data.recovery);
      engine.modified = true;
      engine.nameMovie(name);
    },
    saveRecovered: async (blob, name) => { await api.writeMovie(name, blob); home.sync(); },
  });
  void recovery.offer();

  /** Pictures, layered artwork, video, sound and fonts: decoded in media/import, placed by app/import-flow as one undo step. */
  const importer = createImporter({ engine, renderer, video, openMovie: (f) => openFile(f), importAction: (f) => importActionFile(engine, f) });
  const importFiles = (files: File[], opts?: ImportOptions): Promise<void> => importer.importFiles(files, opts);

  /** Round trips with formvis and formvfx (io/round-trip): a file goes out as a download, and comes back through Import or a drop. */
  async function roundTripOut(what: 'drawing' | 'frame' | 'movie', contentId?: string): Promise<void> {
    const m = engine.movie;
    if (!m) return;
    const job = engine.startJob(what === 'movie' ? 'Movie as formvfx composition' : 'formvis document', 1);
    try {
      const blobOf = (id: string): Blob | undefined => engine.assets.get(id);
      const drawing = contentId ? engine.selected.find((c) => c.id === contentId) : engine.selected.find((c) => c.kind === 'drawing');
      const out = what === 'movie' ? await movieToFormvfx(m, blobOf)
        : what === 'drawing' || (drawing && drawing.kind === 'drawing') ? await drawingToFormvis(m, drawing as Content, blobOf)
        : await frameToFormvis(m, engine.frame, renderer);
      platform.files.download(out.blob, out.name);
      if (what === 'movie') toast(`${out.name}: ${out.note ?? ''} Unzip it and open the .fvxproj in formvfx.`);
      else if (drawing && drawing.kind === 'drawing') toast(`${out.name} saved. Edit it in formvis, save it, then drop the file here to bring the layers back.`);
      else toast(`${out.name}: ${out.note ?? ''}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The export failed.', 'error');
    } finally {
      engine.endJob(job);
    }
  }
  async function characterOut(): Promise<void> {
    const m = engine.movie, c = selectedCharacter(engine);
    if (!m || !c) return;
    // the desktop app's folder dialog gives a real path, so the saved file becomes the character's source
    const dest = canLinkPaths() ? await pickDestination() : 'unavailable';
    if (dest === null) return;
    const job = engine.startJob(t('Character as SVG'), 1);
    try {
      const out = await characterToSvg(m, c.id, (id) => engine.assets.get(id));
      const note = out.note ? ` ${out.note}` : '';
      const saved = (file: string): string => tf('{file} saved with {n} parts. Edit it in a vector app, keep one group per part, then choose Update from Source... on the character.', { file, n: out.parts });
      if (dest !== 'unavailable') {
        const path = await saveFileTo(dest, out.blob, out.name);
        if (dest.kind === 'engine') {
          let why: string;
          try {
            const link = await sourceApi.stat(path);
            engine.run('Link Source', (mv) => setSourceLink(mv, c.id, link));
            trustSource(path);
            toast(`${tf('{file} saved with {n} parts and linked. Edit it in a vector app, keep one group per part, and save: the character updates when you come back.', { file: path, n: out.parts })}${note}`);
            return;
          } catch (e) {
            why = e instanceof ApiError && e.status === 413 ? t('Saved, not linked: larger than 20 MB.')
              : tf('Saved, not linked: {reason}', { reason: e instanceof Error ? e.message : t('the file could not be read.') });
          }
          toast(`${saved(path)}${note} ${why}`);
          return;
        }
      } else platform.files.download(out.blob, out.name);
      toast(`${saved(out.name)}${note}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : t('The export failed.'), 'error');
    } finally {
      engine.endJob(job);
    }
  }
  const pickFor = (accept: string): void => { pickMode = 'import'; picker.accept = accept; picker.click(); };

  const MEDIA_ACCEPT = 'image/*,video/*,audio/*,.svg,image/svg+xml,.fmo,.tif,.tiff,.otf,.ttf,.ttc,.woff,.woff2,.flac,.ogg,.opus,.m4a,.aif,.aiff,.caf,.ac3,.mp2,.tga,.heic,.heif,.psd,.psb,.ora,.kra,.krz,.pdn,.procreate,.fvd,.fvxproj,.zip,.drm,.fmact';
  const picker = el<HTMLInputElement>(`<input type="file" hidden multiple accept="${MEDIA_ACCEPT}">`);
  document.body.appendChild(picker);
  let pickMode: 'open' | 'import' = 'import';
  picker.addEventListener('change', () => {
    const files = Array.from(picker.files ?? []);
    picker.value = '';
    if (!files.length) return;
    if (pickMode === 'open') void openFile(files[0]);
    else void importFiles(files, { preview: true });
  });

  async function editContent(c: Content): Promise<void> {
    if (c.kind === 'text' && c.text) {
      const pill = root.querySelector<HTMLElement>('.fm-edit-pill');
      textCard.open(pill && !pill.hidden ? pill : { x: window.innerWidth / 2, y: window.innerHeight / 3 }, c.id);
      return;
    }
    if (c.kind === 'drawing' || c.kind === 'flipbook') await paint.open(c.id);
    if (c.kind === 'shape' || c.kind === 'solid' || c.kind === 'adjust') shapePanel.open(mid(), c.id);
  }

  const aboutDialog = new AboutDialog();
  const penLink = new PenLink(paint);
  const has = (): boolean => !!engine.movie;
  const sel = (): boolean => engine.selection.content.length > 0;
  /** A new Drawing or Flipbook stays on the Timeline, selected with its Edit pill; the choice in the Create menu goes straight into Draw & Paint. */
  const afterCreate = (id: string | null): void => { if (id && openPaintOnCreate()) void paint.open(id); };
  const add: Command[] = [
    { id: 'new', label: 'New Movie...', keys: ['Mod+N'], run: () => newMovie.show(false) },
    { id: 'new-from-scene', label: 'New from Starter Scene...', run: () => { void starterScenes.show(); } },
    { id: 'new-flipbook', label: 'New Flipbook...', run: () => newMovie.show(true) },
    { id: 'open', label: 'Open...', keys: ['Mod+O'], run: () => home.show('projects') },
    { id: 'open-file', label: 'Open Movie File...', keys: ['Shift+Mod+O'], run: () => { pickMode = 'open'; picker.accept = '.fmo'; picker.click(); } },
    { id: 'save', label: 'Save', keys: ['Mod+S'], enabled: has, run: () => { void save(false, { poster: true, notice: true }); } },
    { id: 'save-as', label: 'Duplicate as...', keys: ['Shift+Mod+S'], enabled: has, run: () => { void save(true); } },
    { id: 'export-fmo', label: 'Share Movie File', enabled: has, run: () => { void exportFile(false); } },
    { id: 'export-fmo-history', label: 'Share Movie File with History', enabled: has, run: () => { void exportFile(true); } },
    { id: 'export-fvd', label: 'Current frame as formvis document...', enabled: has, run: () => { void roundTripOut('frame'); } },
    { id: 'export-fvfx', label: 'Movie as formvfx composition...', enabled: has, run: () => { void roundTripOut('movie'); } },
    { id: 'export-char-svg', label: 'Character as SVG for Vector App...', enabled: () => !!selectedCharacter(engine), run: () => { void characterOut(); } },
    { id: 'import-fvd', label: 'Import formvis document...', enabled: has, run: () => pickFor('.fvd,application/zip') },
    { id: 'import-fvfx', label: 'Import formvfx composition...', enabled: has, run: () => pickFor('.fvxproj,.zip,application/zip') },
    { id: 'import-media', label: 'Import...', keys: ['Mod+I'], enabled: has, run: () => { pickMode = 'import'; picker.accept = MEDIA_ACCEPT; picker.click(); } },
    { id: 'import-photo', label: 'Photo...', icon: 'image', enabled: has, run: () => pickFor('image/*,.tif,.tiff,.tga,.heic,.heif,.psd,.psb,.ora,.kra,.krz,.pdn,.procreate') },
    { id: 'import-video', label: 'Video...', icon: 'video', enabled: has, run: () => pickFor('video/*') },
    { id: 'import-audio', label: 'Audio...', icon: 'audio', enabled: has, run: () => pickFor('audio/*,.flac,.ogg,.opus,.m4a,.aif,.aiff,.caf,.ac3,.mp2') },
    { id: 'record-audio', label: 'Record sound...', icon: 'audio', enabled: has, run: () => voicePanel.show() },
    ...speechCommands({ hasMovie: has, generateVoice: () => speechPanel.show(), subtitles: () => subtitlesPanel.show() }),
    { id: 'sound-card', label: 'Sound options...', enabled: () => engine.selected.some((c) => c.kind === 'audio'), run: () => soundCard.show() },
    { id: 'import-file', label: 'File...', icon: 'upload', enabled: has, run: () => pickFor(MEDIA_ACCEPT) },
    { id: 'import-font', label: 'Import font...', enabled: has, run: () => pickFor('.otf,.ttf,.ttc,.woff,.woff2') },
    { id: 'export', label: 'Export...', keys: ['Mod+E'], enabled: has, run: () => exportDialog.open('share') },
    { id: 'close', label: 'Close Movie', keys: ['Mod+W'], enabled: has, run: () => { void askToKeep().then((ok) => { if (ok) engine.close(); }); } },
    { id: 'home', label: 'Theater', keys: ['Shift+Mod+H'], run: () => { void toTheater(); } },
    { id: 'settings', label: 'Preferences...', keys: ['Mod+,'], run: () => settings.show() },
    { id: 'search', label: 'Search Commands...', keys: ['Mod+K'], run: () => palette.show() },
    { id: 'undo', label: () => (engine.history.canUndo ? `${t('Undo')} ${historyLabel(engine.history.undoLabel ?? '')}` : 'Undo'), keys: ['Mod+Z'], enabled: () => engine.history.canUndo, run: () => engine.undo() },
    { id: 'redo', label: () => (engine.history.canRedo ? `${t('Redo')} ${historyLabel(engine.history.redoLabel ?? '')}` : 'Redo'), keys: ['Shift+Mod+Z', 'Mod+Y'], enabled: () => engine.history.canRedo, run: () => engine.redo() },
    { id: 'cut', label: 'Cut', keys: ['Mod+X'], enabled: sel, run: () => engine.copy(true) },
    { id: 'copy', label: 'Copy', keys: ['Mod+C'], enabled: sel, run: () => engine.copy(false) },
    { id: 'paste', label: 'Paste', keys: ['Mod+V'], enabled: () => has() && engine.hasClipboard, run: () => engine.paste() },
    { id: 'duplicate', label: 'Duplicate', keys: ['Mod+D'], enabled: sel, run: () => { const id = engine.selection.content[0]; engine.run('Duplicate', (m) => { const r = ops.duplicateContent(m, id); return { movie: r.movie, select: [r.copy] }; }); } },
    { id: 'duplicate-after', label: 'Duplicate After', keys: ['Alt+Mod+D'], enabled: sel, run: () => { const id = engine.selection.content[0]; engine.run('Duplicate After', (m) => { const r = ops.duplicateAfter(m, id); return { movie: r.movie, select: [r.copy] }; }); } },
    { id: 'split', label: 'Split Content', keys: ['Mod+B'], enabled: () => engine.selected.some((c) => engine.isOver(c)), run: () => { const c = engine.selected.find((x) => engine.isOver(x)); if (c) engine.run('Split Content', (m) => { const r = ops.splitContent(m, c.id, engine.frame); return { movie: r.movie, select: [r.right] }; }); } },
    { id: 'fill-duration', label: 'Fill Duration', keys: ['Alt+Mod+F'], enabled: sel, run: () => { const id = engine.selection.content[0]; engine.run('Fill Duration', (m) => ops.fillDuration(m, id)); } },
    { id: 'delete', label: 'Delete Content', keys: ['Delete', 'Backspace'], enabled: sel, run: () => { if (deleteChosenKeys(engine)) return; void (async () => { if (prefs.confirmDelete && !(await confirmAction('Delete content', 'Delete the selected content?', 'Delete', true))) return; const ids = engine.selection.content.slice(); engine.run('Delete Content', (m) => ops.deleteContent(m, ids)); })(); } },
    { id: 'group', label: 'Group', keys: ['Mod+G'], enabled: sel, run: () => { const ids = engine.selection.content.slice(); engine.run('Group', (m) => { const r = ops.groupContent(m, ids); return { movie: r.movie, select: [r.group] }; }); } },
    { id: 'ungroup', label: 'Ungroup', keys: ['Shift+Mod+G'], enabled: () => engine.selected.length === 1 && engine.selected[0].kind === 'group' && document.querySelector('[data-act="multi"]')?.getAttribute('aria-pressed') !== 'true', run: () => { const g = engine.selected.length === 1 ? engine.selected.find((c) => c.kind === 'group') : undefined; if (g) engine.run('Ungroup', (m) => { const r = ops.ungroupContent(m, g.id); return { movie: r.movie, select: r.ids }; }); } },
    { id: 'select-all', label: 'Select All', keys: ['Mod+A'], enabled: has, run: () => { const m = engine.movie; if (m) engine.select(m.tracks.flatMap((tr) => tr.content.map((c) => c.id))); } },
    { id: 'deselect', label: 'Deselect', keys: ['Escape'], enabled: sel, run: () => { if (groupCtx.picked) engine.pick(null); else engine.select([]); } },
    { id: 'add-drawing', label: 'Drawing', icon: 'drawing', enabled: has, run: () => afterCreate(engine.insert('drawing')) },
    { id: 'add-flipbook', label: 'Flipbook', icon: 'flipbook', enabled: has, run: () => afterCreate(engine.insert('flipbook')) },
    { id: 'create-opens-paint', label: 'Open Draw & Paint after adding', enabled: has, checked: () => openPaintOnCreate(), run: () => setOpenPaintOnCreate(!openPaintOnCreate()) },
    // a Flipbook that plays its drawings at its own rate: each drawing is held for movie fps / rate frames
    ...FLIP_RATES.map((n): Command => ({ id: `add-flipbook-${n}`, label: `${n} fps`, enabled: has, run: () => {
      const m = engine.movie;
      if (!m) return;
      const hold = Math.max(1, Math.round(m.fps / n));
      const track = flipTrack('Track 1', n);
      track.frames = track.frames.map((f) => ({ ...f, hold }));
      afterCreate(engine.insert('flipbook', { flip: [track], duration: n * hold }));
    } })),
    { id: 'add-text', label: 'Text', icon: 'text', enabled: has, run: () => { const id = engine.insert('text', { name: 'Text', text: { text: 'Text', font: 'Inter', size: 160, weight: 600, color: textColorFor(engine.movie?.background ?? '#ffffff'), align: 'center' } }); if (id) stage.editText(id); } },
    { id: 'add-track', label: 'Track', icon: 'track', keys: ['Shift+Mod+T'], enabled: has, run: () => { const m = engine.movie; if (!m) return; const gid = groupCtx.target(); if (gid) { engine.run('Add Track', (mv) => groupInner.addInnerTrack(mv, gid)); return; } const at = engine.selection.track ? Math.max(0, m.tracks.findIndex((tr) => tr.id === engine.selection.track)) : 0; engine.run('Add Track', (mv) => ops.addTrack(mv, at).movie); } },
    { id: 'play', label: () => (engine.playing ? 'Pause' : 'Play'), keys: ['Space'], enabled: has, run: () => engine.togglePlay() },
    { id: 'prev-frame', label: 'Previous Frame', keys: ['Left', ','], enabled: has, run: () => engine.step(-1) },
    { id: 'next-frame', label: 'Next Frame', keys: ['Right', '.'], enabled: has, run: () => engine.step(1) },
    { id: 'go-start', label: 'Go to Start', keys: ['Home'], enabled: has, run: () => { engine.stop(); engine.seek(0); } },
    { id: 'go-end', label: 'Go to End', keys: ['End'], enabled: has, run: () => { const m = engine.movie; engine.stop(); if (m) engine.seek(m.duration - 1); } },
    { id: 'mode-compose', label: 'Compose', keys: ['Mod+1'], enabled: has, checked: () => engine.mode === 'compose', run: () => engine.setMode('compose') },
    { id: 'mode-perform', label: 'Perform', keys: ['Mod+2'], enabled: has, checked: () => engine.mode === 'perform', run: () => engine.setMode('perform') },
    { id: 'mode-keyframe', label: 'Keyframe', keys: ['Mod+3'], enabled: has, checked: () => engine.mode === 'keyframe', run: () => engine.setMode('keyframe') },
    { id: 'multi-select', label: 'Multi-select', keys: ['Shift+M'], enabled: has, run: () => timeline?.toggleMulti() },
    // Ctrl/Cmd + = - 0 go to whichever of the Stage and the Timeline the pointer rests over
    { id: 'timeline-in', label: 'Zoom Timeline In', keys: ['Mod+='], enabled: has, run: () => { if (stageHovered()) stage?.nav.zoomBy(1.25); else timeline?.zoomBy(1.4); } },
    { id: 'timeline-out', label: 'Zoom Timeline Out', keys: ['Mod+-'], enabled: has, run: () => { if (stageHovered()) stage?.nav.zoomBy(0.8); else timeline?.zoomBy(1 / 1.4); } },
    { id: 'timeline-in-h', label: 'Zoom Timeline In (Time Only)', keys: ['Shift+Mod+='], enabled: has, run: () => timeline?.zoomBy(1.4) },
    { id: 'timeline-out-h', label: 'Zoom Timeline Out (Time Only)', keys: ['Shift+Mod+-'], enabled: has, run: () => timeline?.zoomBy(1 / 1.4) },
    { id: 'timeline-in-v', label: 'Taller Tracks', keys: ['Alt+Shift+='], enabled: has, run: () => timeline?.zoomRows(1.25) },
    { id: 'timeline-out-v', label: 'Shorter Tracks', keys: ['Alt+Shift+-'], enabled: has, run: () => timeline?.zoomRows(0.8) },
    { id: 'timeline-fit', label: 'Fit Timeline', keys: ['Mod+0'], enabled: has, run: () => { if (stageHovered()) stage?.nav.fit(); else timeline?.fit(); } },
    { id: 'stage-zoom-in', label: 'Zoom Stage In', keys: ['Alt+Mod+='], enabled: has, run: () => stage?.nav.zoomBy(1.25) },
    { id: 'stage-zoom-out', label: 'Zoom Stage Out', keys: ['Alt+Mod+-'], enabled: has, run: () => stage?.nav.zoomBy(0.8) },
    { id: 'stage-fit', label: 'Fit Stage', keys: ['Alt+Mod+0'], enabled: has, run: () => stage?.nav.fit() },
    { id: 'stage-zoom-100', label: 'Stage at 100%', keys: ['Alt+Mod+1'], enabled: has, run: () => stage?.nav.zoomTo(1) },
    { id: 'stage-rotate-left', label: 'Rotate Stage Left', keys: ['Alt+Mod+Left'], enabled: has, run: () => stage?.nav.rotateStep(-1) },
    { id: 'stage-rotate-right', label: 'Rotate Stage Right', keys: ['Alt+Mod+Right'], enabled: has, run: () => stage?.nav.rotateStep(1) },
    { id: 'stage-rotate-reset', label: 'Reset Stage Rotation', enabled: has, run: () => stage?.nav.resetRotation() },
    { id: 'stage-fullscreen', label: 'Stage Full Screen', keys: ['Shift+Mod+F'], enabled: has, run: () => stage?.nav.togglePreview() },
    { id: 'stage-options', label: 'Stage Options...', keys: ['Shift+Mod+J'], enabled: has, run: () => stageOptions.show(stageAt()) },
    { id: 'stage-background', label: 'Background Color...', enabled: has, run: () => stageOptions.pickBackground(stageAt()) },
    { id: 'stage-timecode', label: 'Timecode', enabled: has, checked: () => engine.movie?.timecode !== false, run: () => engine.run('Timecode', (m) => ops.patchMovie(m, { timecode: m.timecode === false })) },
    { id: 'graph-editor', label: 'Graph Editor', keys: ['Alt+Mod+G'], enabled: has, run: () => graphEditor.toggle() },
    { id: 'media-bin', label: 'Media Bin', keys: ['Alt+Mod+B'], enabled: has, checked: () => mediaBin.isOpen, run: () => mediaBin.toggle() },
    { id: 'movie-settings', label: 'Movie Settings...', keys: ['Mod+J'], enabled: has, run: () => movieSettings.toggle(q(root, '[data-act="settings"]')) },
    { id: 'fit-to-content', label: 'Fit Duration to Content', enabled: has, run: () => engine.run('Fit to Content', (m) => ops.fitToContent(m)) },
    { id: 'recovery', label: 'Restore Last Recovery Point', enabled: () => engine.history.recovery.length > 0, run: () => { const r = engine.history.recovery[0]; if (r) engine.restoreRecovery(r.id); } },
    { id: 'menus-in-window', label: 'Menus in Window', enabled: () => '__TAURI_INTERNALS__' in window && /Mac/.test(navigator.platform), checked: menusInWindow, run: () => { const on = !menusInWindow(); store(MENUS_IN_WINDOW_KEY, on ? '1' : '0'); toast(on ? 'The menus stay in the window from the next start.' : 'The menus go to the menu bar from the next start.'); } },
    { id: 'custom-title-bar', label: 'Custom Title Bar', enabled: wantsCustomTitleBar, checked: () => stored(CUSTOM_TITLE_KEY) === '1', run: () => { store(CUSTOM_TITLE_KEY, stored(CUSTOM_TITLE_KEY) === '1' ? '0' : '1'); captions.sync(); } },
    { id: 'help', label: 'FormMorpheus Manual', keys: ['F1'], run: () => { helpView ??= new HelpView((c) => { commands.run(c); }); helpView.show(); } },
    { id: 'about', label: 'About FormMorpheus', run: () => aboutDialog.show() },
  ];
  const groupOfCommand = (id: string): string => {
    const find = (items: ReadonlyArray<unknown>, path: string): string => {
      for (const it of items) {
        if (it === id) return path;
        if (it && typeof it === 'object' && 'items' in it) {
          const d = it as MenuDef;
          const hit = find(typeof d.items === 'function' ? d.items() : d.items, d.label);
          if (hit) return hit;
        }
      }
      return '';
    };
    for (const m of menus) { const hit = find(typeof m.items === 'function' ? m.items() : m.items, m.label); if (hit) return hit; }
    return '';
  };
  const shortcutsDialog = new ShortcutsDialog(commands, groupOfCommand, () => { prefs = updatePrefs({ shortcuts: commands.overrides() }); });
  const recoveryDialog = new RecoveryDialog(engine);
  document.addEventListener('fm:open-shortcuts', () => shortcutsDialog.show());
  document.addEventListener('fm:open-settings', (e) => settings.show(String((e as CustomEvent<{ section?: string }>).detail?.section ?? '') || undefined));
  document.addEventListener('fm:command', (e) => { const id = (e as CustomEvent<string>).detail; if (typeof id === 'string') commands.run(id); });
  const mid = (): { x: number; y: number } => { const r = q(root, '.fm-stage-wrap').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const actions = actionCommands({ engine, picker: new ActionPicker(), note: (text) => status.note(text), anchor: mid, download: (blob, name) => platform.files.download(blob, name), pickFile: (accept) => pickFor(accept) });
  commands.add(
    ...add,
    ...actions.commands,
    ...shapeCommands(engine, () => stage?.shapeStage ?? null, shapePanel, mid),
    ...characterCommands(engine, charactersPanel, builder),
    ...setupSourceLink({ engine, renderer }).commands,
    ...paint.paintCommands(),
    ...pushCommands(engine),
    ...loopCommands(engine),
    ...keyCommands(engine),
    ...edCommands(engine),
    ...timelineViewCommands(engine, () => timeline),
    ...shuttleCommands(engine),
    ...a11yCommands(engine),
    ...chromeCommands(),
    ...ckCommands({
      engine,
      nudge: (dx, dy) => stage?.nudge(dx, dy),
      centerPlayhead: () => timeline?.centerOnPlayhead(),
      openOptions: () => { const p = mid(); contentMenu.open(p.x, p.y); },
      openCreate: () => { const p = mid(); createMenu.openAt(p.x, p.y); },
      edit: (c) => { void editContent(c); },
    }),
    { id: 'shortcuts', label: 'Keyboard Shortcuts...', run: () => shortcutsDialog.show() },
    { id: 'pen-link', label: 'Pen Link...', enabled: () => platform.features.penLink, run: () => penLink.show() },
    { id: 'recovery-points', label: 'Recovery Points...', enabled: has, run: () => recoveryDialog.show() },
    { id: 'recover-lost', label: 'Recover Lost Movies...', run: () => { void recovery.offer('menu'); } },
  );
  reserveDock(platform.kind === 'ipad');
  const dock: Dock<'antigravity'> | null = platform.kind === 'ipad' ? null : new Dock(formmorpheusDock({
    context: () => {
      const m = engine.movie;
      if (!m) return 'FormMorpheus window: no movie open';
      const chosen = engine.selection.content;
      return `FormMorpheus window: movie "${m.name}", frame ${engine.frame + 1} of ${m.duration}${chosen.length ? `, selected content ids ${chosen.slice(0, 40).join(', ')}` : ''}`;
    },
    openSettings: () => settings.show('Agents'),
    layerOpen: () => anyDialogOpen(),
    firstRun: () => !home.isShown && !anyDialogOpen(),
  }));
  if (dock) {
    dock.mount(root, q(root, '.cv-status'));
    document.addEventListener('fm:dock-open', () => { if (dock.isOpen()) dock.focus(); else dock.toggle(true); });
    commands.add(
      { id: 'view-terminal', label: 'Terminal', icon: 'terminal', keys: ['Mod+`'], checked: () => dock.isOpen(), run: () => dock.toggle() },
      { id: 'new-terminal', label: 'New Terminal', icon: 'terminal', run: () => { void dock.newTerminal(); } },
      { id: 'claude-code', label: 'Claude Code', icon: 'agent', keys: ['Shift+Mod+`', 'Shift+Mod+~'], run: () => { void dock.show('claude'); } },
    );
    void outsideAgents.restore();
    startAgentBridge({
      engine, renderer, audio: () => audio,
      open: openFromLibrary,
      save: () => save(false, { quiet: true }),
      commitOpen: () => (paint.isOpen() ? paint.done(true) : Promise.resolve()),
      importFile: (file, at, row) => importFiles([file], { drop: { where: 'timeline', ...(at === undefined ? {} : { frame: at }), ...(row === undefined ? {} : { index: row }) } }),
      exportBusy: () => exportDialog.running,
      listed: () => home.sync(),
    });
  }
  for (const [id, keys] of Object.entries(prefs.shortcuts)) if (commands.get(id)) commands.setKeys(id, keys);
  paint.useCommands(commands);

  setupOnboarding({ commands, engine, openMovie: openFromLibrary, closeHome: () => home.hide() });
  setupHelpCenter({ commands, engine, askToKeep, closeHome: () => home.hide() });
  menus.push(
    { label: 'File', items: () => ['new', 'new-from-scene', 'new-flipbook', 'open', 'open-file', ...(prefs.recent.length ? [{ label: 'Open Recent', items: prefs.recent.slice(0, 10).map((r) => `recent:${r}`) }] : []), '-', 'save', 'save-as', '-', 'export', 'export-fmo', 'export-fmo-history', { label: 'Round Trips', items: ['export-fvd', 'export-fvfx', 'export-char-svg', '-', 'import-fvd', 'import-fvfx'] }, '-', 'import-media', '-', 'close'] },
    { label: 'Edit', items: ['undo', 'redo', '-', 'cut', 'copy', 'paste', 'duplicate', 'duplicate-after', 'delete', '-', 'select-all', 'deselect', '-', 'recovery', 'recovery-points', 'recover-lost', '-', 'shortcuts', ...(platform.features.penLink ? ['pen-link'] : []), 'settings'] },
    { label: 'Movie', items: ['movie-settings', 'fit-to-content', '-', 'play', 'prev-frame', 'next-frame', 'go-start', 'go-end', '-', 'loop-in', 'loop-out', 'loop-clear'] },
    { label: 'Content', items: [{ label: 'Add', items: ['add-drawing', 'add-flipbook', FLIP_FPS_MENU, 'add-text', ...SHAPE_CREATE_ITEMS, 'add-track', '-', 'import-photo', 'import-video', 'import-audio', 'import-file', '-', 'generate-voice', 'subtitles'] }, '-', 'split', 'fill-duration', 'push-content-left', 'push-content-right', 'flip-order', '-', { label: 'Size on Stage', items: ['size-fit', 'size-fill', 'size-original', '-', { label: 'Default on import', items: ['import-size-fit', 'import-size-fill', 'import-size-original'] }] }, { label: 'Speed', items: ['reverse-clip', 'freeze-frame', 'speed-reset'] }, { label: 'Keyframe tools', items: ['key-reverse', '-', 'keys-loop', 'keys-pingpong', 'keys-cycle', '-', 'keys-orient', 'keys-thin'] }, '-', 'group', 'ungroup', 'character.make', 'character.save', 'character.mouth', 'character.builder', 'character.builder-edit', { label: 'Actions', items: ACTION_MENU_ITEMS }] },
    { label: 'View', items: ['home', '-', 'mode-compose', 'mode-perform', 'mode-keyframe', '-', 'multi-select', 'timeline-in', 'timeline-out', 'timeline-in-h', 'timeline-out-h', 'timeline-in-v', 'timeline-out-v', 'timeline-fit', 'timeline-zoom-selection', 'timeline-zoom-loop', 'timeline-headers', 'timeline-collapse', 'timeline-expand', 'track-lock', 'timeline-snap', 'snap-seconds', 'timeline-ruler-drag', 'preview-sounds', 'marker-add', 'marker-prev', 'marker-next', 'beat-markers', 'marker-clear', 'graph-editor', 'media-bin', 'characters-panel', '-', 'stage-options', { label: 'Stage', items: ['stage-zoom-in', 'stage-zoom-out', 'stage-fit', 'stage-zoom-100', '-', 'stage-rotate-left', 'stage-rotate-right', 'stage-rotate-reset', '-', 'stage-background', 'stage-timecode'] }, 'stage-fullscreen', ...(dock ? ['-', 'view-terminal', 'new-terminal', 'claude-code'] : []), '-', 'search', ...(platform.kind === 'ipad' ? [] : ['-', 'chrome-hide-menu', 'chrome-hide-status', 'menus-in-window', 'custom-title-bar'])] },
    { label: 'Help', items: ['help-center', 'help', 'help-tutorials', 'help-idea', 'help-web', 'whats-new', 'tour', '-', 'reset-examples', '-', 'about'] },
  );
  const syncRecentCommands = (): void => {
    for (const r of prefs.recent.slice(0, 10)) if (!commands.get(`recent:${r}`)) commands.add({ id: `recent:${r}`, label: r, run: () => { void openFromLibrary(r); } });
  };
  syncRecentCommands();
  engine.on('saved', syncRecentCommands);
  engine.on('projects', syncRecentCommands);

  setMenuStyle(prefs.menuHidden, prefs.menuColors);
  const menubar = new MenuBar(q(root, '.cv-menubar'), commands, menus);
  if (wantsNativeMenus()) {
    const native = new NativeMenus(commands, () => menus);
    void native.build().catch(() => undefined);
    for (const ev of ['movie', 'selection', 'history', 'mode', 'playing'] as const) engine.on(ev, () => native.refresh());
    engine.on('projects', () => { void native.build().catch(() => undefined); });
  }
  if (platform.kind === 'ipad') {
    installIpadMenu({ commands, menus: () => menus, paintOpen: () => paint.isOpen(), onChange: (fn) => { for (const ev of ['movie', 'selection', 'history', 'mode', 'playing', 'projects', 'saved'] as const) engine.on(ev, fn); } });
    installIpadShell({ engine, openFromLibrary, openFromPath, importFile: (file) => importFiles([file], { preview: true }) });
  }

  new TitleTools(q(root, '.cv-titlebar'), { commands });
  const captions = new CaptionButtons(q(root, '.cv-titlebar'), () => stored(CUSTOM_TITLE_KEY) === '1');
  enhanceAllSelects();

  const docTitle = q(root, '.cv-tb-doc');
  new TitleName(docTitle, engine);
  let windowTitle = '';
  const syncTitle = (): void => {
    const m = engine.movie;
    const shown = movieLabel(engine);
    setText(docTitle, shown);
    const title = m ? `${shown} - FormMorpheus` : 'FormMorpheus';
    if (title === windowTitle) return;
    windowTitle = title;
    document.title = title;
    if ('__TAURI_INTERNALS__' in window) void import('@tauri-apps/api/core').then((mod) => mod.invoke('set_window_title', { title })).catch(() => undefined);
  };
  for (const ev of ['projects', 'movie', 'saved'] as const) engine.on(ev, syncTitle);
  syncTitle();

  let chromeFrame = 0;
  const syncChrome = (): void => {
    if (chromeFrame) return;
    chromeFrame = requestAnimationFrame(() => {
      chromeFrame = 0;
      for (const b of Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-cmd]'))) {
        const cmd = commands.get(b.dataset.cmd ?? '');
        if (!cmd) continue;
        setDisabled(b, !commands.enabled(cmd));
        const label = commands.label(cmd).replace(/\.\.\.$/, '');
        const keys = commands.keyLabel(cmd);
        setTitle(b, keys ? `${label} (${keys})` : label);
      }
    });
  };
  for (const ev of ['projects', 'history', 'selection', 'movie', 'mode'] as const) engine.on(ev, syncChrome);
  syncChrome();
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cmd]');
    if (b && root.contains(b) && !b.disabled) commands.run(b.dataset.cmd ?? '');
  });
  document.getElementById('overlay-root')?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cmd]');
    if (b && !b.disabled && b.closest('.cv-home')) commands.run(b.dataset.cmd ?? '');
  });

  installNumberFields();
  installA11y(engine);
  installTextWarpNote(engine);
  window.addEventListener('keydown', (e) => {
    if (anyDialogOpen() || e.defaultPrevented || paint.isOpen()) return;
    if (menubar.isOpen || createMenu.isOpen) {
      if (e.key === 'Escape') { e.preventDefault(); menubar.close(); createMenu.close(); }
      return;
    }
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (home.isShown && e.key !== 'Escape' && e.key !== 'F1' && !(e.metaKey || e.ctrlKey)) return;
    const cmd = commands.forEvent(e);
    if (!cmd) return;
    // full-screen preview only plays and scrubs, as the reference: no key may change the movie
    if (stage.nav.preview && !/^(play|play-pause|toggle-play|prev-frame|next-frame|stage-fullscreen|stage-full-screen|stage-preview|first-frame|last-frame|back-one-second|forward-one-second)$/.test(cmd.id)) return;
    e.preventDefault();
    if (!e.repeat || /^(undo|redo|prev-frame|next-frame)$/.test(cmd.id)) commands.run(cmd.id);
  });
  installHeldZoom((e) => commands.forEvent(e)?.id, (f) => { if (stageHovered()) stage?.nav.zoomBy(f); else timeline?.zoomBy(f); });
  // two-finger tap undoes, three-finger tap redoes (held: repeats); pinch, hold and the rest live in ui/gestures.ts
  gestures.actions = { undo: () => { engine.undo(); }, redo: () => { engine.redo(); } };
  gestures.install();
  installUndoUi(engine, () => q(root, '.fm-stage-wrap'), (c) => { commands.run(c); });
  installPenPlay();

  const split = q(root, '.fm-split');
  const main = q(root, '.fm-main');
  /** Dragging the Timeline divider all the way to the bottom reaches the full Flipbook (Draw & Paint) of the selected Drawing or Flipbook. */
  const fullFlipbook = (raw: number): void => {
    if (raw < 0.96 || !engine.movie) return;
    const c = engine.selection.content.map((id) => findContent(engine.movie!, id)).find((x) => x && (x.kind === 'flipbook' || x.kind === 'drawing'));
    if (c) void paint.open(c.id);
  };
  split.addEventListener('pointerdown', (e) => {
    split.setPointerCapture(e.pointerId);
    const r = main.getBoundingClientRect();
    let raw = 0;
    const move = (ev: PointerEvent): void => {
      raw = (ev.clientY - r.top) / r.height;
      const share = Math.min(0.8, Math.max(0.25, raw));
      document.documentElement.style.setProperty('--fm-stage-share', share.toFixed(3));
    };
    const up = (): void => {
      split.removeEventListener('pointermove', move);
      split.removeEventListener('pointerup', up);
      fullFlipbook(raw);
      const v = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fm-stage-share')) || 0.56;
      prefs = updatePrefs({ stageShare: v });
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', up);
  });
  // hold the central toolbar's empty space, or the strip just above the Ruler, then drag: resizes the Stage against the Timeline
  const tlRoot = q(root, '.fm-timeline');
  tlRoot.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !(e.target instanceof Element)) return;
    const bar = e.target.closest('.fm-transport');
    if (!bar || e.target.closest('button, canvas, input, select, a')) return;
    const rulerTop = tlRoot.querySelector('.fm-tl-ruler')?.getBoundingClientRect().top ?? Infinity;
    const nearRuler = e.clientY >= rulerTop - 14;
    const id = e.pointerId, y0 = e.clientY, r = main.getBoundingClientRect();
    let armed = false, raw = 0;
    const arm = (): void => { armed = true; tlRoot.classList.add('is-resizing'); try { tlRoot.setPointerCapture(id); } catch { /* pointer already gone */ } };
    const timer = window.setTimeout(arm, nearRuler ? 120 : 450);
    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== id) return;
      if (!armed) {
        if (Math.abs(ev.clientY - y0) > (nearRuler ? 3 : 8)) { if (nearRuler || ev.pointerType === 'mouse') arm(); else { window.clearTimeout(timer); end(); } }
        return;
      }
      ev.preventDefault();
      raw = (ev.clientY - r.top) / r.height;
      const share = Math.min(0.8, Math.max(0.25, raw));
      document.documentElement.style.setProperty('--fm-stage-share', share.toFixed(3));
    };
    const end = (): void => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      tlRoot.classList.remove('is-resizing');
      if (armed) { prefs = updatePrefs({ stageShare: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fm-stage-share')) || 0.56 }); fullFlipbook(raw); }
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
  });

  const drop = q(root, '.cv-drop');
  let depth = 0;
  const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; drop.hidden = false; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); timeline?.fileDragOver(e.clientX, e.clientY); } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) { drop.hidden = true; timeline?.fileDragEnd(); } });
  window.addEventListener('drop', (e) => {
    timeline?.fileDragEnd();
    if (!hasFiles(e)) return;
    // a brush file was already taken by ui/brush-drop
    if (e.defaultPrevented) { depth = 0; drop.hidden = true; return; }
    e.preventDefault();
    depth = 0;
    drop.hidden = true;
    // dropped on the Timeline: at the track and time under the pointer; on the Stage: at the Playhead on the top track
    const tl = timeline?.dropTarget(e.clientX, e.clientY);
    const onStage = !tl && !!(e.target instanceof Element && e.target.closest('.fm-stage-wrap'));
    const dropOpts: ImportOptions = tl ? { drop: { where: 'timeline', frame: tl.frame, index: tl.index } } : onStage ? { drop: { where: 'stage' } } : {};
    void filesOfDrop(e.dataTransfer).then((fs) => importFiles(fs, dropOpts));
  });
  window.addEventListener('beforeunload', (e) => { if (engine.movie && engine.modified && !('__TAURI_INTERNALS__' in window)) e.preventDefault(); });

  status.setEngine('Engine: checking');
  const probe = (): void => {
    void capabilities().then((c) => status.setEngine(c ? `${t('Engine')} ${c.version}${c.desktop ? ` · ${t('desktop')}` : ''}` : 'Engine offline', c ? c.libraryDir : t('The engine service saves and opens movies in the library. Start it with ./formmorpheus.')));
  };
  probe();
  onServiceChange(() => probe());

  applyShellPrefs(prefs);
  const faces = Promise.all(['400', '500', '600'].map((w) => document.fonts.load(`${w} 12px Inter`)));
  void Promise.race([faces, new Promise((r) => window.setTimeout(r, 2500))]).then(() => requestAnimationFrame(() => revealApp()));
}
