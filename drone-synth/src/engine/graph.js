// The audio graph.
//
// Shape of the instrument:
//
//   voices + supersaw + radio ─> voiceBus
//        ─> arctan drive ─> tanh drive ─> tilt ─> tremolo ─> insertOut
//              ├─ dry ─────────────────────────────────────────┐
//              ├─ reverb    (pre-delay ─> convolver) ──────────┤
//              ├─ delay     (delay ─> feedback) ───────────────┤
//              ├─ shimmer   (delay ─> pitch shift ─> feedback) ┤
//              ├─ harmonizer(pitch shift) ────────────────────-┤
//              ├─ chorus    (modulated delay) ─────────────────┤
//              ├─ wow&flutter (modulated delay) ───────────────┤
//              ├─ granular  (grain cloud worklet) ─────────────┤
//              ├─ haze      (decimator worklet) ───────────────┤
//              └─ sub       (divider worklet ─> low pass) ─────┤
//                                                          mixBus
//        ─> ring modulator (dry/wet) ─> filter ─> M/S width
//        ─> probability gate ─> breath ─> DC block ─> master ─> limiter
//        ─> output gate ─> destination
//
// Two structural changes carry most of the improvement over the prototype:
//
// 1. Everything past the inserts is a *parallel send*, not a link in a chain.
//    The prototype ran reverb, delay, chorus, wow and the harmonizer in
//    series, so the reverb was permanently 100% wet (its "Amount" knob only
//    changed the decay), and raising the delay time replaced the dry signal
//    rather than adding to it.
//
// 2. The ring modulator is a real one. The prototype used its ring-mod gain
//    node as the main summing bus, so setting Ring Depth to zero — the
//    default — muted the entire instrument, and its "depth" knob was actually
//    the DC offset the carrier rode on.

import { VOICES } from '../params.js';
import {
  makeImpulse, makeCurve, makePulseWave, pulseCompensation,
  makeWhiteNoise, makePinkNoise, makeBrownNoise,
} from './buffers.js';

const NOISE_SECONDS = 6;

export class Engine {
  constructor(ctx, { worklets = false } = {}) {
    this.ctx = ctx;
    this.hasWorklets = worklets;
    this.nodes = {};
    this.voice = {};
    this._lastValues = {};
    this.supersaw = [];
    this.disposed = false;
    this._impulseTimer = null;
    this._pendingDecay = null;
    this._shTimer = null;
    this._lfoShape = 'sine';

    this._buildMaster();
    this._buildInserts();
    this._buildVoices();
    this._buildSupersaw();
    this._buildRadio();
    this._buildSends();
    if (worklets) this._buildWorkletSends();
    this._buildModulators();
    this._buildSetters();
  }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  _gain(value = 1) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    return g;
  }

  _buildMaster() {
    const ctx = this.ctx;
    const n = this.nodes;

    n.voiceBus = this._gain(1);
    n.mixBus = this._gain(1);

    // Ring modulator: the carrier multiplies a copy of the mix (gain intrinsic
    // value 0, carrier connected into the gain), and depth crossfades that
    // against the untouched dry path.
    n.ringDry = this._gain(1);
    n.ringIn = this._gain(0);
    n.ringWet = this._gain(0);
    n.ringOsc = ctx.createOscillator();
    n.ringOsc.type = 'sine';
    n.ringOsc.frequency.value = 30;
    n.ringOsc.connect(n.ringIn.gain);
    n.postRing = this._gain(1);
    n.mixBus.connect(n.ringDry).connect(n.postRing);
    n.mixBus.connect(n.ringIn).connect(n.ringWet).connect(n.postRing);

    n.filter = ctx.createBiquadFilter();
    n.filter.type = 'lowpass';
    n.filter.frequency.value = 4200;
    n.filter.Q.value = 0.7;
    n.postRing.connect(n.filter);

    // Mid/side width matrix.
    n.split = ctx.createChannelSplitter(2);
    n.merge = ctx.createChannelMerger(2);
    n.lToM = this._gain(0.7071);
    n.rToM = this._gain(0.7071);
    n.mSum = this._gain(1);
    n.lToS = this._gain(0.7071);
    n.rToS = this._gain(-0.7071);
    n.sSum = this._gain(1);
    n.sScale = this._gain(1);
    n.mToL = this._gain(0.7071);
    n.sToL = this._gain(0.7071);
    n.mToR = this._gain(0.7071);
    n.sToR = this._gain(-0.7071);
    n.filter.connect(n.split);
    n.split.connect(n.lToM, 0);
    n.split.connect(n.rToM, 1);
    n.lToM.connect(n.mSum);
    n.rToM.connect(n.mSum);
    n.split.connect(n.lToS, 0);
    n.split.connect(n.rToS, 1);
    n.lToS.connect(n.sSum);
    n.rToS.connect(n.sSum);
    n.sSum.connect(n.sScale);
    n.mSum.connect(n.mToL).connect(n.merge, 0, 0);
    n.sScale.connect(n.sToL).connect(n.merge, 0, 0);
    n.mSum.connect(n.mToR).connect(n.merge, 0, 1);
    n.sScale.connect(n.sToR).connect(n.merge, 0, 1);

    // The probability gate gets its own node. The prototype wrote master gain
    // directly, which meant it fought Freeze (which also wrote master gain to
    // mute the live synth) and reset the master level to a hardcoded 0.35
    // every time it fired.
    n.probGate = this._gain(1);
    n.merge.connect(n.probGate);

    n.breath = this._gain(1);
    n.breathOsc = ctx.createOscillator();
    n.breathOsc.type = 'sine';
    n.breathOsc.frequency.value = 0.05;
    n.breathDepth = this._gain(0.025);
    n.breathDC = ctx.createConstantSource();
    n.breathDC.offset.value = 0.975;
    n.breathOsc.connect(n.breathDepth).connect(n.breath.gain);
    n.breathDC.connect(n.breath.gain);
    n.probGate.connect(n.breath);

    // Sub-octave content plus asymmetric soft clipping can walk the signal off
    // centre; a DC offset costs headroom and does nothing audible.
    n.dcBlock = ctx.createBiquadFilter();
    n.dcBlock.type = 'highpass';
    n.dcBlock.frequency.value = 12;
    n.dcBlock.Q.value = 0.707;
    n.breath.connect(n.dcBlock);

    n.master = this._gain(0.35);
    n.dcBlock.connect(n.master);

    n.limiter = ctx.createDynamicsCompressor();
    n.limiter.threshold.value = -1;
    n.limiter.knee.value = 6;
    n.limiter.ratio.value = 20;
    n.limiter.attack.value = 0.003;
    n.limiter.release.value = 0.25;
    n.master.connect(n.limiter);

    // The live path and the frozen path meet at the output gate. Freeze
    // crossfades between them; the prototype muted the live synth by writing
    // master gain to zero and restored it to a hardcoded 0.35, so unfreezing
    // reset whatever level you had set.
    n.live = this._gain(1);
    n.frozen = this._gain(0);
    n.limiter.connect(n.live);

    // The output gate is what Power toggles. Keeping it separate from the
    // master level means powering down never disturbs the mix.
    n.output = this._gain(0);
    n.live.connect(n.output);
    n.frozen.connect(n.output);
    n.output.connect(ctx.destination);

    // Metering taps the audible signal, so the display reads zero when the
    // instrument is powered down rather than showing a drone nobody can hear.
    n.analyser = ctx.createAnalyser();
    n.analyser.fftSize = 4096;
    n.analyser.smoothingTimeConstant = 0.72;
    n.output.connect(n.analyser);

    // Split taps for the output meters. An AnalyserNode downmixes to mono, so
    // a single one cannot show that a patch has collapsed to the centre or run
    // away into one channel — which, on an instrument with three systems
    // moving the stereo image, is exactly what you want to see.
    n.meterSplit = ctx.createChannelSplitter(2);
    n.meterL = ctx.createAnalyser();
    n.meterR = ctx.createAnalyser();
    n.meterL.fftSize = 1024;
    n.meterR.fftSize = 1024;
    n.output.connect(n.meterSplit);
    n.meterSplit.connect(n.meterL, 0);
    n.meterSplit.connect(n.meterR, 1);

    n.ringOsc.start();
    n.breathOsc.start();
    n.breathDC.start();
  }

  _buildInserts() {
    const ctx = this.ctx;
    const n = this.nodes;

    n.dist1 = ctx.createWaveShaper();
    n.dist1.curve = makeCurve(ctx, 'atan', 0);
    n.dist1.oversample = '2x';
    n.dist2 = ctx.createWaveShaper();
    n.dist2.curve = makeCurve(ctx, 'tanh', 0);
    n.dist2.oversample = '2x';

    n.tilt = ctx.createBiquadFilter();
    n.tilt.type = 'lowshelf';
    n.tilt.frequency.value = 500;
    n.tilt.gain.value = 0;

    // Tremolo sits at or below unity: gain = (1 - d/2) + (d/2)·carrier. The
    // prototype's rode on a DC of 1 with a depth of 0.35, so it peaked 2.6 dB
    // *above* unity and pushed the limiter on every cycle.
    n.trem = this._gain(1);
    n.tremOsc = ctx.createOscillator();
    n.tremOsc.type = 'sine';
    n.tremOsc.frequency.value = 0;
    n.tremDepth = this._gain(0.175);
    n.tremDC = ctx.createConstantSource();
    n.tremDC.offset.value = 0.825;
    n.tremOsc.connect(n.tremDepth).connect(n.trem.gain);
    n.tremDC.connect(n.trem.gain);
    n.tremOsc.start();
    n.tremDC.start();

    n.insertOut = this._gain(1);
    n.voiceBus.connect(n.dist1).connect(n.dist2).connect(n.tilt).connect(n.trem).connect(n.insertOut);

    n.dry = this._gain(1);
    n.insertOut.connect(n.dry).connect(n.mixBus);

    // A dedicated tap for the envelope follower, before the filter it drives.
    // The prototype measured the post-limiter output and modulated the master
    // filter with it, so the follower was listening to its own effect: opening
    // the filter raised the level, which opened the filter further, and the
    // pair drifted together until the limiter stopped them.
    n.envAnalyser = ctx.createAnalyser();
    n.envAnalyser.fftSize = 1024;
    n.envAnalyser.smoothingTimeConstant = 0.5;
    n.insertOut.connect(n.envAnalyser);
  }

  _buildVoices() {
    const ctx = this.ctx;
    for (const type of VOICES) {
      const osc = ctx.createOscillator();
      if (type === 'pulse') osc.setPeriodicWave(makePulseWave(ctx, 0.5));
      else osc.type = type;
      osc.frequency.value = 110;

      const gain = this._gain(0);
      const comp = this._gain(1);
      const pan = ctx.createStereoPanner();
      pan.pan.value = 0;

      osc.connect(gain).connect(comp).connect(pan).connect(this.nodes.voiceBus);
      osc.start();
      this.voice[type] = { osc, gain, comp, pan };
    }
  }

  _buildSupersaw() {
    this.nodes.supersawGain = this._gain(0);
    this.nodes.supersawGain.connect(this.nodes.voiceBus);
    this._rebuildSupersaw(7, 110, 22, 0.7);
  }

  /**
   * A supersaw is one pitch detuned by cents across many voices. The prototype
   * spread its seven oscillators over ±12 semitones, which is a chord — a
   * minor-ish stack that fought whatever pitch the rest of the patch was on.
   */
  _rebuildSupersaw(count, pitch, cents, spread) {
    for (const v of this.supersaw) {
      try { v.osc.stop(); } catch { /* already stopped */ }
      v.osc.disconnect();
      v.gain.disconnect();
      v.pan.disconnect();
    }
    this.supersaw = [];
    const n = Math.max(3, Math.round(count) | 1);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;   // -1 .. 1
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = pitch;
      osc.detune.value = t * cents;
      const gain = this._gain(1 / Math.sqrt(n));
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = t * spread;
      osc.connect(gain).connect(pan).connect(this.nodes.supersawGain);
      // A tiny random phase offset stops all voices starting in lockstep,
      // which would otherwise give one loud click and a beat-free first second.
      osc.start(this.ctx.currentTime + Math.random() * 0.01);
      this.supersaw.push({ osc, gain, pan, t });
    }
  }

  _buildRadio() {
    const ctx = this.ctx;
    const n = this.nodes;
    n.radioFilter = ctx.createBiquadFilter();
    n.radioFilter.type = 'bandpass';
    n.radioFilter.frequency.value = 1200;
    n.radioFilter.Q.value = 5;
    n.radioGain = this._gain(0);
    n.radioFilter.connect(n.radioGain).connect(n.voiceBus);

    n.radioDriftOsc = ctx.createOscillator();
    n.radioDriftOsc.type = 'sine';
    n.radioDriftOsc.frequency.value = 0.2;
    n.radioDriftGain = this._gain(180);
    n.radioDriftOsc.connect(n.radioDriftGain).connect(n.radioFilter.detune);
    n.radioDriftOsc.start();

    const mk = (buf) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      return src;
    };
    n.whiteSrc = mk(makeWhiteNoise(ctx, NOISE_SECONDS));
    n.pinkSrc = mk(makePinkNoise(ctx, NOISE_SECONDS));
    n.brownSrc = mk(makeBrownNoise(ctx, NOISE_SECONDS));
    n.whiteMix = this._gain(1);
    n.pinkMix = this._gain(0);
    n.brownMix = this._gain(0);
    n.whiteSrc.connect(n.whiteMix).connect(n.radioFilter);
    n.pinkSrc.connect(n.pinkMix).connect(n.radioFilter);
    n.brownSrc.connect(n.brownMix).connect(n.radioFilter);
    n.whiteSrc.start();
    n.pinkSrc.start();
    n.brownSrc.start();
  }

  _buildSends() {
    const ctx = this.ctx;
    const n = this.nodes;
    const from = n.insertOut;

    // Reverb ---------------------------------------------------------------
    n.revSend = this._gain(0.32);
    n.revPre = ctx.createDelay(0.5);
    n.revPre.delayTime.value = 0.02;
    n.convolver = ctx.createConvolver();
    n.convolver.buffer = makeImpulse(ctx, 4.5);
    from.connect(n.revSend).connect(n.revPre).connect(n.convolver).connect(n.mixBus);

    // Delay ----------------------------------------------------------------
    n.delaySend = this._gain(0);
    n.delay = ctx.createDelay(5);
    n.delay.delayTime.value = 0.6;
    n.delayFb = this._gain(0.35);
    // Damping in the feedback path: an undamped repeat gets brighter and
    // harsher every pass, which is the one thing a real delay never does.
    n.delayDamp = ctx.createBiquadFilter();
    n.delayDamp.type = 'lowpass';
    n.delayDamp.frequency.value = 4500;
    from.connect(n.delaySend).connect(n.delay);
    n.delay.connect(n.delayDamp).connect(n.delayFb).connect(n.delay);
    n.delay.connect(n.mixBus);

    // Chorus ---------------------------------------------------------------
    n.chorusSend = this._gain(0);
    n.chorusDelay = ctx.createDelay(0.2);
    n.chorusDelay.delayTime.value = 0.02;
    n.chorusOsc = ctx.createOscillator();
    n.chorusOsc.type = 'sine';
    n.chorusOsc.frequency.value = 0.25;
    n.chorusDepth = this._gain(0.004);
    n.chorusOsc.connect(n.chorusDepth).connect(n.chorusDelay.delayTime);
    n.chorusOsc.start();
    from.connect(n.chorusSend).connect(n.chorusDelay).connect(n.mixBus);

    // Wow & flutter --------------------------------------------------------
    // Two rates, as the name says: wow is the slow tape wander, flutter the
    // fast one. The prototype had a single 0.5 Hz LFO and no flutter at all.
    n.wowSend = this._gain(0);
    n.wowDelay = ctx.createDelay(0.2);
    n.wowDelay.delayTime.value = 0.008;
    n.wowOsc = ctx.createOscillator();
    n.wowOsc.type = 'sine';
    n.wowOsc.frequency.value = 0.5;
    n.wowDepth = this._gain(0.0025);
    n.wowOsc.connect(n.wowDepth).connect(n.wowDelay.delayTime);
    n.wowOsc.start();
    n.flutterOsc = ctx.createOscillator();
    n.flutterOsc.type = 'triangle';
    n.flutterOsc.frequency.value = 7.3;
    n.flutterDepth = this._gain(0.0002);
    n.flutterOsc.connect(n.flutterDepth).connect(n.wowDelay.delayTime);
    n.flutterOsc.start();
    from.connect(n.wowSend).connect(n.wowDelay).connect(n.mixBus);
  }

  _buildWorkletSends() {
    const ctx = this.ctx;
    const n = this.nodes;
    const from = n.insertOut;
    const opts = { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] };

    // Shimmer: a delay feeding a pitch shifter feeding itself. The delay is
    // required — Web Audio only permits a cycle that contains one — and it is
    // also the musical control, since it sets how long each octave takes to
    // climb to the next.
    n.shimSend = this._gain(0);
    n.shimDelay = ctx.createDelay(4);
    n.shimDelay.delayTime.value = 0.45;
    n.shimShift = new AudioWorkletNode(ctx, 'pitch-shift-processor', opts);
    n.shimShift.parameters.get('ratio').value = 2;
    n.shimShift.parameters.get('window').value = 0.1;
    n.shimFb = this._gain(0.55);
    n.shimDamp = ctx.createBiquadFilter();
    n.shimDamp.type = 'lowpass';
    n.shimDamp.frequency.value = 6000;
    from.connect(n.shimSend).connect(n.shimDelay);
    n.shimDelay.connect(n.shimShift).connect(n.shimDamp).connect(n.shimFb).connect(n.shimDelay);
    n.shimShift.connect(n.mixBus);

    // Harmonizer -----------------------------------------------------------
    n.harmSend = this._gain(0);
    n.harmShift = new AudioWorkletNode(ctx, 'pitch-shift-processor', opts);
    n.harmShift.parameters.get('ratio').value = Math.pow(2, 7 / 12);
    n.harmShift.parameters.get('window').value = 0.08;
    from.connect(n.harmSend).connect(n.harmShift).connect(n.mixBus);

    // Granular -------------------------------------------------------------
    n.granSend = this._gain(0);
    n.granular = new AudioWorkletNode(ctx, 'granular-processor', opts);
    n.granular.parameters.get('density').value = 12;
    from.connect(n.granular);
    n.granular.connect(n.granSend).connect(n.mixBus);

    // Haze -----------------------------------------------------------------
    n.hazeSend = this._gain(0);
    n.haze = new AudioWorkletNode(ctx, 'downsample-processor', opts);
    from.connect(n.haze);
    n.haze.connect(n.hazeSend).connect(n.mixBus);
    n.haze.port.postMessage({ rate: 12000, bits: 16 });

    // Sub ------------------------------------------------------------------
    n.subSend = this._gain(0);
    n.sub = new AudioWorkletNode(ctx, 'sub-divider-processor', opts);
    n.subLP = ctx.createBiquadFilter();
    n.subLP.type = 'lowpass';
    n.subLP.frequency.value = 220;
    from.connect(n.sub);
    n.sub.connect(n.subLP).connect(n.subSend).connect(n.mixBus);

    // Capture tap for Freeze ------------------------------------------------
    n.capture = new AudioWorkletNode(ctx, 'capture-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    n.limiter.connect(n.capture);
    // The processor writes nothing to its output; connecting it to a muted
    // gain keeps it scheduled without adding silence-shaped nodes to the mix.
    n.captureSink = this._gain(0);
    n.capture.connect(n.captureSink).connect(ctx.destination);
  }

  _buildModulators() {
    const ctx = this.ctx;
    const n = this.nodes;

    // Global LFO. Everything it drives is an audio-rate connection into an
    // AudioParam, so it never passes through the modulation router.
    n.lfoBus = this._gain(1);
    n.lfoOsc = ctx.createOscillator();
    n.lfoOsc.type = 'sine';
    n.lfoOsc.frequency.value = 0.35;
    n.lfoOsc.start();
    n.lfoOsc.connect(n.lfoBus);
    n.lfoSH = ctx.createConstantSource();
    n.lfoSH.offset.value = 0;
    n.lfoSH.start();

    n.lfoPitch = this._gain(8);
    n.lfoFilter = this._gain(0);
    n.lfoBus.connect(n.lfoPitch);
    n.lfoBus.connect(n.lfoFilter).connect(n.filter.detune);
    for (const type of VOICES) n.lfoPitch.connect(this.voice[type].osc.detune);

    // Cross-modulation: a real oscillator into the target's detune, rather
    // than the prototype's 20 Hz setInterval writing a sampled sine, which
    // aliased into a buzz well before the rate knob was halfway up.
    n.xmodOsc = ctx.createOscillator();
    n.xmodOsc.type = 'sine';
    n.xmodOsc.frequency.value = 5;
    n.xmodOsc.start();
    n.xmodGain = this._gain(0);
    n.xmodOsc.connect(n.xmodGain);
    this._xmodTarget = null;
    this._setXmodTarget('square');
  }

  _setXmodTarget(target) {
    const n = this.nodes;
    try { n.xmodGain.disconnect(); } catch { /* nothing connected yet */ }
    this._xmodTarget = target;
    const list = target === 'all' ? VOICES : [target];
    for (const t of list) {
      if (this.voice[t]) n.xmodGain.connect(this.voice[t].osc.detune);
    }
  }

  // -------------------------------------------------------------------------
  // Parameter application
  // -------------------------------------------------------------------------

  /** Ramp an AudioParam. `smooth` is the time to essentially arrive, not tau. */
  ramp(param, value, smooth = 0.02) {
    if (!Number.isFinite(value)) return;
    const t = this.ctx.currentTime;
    if (smooth <= 0.001) {
      param.cancelScheduledValues(t);
      param.setValueAtTime(value, t);
    } else {
      param.setTargetAtTime(value, t, Math.max(0.0005, smooth / 3));
    }
  }

  apply(id, value, smooth) {
    // Recorded before dispatch: a few settings are derived from more than one
    // parameter (the harmonizer's ratio from its interval and fine tuning, the
    // supersaw's rebuild from its pitch, detune and spread), and reading them
    // back from the nodes would read whatever a ramp happens to be passing
    // through rather than the value that was asked for.
    this._lastValues[id] = value;
    const fn = this.setters[id];
    if (fn) fn(value, smooth === undefined ? 0.02 : smooth);
  }

  _buildSetters() {
    const n = this.nodes;
    const s = {};

    for (const type of VOICES) {
      const v = this.voice[type];
      s[`${type}Vol`] = (x, sm) => this.ramp(v.gain.gain, x, sm);
      s[`${type}Pitch`] = (x, sm) => this.ramp(v.osc.frequency, x, sm);
      s[`${type}Detune`] = (x, sm) => this.ramp(v.osc.detune, x, sm);
      s[`${type}Pan`] = (x, sm) => this.ramp(v.pan.pan, x, sm);
    }

    s.pulseWidth = (x) => {
      const p = this.voice.pulse;
      if (!p) return;
      p.osc.setPeriodicWave(makePulseWave(this.ctx, x));
      this.ramp(p.comp.gain, pulseCompensation(x), 0.05);
    };
    s.crossMod = (x, sm) => this.ramp(n.xmodGain.gain, x * x * 2400, sm);
    s.crossModRate = (x, sm) => this.ramp(n.xmodOsc.frequency, x, sm);
    s.crossModTarget = (x) => this._setXmodTarget(x);

    s.reverb = (x, sm) => this.ramp(n.revSend.gain, x, sm);
    s.reverbDecay = (x) => this._scheduleImpulse(x);
    s.reverbPreDelay = (x, sm) => this.ramp(n.revPre.delayTime, x, sm);
    s.distortion = (x) => { n.dist1.curve = makeCurve(this.ctx, 'atan', x); };
    s.distortion2 = (x) => { n.dist2.curve = makeCurve(this.ctx, 'tanh', x); };
    s.delayTime = (x, sm) => this.ramp(n.delay.delayTime, x, Math.max(sm, 0.08));
    s.delayFeedback = (x, sm) => this.ramp(n.delayFb.gain, x, sm);
    s.delayMix = (x, sm) => this.ramp(n.delaySend.gain, x, sm);
    s.tremolo = (x, sm) => this.ramp(n.tremOsc.frequency, x, sm);
    s.tremoloDepth = (x, sm) => {
      this.ramp(n.tremDepth.gain, x / 2, sm);
      this.ramp(n.tremDC.offset, 1 - x / 2, sm);
    };
    s.filterFreq = (x, sm) => this.ramp(n.filter.frequency, x, sm);
    s.filterQ = (x, sm) => this.ramp(n.filter.Q, x, sm);
    s.filterType = (x) => { n.filter.type = x; };
    s.toneTilt = (x, sm) => this.ramp(n.tilt.gain, x, sm);

    s.lfoSpeed = (x, sm) => {
      this.ramp(n.lfoOsc.frequency, x, sm);
      if (this._lfoShape === 'random') this._restartSampleHold(x);
    };
    s.lfoDepth = (x, sm) => this.ramp(n.lfoPitch.gain, x, sm);
    s.lfoToFilter = (x, sm) => this.ramp(n.lfoFilter.gain, x, sm);
    s.lfoShape = (x) => this._setLfoShape(x);

    s.ringModFreq = (x, sm) => this.ramp(n.ringOsc.frequency, x, sm);
    s.ringModDepth = (x, sm) => {
      this.ramp(n.ringWet.gain, x, sm);
      this.ramp(n.ringDry.gain, 1 - x, sm);
    };

    s.supersawVolume = (x, sm) => this.ramp(n.supersawGain.gain, x, sm);
    s.supersawPitch = (x, sm) => {
      for (const v of this.supersaw) this.ramp(v.osc.frequency, x, sm);
    };
    s.supersawDetune = (x, sm) => {
      for (const v of this.supersaw) this.ramp(v.osc.detune, v.t * x, sm);
    };
    s.supersawSpread = (x, sm) => {
      for (const v of this.supersaw) this.ramp(v.pan.pan, v.t * x, sm);
    };
    s.supersawVoices = (x) => {
      this._rebuildSupersaw(x, this._last('supersawPitch', 110), this._last('supersawDetune', 22), this._last('supersawSpread', 0.7));
    };

    if (this.hasWorklets) {
      s.shimmerVolume = (x, sm) => this.ramp(n.shimSend.gain, x, sm);
      s.shimmerPitch = (x, sm) => this.ramp(n.shimShift.parameters.get('ratio'), Math.pow(2, x / 12), Math.max(sm, 0.05));
      s.shimmerFeedback = (x, sm) => this.ramp(n.shimFb.gain, x, sm);
      s.shimmerSize = (x, sm) => this.ramp(n.shimDelay.delayTime, x, Math.max(sm, 0.1));
      s.harmonizerVolume = (x, sm) => this.ramp(n.harmSend.gain, x, sm);
      s.harmonizerPitch = () => this._applyHarmonizerRatio();
      s.harmonizerFine = () => this._applyHarmonizerRatio();
      s.granularDepth = (x, sm) => this.ramp(n.granSend.gain, x, sm);
      s.granularRate = (x) => { n.granular.parameters.get('density').value = x; };
      s.granularSize = (x) => { n.granular.parameters.get('size').value = x; };
      s.granularSpread = (x) => { n.granular.parameters.get('scatter').value = x; };
      s.granularPitch = (x) => { n.granular.parameters.get('pitch').value = Math.pow(2, x / 12); };
      s.hazeMix = (x, sm) => this.ramp(n.hazeSend.gain, x, sm);
      s.hazeRate = (x) => n.haze.port.postMessage({ rate: x * 1000 });
      s.hazeBits = (x) => n.haze.port.postMessage({ bits: x });
      s.subMix = (x, sm) => this.ramp(n.subSend.gain, x, sm);
      s.subLPCutoff = (x, sm) => this.ramp(n.subLP.frequency, x, sm);
      s.subDivMix = (x) => { n.sub.parameters.get('blend').value = x; };
    }

    s.chorusVolume = (x, sm) => this.ramp(n.chorusSend.gain, x, sm);
    s.chorusRate = (x, sm) => this.ramp(n.chorusOsc.frequency, x, sm);
    s.chorusDepth = (x, sm) => this.ramp(n.chorusDepth.gain, x * 0.008, sm);
    s.wowFlutterVolume = (x, sm) => this.ramp(n.wowSend.gain, x, sm);
    s.wowRate = (x, sm) => this.ramp(n.wowOsc.frequency, x, sm);
    s.wowDepth = (x, sm) => this.ramp(n.wowDepth.gain, x * 0.006, sm);
    s.flutterAmt = (x, sm) => this.ramp(n.flutterDepth.gain, x * 0.0006, sm);

    s.radioVolume = (x, sm) => this.ramp(n.radioGain.gain, x, sm);
    // 0..100 maps exponentially across the audible band. The prototype mapped
    // it to 3–30 kHz, so everything past the halfway point was above Nyquist
    // and the top half of the knob was silence.
    s.radioTuning = (x, sm) => this.ramp(n.radioFilter.frequency, 90 * Math.pow(12000 / 90, x / 100), sm);
    s.radioQ = (x, sm) => this.ramp(n.radioFilter.Q, x, sm);
    s.radioDrift = (x, sm) => this.ramp(n.radioDriftGain.gain, x * 600, sm);
    s.noiseColor = (x, sm) => {
      const t = Math.max(0, Math.min(1, x));
      this.ramp(n.whiteMix.gain, Math.max(0, 1 - t * 2), sm);
      this.ramp(n.pinkMix.gain, 1 - Math.abs(t * 2 - 1), sm);
      this.ramp(n.brownMix.gain, Math.max(0, t * 2 - 1), sm);
    };

    s.breathRate = (x, sm) => this.ramp(n.breathOsc.frequency, x, sm);
    s.breathDepth = (x, sm) => {
      this.ramp(n.breathDepth.gain, x / 2, sm);
      this.ramp(n.breathDC.offset, 1 - x / 2, sm);
    };

    s.masterVolume = (x, sm) => this.ramp(n.master.gain, x, sm);
    s.stereoWidth = (x, sm) => this.ramp(n.sScale.gain, x, sm);
    s.limiterThreshold = (x, sm) => this.ramp(n.limiter.threshold, x, sm);
    s.limiterRelease = (x, sm) => this.ramp(n.limiter.release, x, sm);

    this.setters = s;
  }

  _last(id, fallback) {
    return this._lastValues && this._lastValues[id] !== undefined ? this._lastValues[id] : fallback;
  }

  _applyHarmonizerRatio() {
    const semi = this._last('harmonizerPitch', 7);
    const fine = this._last('harmonizerFine', 0);
    this.ramp(this.nodes.harmShift.parameters.get('ratio'), Math.pow(2, (semi + fine / 100) / 12), 0.05);
  }

  _setLfoShape(shape) {
    const n = this.nodes;
    this._lfoShape = shape;
    try { n.lfoOsc.disconnect(); } catch { /* not connected */ }
    try { n.lfoSH.disconnect(); } catch { /* not connected */ }
    if (this._shTimer) { clearInterval(this._shTimer); this._shTimer = null; }
    if (shape === 'random') {
      n.lfoSH.connect(n.lfoBus);
      this._restartSampleHold(n.lfoOsc.frequency.value);
    } else {
      n.lfoOsc.type = shape;
      n.lfoOsc.connect(n.lfoBus);
    }
  }

  _restartSampleHold(rate) {
    if (this._shTimer) clearInterval(this._shTimer);
    const ms = Math.max(20, 1000 / Math.max(0.005, rate));
    this._shTimer = setInterval(() => {
      const t = this.ctx.currentTime;
      // Stepped, not slewed: a sample-and-hold that glides is a triangle.
      this.nodes.lfoSH.offset.setValueAtTime(Math.random() * 2 - 1, t);
    }, ms);
  }

  /**
   * Rebuilding the impulse response allocates megabytes, so a knob drag
   * schedules one rebuild for after the gesture settles rather than one per
   * pointer sample.
   */
  _scheduleImpulse(decay) {
    this._pendingDecay = decay;
    if (this._impulseTimer) return;
    this._impulseTimer = setTimeout(() => {
      this._impulseTimer = null;
      if (this.disposed) return;
      const d = this._pendingDecay;
      this._pendingDecay = null;
      try {
        this.nodes.convolver.buffer = makeImpulse(this.ctx, d);
      } catch (err) {
        console.warn('impulse rebuild failed', err);
      }
    }, 120);
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  setPower(on, fade = 0.35) {
    // A linear ramp, not setTargetAtTime: an exponential approach never
    // arrives, so "off" would sit at roughly -70 dB rather than at silence.
    const g = this.nodes.output.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(on ? 1 : 0, t + Math.max(0.01, fade));
  }

  get powered() {
    return this.nodes.output.gain.value > 0.001;
  }

  dispose() {
    this.disposed = true;
    if (this._shTimer) clearInterval(this._shTimer);
    if (this._impulseTimer) clearTimeout(this._impulseTimer);
    for (const key of Object.keys(this.nodes)) {
      const node = this.nodes[key];
      try { if (node.stop) node.stop(); } catch { /* not a source */ }
      try { node.disconnect(); } catch { /* already detached */ }
    }
    for (const t of VOICES) {
      const v = this.voice[t];
      if (!v) continue;
      try { v.osc.stop(); } catch { /* already stopped */ }
      try { v.osc.disconnect(); } catch { /* already detached */ }
    }
    for (const v of this.supersaw) {
      try { v.osc.stop(); } catch { /* already stopped */ }
      try { v.osc.disconnect(); } catch { /* already detached */ }
    }
  }
}
