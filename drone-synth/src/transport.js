// Freeze and record.

const FREEZE_SECONDS = 4;
const FREEZE_FADE = 0.25;   // seconds of crossfade baked into the loop

/**
 * Freeze: capture a few seconds of output and loop it while the live
 * instrument is faded out, so you can keep the moment and go on turning knobs
 * against it.
 *
 * Two things are different from the prototype's version. It captured through a
 * ScriptProcessorNode — deprecated, running on the main thread, and dropping
 * samples whenever the UI was busy, which is exactly when you are reaching for
 * the button. And it looped the raw four seconds, so the join clicked once per
 * cycle forever. This captures on the audio thread and crossfades the seam.
 */
export class Freezer {
  constructor(engine) {
    this.engine = engine;
    this.active = false;
    this.pending = false;
    this.source = null;
    this.onChange = null;
  }

  get available() {
    return !!(this.engine && this.engine.nodes.capture);
  }

  toggle() {
    return this.active ? this.thaw() : this.freeze();
  }

  freeze() {
    if (!this.available || this.active || this.pending) return Promise.resolve(false);
    const ctx = this.engine.ctx;
    const n = this.engine.nodes;
    this.pending = true;
    this.emit();
    return new Promise((resolve) => {
      const onMessage = (e) => {
        if (!e.data || !e.data.done) return;
        n.capture.port.removeEventListener('message', onMessage);
        this.pending = false;
        const buffer = this.buildLoop(ctx, e.data.L, e.data.R);
        if (!buffer) { this.emit(); resolve(false); return; }
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.connect(n.frozen);
        src.start();
        this.source = src;
        this.active = true;
        const t = ctx.currentTime;
        n.frozen.gain.cancelScheduledValues(t);
        n.live.gain.cancelScheduledValues(t);
        n.frozen.gain.setValueAtTime(0, t);
        n.frozen.gain.linearRampToValueAtTime(1, t + 0.12);
        n.live.gain.setValueAtTime(n.live.gain.value, t);
        n.live.gain.linearRampToValueAtTime(0, t + 0.12);
        this.emit();
        resolve(true);
      };
      n.capture.port.addEventListener('message', onMessage);
      n.capture.port.start();
      n.capture.port.postMessage({ cmd: 'record', seconds: FREEZE_SECONDS });
    });
  }

  thaw() {
    if (!this.active) return Promise.resolve(false);
    const ctx = this.engine.ctx;
    const n = this.engine.nodes;
    const t = ctx.currentTime;
    n.frozen.gain.cancelScheduledValues(t);
    n.live.gain.cancelScheduledValues(t);
    n.frozen.gain.setValueAtTime(n.frozen.gain.value, t);
    n.frozen.gain.linearRampToValueAtTime(0, t + 0.2);
    n.live.gain.setValueAtTime(0, t);
    n.live.gain.linearRampToValueAtTime(1, t + 0.2);
    const src = this.source;
    this.source = null;
    this.active = false;
    if (src) {
      try { src.stop(t + 0.3); } catch { /* already stopped */ }
      setTimeout(() => { try { src.disconnect(); } catch { /* gone */ } }, 500);
    }
    this.emit();
    return Promise.resolve(true);
  }

  /** Crossfade the tail into the head so the loop point does not click. */
  buildLoop(ctx, L, R) {
    const fade = Math.min(Math.floor(ctx.sampleRate * FREEZE_FADE), Math.floor(L.length / 3));
    const len = L.length - fade;
    if (len <= fade) return null;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    const chans = [L, R];
    for (let c = 0; c < 2; c++) {
      const src = chans[c];
      const out = buf.getChannelData(c);
      out.set(src.subarray(0, len));
      for (let i = 0; i < fade; i++) {
        // Equal power, so the crossfade does not dip through the join.
        const t = i / fade;
        const a = Math.cos(t * Math.PI * 0.5);
        const b = Math.sin(t * Math.PI * 0.5);
        out[i] = out[i] * b + src[len + i] * a;
      }
    }
    return buf;
  }

  emit() {
    if (this.onChange) this.onChange(this.state);
  }

  get state() {
    return { active: this.active, pending: this.pending };
  }
}

/**
 * Record what you hear, tapped at the output gate so a frozen loop or a
 * powered-down instrument records exactly as it sounds.
 */
export class Recorder {
  constructor(engine) {
    this.engine = engine;
    this.recorder = null;
    this.chunks = [];
    this.dest = null;
    this.startedAt = 0;
    this.onChange = null;
    this.lastBlobUrl = null;
  }

  get supported() {
    return typeof MediaRecorder !== 'undefined' && !!this.engine;
  }

  get active() {
    return !!this.recorder && this.recorder.state === 'recording';
  }

  get elapsed() {
    return this.active ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  static pickMime() {
    const wanted = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const m of wanted) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  start() {
    if (!this.supported || this.active) return false;
    const ctx = this.engine.ctx;
    this.dest = ctx.createMediaStreamDestination();
    this.engine.nodes.output.connect(this.dest);
    const mimeType = Recorder.pickMime();
    try {
      this.recorder = mimeType ? new MediaRecorder(this.dest.stream, { mimeType }) : new MediaRecorder(this.dest.stream);
    } catch (err) {
      console.warn('Recording unavailable', err);
      this.cleanup();
      return false;
    }
    this.chunks = [];
    this.recorder.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.recorder.onstop = () => this.finish();
    this.recorder.start();
    this.startedAt = performance.now();
    this.emit();
    return true;
  }

  stop() {
    if (!this.active) return false;
    this.recorder.stop();
    return true;
  }

  finish() {
    const type = (this.recorder && this.recorder.mimeType) || 'audio/webm';
    const blob = new Blob(this.chunks, { type });
    this.chunks = [];
    const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `viceroy-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`;
    document.body.append(a);
    a.click();
    a.remove();
    // Revoked on a delay: revoking immediately races the download in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    this.cleanup();
    this.emit();
  }

  cleanup() {
    // The tap must come down, or every recording adds another live
    // MediaStreamDestination to the output for the rest of the session.
    if (this.dest) {
      try { this.engine.nodes.output.disconnect(this.dest); } catch { /* already detached */ }
      this.dest = null;
    }
    this.recorder = null;
  }

  emit() {
    if (this.onChange) this.onChange({ active: this.active });
  }
}
