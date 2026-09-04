/*
 * Pseudo-3D road engine.
 *
 * The track is a list of fixed-length segments, each carrying a curvature
 * delta and a world-space height.  Curvature is *accumulated* across the draw
 * loop (x += dx; dx += curve) rather than applied per segment, which is what
 * makes long sweepers bend correctly instead of kinking.  Hills come from the
 * segment y values plus a per-column "clip" line so a crest genuinely hides
 * what is behind it.
 *
 * Tracks are finite: a Road Blasters rally stage has a start and a finish,
 * not a loop.  We append padding segments past the finish line so the horizon
 * still has geometry to draw as you cross it.
 */

import {
  SEG_LENGTH, ROAD_WIDTH, TOTAL_STAGES, STAGE_THEME_ORDER,
} from './config.js';
import { makeRNG, lerp } from './util.js';

// --------------------------------------------------------------- projection

/**
 * Project one road-space point into screen space.
 * Mutates p.camera and p.screen in place (these objects are reused every
 * frame; allocating here would churn the GC at 60Hz).
 */
/**
 * Surface decoration flags.  Purely cosmetic, but they are what stops a
 * hundred identical segments from reading as a treadmill: patched asphalt and
 * expansion joints give the eye something to measure speed against.
 */
export const DECO = {
  PATCH: 1,       // a darker rectangle of newer asphalt
  JOINT: 2,       // transverse expansion joint
  SKID: 4,        // somebody else's bad day
  RAIL: 8,        // guardrail along both edges
};

export function project(p, camX, camY, camZ, camDepth, width, height, roadWidth) {
  p.camera.x = p.world.x - camX;
  p.camera.y = p.world.y - camY;
  // Clamp z: a segment exactly at the camera plane would divide by zero and
  // fling the whole road off-screen.
  p.camera.z = Math.max(p.world.z - camZ, 1e-3);
  p.screen.scale = camDepth / p.camera.z;
  p.screen.x = Math.round(width / 2 + (p.screen.scale * p.camera.x * width) / 2);
  p.screen.y = Math.round(height / 2 - (p.screen.scale * p.camera.y * height) / 2);
  p.screen.w = Math.round((p.screen.scale * roadWidth * width) / 2);
}

const makePoint = (z) => ({
  world: { x: 0, y: 0, z },
  camera: { x: 0, y: 0, z: 0 },
  screen: { x: 0, y: 0, w: 0, scale: 0 },
});

// --------------------------------------------------------------- easing

const easeIn = (a, b, p) => a + (b - a) * Math.pow(p, 2);
const easeOut = (a, b, p) => a + (b - a) * (1 - Math.pow(1 - p, 2));
const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);

// --------------------------------------------------------------- track class

export class Track {
  constructor() {
    /** @type {Array<object>} */
    this.segments = [];
    this.finishIndex = 0;
    this.theme = 'day';
    this.stage = 1;
    this.name = '';
  }

  get length() { return this.segments.length * SEG_LENGTH; }
  /** World z of the finish line. */
  get finishZ() { return this.finishIndex * SEG_LENGTH; }

  /** Segment containing world position z (clamped; the track does not loop). */
  segmentAt(z) {
    const i = Math.floor(z / SEG_LENGTH);
    return this.segments[Math.max(0, Math.min(this.segments.length - 1, i))];
  }

  lastY() {
    return this.segments.length === 0 ? 0 : this.segments[this.segments.length - 1].p2.world.y;
  }

  /** Append `count` segments with the given curvature and target height. */
  addSegments(count, curve, targetY, width = 1) {
    const startY = this.lastY();
    for (let i = 0; i < count; i++) {
      const n = this.segments.length;
      const seg = {
        index: n,
        p1: makePoint(n * SEG_LENGTH),
        p2: makePoint((n + 1) * SEG_LENGTH),
        curve,
        width,               // road half-width multiplier (bridges narrow this)
        alt: Math.floor(n / 3) % 2 === 0, // stripe alternation, 3 segs per band
        deco: 0,
        objects: [],         // static props & pickups anchored to this segment
        dyn: [],             // dynamic things bucketed here by the renderer
        clip: 0,             // filled in each frame by the renderer
        fog: 1,
        visible: false,
      };
      seg.p1.world.y = easeInOut(startY, targetY, i / count);
      seg.p2.world.y = easeInOut(startY, targetY, (i + 1) / count);
      this.segments.push(seg);
    }
  }

  /** A curve/hill "piece" with eased entry, steady hold and eased exit. */
  addRoad(enter, hold, leave, curve, targetY, width = 1) {
    const startY = this.lastY();
    const total = enter + hold + leave;
    for (let i = 0; i < total; i++) {
      // Ease curvature in and out so corners have a proper turn-in and exit
      // rather than snapping to full lock on the first segment.
      let c;
      if (i < enter) c = easeIn(0, curve, i / enter);
      else if (i < enter + hold) c = curve;
      else c = easeInOut(curve, 0, (i - enter - hold) / leave);

      const idx = this.segments.length;
      const seg = {
        index: idx,
        p1: makePoint(idx * SEG_LENGTH),
        p2: makePoint((idx + 1) * SEG_LENGTH),
        curve: c,
        width,
        alt: Math.floor(idx / 3) % 2 === 0,
        objects: [],
        dyn: [],
        clip: 0,
        fog: 1,
        visible: false,
      };
      seg.p1.world.y = easeInOut(startY, targetY, i / total);
      seg.p2.world.y = easeInOut(startY, targetY, (i + 1) / total);
      this.segments.push(seg);
    }
  }
}

// --------------------------------------------------------------- generation

/** Extra segments appended past the finish line so the horizon keeps drawing. */
const DRAW_PADDING = 220;

const CURVE = { easy: 1.5, medium: 3.2, hard: 4.8, brutal: 6.2 };
const HILL = { low: 900, medium: 2100, high: 3800 };

/**
 * Build the track for a stage.  Deterministic in `stage`, so stage 23 is the
 * same road every time you reach it -- you are meant to learn the route.
 */
export function buildTrack(stage) {
  const rng = makeRNG(0x9e37 ^ (stage * 2654435761));
  const track = new Track();
  track.stage = stage;
  track.theme = STAGE_THEME_ORDER[(stage - 1) % STAGE_THEME_ORDER.length];
  track.name = STAGE_NAMES[(stage - 1) % STAGE_NAMES.length];

  /*
   * Difficulty ramp.
   *
   * `t` is progress through the rally, 0 at stage 1 and 1 at stage 50.  It is
   * eased rather than linear: the first handful of stages stay noticeably
   * short and gentle so there is room to learn the van, and the back half
   * climbs harder.  Everything difficulty-related in the generator is a
   * function of it, so the curve is tuned in one place.
   *
   * Length is set so a clean early run is ~25 seconds and a late one ~70.
   * That is what makes the fuel economy bite: one tank never covers a stage,
   * so you have to go and get the globes.
   */
  const t = Math.min(1, (stage - 1) / (TOTAL_STAGES - 1));
  const ramp = Math.pow(t, 1.35);           // slow start, hard finish
  const pieces = Math.round(lerp(11, 34, ramp));
  const twist = lerp(0.48, 1.18, ramp);
  const hilliness = lerp(0.35, 1.35, ramp);

  // Straight launch pad: gives the player a moment before the first corner.
  // It shortens as the rally goes on -- later stages throw you straight in.
  track.addSegments(Math.round(lerp(70, 40, ramp)), 0, 0);

  let y = 0;
  for (let i = 0; i < pieces; i++) {
    // Piece length is a ramping mean with only mild variance.  Picking freely
    // from short/medium/long made total stage length swing so wide that a
    // later stage could come out shorter than an earlier one, which reads as
    // the difficulty curve going backwards.
    const len = Math.max(14, Math.round(lerp(44, 58, ramp) * rng.range(0.82, 1.18)));
    const enter = Math.round(len * 0.35);
    const hold = Math.round(len * 0.45);
    const leave = len - enter - hold;

    // Curvature: sometimes a straight, otherwise a signed corner.  Straights
    // get rarer as the rally goes on.
    let curve = 0;
    if (!rng.chance(lerp(0.34, 0.13, ramp))) {
      const mag = rng.pick([CURVE.easy, CURVE.medium, CURVE.medium, CURVE.hard, CURVE.brutal]);
      curve = mag * twist * (rng.chance(0.5) ? 1 : -1);
    }

    // Hills.
    if (rng.chance(lerp(0.42, 0.74, ramp))) {
      const h = rng.pick([HILL.low, HILL.low, HILL.medium, HILL.high]) * hilliness;
      y += rng.chance(0.5) ? h : -h;
      y = Math.max(-6000, Math.min(9000, y));
    }

    // Narrow bridge sections (no shoulder, and a long way down).
    const width = stage >= 6 && rng.chance(lerp(0.05, 0.24, ramp)) ? 0.60 : 1;

    track.addRoad(enter, hold, leave, curve, y, width);
  }

  // Level run-in to the finish line so the banner is readable.
  track.addSegments(45, 0, y);
  track.finishIndex = track.segments.length - 1;
  // Horizon padding past the finish so the world does not fall away.
  track.addSegments(DRAW_PADDING, 0, y);

  decorate(track, rng);

  return track;
}

/**
 * Scatter surface decoration over a finished track.
 *
 * Expansion joints are regular (they are cast that way); patches and skids are
 * random.  Guardrails follow the narrow sections automatically, because a
 * bridge with nothing at the edge is the one place you most want a visual cue
 * that the shoulder has run out.
 */
function decorate(track, rng) {
  const segs = track.segments;
  // Expansion joints every 12 segments, like real concrete slab paving.
  for (let i = 0; i < segs.length; i += 12) segs[i].deco |= DECO.JOINT;

  // Patched asphalt in runs of 2-5 segments.
  for (let i = 20; i < segs.length - 6; i += rng.int(18, 60)) {
    const run = rng.int(2, 5);
    for (let k = 0; k < run && i + k < segs.length; k++) segs[i + k].deco |= DECO.PATCH;
  }

  // Skid marks, usually just before something worth braking for.
  for (let i = 30; i < segs.length - 8; i += rng.int(40, 150)) {
    const run = rng.int(3, 7);
    for (let k = 0; k < run && i + k < segs.length; k++) segs[i + k].deco |= DECO.SKID;
  }

  // Guardrails wherever the road narrows, plus a segment either side so the
  // rail does not start and stop in mid-air.
  for (let i = 1; i < segs.length - 1; i++) {
    if (segs[i].width < 0.8) {
      segs[i].deco |= DECO.RAIL;
      segs[i - 1].deco |= DECO.RAIL;
      segs[i + 1].deco |= DECO.RAIL;
    }
  }
}

export const STAGE_NAMES = [
  'INTERSTATE 4', 'DEAD MALL LOOP', 'THE BYPASS', 'SCHOOL ZONE', 'RUST BELT',
  'CANYON CUTOFF', 'THE OVERPASS', 'SALT FLATS', 'DETOUR 9', 'QUARRY ROAD',
  'SUBURBAN SPRAWL', 'THE TOLL PLAZA', 'RIVER CROSSING', 'HIGH DESERT',
  'THE CLOVERLEAF', 'PARK & RIDE', 'LAST EXIT',
];
