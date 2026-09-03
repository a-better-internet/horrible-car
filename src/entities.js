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

const SCENERY = [
  { sprite: 'tree', solid: true }, { sprite: 'treeDark', solid: true },
  { sprite: 'rock', solid: true }, { sprite: 'sign', solid: true },
  { sprite: 'billboard', solid: false }, { sprite: 'pylon', solid: false },
];

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
  const t = Math.min(1, (stage - 1) / 49);

  const add = (segIndex, obj) => {
    const s = segs[Math.max(0, Math.min(segs.length - 1, segIndex))];
    obj.seg = s.index;
    obj.z = s.index * SEG_LENGTH + SEG_LENGTH / 2;
    s.objects.push(obj);
  };

  // ---- roadside scenery ------------------------------------------------
  // Denser near the start so the sense of speed reads immediately.
  for (let n = 12; n < segs.length - 4; n += rng.int(2, 6)) {
    const side = rng.chance(0.5) ? -1 : 1;
    const pick = rng.pick(SCENERY);
    const dist = rng.range(1.30, 2.70);
    add(n, {
      kind: 'prop', sprite: pick.sprite, x: side * dist,
      w: SPR[pick.sprite] ? SPR[pick.sprite].worldW : 0.4,
      solid: pick.solid && dist < 2.05, hp: 0, dead: false,
    });
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
  const globeGap = Math.round(104 - t * 26);
  for (let n = 70; n < finish - 24; n += globeGap + rng.int(-14, 14)) {
    const lane = rng.range(-0.72, 0.72);
    add(n, {
      kind: 'globe', sprite: 'globe', x: lane, w: SPR.globe[0].worldW,
      solid: false, hp: 0, dead: false, phase: rng.next(),
    });
    globes++;
  }

  // ---- mines and turrets ----------------------------------------------
  if (stage >= 3) {
    const mineCount = Math.round(4 + t * 22);
    for (let i = 0; i < mineCount; i++) {
      const n = rng.int(90, Math.max(95, finish - 20));
      add(n, {
        kind: 'mine', sprite: 'mine', x: rng.range(-0.85, 0.85), w: SPR.mine.worldW,
        solid: true, hp: 1, dead: false, score: SCORE.mine,
      });
    }
  }
  if (stage >= 4) {
    const turretCount = Math.round(1 + t * 9);
    for (let i = 0; i < turretCount; i++) {
      const n = rng.int(110, Math.max(120, finish - 30));
      const side = rng.chance(0.5) ? -1 : 1;
      const tur = makeTurret(side * rng.range(1.18, 1.55), 0);
      tur.kind = 'turret';
      add(n, tur);
    }
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
  const density = 0.80 + t * 0.90;
  const firstEnemy = 50;
  let n = firstEnemy;
  while (n < finish - 20) {
    n += Math.max(4, Math.round(rng.range(9, 22) / density));
    if (n >= finish - 20) break;

    const roll = rng.next();
    let type;
    if (roll < 0.10 + t * 0.05) type = 'civic';
    else if (roll < 0.20 + t * 0.05) type = 'oncoming';
    else if (roll < 0.55) type = 'sedan';
    else if (roll < 0.78 + t * 0.05) type = 'coupe';
    else if (roll < 0.92) type = 'cycle';
    else type = 'command';

    // Cars in the opposite direction belong on the far side of the road.
    const x = type === 'oncoming' ? rng.range(-0.85, -0.30) : rng.range(-0.80, 0.80);
    spawns.push({ z: n * SEG_LENGTH, type, x, used: false });

    // Packs: later stages send cars in twos and threes.
    if (stage > 8 && rng.chance(0.24 + t * 0.2)) {
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
