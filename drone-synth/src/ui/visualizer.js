// Displays.
//
// Three views, because a drone needs all three at different timescales: a
// scope for the waveform, a spectrum for what is sounding now, and a
// spectrogram for what has happened over the last few minutes. The prototype
// had the first two, both on a linear frequency axis — which puts the entire
// bottom four octaves of a bass drone into the left 3% of the display, and is
// precisely the range this instrument lives in.

const F_MIN = 20;
const F_MAX = 16000;
const SPECTROGRAM_WINDOW_MS = 180000;   // three minutes across the pane

function dpr() {
  return Math.min(2, window.devicePixelRatio || 1);
}

/** Size a canvas to its CSS box at device resolution. Returns true if it changed. */
function fit(canvas) {
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr()));
  const h = Math.max(1, Math.round(r.height * dpr()));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}

function css(el, name, fallback) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

export class Visualizer {
  constructor({ scope, spectrum, spectrogram, meterCanvas, root }) {
    this.scopeCanvas = scope;
    this.spectrumCanvas = spectrum;
    this.spectrogramCanvas = spectrogram;
    this.meterCanvas = meterCanvas;
    this.root = root || document.body;

    this.engine = null;
    this.time = null;
    this.freq = null;
    this.peaks = null;
    this.meterBuf = new Uint8Array(1024);

    this.spectroBuffer = document.createElement('canvas');
    this.lastColumnAt = 0;
    this.columnPeriod = 450;

    this.levels = { l: 0, r: 0, peakL: 0, peakR: 0, holdL: 0, holdR: 0, reduction: 0 };
    this.running = false;
    this.frame = 0;
  }

  attach(engine) {
    this.engine = engine;
    const bins = engine.nodes.analyser.frequencyBinCount;
    this.time = new Uint8Array(engine.nodes.analyser.fftSize);
    this.freq = new Uint8Array(bins);
    this.peaks = new Float32Array(bins);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  /** Palette read from CSS so the displays follow the stylesheet. */
  colours() {
    if (!this._colours || this._colourFrame !== Math.floor(this.frame / 240)) {
      const el = this.root;
      this._colours = {
        ink: css(el, '--ink-dim', '#4e5866'),
        grid: css(el, '--grid', 'rgba(255,255,255,0.05)'),
        accent: css(el, '--accent', '#5fd3c4'),
        accentSoft: css(el, '--accent-soft', 'rgba(95,211,196,0.35)'),
        warm: css(el, '--warm', '#f0a868'),
        hot: css(el, '--hot', '#ff5f6d'),
        ground: css(el, '--display-bg', '#07090b'),
      };
      this._colourFrame = Math.floor(this.frame / 240);
    }
    return this._colours;
  }

  draw() {
    this.frame++;
    if (!this.engine) return;
    const a = this.engine.nodes.analyser;
    a.getByteTimeDomainData(this.time);
    a.getByteFrequencyData(this.freq);
    this.readLevels();
    this.drawScope();
    this.drawSpectrum();
    this.drawSpectrogram();
    this.drawMeters();
  }

  readLevels() {
    const n = this.engine.nodes;
    const read = (analyser) => {
      analyser.getByteTimeDomainData(this.meterBuf);
      let peak = 0;
      let sum = 0;
      const len = Math.min(this.meterBuf.length, analyser.fftSize);
      for (let i = 0; i < len; i++) {
        const v = (this.meterBuf[i] - 128) / 128;
        const av = Math.abs(v);
        if (av > peak) peak = av;
        sum += v * v;
      }
      return { peak, rms: Math.sqrt(sum / len) };
    };
    const L = read(n.meterL);
    const R = read(n.meterR);
    const lv = this.levels;
    // Fast attack, slow release: the standard meter ballistics, so a peak is
    // visible for long enough to read rather than for one frame.
    lv.l = Math.max(L.rms, lv.l * 0.86);
    lv.r = Math.max(R.rms, lv.r * 0.86);
    lv.peakL = Math.max(L.peak, lv.peakL * 0.94);
    lv.peakR = Math.max(R.peak, lv.peakR * 0.94);
    lv.holdL = L.peak >= lv.holdL ? L.peak : lv.holdL * 0.995;
    lv.holdR = R.peak >= lv.holdR ? R.peak : lv.holdR * 0.995;
    lv.reduction = n.limiter.reduction || 0;
  }

  drawScope() {
    const c = this.scopeCanvas;
    if (!c) return;
    fit(c);
    const ctx = c.getContext('2d');
    const { width: w, height: h } = c;
    const col = this.colours();
    ctx.fillStyle = col.ground;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = col.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2 + 0.5);
    ctx.lineTo(w, h / 2 + 0.5);
    ctx.stroke();

    const data = this.time;
    // Trigger on a rising zero crossing so a steady tone stands still instead
    // of sliding across the display.
    let start = 0;
    for (let i = 1; i < data.length / 2; i++) {
      if (data[i - 1] < 128 && data[i] >= 128) { start = i; break; }
    }
    const span = Math.floor(data.length / 2);
    ctx.strokeStyle = col.accent;
    ctx.lineWidth = Math.max(1, dpr());
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < span; i++) {
      const v = (data[start + i] - 128) / 128;
      const x = (i / span) * w;
      const y = h / 2 - v * h * 0.46;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /** x across the pane -> FFT bin, on a logarithmic frequency axis. */
  binAt(t, binCount, nyquist) {
    const f = F_MIN * Math.pow(F_MAX / F_MIN, t);
    return Math.min(binCount - 1, Math.max(0, Math.round((f / nyquist) * binCount)));
  }

  drawSpectrum() {
    const c = this.spectrumCanvas;
    if (!c) return;
    fit(c);
    const ctx = c.getContext('2d');
    const { width: w, height: h } = c;
    const col = this.colours();
    const bins = this.freq.length;
    const nyquist = this.engine.ctx.sampleRate / 2;

    ctx.fillStyle = col.ground;
    ctx.fillRect(0, 0, w, h);

    // Octave gridlines, so the log axis is legible as pitch.
    ctx.strokeStyle = col.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let f = 31.25; f < F_MAX; f *= 2) {
      const x = Math.round((Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * w) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    ctx.stroke();

    const cols = Math.min(w, 320);
    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, col.accentSoft);
    grad.addColorStop(0.75, col.accent);
    grad.addColorStop(1, col.warm);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i <= cols; i++) {
      const t = i / cols;
      const b0 = this.binAt(t, bins, nyquist);
      const b1 = Math.max(b0 + 1, this.binAt((i + 1) / cols, bins, nyquist));
      let m = 0;
      for (let b = b0; b < b1 && b < bins; b++) if (this.freq[b] > m) m = this.freq[b];
      this.peaks[b0] = Math.max(m, this.peaks[b0] * 0.97);
      ctx.lineTo(t * w, h - (m / 255) * h * 0.98);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = col.warm;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= cols; i++) {
      const t = i / cols;
      const b0 = this.binAt(t, bins, nyquist);
      const y = h - (this.peaks[b0] / 255) * h * 0.98;
      if (i === 0) ctx.moveTo(0, y); else ctx.lineTo(t * w, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Energy to colour: dark ground, through the cool accent, into the warm. */
  static ramp(v) {
    const t = Math.max(0, Math.min(1, v));
    if (t < 0.35) {
      const k = t / 0.35;
      return `rgb(${Math.round(8 + 18 * k)},${Math.round(12 + 46 * k)},${Math.round(16 + 54 * k)})`;
    }
    if (t < 0.72) {
      const k = (t - 0.35) / 0.37;
      return `rgb(${Math.round(26 + 69 * k)},${Math.round(58 + 153 * k)},${Math.round(70 + 126 * k)})`;
    }
    const k = (t - 0.72) / 0.28;
    return `rgb(${Math.round(95 + 160 * k)},${Math.round(211 + 24 * k)},${Math.round(196 - 76 * k)})`;
  }

  drawSpectrogram() {
    const c = this.spectrogramCanvas;
    if (!c) return;
    const resized = fit(c);
    const ctx = c.getContext('2d');
    const { width: w, height: h } = c;
    const buf = this.spectroBuffer;
    if (resized || buf.width !== w || buf.height !== h) {
      buf.width = w;
      buf.height = h;
      buf.getContext('2d').fillStyle = this.colours().ground;
      buf.getContext('2d').fillRect(0, 0, w, h);
      // Three minutes across the pane whatever its width, so the timescale is
      // a property of the display rather than of the window size.
      this.columnPeriod = SPECTROGRAM_WINDOW_MS / Math.max(1, w / dpr());
    }

    const now = performance.now();
    if (now - this.lastColumnAt >= this.columnPeriod) {
      this.lastColumnAt = now;
      const bctx = buf.getContext('2d');
      bctx.drawImage(buf, -1, 0);
      const bins = this.freq.length;
      const nyquist = this.engine.ctx.sampleRate / 2;
      const rows = Math.min(h, 180);
      for (let r = 0; r < rows; r++) {
        const t = 1 - r / rows;              // top of the pane is the top of the band
        const b0 = this.binAt(t, bins, nyquist);
        const b1 = Math.max(b0 + 1, this.binAt(Math.min(1, t + 1 / rows), bins, nyquist));
        let m = 0;
        for (let b = b0; b < b1 && b < bins; b++) if (this.freq[b] > m) m = this.freq[b];
        bctx.fillStyle = Visualizer.ramp(m / 255);
        bctx.fillRect(w - 1, Math.floor((r / rows) * h), 1, Math.ceil(h / rows));
      }
    }
    ctx.drawImage(buf, 0, 0);
  }

  drawMeters() {
    const c = this.meterCanvas;
    if (!c) return;
    fit(c);
    const ctx = c.getContext('2d');
    const { width: w, height: h } = c;
    const col = this.colours();
    ctx.clearRect(0, 0, w, h);

    // A decibel scale: a linear meter spends most of its length on the top
    // 6 dB and shows nothing about a drone sitting at -30.
    const norm = (v) => {
      if (v <= 0) return 0;
      const db = 20 * Math.log10(v);
      return Math.max(0, Math.min(1, (db + 60) / 60));
    };

    const lanes = [
      { rms: this.levels.l, peak: this.levels.peakL, hold: this.levels.holdL },
      { rms: this.levels.r, peak: this.levels.peakR, hold: this.levels.holdR },
    ];
    const gap = Math.round(2 * dpr());
    const laneH = (h - gap) / 2;
    lanes.forEach((lane, i) => {
      const y = i * (laneH + gap);
      ctx.fillStyle = col.grid;
      ctx.fillRect(0, y, w, laneH);
      const wRms = norm(lane.rms) * w;
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, col.accentSoft);
      g.addColorStop(0.72, col.accent);
      g.addColorStop(0.9, col.warm);
      g.addColorStop(1, col.hot);
      ctx.fillStyle = g;
      ctx.fillRect(0, y, wRms, laneH);
      ctx.fillStyle = lane.peak > 0.985 ? col.hot : col.warm;
      ctx.fillRect(Math.min(w - 2, norm(lane.hold) * w), y, 2, laneH);
    });
  }

  get peakDb() {
    const v = Math.max(this.levels.peakL, this.levels.peakR);
    return v > 0 ? 20 * Math.log10(v) : -Infinity;
  }
}
