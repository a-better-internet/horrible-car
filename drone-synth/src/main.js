// Application wiring.

import { PARAMS, BY_ID, VOICES, format, clamp } from './params.js';
import { Store } from './store.js';
import { ModRouter } from './engine/modulation.js';
import { Engine } from './engine/graph.js';
import { loadWorklets } from './engine/worklets.js';
import { Systems } from './systems.js';
import { MacroMatrix, MACRO_IDS, applyXY, DEFAULT_ASSIGNMENTS } from './macros.js';
import { PanelBuilder, el } from './ui/build.js';
import { TABS } from './ui/layout.js';
import { Visualizer } from './ui/visualizer.js';
import { Freezer, Recorder } from './transport.js';
import {
  FACTORY, exportPreset, importPreset, randomisePatch,
  loadUserPresets, saveUserPreset, deleteUserPreset,
} from './presets.js';

const $ = (sel, root = document) => root.querySelector(sel);

function formatClock(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Chips in the always-visible activity bar. The evolving systems are the point
 * of the instrument and they were scattered across two tabs with no way to see
 * whether any of them were doing anything. Each chip lights when its system is
 * live, shows what it is up to, and jumps to its controls when clicked.
 */
function activityDefinitions(store, systems) {
  const plate = (name, label) => ({
    key: name,
    label,
    tab: 'evolve',
    active: () => !!store.get(`${name}DriftEnable`),
    detail: () => formatClock(systems.plateState(name).remainingSeconds),
    title: () => {
      const st = systems.plateState(name);
      return `${label} plate: ${Math.round(st.phase * 100)}% through a ${st.cycleMinutes.toFixed(0)}-minute cycle, ${formatClock(st.remainingSeconds)} to go.`;
    },
    phase: () => systems.plateState(name).phase,
  });
  return [
    {
      key: 'lfo', label: 'LFO', tab: 'modulation',
      active: () => Number(store.get('lfoDepth')) > 0 || Number(store.get('lfoToFilter')) > 0,
      detail: () => format(BY_ID.lfoSpeed, store.get('lfoSpeed')),
      title: () => `Global LFO at ${format(BY_ID.lfoSpeed, store.get('lfoSpeed'))}, ${format(BY_ID.lfoDepth, store.get('lfoDepth'))} of pitch.`,
    },
    {
      key: 'organic', label: 'Organic', tab: 'evolve',
      active: () => Number(store.get('organicDrift')) > 0,
      detail: () => format(BY_ID.organicDrift, store.get('organicDrift')),
      title: () => 'Always-on drift on tuning, image and cutoff.',
    },
    {
      key: 'random', label: 'Drift', tab: 'modulation',
      active: () => Number(store.get('randAmount')) > 0,
      detail: () => format(BY_ID.randRate, store.get('randRate')),
      title: () => `Random drift picks a new target every ${format(BY_ID.randRate, store.get('randRate'))}.`,
    },
    {
      key: 'env', label: 'Follower', tab: 'modulation',
      active: () => Number(store.get('envFollow')) > 0,
      detail: () => `${Math.round(systems.env.level * 100)}%`,
      title: () => 'Envelope follower: input level driving the filter.',
    },
    {
      key: 'gate', label: 'Gate', tab: 'modulation',
      active: () => Number(store.get('probGate')) < 1 && Number(store.get('probDepth')) > 0,
      detail: () => (systems.gate.open ? 'open' : 'shut'),
      title: () => `Probability gate: ${format(BY_ID.probGate, store.get('probGate'))} chance at ${format(BY_ID.probRate, store.get('probRate'))}.`,
    },
    {
      key: 'seq', label: 'Sequencer', tab: 'modulation',
      active: () => !!store.get('seqOn'),
      detail: () => `${systems.seq.index + 1}/${Math.round(Number(store.get('seqLength')))}`,
      title: () => `Step sequencer on step ${systems.seq.index + 1}, ${format(BY_ID.seqStepTime, store.get('seqStepTime'))} per step.`,
    },
    {
      key: 'morph', label: 'Morph', tab: 'oscillators',
      active: () => !!store.get('morphEnable'),
      detail: () => format(BY_ID.waveMorph, store.get('waveMorph')),
      title: () => 'Wave morph is engaged and owns the sine, square and sawtooth levels.',
    },
    plate('harmonic', 'Harmonic'),
    plate('timbral', 'Timbral'),
    plate('spatial', 'Spatial'),
    {
      key: 'evolve', label: 'Auto-Evolve', tab: 'evolve',
      active: () => !!store.get('autoEvolve'),
      detail: () => formatClock(systems.evolveCountdown),
      title: () => `Auto-evolve: next in ${formatClock(systems.evolveCountdown)}, ${systems.evolve.count} so far.`,
    },
    {
      key: 'memory', label: 'Memory', tab: 'evolve',
      active: () => !!store.get('memoryEnable'),
      detail: () => `${systems.memory.slots.length} · ${formatClock(systems.memoryCountdown)}`,
      title: () => `State memory: ${systems.memory.slots.length} snapshots kept, next capture in ${formatClock(systems.memoryCountdown)}.`,
    },
  ];
}

class App {
  constructor() {
    this.store = new Store();
    this.router = new ModRouter(this.store);
    this.systems = new Systems(this.store, this.router);
    this.macros = new MacroMatrix(this.store);
    this.builder = new PanelBuilder(this);

    this.engine = null;
    this.freezer = null;
    this.recorder = null;
    this.visualizer = null;
    this.hasWorklets = false;
    this.starting = false;
    this.dirty = new Set();
    this.activeTab = TABS[0].id;
    this.lastModulated = new Set();

    this.activity = activityDefinitions(this.store, this.systems);
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  mount(root) {
    this.root = root;
    this.buildChrome(root);
    this.tabPanels = this.builder.build($('#panels', root), true);
    this.buildTabs();
    this.buildActivity();
    this.bindStore();
    this.bindTransport();
    this.bindPresets();
    this.bindKeyboard();
    this.refreshPresetList();
    this.refreshAll();
    this.showTab(this.activeTab);
    this.startUiLoop();
    this.note('Ready. Press Power (or the space bar) to start the audio engine.');
  }

  buildChrome(root) {
    root.innerHTML = `
      <header class="rail">
        <div class="rail__identity">
          <h1>Viceroy <span>Drone Synth</span></h1>
          <p class="rail__sub">Evolving drone instrument</p>
        </div>

        <div class="rail__transport">
          <button id="power" class="btn btn--power" type="button" aria-pressed="false">
            <i class="dot"></i><span>Power</span>
          </button>
          <button id="freeze" class="btn" type="button" aria-pressed="false">Freeze</button>
          <button id="record" class="btn" type="button" aria-pressed="false">Record</button>
          <button id="panic" class="btn btn--quiet" type="button" title="Silence everything at once">Panic</button>
        </div>

        <div class="rail__meters">
          <div class="rail__master" id="masterSlot"></div>
          <div class="meter">
            <canvas id="meters" aria-hidden="true"></canvas>
            <div class="meter__scale"><span>-60</span><span>-24</span><span>-12</span><span>-6</span><span>0</span></div>
          </div>
          <p class="meter__readout"><span id="peakRead">—</span><span id="grRead"></span></p>
        </div>

        <div class="rail__presets">
          <label class="sr-only" for="presetSelect">Preset</label>
          <select id="presetSelect"></select>
          <div class="btn-row">
            <button id="presetLoad" class="btn" type="button">Load</button>
            <button id="presetMorph" class="btn" type="button" title="Travel to the preset over 30 seconds">Morph in</button>
            <button id="randomise" class="btn" type="button">Randomise</button>
          </div>
          <div class="btn-row">
            <button id="presetSave" class="btn btn--quiet" type="button">Save</button>
            <button id="presetExport" class="btn btn--quiet" type="button">Export</button>
            <button id="presetImport" class="btn btn--quiet" type="button">Import</button>
            <button id="presetDelete" class="btn btn--quiet" type="button">Delete</button>
          </div>
        </div>
      </header>

      <div class="displays">
        <figure class="display display--scope">
          <figcaption>Waveform</figcaption>
          <canvas id="scope"></canvas>
        </figure>
        <figure class="display display--spectrum">
          <figcaption>Spectrum <span>20 Hz – 16 kHz, logarithmic</span></figcaption>
          <canvas id="spectrum"></canvas>
        </figure>
        <figure class="display display--spectrogram">
          <figcaption>Spectrogram <span>last 3 minutes</span></figcaption>
          <canvas id="spectrogram"></canvas>
        </figure>
      </div>

      <div class="activity" id="activity" aria-label="Evolving systems"></div>

      <nav class="tabs" id="tabs" role="tablist" aria-label="Sections"></nav>
      <main id="panels"></main>

      <div class="log" id="log" role="status" aria-live="polite"></div>
      <footer class="foot">
        <p>Space power · F freeze · R record · E evolve · N randomise · 1–8 sections · double-click any control to reset it · hold Shift while dragging for fine adjustment</p>
      </footer>
    `;

    // The master level appears in the rail as well as on the Master tab; both
    // are real controls bound to the same parameter.
    const master = this.builder.addControl('masterVolume', { variant: 'knob', label: 'Master' });
    $('#masterSlot', root).append(master.el);

    this.visualizer = new Visualizer({
      scope: $('#scope', root),
      spectrum: $('#spectrum', root),
      spectrogram: $('#spectrogram', root),
      meterCanvas: $('#meters', root),
      root: document.documentElement,
    });
  }

  buildTabs() {
    const nav = $('#tabs', this.root);
    this.tabButtons = {};
    TABS.forEach((tab, i) => {
      const b = el('button', 'tab', tab.label);
      b.type = 'button';
      b.id = `tabbtn-${tab.id}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', `tab-${tab.id}`);
      b.append(el('kbd', 'tab__key', String(i + 1)));
      b.addEventListener('click', () => this.showTab(tab.id));
      b.addEventListener('keydown', (e) => {
        const order = TABS.map((t) => t.id);
        const at = order.indexOf(this.activeTab);
        if (e.key === 'ArrowRight') { e.preventDefault(); this.showTab(order[(at + 1) % order.length], true); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); this.showTab(order[(at - 1 + order.length) % order.length], true); }
      });
      nav.append(b);
      this.tabButtons[tab.id] = b;
    });
  }

  buildActivity() {
    const bar = $('#activity', this.root);
    this.activityEls = {};
    for (const def of this.activity) {
      const chip = el('button', 'chip');
      chip.type = 'button';
      chip.title = `Go to ${def.label}`;
      chip.append(el('i', 'chip__led'));
      chip.append(el('span', 'chip__name', def.label));
      chip.append(el('span', 'chip__detail', ''));
      const arc = el('i', 'chip__phase');
      chip.append(arc);
      chip.addEventListener('click', () => this.showTab(def.tab, true));
      bar.append(chip);
      this.activityEls[def.key] = { chip, detail: chip.querySelector('.chip__detail'), phase: arc };
    }
  }

  showTab(id, focus = false) {
    this.activeTab = id;
    for (const tab of TABS) {
      const on = tab.id === id;
      this.tabPanels[tab.id].hidden = !on;
      this.tabButtons[tab.id].classList.toggle('is-active', on);
      this.tabButtons[tab.id].setAttribute('aria-selected', String(on));
      this.tabButtons[tab.id].tabIndex = on ? 0 : -1;
    }
    if (focus) this.tabButtons[id].focus();
    this.refreshAll();
  }

  // -------------------------------------------------------------------------
  // Store binding — exactly one writer per parameter
  // -------------------------------------------------------------------------

  bindStore() {
    this.router.onApply = (id, value, smooth) => {
      if (this.engine) this.engine.apply(id, value, smooth);
      this.dirty.add(id);
    };

    this.store.subscribe((id, value, opts) => {
      this.router.markBaseChanged(id, opts.smooth === undefined ? 0.02 : opts.smooth);
      this.systems.onParamChanged(id, value);
      this.macros.invalidate(id);
      if (MACRO_IDS.includes(id)) this.macros.apply(id, value);
      if (id === 'xyX' || id === 'xyY') {
        applyXY(this.store, Number(this.store.get('xyX')), Number(this.store.get('xyY')));
      }
      if (this.router.isModulated(id)) {
        // A modulated parameter is written by the router and by nobody else,
        // so a knob move re-sums immediately rather than being overwritten a
        // frame later by whatever system happens to own it.
        this.router.flush();
      } else if (this.engine) {
        this.engine.apply(id, value, opts.smooth);
      }
      this.dirty.add(id);
    });

    this.systems.subscribe((event, detail) => this.onSystemEvent(event, detail));
  }

  setParam(id, value, source = 'ui') {
    this.store.set(id, value, { smooth: source === 'ui' ? 0.02 : 0.05 });
  }

  applyAllToEngine() {
    if (!this.engine) return;
    for (const p of PARAMS) {
      const v = this.router.isModulated(p.id) ? this.router.valueFor(p.id) : this.store.get(p.id);
      this.engine.apply(p.id, v, 0);
    }
  }

  // -------------------------------------------------------------------------
  // Audio engine, created on the first gesture
  // -------------------------------------------------------------------------

  async ensureEngine() {
    if (this.engine || this.starting) return this.engine;
    this.starting = true;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) {
        this.note('This browser has no Web Audio support, so there is nothing to drive.', 'warn');
        return null;
      }
      const ctx = new Ctor({ latencyHint: 'playback' });
      await ctx.resume();
      this.hasWorklets = await loadWorklets(ctx);
      this.engine = new Engine(ctx, { worklets: this.hasWorklets });
      this.systems.attach(this.engine);
      this.systems.start();
      this.freezer = new Freezer(this.engine);
      this.freezer.onChange = () => this.refreshTransport();
      this.recorder = new Recorder(this.engine);
      this.recorder.onChange = () => this.refreshTransport();
      this.visualizer.attach(this.engine);
      this.visualizer.start();
      this.applyAllToEngine();
      if (!this.hasWorklets) {
        this.note('AudioWorklet is unavailable here: shimmer, harmonizer, granular, haze, sub and freeze are switched off. Everything else runs.', 'warn');
        this.markUnavailablePanels();
      }
      // Some browsers suspend the context when the tab is hidden; a drone left
      // running should come back rather than stay silent.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this.engine && this.engine.ctx.state === 'suspended') {
          this.engine.ctx.resume().catch(() => {});
        }
      });
      return this.engine;
    } catch (err) {
      console.error(err);
      this.note(`Could not start audio: ${err.message}`, 'warn');
      return null;
    } finally {
      this.starting = false;
    }
  }

  markUnavailablePanels() {
    for (const tab of TABS) {
      for (const panel of tab.panels) {
        if (panel.requires !== 'worklets') continue;
        const box = [...this.tabPanels[tab.id].querySelectorAll('.panel')]
          .find((n) => n.querySelector('.panel__title').textContent === panel.title);
        if (!box) continue;
        box.classList.add('is-unavailable');
        if (!box.querySelector('.panel__note--warn')) {
          const note = el('p', 'panel__note panel__note--warn',
            'Needs AudioWorklet, which this browser did not provide.');
          box.querySelector('.panel__head').after(note);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  bindTransport() {
    $('#power', this.root).addEventListener('click', () => this.togglePower());
    $('#freeze', this.root).addEventListener('click', () => this.toggleFreeze());
    $('#record', this.root).addEventListener('click', () => this.toggleRecord());
    $('#panic', this.root).addEventListener('click', () => this.panic());
  }

  async togglePower() {
    const engine = await this.ensureEngine();
    if (!engine) return;
    if (engine.ctx.state === 'suspended') await engine.ctx.resume();
    const next = !engine.powered;
    engine.setPower(next);
    this.refreshTransport();
    this.note(next ? 'Running.' : 'Stopped. The patch is untouched.');
  }

  async toggleFreeze() {
    const engine = await this.ensureEngine();
    if (!engine) return;
    if (!this.freezer.available) {
      this.note('Freeze needs AudioWorklet, which this browser did not provide.', 'warn');
      return;
    }
    const wasActive = this.freezer.active;
    await this.freezer.toggle();
    this.note(wasActive ? 'Live again.' : 'Frozen. The loop holds while you keep editing.');
  }

  async toggleRecord() {
    const engine = await this.ensureEngine();
    if (!engine) return;
    if (this.recorder.active) {
      this.recorder.stop();
      this.note('Recording saved.');
    } else if (!this.recorder.supported) {
      this.note('This browser has no MediaRecorder, so recording is unavailable.', 'warn');
    } else if (this.recorder.start()) {
      this.note('Recording. Press again to stop and download.');
    } else {
      this.note('Recording could not start.', 'warn');
    }
    this.refreshTransport();
  }

  panic() {
    if (!this.engine) return;
    this.engine.setPower(false, 0.05);
    if (this.freezer && this.freezer.active) this.freezer.thaw();
    this.engine.ramp(this.engine.nodes.probGate.gain, 1, 0.05);
    this.refreshTransport();
    this.note('Silenced. The patch is untouched — press Power to bring it back.');
  }

  refreshTransport() {
    const power = $('#power', this.root);
    const on = !!(this.engine && this.engine.powered);
    power.setAttribute('aria-pressed', String(on));
    power.classList.toggle('is-on', on);
    power.querySelector('span').textContent = on ? 'Running' : 'Power';

    const freeze = $('#freeze', this.root);
    const fz = this.freezer ? this.freezer.state : { active: false, pending: false };
    freeze.classList.toggle('is-on', fz.active);
    freeze.setAttribute('aria-pressed', String(fz.active));
    freeze.textContent = fz.pending ? 'Capturing…' : fz.active ? 'Unfreeze' : 'Freeze';

    const rec = $('#record', this.root);
    const active = !!(this.recorder && this.recorder.active);
    rec.classList.toggle('is-recording', active);
    rec.setAttribute('aria-pressed', String(active));
    rec.textContent = active ? `Stop ${formatClock(this.recorder.elapsed)}` : 'Record';
  }

  // -------------------------------------------------------------------------
  // Presets
  // -------------------------------------------------------------------------

  bindPresets() {
    $('#presetLoad', this.root).addEventListener('click', () => this.loadSelectedPreset(0));
    $('#presetMorph', this.root).addEventListener('click', () => this.loadSelectedPreset(30));
    $('#randomise', this.root).addEventListener('click', () => {
      randomisePatch(this.store);
      this.refreshAll();
      this.note('Randomised: a couple of voices on a shared root, most modules off.');
    });
    $('#presetSave', this.root).addEventListener('click', () => this.savePreset());
    $('#presetExport', this.root).addEventListener('click', () => this.exportFile());
    $('#presetImport', this.root).addEventListener('click', () => this.importFile());
    $('#presetDelete', this.root).addEventListener('click', () => this.deleteSelected());
  }

  refreshPresetList(selectName) {
    const sel = $('#presetSelect', this.root);
    const user = loadUserPresets();
    sel.innerHTML = '';
    const mk = (label) => {
      const g = document.createElement('optgroup');
      g.label = label;
      return g;
    };
    const placeholder = el('option', null, '— current patch —');
    placeholder.value = '';
    sel.append(placeholder);
    const gf = mk('Factory');
    for (const p of FACTORY) {
      const o = el('option', null, p.name);
      o.value = `factory:${p.name}`;
      o.title = p.note || '';
      gf.append(o);
    }
    sel.append(gf);
    if (user.length) {
      const gu = mk('Saved here');
      for (const p of user) {
        const o = el('option', null, p.name);
        o.value = `user:${p.name}`;
        gu.append(o);
      }
      sel.append(gu);
    }
    if (selectName) sel.value = selectName;
  }

  selectedPreset() {
    const raw = $('#presetSelect', this.root).value || '';
    const [kind, ...rest] = raw.split(':');
    const name = rest.join(':');
    if (kind === 'factory') return { kind, preset: FACTORY.find((p) => p.name === name) };
    return { kind, preset: loadUserPresets().find((p) => p.name === name) };
  }

  loadSelectedPreset(morphSeconds) {
    const { kind, preset } = this.selectedPreset();
    if (!preset) {
      this.note('Choose a preset from the list first.', 'warn');
      return;
    }
    const values = kind === 'factory' ? preset.values : preset.values;
    if (kind !== 'factory' && preset.macros) this.macros.setAssignments(preset.macros);
    if (morphSeconds > 0 && this.engine) {
      this.systems.startMorph(values, morphSeconds, 'preset');
      // Switches and menus cannot be interpolated, so they change at once.
      const discrete = {};
      for (const [id, v] of Object.entries(values)) {
        if (BY_ID[id] && BY_ID[id].type !== 'num') discrete[id] = v;
      }
      this.store.batch(discrete);
      this.note(`Morphing into “${preset.name}” over ${morphSeconds} seconds.`);
    } else {
      this.systems.cancelMorphs();
      this.store.batch(values);
      this.note(`Loaded “${preset.name}”.${preset.note ? ' ' + preset.note : ''}`);
    }
    this.systems.setEvolveHome();
    this.refreshAll();
  }

  savePreset() {
    const name = window.prompt('Name this preset', `Patch ${new Date().toLocaleString()}`);
    if (!name) return;
    const ok = saveUserPreset({ ...exportPreset(this.store, { name, macros: this.macros.toJSON() }) });
    this.refreshPresetList(`user:${name}`);
    this.note(ok ? `Saved “${name}” in this browser.` : 'Could not save: browser storage is unavailable.', ok ? 'info' : 'warn');
  }

  deleteSelected() {
    const { kind, preset } = this.selectedPreset();
    if (kind !== 'user' || !preset) {
      this.note('Only presets saved in this browser can be deleted.', 'warn');
      return;
    }
    deleteUserPreset(preset.name);
    this.refreshPresetList();
    this.note(`Deleted “${preset.name}”.`);
  }

  exportFile() {
    const data = exportPreset(this.store, { name: 'Viceroy patch', macros: this.macros.toJSON() });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `viceroy-preset-${Date.now()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    this.note('Exported.');
  }

  importFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const { values, macros, warnings, name } = importPreset(String(reader.result));
        if (!values) {
          this.note(warnings.join(' '), 'warn');
          return;
        }
        this.systems.cancelMorphs();
        this.store.batch(values);
        if (macros) this.macros.setAssignments(macros);
        this.systems.setEvolveHome();
        this.refreshAll();
        this.note(`Loaded ${name ? `“${name}”` : 'preset'}.${warnings.length ? ' ' + warnings.join(' ') : ''}`,
          warnings.length ? 'warn' : 'info');
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // -------------------------------------------------------------------------
  // Widget actions
  // -------------------------------------------------------------------------

  randomiseSteps() {
    for (let i = 0; i < 8; i++) this.store.set(`seqStep${i}`, Math.random() * 2 - 1);
    this.refreshAll();
  }

  resetSteps() {
    for (let i = 0; i < 8; i++) this.store.set(`seqStep${i}`, BY_ID[`seqStep${i}`].def);
    this.refreshAll();
  }

  evolveNow() {
    const n = this.systems.triggerEvolve();
    this.note(n ? `Evolving ${n} controls over ${formatClock(Number(this.store.get('evolveRate')) * 0.8)}.`
      : 'Evolve depth is at zero, so there is nothing to move.');
  }

  undoEvolve() {
    this.note(this.systems.undoEvolve() ? 'Rolling back the last evolution.' : 'Nothing to undo yet.');
  }

  anchorEvolve() {
    this.systems.setEvolveHome();
    this.note('Evolution will now orbit the patch as it stands.');
  }

  memorySnapshot() {
    const snap = this.systems.takeSnapshot(true);
    this.note(`Snapshot taken — ${this.systems.memory.slots.length} kept.`);
    return snap;
  }

  memoryRecall() {
    if (!this.systems.recall(-1)) this.note('No snapshots stored yet.', 'warn');
    else this.note(`Morphing back over ${format(BY_ID.memoryMorphTime, this.store.get('memoryMorphTime'))}.`);
  }

  memoryClear() {
    this.systems.clearMemory();
    this.note('Memory cleared.');
  }

  assignMacro(macroId, slot, paramId) {
    this.macros.assign(macroId, slot, paramId || null);
    this.refreshAll();
  }

  setMacroDepth(macroId, slot, depth) {
    this.macros.setDepth(macroId, slot, depth);
  }

  setXY(x, y) {
    this.store.set('xyX', x);
    this.store.set('xyY', y);
  }

  onSystemEvent(event, detail) {
    if (event === 'evolve') this.note(`Auto-evolve moved ${detail.changed} controls.`);
    if (event === 'memory' && detail.action === 'recall') this.note('Memory recalled an earlier state.');
  }

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      // Controls own the arrow keys while focused; shortcuts must not steal them.
      const onControl = t && t.closest && t.closest('.ctl, .xy__pad');
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === ' ' && !typing && !onControl) { e.preventDefault(); this.togglePower(); return; }
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === 'f' && !onControl) { e.preventDefault(); this.toggleFreeze(); }
      else if (k === 'r' && !onControl) { e.preventDefault(); this.toggleRecord(); }
      else if (k === 'e' && !onControl) { e.preventDefault(); this.evolveNow(); }
      else if (k === 'n' && !onControl) { e.preventDefault(); randomisePatch(this.store); this.refreshAll(); }
      else if (/^[1-8]$/.test(e.key)) {
        const tab = TABS[Number(e.key) - 1];
        if (tab) { e.preventDefault(); this.showTab(tab.id); }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  refreshControl(id) {
    const list = this.builder.controls.get(id);
    if (!list) return;
    const base = this.store.get(id);
    const modulated = this.router.isModulated(id);
    const effective = modulated ? this.router.valueFor(id) : null;
    const sources = modulated ? this.router.sourcesFor(id) : null;
    for (const c of list) c.render(base, effective, sources);
  }

  refreshAll() {
    for (const id of this.builder.controls.keys()) this.refreshControl(id);
    this.dirty.clear();
  }

  startUiLoop() {
    let frame = 0;
    const loop = () => {
      frame++;
      this.tickUi(frame);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  tickUi(frame) {
    // Redraw what changed plus what is currently being modulated — typically
    // a dozen controls, not all 141.
    const modulated = new Set();
    for (const id of this.builder.controls.keys()) {
      if (this.router.isModulated(id)) modulated.add(id);
    }
    for (const id of this.dirty) this.refreshControl(id);
    this.dirty.clear();
    for (const id of modulated) this.refreshControl(id);
    for (const id of this.lastModulated) {
      // Released this frame: redraw once so the ghost clears.
      if (!modulated.has(id)) this.refreshControl(id);
    }
    this.lastModulated = modulated;

    if (frame % 3 === 0) {
      this.refreshLeds();
      this.refreshActivity();
      this.refreshTimeline();
      this.refreshSeqSteps();
      this.refreshXY();
      this.refreshStatus();
    }
    if (frame % 12 === 0) {
      this.refreshTransport();
      this.refreshMemoryList();
      this.refreshMeterReadout();
    }
  }

  refreshLeds() {
    for (const led of this.root.querySelectorAll('.led')) {
      const key = led.dataset.led;
      let on = false;
      if (key.startsWith('voice:')) {
        const v = key.slice(6);
        on = this.router.valueFor(`${v}Vol`) > 0.02;
      } else if (key.startsWith('plate:')) {
        on = !!this.store.get(`${key.slice(6)}DriftEnable`);
      } else {
        const def = this.activity.find((d) => d.key === key);
        on = def ? def.active() : false;
      }
      led.classList.toggle('is-on', on);
    }
    const meter = this.root.querySelector('[data-meter="env"] .panel__meter-fill');
    if (meter) meter.style.width = `${Math.min(100, this.systems.env.level * 140)}%`;
  }

  refreshActivity() {
    for (const def of this.activity) {
      const ui = this.activityEls[def.key];
      if (!ui) continue;
      const on = def.active();
      ui.chip.classList.toggle('is-on', on);
      ui.detail.textContent = on ? def.detail() : '';
      ui.chip.title = on && def.title ? def.title() : `${def.label} — off. Click to open its controls.`;
      if (def.phase) {
        ui.phase.style.width = on ? `${def.phase() * 100}%` : '0%';
        ui.phase.style.opacity = on ? '1' : '0';
      }
    }
  }

  refreshTimeline() {
    const wrap = this.builder.widgets.timeline;
    if (!wrap || !this.tabPanels.evolve || this.tabPanels.evolve.hidden) return;
    for (const row of wrap.querySelectorAll('.timeline__row')) {
      const st = this.systems.plateState(row.dataset.plate);
      row.classList.toggle('is-on', st.enabled);
      row.querySelector('.timeline__progress').style.width = `${st.phase * 100}%`;
      row.querySelector('.timeline__cursor').style.left = `${st.phase * 100}%`;
      row.querySelector('.timeline__readout').textContent = st.enabled
        ? `${formatClock(st.remainingSeconds)} of ${st.cycleMinutes.toFixed(0)} min`
        : 'off';
    }
  }

  refreshSeqSteps() {
    const grid = this.builder.widgets.seqSteps;
    if (!grid) return;
    const on = !!this.store.get('seqOn');
    const len = Math.round(Number(this.store.get('seqLength')));
    for (const cell of grid.children) {
      const i = Number(cell.dataset.step);
      cell.classList.toggle('is-current', on && i === this.systems.seq.index);
      cell.classList.toggle('is-muted', i >= len);
    }
  }

  refreshXY() {
    const xy = this.builder.widgets.xy;
    if (!xy) return;
    const x = Number(this.store.get('xyX'));
    const y = Number(this.store.get('xyY'));
    xy.cursor.style.left = `${x * 100}%`;
    xy.cursor.style.top = `${(1 - y) * 100}%`;
    xy.crossV.style.left = `${x * 100}%`;
    xy.crossH.style.top = `${(1 - y) * 100}%`;
    const xId = this.store.get('xyParamX');
    const yId = this.store.get('xyParamY');
    xy.readout.children[0].textContent = `X · ${BY_ID[xId] ? format(BY_ID[xId], this.store.get(xId)) : '—'}`;
    xy.readout.children[1].textContent = `Y · ${BY_ID[yId] ? format(BY_ID[yId], this.store.get(yId)) : '—'}`;
  }

  refreshStatus() {
    const evolveStatus = this.root.querySelector('[data-status="evolve"]');
    if (evolveStatus) {
      const morph = this.systems.morphProgress;
      const countdown = this.systems.evolveCountdown;
      evolveStatus.textContent = morph
        ? `Travelling — ${Math.round(morph.t * 100)}% through ${morph.count} controls (${morph.tag}).`
        : countdown !== null
          ? `Next evolution in ${formatClock(countdown)}. ${this.systems.evolve.count} so far.`
          : 'Idle. Use Evolve now, or switch Auto-Evolve on.';
    }
    const memStatus = this.root.querySelector('[data-status="memory"]');
    if (memStatus) {
      const c = this.systems.memoryCountdown;
      memStatus.textContent = c !== null
        ? `Next capture in ${formatClock(c)}.`
        : `${this.systems.memory.slots.length} snapshot${this.systems.memory.slots.length === 1 ? '' : 's'} stored.`;
    }
  }

  refreshMemoryList() {
    const list = this.builder.widgets.memoryList;
    if (!list || !this.tabPanels.evolve || this.tabPanels.evolve.hidden) return;
    const slots = this.systems.memory.slots;
    if (list.childElementCount === slots.length && list.dataset.stamp === String(slots.length && slots[slots.length - 1].at)) return;
    list.dataset.stamp = String(slots.length && slots[slots.length - 1].at);
    list.innerHTML = '';
    slots.forEach((snap, i) => {
      const li = el('li', 'memory-list__item');
      li.append(el('span', 'memory-list__when', new Date(snap.at).toLocaleTimeString()));
      li.append(el('span', 'memory-list__kind', snap.manual ? 'manual' : 'auto'));
      const b = el('button', 'btn btn--tiny', 'Recall');
      b.type = 'button';
      b.addEventListener('click', () => {
        this.systems.recall(i);
        this.note('Morphing into that snapshot.');
      });
      li.append(b);
      list.append(li);
    });
  }

  refreshMeterReadout() {
    if (!this.visualizer || !this.engine) return;
    const db = this.visualizer.peakDb;
    $('#peakRead', this.root).textContent = Number.isFinite(db) ? `${db.toFixed(1)} dB peak` : '— dB';
    const gr = this.visualizer.levels.reduction;
    $('#grRead', this.root).textContent = gr < -0.1 ? `${gr.toFixed(1)} dB limiting` : '';
  }

  note(text, kind = 'info') {
    const log = $('#log', this.root);
    log.textContent = text;
    log.dataset.kind = kind;
    log.classList.remove('is-fresh');
    // Reflow so the animation restarts for a repeated message.
    void log.offsetWidth;
    log.classList.add('is-fresh');
  }
}

const app = new App();
app.mount(document.getElementById('app'));
// Exposed for debugging from the console; nothing in the app reads it.
window.viceroy = app;

export { App };
