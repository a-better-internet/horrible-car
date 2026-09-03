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

const ROAD = { short: 22, medium: 44, long: 88 };
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

  // Difficulty ramps over the 50-stage rally: longer, twistier, hillier.
  // Stage length is set so a clean run takes roughly 30-50 seconds, which is
  // what makes the fuel economy bite: one tank does not cover a stage, so
  // you have to go and get the globes.
  const t = Math.min(1, (stage - 1) / (TOTAL_STAGES - 1));
  const pieces = Math.round(lerp(15, 27, t));
  const twist = lerp(0.60, 1.10, t);
  const hilliness = lerp(0.5, 1.25, t);

  // Straight launch pad: gives the player a moment before the first corner.
  track.addSegments(60, 0, 0);

  let y = 0;
  for (let i = 0; i < pieces; i++) {
    const len = rng.pick([ROAD.short, ROAD.medium, ROAD.medium, ROAD.long]);
    const enter = Math.round(len * 0.35);
    const hold = Math.round(len * 0.45);
    const leave = len - enter - hold;

    // Curvature: sometimes a straight, otherwise a signed corner.
    let curve = 0;
    if (!rng.chance(0.22)) {
      const mag = rng.pick([CURVE.easy, CURVE.medium, CURVE.medium, CURVE.hard, CURVE.brutal]);
      curve = mag * twist * (rng.chance(0.5) ? 1 : -1);
    }

    // Hills.
    if (rng.chance(0.62)) {
      const h = rng.pick([HILL.low, HILL.low, HILL.medium, HILL.high]) * hilliness;
      y += rng.chance(0.5) ? h : -h;
      y = Math.max(-6000, Math.min(9000, y));
    }

    // Narrow bridge sections (no shoulder, and a long way down).
    const width = stage >= 5 && rng.chance(0.16) ? 0.60 : 1;

    track.addRoad(enter, hold, leave, curve, y, width);
  }

  // Level run-in to the finish line so the banner is readable.
  track.addSegments(45, 0, y);
  track.finishIndex = track.segments.length - 1;
  // Horizon padding past the finish so the world does not fall away.
  track.addSegments(DRAW_PADDING, 0, y);

  return track;
}

export const STAGE_NAMES = [
  'INTERSTATE 4', 'DEAD MALL LOOP', 'THE BYPASS', 'SCHOOL ZONE', 'RUST BELT',
  'CANYON CUTOFF', 'THE OVERPASS', 'SALT FLATS', 'DETOUR 9', 'QUARRY ROAD',
  'SUBURBAN SPRAWL', 'THE TOLL PLAZA', 'RIVER CROSSING', 'HIGH DESERT',
  'THE CLOVERLEAF', 'PARK & RIDE', 'LAST EXIT',
];
