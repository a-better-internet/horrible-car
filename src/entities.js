/*
 * Entities: object pools and the stage populator.
 *
 * Everything that can exist in large numbers (bullets, sparks, debris) comes
 * from a fixed pool.  Nothing is allocated during play, so there are no GC
 * hitches at 60Hz -- which in a game where a hitch means a wreck matters.
 *
 * Enemies are *scheduled* rather than pre-spawned: a stage stores a sorted
 * list of spawn records, and each one instantiates a live entity when the van
 * gets within spawn range.  That keeps the stage layout deterministic while
 * still letting cars actually drive.
 */

import { SEG_LENGTH, SCORE } from './config.js';
import { SPR } from './sprites.js';

/** Themes dark enough to want street lighting. */
const NIGHT_THEMES = new Set(['dusk', 'night', 'fog']);

/** Fixed-size pool of plain objects; never grows during play. */
export class Pool {
  /**
   * @param {number} size
   * @param {() => object} make factory for a blank record
   */
  constructor(size, make) {
    this.items = new Array(size);
    for (let i = 0; i < size; i++) {
      this.items[i] = make();
      this.items[i].active = false;
    }
    this.size = size;
    this._cursor = 0;
  }

  /**
   * Take a free record.  If the pool is exhausted the oldest slot is recycled
   * rather than allocating -- a dropped spark is invisible, a stall is not.
   */
  acquire() {
    for (let n = 0; n < this.size; n++) {
      const i = (this._cursor + n) % this.size;
      if (!this.items[i].active) {
        this._cursor = (i + 1) % this.size;
        this.items[i].active = true;
        return this.items[i];
      }
    }
    const it = this.items[this._cursor];
    this._cursor = (this._cursor + 1) % this.size;
    it.active = true;
    return it;
  }

  release(item) { item.active = false; }

  forEach(fn) {
    for (let i = 0; i < this.size; i++) {
      const it = this.items[i];
      if (it.active) fn(it, i);
    }
  }

  clear() { for (let i = 0; i < this.size; i++) this.items[i].active = false; }

  get activeCount() {
    let n = 0;
    for (let i = 0; i < this.size; i++) if (this.items[i].active) n++;
    return n;
  }
}

// ------------------------------------------------------------- record shapes

export const newBullet = () => ({
  active: false, x: 0, z: 0, y: 0, vx: 0, vz: 0, life: 0,
  damage: 1, hostile: false, size: 1, color: '#fff', seg: 0,
  _render: 'bullet', _z: 0,
});

export const newParticle = () => ({
  active: false, x: 0, z: 0, y: 0, vx: 0, vy: 0, vz: 0,
  life: 0, maxLife: 1, size: 1, color: '#fff', gravity: 1, seg: 0,
  _render: 'particle', _z: 0,
});

export const newFloater = () => ({
  active: false, x: 0, z: 0, y: 0, life: 0, maxLife: 1, text: '', color: '#fff', seg: 0,
  _render: 'floater', _z: 0,
});

// ------------------------------------------------------------- enemy catalog

/**
 * `speed` is a fraction of the player's top speed.  `w` is a fraction of the
 * road half-width and is used for both drawing and collision, so what you see
 * is exactly what you hit.
 */
export const ENEMY_TYPES = {
  sedan: {
    hp: 1, speed: 0.60, w: 0.36, score: SCORE.sedan, ai: 'chase',
    lateral: 0.32, sprite: 'sedanRear', spriteFront: 'sedanFront', hostile: true,
    contact: 'swipe',
  },
  coupe: {
    hp: 2, speed: 0.76, w: 0.34, score: SCORE.coupe, ai: 'ram',
    lateral: 0.62, sprite: 'coupeRear', spriteFront: 'coupeFront', hostile: true,
    contact: 'crash',
  },
  cycle: {
    hp: 1, speed: 0.70, w: 0.18, score: SCORE.cycle, ai: 'weave',
    lateral: 0.85, sprite: 'cycle', spriteFront: 'cycle', hostile: true,
    contact: 'flatten',
  },
  command: {
    hp: 3, speed: 0.54, w: 0.46, score: SCORE.command, ai: 'miner',
    lateral: 0.20, sprite: 'commandRear', spriteFront: 'commandFront', hostile: true,
    contact: 'crash', mineInterval: 1.9,
  },
  civic: {
    hp: 1, speed: 0.42, w: 0.35, score: 50, ai: 'straight',
    lateral: 0.06, sprite: 'civicRear', spriteFront: 'civicFront', hostile: false,
    contact: 'crash',
  },
  oncoming: {
    hp: 1, speed: -0.55, w: 0.35, score: 120, ai: 'straight',
    lateral: 0.04, sprite: 'civicFront', spriteFront: 'civicFront', hostile: false,
    contact: 'crash', oncoming: true,
  },
};

/** Create a live enemy record from a scheduled spawn. */
export function makeEnemy(type, x, z) {
  const def = ENEMY_TYPES[type];
  return {
    kind: 'enemy',
    type,
    def,
    x,
    z,
    w: def.w,
    hp: def.hp,
    speedFrac: def.speed,
    vx: 0,
    phase: Math.random() * Math.PI * 2,
    fireTimer: 0.6 + Math.random(),
    hitFlash: 0,
    dead: false,
    passed: false,
    seg: 0,
    sprite: def.sprite,
    _render: 'enemy',
    _z: z,
  };
}

/** Roadside gun emplacement.  Static, shoots, and is worth a lot. */
export function makeTurret(x, z) {
  return {
    kind: 'turret', type: 'turret', x, z, w: 0.30, hp: 2,
    fireTimer: 1.2 + Math.random() * 1.5, hitFlash: 0, dead: false, seg: 0,
    sprite: 'turret', score: SCORE.turret,
  };
}

// ------------------------------------------------------------ stage contents

/*
 * Roadside furniture, with weights.
 *
 * Billboards used to be as common as trees, which made the highway read as a
 * six-mile advertising hoarding.  They are now rare enough to be an event,
 * and there are six designs so the ones you do pass are not obviously the
 * same board again.
 */
const SCENERY = [
  { sprite: 'tree', solid: true, weight: 20 },
  { sprite: 'treeDark', solid: true, weight: 14 },
  { sprite: 'pine', solid: true, weight: 16 },
  { sprite: 'deadTree', solid: true, weight: 5 },
  { sprite: 'bush', solid: false, weight: 16 },
  { sprite: 'rock', solid: true, weight: 9 },
  { sprite: 'sign', solid: true, weight: 6 },
  { sprite: 'pylon', solid: false, weight: 6 },
  { sprite: 'billboard', solid: false, weight: 2, variants: 6, minGap: 44 },
];

/** Daylight sprite -> its shaded variant, for the dark themes. */
const NIGHT_SWAP = { tree: 'treeDark', pine: 'pineDark', bush: 'bushDark', grass: 'grassDark' };

const SCENERY_TOTAL = SCENERY.reduce((n, p) => n + p.weight, 0);

/** Weighted pick from SCENERY. */
function pickScenery(rng) {
  let roll = rng.next() * SCENERY_TOTAL;
  for (const item of SCENERY) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return SCENERY[0];
}

/**
 * Fill a track with static props, pickups and hazards, and build the enemy
 * spawn schedule.  Deterministic in the RNG that is handed in.
 *
 * @param {import('./road.js').Track} track
 * @param {number} stage 1..50
 * @param {ReturnType<import('./util.js').makeRNG>} rng
 * @returns {{spawns: Array<object>, globes: number}}
 */
export function populateTrack(track, stage, rng) {
  const segs = track.segments;
  const finish = track.finishIndex;
  // Same eased ramp the road geometry uses, so length and threat rise
  // together rather than one outpacing the other.
  const t = Math.pow(Math.min(1, (stage - 1) / 49), 1.35);

  const add = (segIndex, obj) => {
    const s = segs[Math.max(0, Math.min(segs.length - 1, segIndex))];
    obj.seg = s.index;
    obj.z = s.index * SEG_LENGTH + SEG_LENGTH / 2;
    s.objects.push(obj);
  };

  // ---- roadside scenery ------------------------------------------------
  // Minimum spacing for anything that declares one.  Without it two
  // billboards can land three segments apart and read as a single hoarding.
  const lastAt = new Map();
  for (let n = 12; n < segs.length - 4; n += rng.int(2, 6)) {
    const side = rng.chance(0.5) ? -1 : 1;
    let pick = pickScenery(rng);
    if (pick.minGap && n - (lastAt.get(pick.sprite) ?? -1e9) < pick.minGap) {
      pick = SCENERY[0];
    }
    lastAt.set(pick.sprite, n);
    const dist = rng.range(1.30, 2.70);
    let sprite = pick.variants ? `${pick.sprite}${rng.int(0, pick.variants - 1)}` : pick.sprite;
    // After dark, use the shaded foliage: a full-brightness summer tree at
    // midnight reads as a cutout pasted over the scene.
    if (NIGHT_THEMES.has(track.theme) && NIGHT_SWAP[sprite]) sprite = NIGHT_SWAP[sprite];
    add(n, {
      kind: 'prop', sprite, x: side * dist,
      w: SPR[sprite] ? SPR[sprite].worldW : 0.4,
      solid: pick.solid && dist < 2.05, hp: 0, dead: false,
    });
  }

  // ---- delineator posts ------------------------------------------------
  // Both shoulders, evenly spaced.  Regular spacing is the point: they are a
  // metronome for speed, and at night their reflectors are the first thing
  // the headlights find.
  for (let n = 8; n < segs.length - 4; n += 11) {
    for (const side of [-1, 1]) {
      add(n, {
        kind: 'prop', sprite: side > 0 ? 'postR' : 'postL', x: side * 1.10,
        w: SPR.postL.worldW, solid: false, hp: 0, dead: false,
      });
    }
  }

  // ---- low growth ------------------------------------------------------
  // A second, much denser pass of small vegetation hugging the shoulder.
  // Big trees alone leave the verge looking mown; grass and scrub right at
  // the edge are what actually sell speed, because they are close enough to
  // blur past.
  const dark = NIGHT_THEMES.has(track.theme);
  const grassSprite = dark ? 'grassDark' : 'grass';
  const bushSprite = dark ? 'bushDark' : 'bush';
  for (let n = 10; n < segs.length - 4; n += rng.int(1, 3)) {
    const side = rng.chance(0.5) ? -1 : 1;
    const isBush = rng.chance(0.22);
    const sprite = isBush ? bushSprite : grassSprite;
    add(n, {
      kind: 'prop', sprite, x: side * rng.range(1.08, 1.9),
      w: SPR[sprite].worldW, solid: false, hp: 0, dead: false,
    });
  }

  // ---- streetlights ----------------------------------------------------
  // Only after dark, where they are the difference between a road and a
  // black rectangle.  Alternating sides, evenly spaced, arms over the road.
  if (NIGHT_THEMES.has(track.theme)) {
    let side = 1;
    for (let n = 20; n < segs.length - 4; n += 26) {
      add(n, {
        // The pole stands on the shoulder and the arm reaches IN over the
        // road, so the sprite whose arm points left goes on the right verge.
        kind: 'prop', sprite: side > 0 ? 'streetlightR' : 'streetlight',
        x: side * 1.42, w: SPR.streetlight.worldW,
        solid: false, hp: 0, dead: false, yWorld: 0,
      });
      side = -side;
    }
  }

  // Cones and barriers hugging the tarmac -- these you can actually hit.
  for (let n = 40; n < finish - 30; n += rng.int(14, 40)) {
    const side = rng.chance(0.5) ? -1 : 1;
    const count = rng.int(2, 5);
    for (let k = 0; k < count; k++) {
      add(n + k * 3, {
        kind: 'prop', sprite: 'cone', x: side * rng.range(1.02, 1.16),
        w: SPR.cone.worldW, solid: true, soft: true, hp: 0, dead: false,
      });
    }
  }

  // ---- fuel globes -----------------------------------------------------
  // Spacing tightens the further into the rally you are, because the drain
  // rate rises too; running the tank dry is the only way to lose.
  let globes = 0;
  const globeGap = Math.round(100 - t * 22);
  for (let n = 70; n < finish - 24; n += globeGap + rng.int(-14, 14)) {
    const lane = rng.range(-0.72, 0.72);
    add(n, {
      kind: 'globe', sprite: 'globe', x: lane, w: SPR.globe[0].worldW,
      solid: false, hp: 0, dead: false, phase: rng.next(),
    });
    globes++;
  }

  // ---- mines and turrets ----------------------------------------------
  if (stage >= 4) {
    const mineCount = Math.round(2 + t * 30);
    for (let i = 0; i < mineCount; i++) {
      const n = rng.int(90, Math.max(95, finish - 20));
      add(n, {
        kind: 'mine', sprite: 'mine', x: rng.range(-0.85, 0.85), w: SPR.mine.worldW,
        solid: true, hp: 1, dead: false, score: SCORE.mine,
      });
    }
  }
  if (stage >= 6) {
    const turretCount = Math.round(1 + t * 13);
    for (let i = 0; i < turretCount; i++) {
      const n = rng.int(110, Math.max(120, finish - 30));
      const side = rng.chance(0.5) ? -1 : 1;
      const tur = makeTurret(side * rng.range(1.18, 1.55), 0);
      tur.kind = 'turret';
      add(n, tur);
    }
  }

  // ---- overhead sign gantries -----------------------------------------
  // Rare, and always on a straight-ish stretch, so the first thing you see
  // through one is the road rather than the gantry's own legs.
  for (let n = 90; n < finish - 60; n += rng.int(150, 320)) {
    add(n, {
      kind: 'prop', sprite: 'gantry', x: 0, w: SPR.gantry.worldW,
      solid: false, hp: 0, dead: false, yWorld: 0,
    });
  }

  // ---- finish line -----------------------------------------------------
  add(finish, {
    kind: 'banner', sprite: 'banner', x: 0, w: SPR.banner.worldW,
    solid: false, hp: 0, dead: false,
  });

  // ---- enemy spawn schedule -------------------------------------------
  // `density` divides the gap, so a higher value means cars arrive closer
  // together.  Tuned so stage 1 keeps 3-5 cars on screen and stage 50 keeps
  // the road more or less permanently occupied.
  const spawns = [];
  const density = 0.62 + t * 1.20;
  const firstEnemy = 50;
  let n = firstEnemy;
  while (n < finish - 20) {
    n += Math.max(4, Math.round(rng.range(9, 22) / density));
    if (n >= finish - 20) break;

    // The mix shifts from mostly civilian traffic and slow chasers toward
    // ramming coupes, cycles and mine-laying command trucks.
    const roll = rng.next();
    let type;
    if (roll < 0.16 - t * 0.08) type = 'civic';
    else if (roll < 0.26 - t * 0.08) type = 'oncoming';
    else if (roll < 0.62 - t * 0.16) type = 'sedan';
    else if (roll < 0.82 - t * 0.04) type = 'coupe';
    else if (roll < 0.93) type = 'cycle';
    else type = 'command';

    // Cars in the opposite direction belong on the far side of the road.
    const x = type === 'oncoming' ? rng.range(-0.85, -0.30) : rng.range(-0.80, 0.80);
    spawns.push({ z: n * SEG_LENGTH, type, x, used: false });

    // Packs: later stages send cars in twos and threes.
    if (stage > 6 && rng.chance(0.16 + t * 0.34)) {
      const nz = n + rng.int(4, 10);
      if (nz < finish - 20) {
        spawns.push({
          z: nz * SEG_LENGTH, type,
          x: Math.max(-0.9, Math.min(0.9, x + rng.range(-0.6, 0.6))), used: false,
        });
      }
    }
  }
  spawns.sort((a, b) => a.z - b.z);

  return { spawns, globes };
}
