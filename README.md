# Horrible Car

A browser port of Atari Games' **Road Blasters** (1987), except you are not
driving a race car. You are driving a tan 1994 Dodge Caravan.

Everything else is intact: 50 rally stages, fuel as your only life, a roof
cannon, and a Rescue Cruiser that drops weapon pods on a road you are already
sharing with people who want to ram you.

```
python3 -m http.server 8000     # or any static server
open http://localhost:8000
```

No build step, no dependencies, no assets — ES modules and a canvas.

## Controls

| | |
|---|---|
| **← →** / A D / mouse / left stick | Steer (analog) |
| **↑** / W / right trigger | Gas |
| **↓** / S / left trigger | Brake |
| **Space** / Z / gamepad X | Fire |
| **Shift** / X / gamepad B | Cruise missile |
| **C** / gamepad Y | Nitro |
| **Enter** | Start |
| **P** / Esc | Pause |
| **M** | Mute |
| **F** | Fullscreen |
| **`** | Debug overlay |

## What was taken from the hardware

The uploaded MiSTer **Atari System 1** core is the FPGA implementation of the
board Road Blasters ran on. It contains no game code — that lived in ROM — but
it does pin down the machine the game was written for, and three things came
straight out of it:

**The raster.** `Arcade-atarisys1.sv` instantiates `arcade_video` at 320 pixels
wide with a 12-bit colour bus. The game keeps that 4:3 framing but renders at
640×480 — twice the density, so a car closing at 250 mph has enough pixels to
read as a car. The HUD is still laid out in 320×240 arcade units and drawn
through a scale transform, which keeps it on exact pixel boundaries.

**The colour model.** `VIDEO.vhd` slices each 16-bit CRAM word into
`INT:RED:GRN:BLU` nibbles, and `RGBI.vhd` holds the PROM that turns each
(intensity, channel) pair into a 4-bit DAC value. That PROM's comment says
`(Intensity * Color) / 16`, but the table contents are actually
`round(I * C / 15)` — row `I=15` is the identity `0..F`, which `/16` cannot
produce. `src/palette.js` reproduces the real table, so every colour on screen
is one the board could have held.

**The controls.** For slapstic types 109/110 (Road Blasters), the core reads a
quadrature steering wheel (`left=0x7F, centre=0x3F, right=0x00`) and a
*one-sided* analog gas pedal on ADC channel 3, plus a trigger and a thumb
button. The input layer presents that same shape: a continuous steer in
`[-1,1]` and a continuous throttle in `[0,1]`. Keyboard input is ramped into
that range rather than snapping to full lock, so keys feel like a wheel.

## Mechanics

**Fuel is the whole game.** There are no lives. Fuel is the timer, the health
bar and the end-of-stage bonus simultaneously. It drains with speed, and
wrecks, sideswipes and turret hits all cost it. Run dry and the rally is over
wherever you happen to be standing. One tank does not cover a stage, so
collecting globes is not optional.

**The camera** sits high and well back, as the arcade's did. That framing is
not decoration: a low chase camera hides the very lane you are shooting into.
`CAMERA_HEIGHT` and `PLAYER_PULLBACK` in `config.js` are the only two knobs —
the van's on-screen size and height are derived from the projection at its own
depth, not from hardcoded screen fractions, so pulling the camera back shrinks
the van and lifts it up the frame exactly as it should.

**The road** is a segment list carrying curvature and height. Curvature is
accumulated across the draw loop (`x += dx; dx += curve`), which is what makes
long sweepers bend instead of kink; hills come from segment heights plus a
per-column clip line, so a crest genuinely hides what is behind it. Centrifugal
force scales with the square of speed, so the hardest corners are not
counterable at 250 mph — you have to lift.

**The roster**: red sedans that drift into your line, blue coupés that ram,
motorcycles that weave (a minivan wins that argument), command trucks that lay
mines, roadside gun emplacements, mines, cones and immovable scenery. Some
stages narrow to bridges with nothing either side.

**Weapons** arrive by parachute. The X-1 Rescue Cruiser flies over periodically
and drops a pod containing whatever you are shortest of: the UZ Cannon, the
Door Spreader, cruise missiles, nitro, or an Electro Shield.

**Stages** are generated from a seed derived from the stage number, so stage 23
is the same road every time you reach it. Themes cycle through day, dusk,
night, fog, rust and snow.

**The ramp** is eased rather than linear (`t^1.35`), so the opening stages stay
short and gentle and the back half climbs hard. Everything scales off that one
value — length, corner severity, hills, bridge frequency, traffic density, the
enemy mix, mines and turrets — and piece length is a ramping mean with only
mild variance, so a later stage is never accidentally shorter than an earlier
one. Measured end to end: stage 1 is 589 segments (~13s) with 20 cars and no
hazards; stage 50 is 2072 segments (~48s) with 358 cars, 32 mines and 14
turrets.

**After dark** the van throws real headlight beams, and every lamp in the world
— car head- and tail-lights, streetlights, turret sensors, mines, fuel globes,
billboard floods, the skyline's windows — is queued during the sprite pass and
painted additively *after* the night wash. Lighting them before it would just
mean dimming the lights.

## Layout

| File | |
|---|---|
| `src/config.js` | every tunable, in one place |
| `src/palette.js` | the Atari System 1 CRAM/RGBI colour model, stage themes |
| `src/road.js` | segment track, projection, stage geometry |
| `src/entities.js` | object pools, enemy catalogue, stage populator |
| `src/game.js` | the simulation — physics, collisions, fuel, scoring |
| `src/render.js` | sky, road, sprites, lighting, effects |
| `src/skyline.js` | the Pittsburgh horizon, baked once per theme |
| `src/hud.js` | HUD and the between-play screens |
| `src/sprites.js` | all artwork, drawn procedurally at load |
| `src/font.js` | 5×7 bitmap font |
| `src/input.js` | analog wheel/pedal model over keyboard, mouse, gamepad |
| `src/audio.js` | synthesised engine and SFX |
| `src/main.js` | fixed-timestep loop, scaling, pause |

## Engineering notes

The things that usually go wrong in a first-pass driving game, and what was
done about them here:

- **Framerate coupling.** The simulation runs on a fixed 120 Hz step behind an
  accumulator. Verified: identical inputs produce bit-identical positions at
  1, 4 and 8 steps per rendered frame.
- **Per-frame input edges firing per step.** Several sim steps run per frame,
  so a latched keypress would fire once per step — three cruise missiles for
  one press. Steps *consume* edges (`input.consume()`).
- **Collision tunnelling.** At 250 mph the van covers 100 road units per step.
  Collisions test swept z intervals, not point positions.
- **Sprites at the near plane.** Projection scale is `1/z`, so an object level
  with the camera projects to infinite size. Sprites are culled at a near
  plane just short of the van; without it, a billboard you have just passed
  blankets the screen.
- **Fog halos.** Distance fade is done with alpha rather than by washing a
  haze rectangle over each sprite, whose bounding box is mostly transparent.
- **A horizon that disagrees with the road.** The sky is painted over the whole
  screen and the road paints down from the furthest visible segment, so the
  sky/world boundary is wherever the road actually ends. A separately guessed
  horizon leaves a slab of ground colour floating on hills.
- **Lights dimmed by the thing that makes it night.** The night wash is applied
  after the world and before the van, and lamps are deferred past it, so
  headlights brighten a dark scene instead of being darkened with it.
- **Stuck keys after alt-tab.** `keyup` never arrives for a window that lost
  focus, so blur releases every key and pauses (except on the attract screen,
  which is a demo).
- **Autoplay policy.** The AudioContext is created on the first user gesture
  and every audio call is guarded, so the game runs silently rather than not
  at all if audio is unavailable.
- **GC hitches.** Bullets, particles and floaters come from fixed pools that
  recycle rather than grow. A 5-minute soak moves the heap 9.5 MB → 9.5 MB.
- **Storage that throws.** `localStorage` is wrapped; private mode loses your
  high score rather than the game.

Measured at 640×480 on the last stage with maximum traffic and repeated cruise
missiles: median frame 16.7 ms, p95 17.1 ms, peak 27 cars and 193 particles
live.

## The city

The skyline is Pittsburgh, built from the silhouettes that actually identify
it: the US Steel Tower as a flat-topped Cor-Ten slab (it is meant to rust),
PPG Place as a cluster of glass gothic spires, the Gulf Tower's stepped
ziggurat cap, Fifth Avenue Place's needle, mill stacks still smoking, and gold
truss bridges — in this city they are all the same yellow. It is baked once per
theme into an offscreen strip and blitted twice per frame; at night its windows
light up. Rebuilding it from rectangles every frame would be hundreds of fill
calls for something that only ever slides sideways.
