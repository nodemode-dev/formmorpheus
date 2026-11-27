// The AI Voice card: type words, pick a voice (the built-in one, a voice app on this computer, or an online one with
// the person's own key) and speak them onto the Timeline at the playhead. Built once, then patched in place.
import type { Engine } from '../engine/engine';
import { timecode } from '../engine/time';
import { ApiError } from '../io/api';
import { voiceApi, type SpeakRequest, type VoiceJob, type VoiceOption, type VoiceStatus } from '../io/voice-api';
import type { SpokenOnTimeline } from '../app/voice-commands';
import { confirmAction } from './dialogs';
import { el, patchList, q, setClass, setDisabled, setHidden, setStyleVar, setText, setValue } from './dom';
import { enhanceSelect } from './dropdown';
import { t } from './i18n';
import '../styles/ai-voice.css';

type Tab = 'offline' | 'online';
type Source = 'builtin' | 'local';

interface Opts { tab: Tab; engine: Source; voice: { builtin?: string; online?: string }; speed: number; local: { base: string; model: string; voice: string } }
const DEFAULTS: Opts = { tab: 'offline', engine: 'builtin', voice: {}, speed: 1, local: { base: '', model: '', voice: '' } };
const STORE = 'formmorpheus.aivoice';
const MAX_OFFLINE = 10000;
const MAX_ONLINE = 2000;
const POLL_MS = 700;

const X = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function loadOpts(): Opts {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Opts>;
    return { ...DEFAULTS, ...raw, voice: { ...(raw.voice ?? {}) }, local: { ...DEFAULTS.local, ...(raw.local ?? {}) } };
  } catch { return { ...DEFAULTS, voice: {}, local: { ...DEFAULTS.local } }; }
}

const mb = (bytes: number): string => (bytes / 1048576).toFixed(0);
const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';
const message = (e: unknown): string => (e instanceof ApiError || e instanceof Error ? e.message : String(e));

/** Moves `nodes` into `parent` in that order, reusing the nodes already there; anything else in `parent` goes. */
function place(parent: Element, nodes: Element[]): void {
  let cur = parent.firstElementChild;
  for (const n of nodes) {
    if (n === cur) { cur = cur.nextElementSibling; continue; }
    parent.insertBefore(n, cur);
  }
  while (cur) { const next = cur.nextElementSibling; cur.remove(); cur = next; }
}

/** A keyed in-place update of a select's options (under optgroups when `grouped`): unchanged lists are not touched. */
function syncOptions(sel: HTMLSelectElement, items: VoiceOption[], grouped: boolean, want: string): void {
  const sig = items.map((v) => `${grouped ? v.group ?? '' : ''}\u0001${v.id}\u0001${v.name}`).join('\u0002');
  if (sel.dataset.sig !== sig) {
    sel.dataset.sig = sig;
    const opts = new Map<string, HTMLOptionElement>();
    for (const o of Array.from(sel.querySelectorAll('option'))) opts.set(o.value, o);
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const g of Array.from(sel.querySelectorAll('optgroup'))) groups.set(g.label, g);
    const top: Element[] = [];
    const kids = new Map<Element, Element[]>();
    for (const v of items) {
      const o = opts.get(v.id) ?? new Option(v.name, v.id);
      if (o.textContent !== v.name) o.textContent = v.name;
      const label = grouped ? v.group ?? '' : '';
      if (!label) { top.push(o); continue; }
      let g = groups.get(label);
      if (!g) { g = document.createElement('optgroup'); g.label = label; groups.set(label, g); }
      let list = kids.get(g);
      if (!list) { list = []; kids.set(g, list); top.push(g); }
      list.push(o);
    }
    for (const [g, list] of kids) place(g, list);
    place(sel, top);
  }
  const pick = items.some((v) => v.id === want) ? want : items[0]?.id ?? '';
  if (sel.value !== pick) sel.value = pick;
}

export class AiVoicePanel {
  private readonly root: HTMLElement;
  private readonly err: HTMLElement;
  private readonly tabs: Record<Tab, HTMLButtonElement>;
  private readonly panels: Record<Tab, HTMLElement>;
  private readonly source: HTMLSelectElement;
  private readonly builtinBox: HTMLElement;
  private readonly setupBox: HTMLElement;
  private readonly setupBtn: HTMLButtonElement;
  private readonly setupCancel: HTMLButtonElement;
  private readonly prog: HTMLElement;
  private readonly stepLine: HTMLElement;
  private readonly readyBox: HTMLElement;
  private readonly builtinVoice: HTMLSelectElement;
  private readonly speed: HTMLInputElement;
  private readonly speedVal: HTMLElement;
  private readonly removeBtn: HTMLButtonElement;
  private readonly localBox: HTMLElement;
  private readonly base: HTMLInputElement;
  private readonly model: HTMLInputElement;
  private readonly localVoice: HTMLInputElement;
  private readonly modelList: HTMLDataListElement;
  private readonly voiceList: HTMLDataListElement;
  private readonly checkBtn: HTMLButtonElement;
  private readonly checkLine: HTMLElement;
  private readonly localKey: HTMLInputElement;
  private readonly keyBox: HTMLElement;
  private readonly onlineKey: HTMLInputElement;
  private readonly saveKeyBtn: HTMLButtonElement;
  private readonly keyNote: HTMLElement;
  private readonly onlineBox: HTMLElement;
  private readonly onlineVoice: HTMLSelectElement;
  private readonly forgetBtn: HTMLButtonElement;
  private readonly text: HTMLTextAreaElement;
  private readonly count: HTMLElement;
  private readonly startLine: HTMLElement;
  private readonly go: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private readonly status: HTMLElement;
  private opts = loadOpts();
  private st: VoiceStatus | null = null;
  private job: VoiceJob | null = null;
  private builtinVoices: VoiceOption[] | null = null;
  private onlineVoices: VoiceOption[] | null = null;
  private loadingBuiltin = false;
  private loadingOnline = false;
  private busy = false;
  private ctrl: AbortController | null = null;
  private pollTimer = 0;
  private open = false;
  private keyDirty = false;
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly engine: Engine, private readonly speak: (req: SpeakRequest, signal: AbortSignal) => Promise<SpokenOnTimeline | null>) {
    const row = (label: string, control: HTMLElement): HTMLElement => {
      const r = el<HTMLElement>('<div class="fm-aiv-row"><span class="fm-aiv-lab"></span></div>');
      setText(q(r, '.fm-aiv-lab'), t(label));
      r.appendChild(control);
      return r;
    };
    const named = <T extends HTMLElement>(html: string, label: string): T => { const n = el<T>(html); n.setAttribute('aria-label', t(label)); return n; };
    const button = (cls: string, label: string): HTMLButtonElement => { const b = el<HTMLButtonElement>(`<button class="${cls}" type="button"></button>`); setText(b, t(label)); return b; };
    const para = (cls: string, label: string): HTMLElement => { const p = el<HTMLElement>(`<p class="${cls}"></p>`); setText(p, t(label)); return p; };

    this.root = el<HTMLElement>(
      '<section class="fm-aiv" role="dialog" hidden>' +
      '<div class="fm-aiv-head"><span class="fm-aiv-title"></span><button class="fm-aiv-x" type="button"></button></div>' +
      '<div class="fm-aiv-tabs" role="tablist"></div>' +
      '<div class="fm-aiv-err" role="alert" hidden></div>' +
      '<div class="fm-aiv-body"></div></section>');
    this.root.setAttribute('aria-label', t('AI Voice'));
    setText(q(this.root, '.fm-aiv-title'), t('AI Voice'));
    const closeBtn = q<HTMLButtonElement>(this.root, '.fm-aiv-x');
    closeBtn.innerHTML = X;
    closeBtn.setAttribute('aria-label', t('Close'));
    closeBtn.addEventListener('click', () => this.close());
    this.err = q(this.root, '.fm-aiv-err');

    // ---- tabs ----
    const tablist = q(this.root, '.fm-aiv-tabs');
    tablist.setAttribute('aria-label', t('AI Voice'));
    const mkTab = (id: Tab, label: string): HTMLButtonElement => {
      const b = el<HTMLButtonElement>(`<button class="fm-aiv-tab" type="button" role="tab" id="fm-aiv-tab-${id}" aria-controls="fm-aiv-panel-${id}"></button>`);
      setText(b, t(label));
      b.addEventListener('click', () => this.pickTab(id));
      tablist.appendChild(b);
      return b;
    };
    this.tabs = { offline: mkTab('offline', 'Offline'), online: mkTab('online', 'Online') };
    tablist.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      e.stopPropagation();
      const next: Tab = e.key === 'Home' ? 'offline' : e.key === 'End' ? 'online' : this.opts.tab === 'offline' ? 'online' : 'offline';
      this.pickTab(next);
      this.tabs[next].focus();
    });
    const mkPanel = (id: Tab): HTMLElement => el<HTMLElement>(`<div class="fm-aiv-panel" role="tabpanel" id="fm-aiv-panel-${id}" aria-labelledby="fm-aiv-tab-${id}"></div>`);
    this.panels = { offline: mkPanel('offline'), online: mkPanel('online') };

    // ---- offline: the built-in voice ----
    this.source = named<HTMLSelectElement>('<select class="cv-input"></select>', 'Voice from');
    this.source.append(new Option(t('Built-in voice'), 'builtin'), new Option(t('Voice app on this computer'), 'local'));
    this.builtinBox = el<HTMLElement>('<div class="fm-aiv-src"></div>');
    this.setupBox = el<HTMLElement>('<div class="fm-aiv-setup" hidden></div>');
    this.setupBtn = button('cv-btn', 'Set up the built-in voice');
    this.setupCancel = button('cv-btn', 'Cancel');
    this.prog = el<HTMLElement>('<div class="fm-aiv-prog is-idle" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="fm-aiv-fill"></div></div>');
    this.prog.setAttribute('aria-label', t('Setup progress'));
    this.stepLine = el<HTMLElement>('<div class="fm-aiv-step" aria-live="polite"></div>');
    const setupActs = el<HTMLElement>('<div class="fm-aiv-acts"></div>');
    setupActs.append(this.setupBtn, this.setupCancel);
    this.setupBox.append(
      para('fm-aiv-note', 'The built-in voice runs on this computer. It needs a one-time setup of about 400 MB, and Python 3.10 to 3.13 for its own runtime.'),
      this.prog, this.stepLine, setupActs,
    );
    this.readyBox = el<HTMLElement>('<div class="fm-aiv-ready" hidden></div>');
    this.builtinVoice = named<HTMLSelectElement>('<select class="cv-input"></select>', 'Voice');
    this.speed = named<HTMLInputElement>('<input type="range" min="0.5" max="2" step="0.05">', 'Speed');
    this.speedVal = el<HTMLElement>('<span class="fm-aiv-val"></span>');
    const speedRow = el<HTMLElement>('<div class="fm-aiv-speed"></div>');
    speedRow.append(this.speed, this.speedVal);
    this.removeBtn = button('fm-aiv-link is-danger', 'Remove the built-in voice');
    this.readyBox.append(row('Voice', this.builtinVoice), row('Speed', speedRow), this.removeBtn);
    this.builtinBox.append(this.setupBox, this.readyBox);

    // ---- offline: a voice app on this computer ----
    this.localBox = el<HTMLElement>('<div class="fm-aiv-src" hidden></div>');
    this.base = named<HTMLInputElement>('<input class="cv-input" type="url" spellcheck="false" autocomplete="off" placeholder="http://127.0.0.1:8080">', 'Address');
    this.modelList = el<HTMLDataListElement>('<datalist id="fm-aiv-models"></datalist>');
    this.voiceList = el<HTMLDataListElement>('<datalist id="fm-aiv-voices"></datalist>');
    this.model = named<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off" list="fm-aiv-models">', 'Model');
    this.localVoice = named<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off" list="fm-aiv-voices">', 'Voice');
    this.checkBtn = button('cv-btn', 'Check');
    const baseRow = el<HTMLElement>('<div class="fm-aiv-split"></div>');
    baseRow.append(this.base, this.checkBtn);
    this.checkLine = el<HTMLElement>('<div class="fm-aiv-line" aria-live="polite"></div>');
    this.localKey = named<HTMLInputElement>('<input class="cv-input" type="password" autocomplete="off">', 'Key');
    this.localKey.placeholder = t('Only if the app asks for one');
    this.localBox.append(
      row('Address', baseRow), this.checkLine, row('Model', this.model), row('Voice', this.localVoice), row('Key', this.localKey),
      this.modelList, this.voiceList,
      para('fm-aiv-note', 'Any voice app on this computer that answers the common speech API works here, a cloned voice included. Start the app first.'),
    );
    this.panels.offline.append(row('Voice from', this.source), this.builtinBox, this.localBox);

    // ---- online ----
    this.keyBox = el<HTMLElement>('<div class="fm-aiv-src"></div>');
    this.onlineKey = named<HTMLInputElement>('<input class="cv-input" type="password" autocomplete="off">', 'Key');
    this.saveKeyBtn = button('cv-btn', 'Save key');
    const keyRow = el<HTMLElement>('<div class="fm-aiv-split"></div>');
    keyRow.append(this.onlineKey, this.saveKeyBtn);
    this.keyNote = para('fm-aiv-note', 'Your own ElevenLabs key. It is kept in this computer\'s keychain and sent only to that service.');
    this.keyBox.append(row('Key', keyRow), this.keyNote);
    this.onlineBox = el<HTMLElement>('<div class="fm-aiv-src" hidden></div>');
    this.onlineVoice = named<HTMLSelectElement>('<select class="cv-input"></select>', 'Voice');
    this.forgetBtn = button('fm-aiv-link', 'Forget key');
    this.onlineBox.append(row('Voice', this.onlineVoice), this.forgetBtn);
    this.panels.online.append(this.keyBox, this.onlineBox);

    // ---- the words and the foot ----
    this.text = el<HTMLTextAreaElement>(`<textarea class="cv-input fm-aiv-text" rows="5" maxlength="${MAX_OFFLINE}"></textarea>`);
    this.text.setAttribute('aria-label', t('What to say'));
    const textHead = el<HTMLElement>('<div class="fm-aiv-texthead"><label class="fm-aiv-lab" for="fm-aiv-text"></label><span class="fm-aiv-count" aria-live="polite"></span></div>');
    this.text.id = 'fm-aiv-text';
    setText(q(textHead, 'label'), t('What to say'));
    this.count = q(textHead, '.fm-aiv-count');
    this.startLine = el<HTMLElement>('<div class="fm-aiv-start"></div>');
    this.go = button('cv-btn fm-aiv-go', 'Speak');
    this.cancel = button('cv-btn', 'Cancel');
    setHidden(this.cancel, true);
    const acts = el<HTMLElement>('<div class="fm-aiv-acts"></div>');
    acts.append(this.go, this.cancel);
    this.status = el<HTMLElement>('<div class="fm-aiv-status" aria-live="polite"></div>');
    q(this.root, '.fm-aiv-body').append(this.panels.offline, this.panels.online, textHead, this.text, this.startLine, acts, this.status);

    (document.getElementById('overlay-root') ?? document.body).appendChild(this.root);
    enhanceSelect(this.source);
    enhanceSelect(this.builtinVoice);
    enhanceSelect(this.onlineVoice);

    // ---- wiring ----
    this.source.addEventListener('change', () => { this.opts.engine = this.source.value === 'local' ? 'local' : 'builtin'; this.persist(); this.clearErr(); this.patch(); });
    this.builtinVoice.addEventListener('change', () => { this.opts.voice.builtin = this.builtinVoice.value; this.persist(); });
    this.onlineVoice.addEventListener('change', () => { this.opts.voice.online = this.onlineVoice.value; this.persist(); });
    this.speed.addEventListener('input', () => { this.opts.speed = Number(this.speed.value) || 1; this.persist(); this.patchSpeed(); });
    const keepLocal = (): void => { this.opts.local = { base: this.base.value.trim(), model: this.model.value.trim(), voice: this.localVoice.value.trim() }; this.persist(); this.patch(); };
    for (const f of [this.base, this.model, this.localVoice]) f.addEventListener('input', keepLocal);
    this.localKey.addEventListener('input', () => { this.keyDirty = true; });
    this.checkBtn.addEventListener('click', () => { void this.check(); });
    this.setupBtn.addEventListener('click', () => { void this.startSetup(); });
    this.setupCancel.addEventListener('click', () => { void this.cancelSetup(); });
    this.removeBtn.addEventListener('click', () => { void this.removeBuiltin(); });
    this.saveKeyBtn.addEventListener('click', () => { void this.saveKey(); });
    this.onlineKey.addEventListener('input', () => this.patch());
    this.onlineKey.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void this.saveKey(); } });
    this.forgetBtn.addEventListener('click', () => { void this.forgetKey(); });
    this.text.addEventListener('input', () => this.patch());
    this.go.addEventListener('click', () => { void this.run(); });
    this.cancel.addEventListener('click', () => this.ctrl?.abort());
    this.root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this.running()) return;
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });
    this.engine.on('time', () => { if (this.open) this.patchStart(); });
    this.engine.on('projects', () => { if (this.open) this.patch(); });
    this.patch();
  }

  /** Shows the card on `tab` (else the last one used) and reads where each voice stands. */
  show(tab?: Tab): void {
    if (tab) { this.opts.tab = tab; this.persist(); }
    const was = this.open;
    this.open = true;
    if (!was) this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setHidden(this.root, false);
    this.syncControls();
    this.patch();
    if (!was) this.text.focus();
    void this.refresh();
  }

  // Closing aborts nothing: a speak that is running finishes and lands on the Timeline.
  close(): void {
    if (!this.open) return;
    this.open = false;
    window.clearTimeout(this.pollTimer);
    this.pollTimer = 0;
    const inside = this.root.contains(document.activeElement);
    setHidden(this.root, true);
    if (inside && this.returnFocus?.isConnected) this.returnFocus.focus();
    this.returnFocus = null;
  }

  private persist(): void {
    try { localStorage.setItem(STORE, JSON.stringify(this.opts)); } catch { /* kept for this session only */ }
  }

  private running(): boolean { return !!this.ctrl || this.job?.state === 'running'; }

  private syncControls(): void {
    const o = this.opts;
    this.source.value = o.engine;
    this.speed.value = String(o.speed);
    setValue(this.base, o.local.base);
    setValue(this.model, o.local.model);
    setValue(this.localVoice, o.local.voice);
    this.patchSpeed();
  }

  private pickTab(tab: Tab): void {
    if (this.opts.tab === tab) return;
    this.opts.tab = tab;
    this.persist();
    this.clearErr();
    this.patch();
    if (tab === 'online') void this.loadOnline();
  }

  private showErr(text: string): void { setText(this.err, text); setHidden(this.err, false); }
  private clearErr(): void { setHidden(this.err, true); }

  // ---- reading the engine ----

  private async refresh(): Promise<void> {
    try {
      this.st = await voiceApi.status();
    } catch (e) {
      this.showErr(message(e));
      this.patch();
      return;
    }
    const loc = this.st.local;
    if (!this.opts.local.base && !this.opts.local.model && !this.opts.local.voice) {
      this.opts.local = { base: loc.base, model: loc.model, voice: loc.voice };
      setValue(this.base, loc.base);
      setValue(this.model, loc.model);
      setValue(this.localVoice, loc.voice);
    }
    this.job = this.st.builtin.job;
    if (this.job?.state === 'running') this.poll();
    if (this.st.builtin.ready) void this.loadBuiltin();
    if (this.opts.tab === 'online') void this.loadOnline();
    this.patch();
  }

  private async loadBuiltin(force = false): Promise<void> {
    if (this.loadingBuiltin || (this.builtinVoices && !force)) return;
    this.loadingBuiltin = true;
    try {
      this.builtinVoices = await voiceApi.builtinVoices();
    } catch (e) {
      this.showErr(message(e));
    } finally {
      this.loadingBuiltin = false;
    }
    syncOptions(this.builtinVoice, this.builtinVoices ?? [], true, this.opts.voice.builtin ?? 'af_heart');
    this.patch();
  }

  private async loadOnline(force = false): Promise<void> {
    if (!this.st?.online.hasKey || this.loadingOnline || (this.onlineVoices && !force)) return;
    this.loadingOnline = true;
    try {
      this.onlineVoices = await voiceApi.onlineVoices();
    } catch (e) {
      this.showErr(message(e));
    } finally {
      this.loadingOnline = false;
    }
    syncOptions(this.onlineVoice, this.onlineVoices ?? [], true, this.opts.voice.online ?? '');
    this.patch();
  }

  // ---- the built-in voice's setup ----

  private async startSetup(): Promise<void> {
    this.clearErr();
    try {
      this.job = await voiceApi.setupBuiltin();
    } catch (e) {
      this.showErr(message(e));
      return;
    }
    this.patch();
    this.poll();
  }

  /** Polls the setup only while the card is open and the setup runs. */
  private poll(): void {
    window.clearTimeout(this.pollTimer);
    this.pollTimer = window.setTimeout(() => { void this.pollOnce(); }, POLL_MS);
  }

  private async pollOnce(): Promise<void> {
    this.pollTimer = 0;
    if (!this.open) return;
    let job: VoiceJob | null;
    try {
      job = await voiceApi.builtinJob();
    } catch (e) {
      this.showErr(message(e));
      this.job = null;
      this.patch();
      return;
    }
    this.job = job;
    if (job?.state === 'running') { this.patch(); if (this.open) this.poll(); return; }
    if (job?.state === 'failed') this.showErr(job.error || t('The setup did not finish.'));
    if (job?.state === 'cancelled') setText(this.status, t('Setup cancelled.'));
    if (job?.state === 'done') {
      this.job = null;
      try { this.st = await voiceApi.status(); } catch (e) { this.showErr(message(e)); }
      if (this.st?.builtin.ready) void this.loadBuiltin(true);
    }
    this.patch();
  }

  private async cancelSetup(): Promise<void> {
    try { await voiceApi.cancelBuiltin(); } catch (e) { this.showErr(message(e)); }
  }

  private async removeBuiltin(): Promise<void> {
    const ok = await confirmAction(
      t('Remove the built-in voice?'),
      t('Its runtime and voice model are deleted from this computer. Setting it up again downloads them again.'),
      t('Remove'), true,
    );
    if (!ok) return;
    this.clearErr();
    try {
      await voiceApi.removeBuiltin();
      this.st = await voiceApi.status();
    } catch (e) {
      this.showErr(message(e));
    }
    this.builtinVoices = null;
    syncOptions(this.builtinVoice, [], true, '');
    this.patch();
  }

  // ---- a voice app on this computer ----

  private async check(): Promise<void> {
    const base = this.base.value.trim();
    if (!base) return;
    this.clearErr();
    setText(this.checkLine, t('Checking...'));
    setDisabled(this.checkBtn, true);
    try {
      const p = await voiceApi.probeLocal(base);
      if (!p.ok) {
        setText(this.checkLine, '');
        this.showErr(p.error || t('The voice app did not answer.'));
        return;
      }
      setText(this.checkLine, t('Connected: {models} models, {voices} voices').replace('{models}', String(p.models.length)).replace('{voices}', String(p.voices.length)));
      const items = (vals: Array<{ id: string; name: string }>): Array<{ id: string; name: string }> => vals.filter((v, i) => vals.findIndex((w) => w.id === v.id) === i);
      const fill = (list: HTMLDataListElement, vals: Array<{ id: string; name: string }>): void => {
        patchList(list, items(vals), {
          key: (v) => v.id,
          create: (v) => { const o = document.createElement('option'); o.value = v.id; if (v.name && v.name !== v.id) o.label = v.name; return o; },
          update: (n, v) => { const o = n as HTMLOptionElement; const lab = v.name && v.name !== v.id ? v.name : ''; if (o.label !== lab && lab) o.label = lab; },
        });
      };
      fill(this.modelList, p.models.map((m) => ({ id: m, name: m })));
      fill(this.voiceList, p.voices);
      await this.saveLocal();
    } catch (e) {
      setText(this.checkLine, '');
      this.showErr(message(e));
    } finally {
      setDisabled(this.checkBtn, false);
      this.patch();
    }
  }

  private async saveLocal(): Promise<void> {
    const key = this.keyDirty ? this.localKey.value : undefined;
    const saved = await voiceApi.saveLocal({ base: this.base.value.trim(), model: this.model.value.trim(), voice: this.localVoice.value.trim(), key });
    this.keyDirty = false;
    if (this.st) this.st = { ...this.st, local: saved };
  }

  // ---- the online voice ----

  private async saveKey(): Promise<void> {
    const key = this.onlineKey.value.trim();
    if (!key || !this.st?.online.canStore) return;
    this.clearErr();
    setDisabled(this.saveKeyBtn, true);
    try {
      const online = await voiceApi.setOnlineKey(key);
      this.st = { ...this.st, online };
      this.onlineKey.value = '';
      this.onlineVoices = null;
      void this.loadOnline(true);
    } catch (e) {
      this.showErr(message(e));
    } finally {
      setDisabled(this.saveKeyBtn, false);
      this.patch();
    }
  }

  private async forgetKey(): Promise<void> {
    this.clearErr();
    try {
      const online = await voiceApi.clearOnlineKey();
      if (this.st) this.st = { ...this.st, online };
      this.onlineVoices = null;
      syncOptions(this.onlineVoice, [], true, '');
    } catch (e) {
      this.showErr(message(e));
    }
    this.patch();
  }

  // ---- speaking ----

  private request(): SpeakRequest | null {
    const text = this.text.value.trim();
    if (!text) return null;
    if (this.opts.tab === 'online') {
      const voice = this.onlineVoice.value;
      return this.st?.online.hasKey && voice && text.length <= MAX_ONLINE ? { engine: 'online', text, voice } : null;
    }
    if (this.opts.engine === 'local') {
      const base = this.base.value.trim();
      return base ? { engine: 'local', text, voice: this.localVoice.value.trim(), model: this.model.value.trim() } : null;
    }
    const voice = this.builtinVoice.value;
    if (!this.st?.builtin.ready || !voice) return null;
    const language = this.builtinVoices?.find((v) => v.id === voice)?.language;
    return { engine: 'builtin', text, voice, speed: this.opts.speed, ...(language ? { language } : {}) };
  }

  private async run(): Promise<void> {
    const m = this.engine.movie;
    const req = this.request();
    if (!m || !req || this.ctrl) return;
    this.clearErr();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    const at = timecode(this.engine.frame, m.fps);
    setText(this.status, '');
    this.patch();
    try {
      if (req.engine === 'local') await this.saveLocal();
      const r = await this.speak(req, ctrl.signal);
      if (r) setText(this.status, t('{name} added at {time} · {seconds}').replace('{name}', r.name).replace('{time}', at).replace('{seconds}', `${r.seconds.toFixed(1)} s`));
      else setText(this.status, t('The sound could not be placed on the Timeline.'));
    } catch (e) {
      if (isAbort(e)) setText(this.status, t('Cancelled.'));
      else this.showErr(message(e));
    } finally {
      this.ctrl = null;
      this.patch();
    }
  }

  // ---- patching ----

  private patchSpeed(): void { setText(this.speedVal, `${this.opts.speed.toFixed(2)}×`); }

  private patchStart(): void {
    const m = this.engine.movie;
    setText(this.startLine, m ? t('Starts at {time}').replace('{time}', timecode(this.engine.frame, m.fps)) : t('Open a movie to place the voice on its Timeline.'));
  }

  private patch(): void {
    const tab = this.opts.tab;
    const st = this.st;
    const speaking = !!this.ctrl;
    for (const id of ['offline', 'online'] as const) {
      const on = id === tab;
      this.tabs[id].setAttribute('aria-selected', String(on));
      this.tabs[id].tabIndex = on ? 0 : -1;
      setClass(this.tabs[id], 'is-on', on);
      setHidden(this.panels[id], !on);
    }

    // offline
    const local = this.opts.engine === 'local';
    setHidden(this.builtinBox, local);
    setHidden(this.localBox, !local);
    const job = this.job?.state === 'running' ? this.job : null;
    const ready = !!st?.builtin.ready && !job;
    setHidden(this.setupBox, !st || ready);
    setHidden(this.readyBox, !ready);
    setHidden(this.setupBtn, !!job);
    setHidden(this.setupCancel, !job);
    setClass(this.prog, 'is-idle', !job);
    const sized = !!job && job.step === 'model' && job.total > 0;
    setClass(this.prog, 'is-busy', !!job && !sized);
    const frac = sized ? Math.min(1, job.done / job.total) : 0;
    setStyleVar(this.prog, '--p', frac.toFixed(3));
    if (sized) this.prog.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
    else this.prog.removeAttribute('aria-valuenow');
    let step = '';
    if (job) {
      step = job.step === 'python' ? t('Finding Python') : job.step === 'runtime' ? t('Making the voice\'s runtime') : t('Downloading the voice model');
      if (sized) step += ` · ${t('{done} MB of {total} MB').replace('{done}', mb(job.done)).replace('{total}', mb(job.total))}`;
    }
    setText(this.stepLine, step);
    setDisabled(this.builtinVoice, !this.builtinVoices?.length);
    setDisabled(this.removeBtn, speaking);
    setDisabled(this.checkBtn, !this.base.value.trim());

    // online
    const hasKey = !!st?.online.hasKey;
    const canStore = st?.online.canStore ?? true;
    setHidden(this.keyBox, !st || hasKey);
    setHidden(this.onlineBox, !hasKey);
    setText(this.keyNote, canStore
      ? t('Your own ElevenLabs key. It is kept in this computer\'s keychain and sent only to that service.')
      : t('This computer has no keychain FormMorpheus can use, so a key cannot be kept here.'));
    setClass(this.keyNote, 'is-warn', !canStore);
    setDisabled(this.onlineKey, !canStore);
    setDisabled(this.saveKeyBtn, !canStore || !this.onlineKey.value.trim());
    setDisabled(this.onlineVoice, !this.onlineVoices?.length);

    // the words and the foot
    const n = this.text.value.length;
    const max = tab === 'online' ? MAX_ONLINE : MAX_OFFLINE;
    setText(this.count, `${n} / ${max}`);
    setClass(this.count, 'is-over', n > max);
    this.patchStart();
    setText(this.go, speaking ? t('Speaking...') : t('Speak'));
    setClass(this.go, 'is-busy', speaking);
    setDisabled(this.go, speaking || !this.engine.movie || !this.request());
    setHidden(this.cancel, !speaking);
  }
}
