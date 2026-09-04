# Viceroy Drone Synth

An evolving drone instrument for the browser. Five oscillators, a bank of
parallel effects, and a set of systems whose job is to keep the sound moving
after you stop touching it.

```
python3 -m http.server 8123     # or any static server, from this directory
open http://localhost:8123
```

No build step, no dependencies, no assets — ES modules, Web Audio and a canvas.

This is a rebuild of the `VICEROY DRONE SYNTH v28` prototype. **Nothing was
dropped.** Every control the prototype had is still here, and most of them now
do what their label always claimed. Presets saved from v28 load directly; see
[Reading v28 presets](#reading-v28-presets).

---

## Controls

| | |
|---|---|
| **Space** | Power |
| **F** | Freeze |
| **R** | Record |
| **E** | Evolve now |
| **N** | Randomise |
| **1**–**8** | Sections |
| drag | Set a control (jumps to the pointer) |
| **Shift** + drag | Fine adjustment, relative to where it was |
| wheel | Nudge by one step |
| **←** **→** **↑** **↓** | Nudge (hold **Shift** for a quarter step) |
| **Home** / **End** | Minimum / maximum |
| double-click | Back to the default |

Every control is a real slider to the accessibility tree, with a name, a range
and a spoken value — including the XY pad, which is arrow-key playable.

## What the two colours mean

The whole scheme rests on one distinction. **Teal is what you set. Amber is
what the instrument is doing by itself.** Nothing else uses amber.

So a control whose track carries an amber segment is being moved by something —
and the segment shows how far, from where you left it to where it is now. Hover
it and the tooltip names the system responsible. This is the single most useful
thing to know on an instrument with eight things that can be modulating a
parameter at once, and the prototype had no way to show it: six automated
systems could be driving a knob and the knob would not move.

---

## The instrument

### Signal flow

```
voices + supersaw + radio ─> voiceBus
     ─> arctan drive ─> tanh drive ─> tilt ─> tremolo ─> inserts out
           ├─ dry ──────────────────────────────────────────┐
           ├─ reverb      (pre-delay ─> convolver) ─────────┤
           ├─ delay       (delay ─> damped feedback) ───────┤
           ├─ shimmer     (delay ─> pitch shift ─> fb) ─────┤
           ├─ harmonizer  (pitch shift) ────────────────────┤
           ├─ chorus      (modulated delay) ────────────────┤
           ├─ wow&flutter (two modulated delays) ───────────┤
           ├─ granular    (grain cloud over live capture) ──┤
           ├─ haze        (decimator + bit crusher) ────────┤
           └─ sub         (frequency divider ─> low pass) ──┤
                                                        mix bus
     ─> ring modulator (dry/wet) ─> filter ─> mid/side width
     ─> probability gate ─> breath ─> DC block ─> master ─> limiter
     ─> output gate ─> speakers
```

Two structural changes carry most of the improvement.

**Everything past the inserts is a parallel send, not a link in a chain.** The
prototype ran reverb, delay, chorus, wow and the harmonizer in series off the
oscillator bus. That is why its reverb was permanently 100% wet — its "Amount"
knob only changed the impulse decay, and there was no wet/dry control anywhere
— and why raising the delay time replaced the dry signal instead of adding to
it.

**The ring modulator is a real one.** The prototype used its ring-mod gain node
as the main summing bus for the entire instrument, with the carrier oscillator
connected straight to `gain` and the "Depth" knob writing the DC offset that
carrier rode on. Setting Ring Depth to zero — its default — therefore muted
everything. Here the carrier multiplies a copy of the mix and Depth crossfades
that against an untouched dry path, so depth zero is simply dry.

### The evolving systems

This is what the instrument is for, so they have a tab of their own rather than
being wedged into the bottom of Master, and an always-visible strip of chips
that shows which are running and what each is currently doing.

There are two kinds, and the distinction is deliberate:

**Reversible offsets.** The tectonic plates, organic drift, random drift, the
envelope follower, the sequencer and the wave morph publish signed offsets
against parameters. Your slider stays where you put it; the amber ghost shows
where the offset has taken the sound. Switch the system off and the parameter
returns exactly, with nothing lost.

**Rewrites.** Auto-Evolve and the memory system move the base values
themselves, and the sliders visibly travel. That is what "evolve" means — a
hidden offset would give you a patch whose sound and whose controls disagree —
and both are undoable: Auto-Evolve keeps the state from immediately before its
last move, and the memory system exists precisely to get earlier states back.

| System | What it does |
|---|---|
| **Organic drift** | Always-on life. A bounded random walk on per-voice tuning, pan and cutoff. |
| **Random drift** | Picks a new random target on an interval; moves cutoff, width and pan together. |
| **Envelope follower** | Input level opens the filter. |
| **Probability gate** | Ducks the output at a rate, with a chance and a depth. |
| **Step sequencer** | Eight steps, four directions, into cutoff, ring depth, pitch and pulse width. |
| **Harmonic plate** | The whole instrument drifts through an interval and back, over minutes. |
| **Timbral plate** | Cutoff, pulse width and spectral tilt travelling together. |
| **Spatial plate** | Width breathes; the voices orbit at different phases. |
| **Auto-Evolve** | Periodically nudges a handful of controls. |
| **State memory** | Captures the patch periodically and morphs back into an earlier one. |

The three plates run on independent free-running phases taken from the audio
clock, so a twenty-minute cycle is twenty minutes long whether the tab is in
front of you or throttled to one timer call a second in the background. The
timeline bars report that phase. In the prototype they reported
`Math.random() * 100 + '%'`.

---

## Engineering notes

The prototype was a working instrument with real ideas in it. These are the
things that were wrong underneath, and what was done about them.

### Six systems writing one AudioParam

The sequencer, auto-evolve, the plates, the envelope follower, random drift and
an always-on organic drift all called `setTargetAtTime` on the same nodes. Web
Audio has no notion of who asked, so the last writer won and the sound depended
on timer phase. Turning the sequencer off restored a cutoff the envelope
follower was still moving. Your own filter knob was overwritten within 50 ms of
being touched — `createOrganicDrift` wrote `panners[type].pan` on a timer, over
whatever you had just set.

Everything slow now publishes a named, signed offset to a **modulation router**
(`src/engine/modulation.js`), which sums them, adds your base value, clamps to
range and performs the single write. One writer per parameter, and the
effective value is a number the interface can draw.

Two details that took a second pass:

*Smoothing belongs to the change, not to the parameter.* A plate asks for
four-second glides because that is how a plate should move. When a base change
inherited that, turning the pitch up while a plate ran took four seconds to be
heard, and the control felt broken. A base change now carries its own short
smoothing for that flush only.

*A system that publishes every tick needs only enough smoothing to bridge one
tick.* Its slowness is already in the trajectory. Asking for a four-second ramp
thirty times a second means every write restarts a four-second glide from the
current value — so the parameter could never move faster than the slowest
system touching it, no matter what anything else did. The continuous publishers
now smooth by the measured tick interval, which also degrades correctly when a
background tab throttles them.

Anything that genuinely has to move at audio rate — the pitch LFO,
cross-modulation, the ring carrier, tremolo, the chorus and wow delay lines, the
breath — is a real connection into an AudioParam and never goes through the
router at all.

### Modules that did not do what they said

- **Reverb** had no wet/dry control; "Amount" set the decay and the reverb was
  always fully wet. Now Mix, Decay and Pre-Delay, as a send.
- **Distortion** evaluated to `0.333 × x` at zero drive — a fixed 9.5 dB of
  attenuation on the whole instrument that no amount of turning the knob down
  removed. Both curves are now normalised so zero is exactly the identity.
- **Harmonizer** and **Shimmer** wobbled a delay time with an LFO. That is
  vibrato: it moves pitch back and forth around the original and never holds an
  interval. Both now use a real overlap-add pitch shifter (two taps read at the
  pitch ratio, offset by half a window, crossfaded with an equal-power window),
  and shimmer puts it inside a feedback loop so each repeat climbs.
- **Granular** retriggered a fixed noise buffer, so it granulated noise rather
  than the instrument. It is now a grain cloud scattered across a rolling
  four-second capture of the live signal, with size, scatter, density and grain
  pitch.
- **Cross-modulation** was a `setInterval` at 20 Hz writing a sampled sine into
  `detune`, which aliases into a buzz well before the rate knob is halfway up.
  It is an oscillator now, with a selectable target.
- **The global LFO** divided its depth by 1000 before it reached `detune`, so
  the maximum setting was 0.05 cents — inaudible across the entire range of the
  knob. Depth is now in cents, with five shapes including sample-and-hold, and
  a second amount into the filter.
- **SuperSaw** spread seven oscillators across ±12 semitones, which is a chord,
  not a supersaw, and it was pinned at 110 Hz regardless of the patch. It now
  has pitch, detune in cents, stereo spread and a voice count.
- **Wow & Flutter** had a single 0.5 Hz LFO and no flutter. It has both rates.
- **Radio tuning** mapped to 3–30 kHz, so everything past the halfway point of
  the knob was above Nyquist and the top half of the control was silence. It
  now spans 90 Hz – 12 kHz exponentially.
- **Pink noise** was a one-pole lowpass, which rolls off at −6 dB/octave; that
  is brown noise. It is Paul Kellett's filter bank now, at a real −3 dB/octave.
- **The sub divider** re-clocked on every zero crossing, so noise or any
  harmonic crossing zero made it warble. It is a Schmitt trigger with
  level-tracking hysteresis and a silence gate.
- **The tremolo** rode on a DC offset of 1 with a depth of 0.35, so it peaked
  2.6 dB *above* unity and pushed the limiter on every cycle. It now sits at or
  below unity, with a depth control.
- **A hidden lowpass at 1 kHz** sat in the chain with no user control at all,
  capping the entire instrument. Removed. The tilt filter that was next to it —
  also hidden, also being animated randomly — is exposed as Tone Tilt.
- **The probability gate** wrote the master gain directly, which meant it
  fought Freeze (which also wrote master gain) and reset your level to a
  hardcoded 0.35 every time it fired. It has its own node.
- **Wave Morph** silently overwrote the sine, square and sawtooth levels with no
  way back to what you had. It is a toggle now: engaged it owns those three
  through the router, disengaged the mixer returns untouched.
- **The memory system** shipped nine controls and three buttons and *no
  implementation* — not one event listener, no storage, no recall. It works.
- **The tectonic plates** exposed a cycle length, a depth and a progress bar
  each and used none of them: they only acted when Auto-Evolve happened to
  fire, all three moved on that one shared timer, and the bars were filled with
  `Math.random()`.
- **The macros** were hardcoded and absolute — macro 1 wrote the cutoff to
  `100 + value × 9900`, so touching it slammed the filter to 100 Hz whatever
  the patch had. They are assignable, relative and reversible: a macro anchors
  on the values it finds when it leaves zero, and returning it to zero restores
  them exactly.

### Things that were quietly expensive

- **Rebuilding buffers on every pointer event.** A 14-second stereo impulse
  response and two 44,100-point waveshaper curves, regenerated for each pixel of
  each knob drag — about 11 MB of allocation per pointer move on the reverb
  knob. All three are pure functions of one number: they are cached, quantised
  into buckets, and the impulse rebuild is debounced past the end of the
  gesture. Curves are 2,048 points, which for a smooth monotone shape is
  indistinguishable from 44,100.
- **Fifteen uncleared `setInterval`s.** Every automated system had its own,
  none were cleared, and several were recreated on each knob move. There is one
  scheduler.
- **`ScriptProcessorNode` for Freeze** — deprecated, running on the main thread,
  dropping samples exactly when the interface is busy, which is when you are
  reaching for the button. It is an AudioWorklet, and the captured loop is
  crossfaded at the seam so it does not click once per cycle forever.
- **A recording tap that was never disconnected**, so every recording left
  another live `MediaStreamDestination` hanging off the output for the rest of
  the session.

### Smaller things

- A voice level of zero could not silence a voice: every gain was floored at
  `MIN_VOICE_GAIN = 0.02`.
- The envelope follower measured the post-limiter output and modulated the
  filter with it — it was listening to its own effect, and the pair drifted
  together until the limiter stopped them. It has a tap before the filter it
  drives.
- Power-off used an exponential approach, which never arrives; "off" sat at
  about −70 dB. It is a linear ramp to exactly zero.
- Repeated evolution was a random walk against clamped ends — an absorbing
  process. Left running, every parameter ended pinned to its minimum or maximum
  and the drone died flat. Evolution now reverts a quarter of the way toward
  the patch it started from on each step, so it orbits instead of escaping, and
  it steps in slider space rather than in raw units (a ±35% linear nudge means
  one thing on a 0–1 mix and something absurd on a 0.1–2000 Hz exponential
  control).
- Controls read their own value from the last painted frame, so key repeats and
  wheel ticks arriving faster than the render loop collapsed into one — holding
  an arrow key moved a control at frame rate rather than at key-repeat rate.
- Frequency controls were linear. On a 100 Hz – 10 kHz slider that puts
  everything below 1 kHz — which is where a bass drone lives — in the first 9%
  of the travel. Every frequency control has an exponential taper.
- A global `outline: none` removed the focus ring, which is the only way
  somebody navigating by keyboard can tell where they are.
- The document contained two complete nested `<html>` documents.
- Randomisation set five independent voice volumes and threw four effects
  across their full ranges, which reliably produced a loud, muddy chord. It now
  picks two or three voices on a shared root from a table of musical ratios,
  keeps most optional modules off, and never touches the master level or the
  limiter ceiling.

---

## Displays

Three, at three timescales. The prototype had the first two, both on a linear
frequency axis.

- **Waveform**, triggered on a rising zero crossing so a steady tone stands
  still instead of sliding.
- **Spectrum**, 20 Hz – 16 kHz logarithmic with octave gridlines and a peak
  hold.
- **Spectrogram**, three minutes across the pane whatever its width. This is the
  one that matters for a drone: evolution over minutes is invisible in a single
  FFT frame and obvious as a slow bend in a spectrogram.

Output metering is per channel — an `AnalyserNode` downmixes to mono, and on an
instrument with three systems moving the stereo image you want to see when it
has collapsed to the centre.

---

## Reading v28 presets

Load a preset saved from the prototype through **Import** and it comes across.
Its oscillator controls were keyed off dataset attributes, giving `sine_vol`,
`sine_pitch` and so on, which are mapped. Three settings no longer mean what
they used to, because what they used to mean was a bug, so they are translated
and the translation is reported:

- `reverb` set the decay of an always-wet reverb; it becomes Decay plus a
  sensible Mix.
- any `delayTime` above zero meant a fully wet delay, since it was in series;
  Mix is set to 50%.
- `waveMorph` above zero engages the morph toggle.

Nothing is silently dropped: an unrecognised key is reported by name.

---

## Layout

| File | |
|---|---|
| `src/params.js` | the parameter registry — every control, its range, taper and units |
| `src/store.js` | parameter state, independent of the audio engine |
| `src/systems.js` | the evolving systems, on one audio-clock scheduler |
| `src/presets.js` | factory presets, randomisation, save/load, v28 import |
| `src/macros.js` | the macro matrix and the XY pad's writes |
| `src/transport.js` | freeze and record |
| `src/main.js` | wiring, transport, keyboard, the render loop |
| `src/engine/graph.js` | the audio graph and every parameter's setter |
| `src/engine/modulation.js` | the modulation router |
| `src/engine/worklets.js` | decimator, divider, pitch shifter, grain cloud, capture |
| `src/engine/buffers.js` | impulses, curves and noise, with caches |
| `src/ui/layout.js` | which panel each control lives in |
| `src/ui/control.js` | the control primitive |
| `src/ui/build.js` | panels and the custom widgets |
| `src/ui/visualizer.js` | scope, spectrum, spectrogram, meters |

The registry is the single source of truth: the interface, presets,
randomisation, the memory system and the macro matrix are all generated from
it, so a parameter added there is immediately savable, randomisable, morphable
and drawable. A parameter that appears in no panel fails the layout test.

## Tests

```
node test/run.mjs              # five unit suites, Node only
node test/run.mjs --browser    # plus the end-to-end suite
```

The unit suites run the worklet DSP off-thread against a shimmed
`AudioWorkletProcessor` — the pitch shifter is checked to land on its interval,
the divider an octave down under noise, the grain cloud free of discontinuities
— and drive the evolving systems against a fake clock, so a twenty-minute plate
cycle or four hundred consecutive evolutions take milliseconds.

The end-to-end suite needs Playwright and a static server on port 8123. It
drives the real instrument in Chromium: audio is measured through the analyser,
controls are moved with a real pointer and real key presses, and the whole
thing is run a second time with `AudioWorklet` removed to confirm the five
modules that need it degrade with an explanation rather than failing silently.

```
npx http-server -p 8123 -s .
node test/run.mjs --browser
```
