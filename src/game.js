/*
 * The simulation.
 *
 * Called with a fixed timestep (config.STEP) so that physics, fuel drain and
 * collision sweeps are identical regardless of display refresh rate.  Nothing
 * in here touches the canvas -- rendering reads this state, it never writes
 * to it.
 *
 * Road Blasters' central idea, kept intact: there are no lives.  Fuel is the
 * timer, the health bar and the score bonus all at once.  Everything you do
 * either spends it or earns it back.
 */

import * as K from './config.js';
import { buildTrack } from './road.js';
import {
  Pool, newBullet, newParticle, newFloater,
  ENEMY_TYPES, makeEnemy, populateTrack,
} from './entities.js';
import { SPR } from './sprites.js';
import { clamp, lerp, sign, overlap, makeRNG, storage, approach } from './util.js';

export const STATE = {
  ATTRACT: 'attract',
  READY: 'ready',
  PLAY: 'play',
  STAGE_END: 'stageEnd',
  GAME_OVER: 'gameOver',
};

/** How far ahead of the van a scheduled enemy is brought to life. */
const SPAWN_AHEAD = K.DRAW_DISTANCE * K.SEG_LENGTH * 0.8;
/** How far behind before a car is recycled. */
const DESPAWN_BEHIND = K.SEG_LENGTH * 22;
/** Player rounds vanish past this range so they cannot hit off-screen cars. */
const BULLET_RANGE = K.SEG_LENGTH * 110;
/**
 * Effective width of a round, in road half-widths.  Wider than the drawn
 * tracer on purpose: the cabinet's gun was forgiving, and a game where you
 * miss a car you are visibly pointed at reads as broken rather than hard.
 */
const BULLET_HIT_W = 0.11;

export class Game {
  /** @param {import('./audio.js').AudioEngine} audio */
  constructor(audio) {
    this.audio = audio;
    this.bullets = new Pool(220, newBullet);
    this.particles = new Pool(360, newParticle);
    this.floaters = new Pool(24, newFloater);
    this.enemies = [];
    this.highScore = Math.max(0, storage.get(K.HIGHSCORE_KEY, 0) | 0);

    this.state = STATE.ATTRACT;
    this.paused = false;
    this.shake = 0;
    this.flash = 0;
    this.time = 0;
    this._audioAccum = 0;
    this._boomCooldown = 0;

    this.newGame();
    this.state = STATE.ATTRACT;
    this.attractTimer = 0;
  }

  // ------------------------------------------------------------ life cycle

  /** Reset absolutely everything for a fresh credit. */
  newGame() {
    this.score = 0;
    this.stage = 1;
    this.fuel = K.FUEL_START;
    this.weapon = K.WEAPONS.base;
    this.ammo = Infinity;
    this.missiles = K.CRUISE_MISSILE.startCount;
    this.nitroCharges = 0;
    this.stats = { kills: 0, globes: 0, crashes: 0, distance: 0 };
    this.loadStage(1);
    this.state = STATE.READY;
    this.readyTimer = 2.6;
  }

  /** Build stage `n` and put the van on the start line. */
  loadStage(n) {
    this.stage = n;
    this.track = buildTrack(n);
    const rng = makeRNG(0x51ed ^ (n * 40503));
    const { spawns } = populateTrack(this.track, n, rng);
    this.spawns = spawns;
    this.spawnCursor = 0;
    this.rng = rng;

    this.position = K.PLAYER_Z;   // world z of the van
    this.playerX = 0;
    this.speed = 0;
    this.steerVisual = 0;

    this.crashTimer = 0;
    this.spin = 0;
    this.spinVel = 0;
    this.invulnTimer = 0;
    this.shieldTimer = 0;
    this.nitroTimer = 0;
    this.fireCooldown = 0;
    this.offRoad = false;
    this.braking = false;
    this.rumble = 0;

    this.enemies.length = 0;
    this.bullets.clear();
    this.particles.clear();
    this.floaters.clear();

    // Rescue Cruiser flyover schedule, expressed in stage fractions.
    this.rescue = {
      active: false, timer: 0, x: 0, y: 0, dir: 1, dropped: false,
      nextAt: K.RESCUE.firstAt,
    };

    this.stageStartFuel = this.fuel;
    this.lowFuelBeep = 0;
    this.finished = false;
  }

  /** Progress through the current stage, 0..1. */
  get progress() {
    const span = this.track.finishZ - K.PLAYER_Z;
    if (span <= 0) return 1;
    return clamp((this.position - K.PLAYER_Z) / span, 0, 1);
  }

  get mph() { return Math.round(this.speed * K.MPH_PER_UNIT); }
  get maxSpeedNow() {
    return K.MAX_SPEED * (this.nitroTimer > 0 ? K.NITRO.boost : 1);
  }
  get cameraZ() { return this.position - K.PLAYER_Z; }
  get theme() { return this.track.theme; }

  // ---------------------------------------------------------------- update

  /**
   * Advance one fixed step.
   * @param {number} dt seconds (always K.STEP)
   * @param {import('./input.js').Input} input
   */
  update(dt, input) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 5.5);
    this.flash = Math.max(0, this.flash - dt * 4.2);
    this._boomCooldown = Math.max(0, this._boomCooldown - dt);

    switch (this.state) {
      case STATE.ATTRACT: this._updateAttract(dt); break;
      case STATE.READY: this._updateReady(dt, input); break;
      case STATE.PLAY: this._updatePlay(dt, input); break;
      case STATE.STAGE_END: this._updateStageEnd(dt); break;
      case STATE.GAME_OVER: this._updateGameOver(dt); break;
      default: break;
    }

    // Effects keep running in every state so explosions finish naturally.
    this._updateParticles(dt);
    this._updateFloaters(dt);
  }

  _updateAttract(dt) {
    this.attractTimer += dt;
    // Idle demo: the road scrolls itself so the title screen has motion.
    this.speed = lerp(this.speed, K.MAX_SPEED * 0.42, dt * 0.6);
    this.position += this.speed * dt;
    this.playerX = Math.sin(this.time * 0.7) * 0.45;
    const seg = this.track.segmentAt(this.position);
    this.playerX -= dt * 1.4 * seg.curve * K.CENTRIFUGAL * 0.6;
    this.playerX = clamp(this.playerX, -0.9, 0.9);
    this._spawnScheduled();
    this._updateEnemies(dt, true);
    if (this.position > this.track.finishZ - K.SEG_LENGTH * 10) this.loadStage(this.stage);
  }

  _updateReady(dt, input) {
    this.readyTimer -= dt;
    this._audioAccum += dt;
    if (this._audioAccum >= 1 / 30) {
      this._audioAccum = 0;
      // Blipping the throttle on the line is allowed, and correct.
      this.audio.setEngine(0.12 + input.throttle * 0.5, input.throttle, true);
    }
    if (this.readyTimer <= 0) {
      this.state = STATE.PLAY;
      this.audio.startMusic(THEME_ROOT[this.theme] || 55, THEME_SCALE[this.theme] || [0, 3, 5, 7, 10]);
    }
  }

  _updateStageEnd(dt) {
    this.stageEndTimer -= dt;
    this.speed = Math.max(0, this.speed - K.MAX_SPEED * 0.45 * dt);
    this.position += this.speed * dt;
    this._audioAccum += dt;
    if (this._audioAccum >= 1 / 30) {
      this._audioAccum = 0;
      this.audio.setEngine(0.1 + (this.speed / K.MAX_SPEED) * 0.5, 0.1, this.speed > 20);
    }
    // Pay out the remaining fuel as points, a bit at a time.
    if (this.bonusFuel > 0) {
      const step = Math.min(this.bonusFuel, 46 * dt);
      this.bonusFuel -= step;
      this.addScore(step * K.SCORE.perFuelUnit);
      if (Math.random() < 0.34) this.audio.uiBlip(true);
    } else if (this.stageEndTimer <= 0) {
      if (this.stage >= K.TOTAL_STAGES) {
        this.state = STATE.GAME_OVER;
        this.gameOverTimer = 6;
        this.completedRally = true;
        this.audio.stopMusic();
        this.audio.fanfare();
        this._commitHighScore();
      } else {
        this.fuel = clamp(this.fuel + K.FUEL_STAGE_BONUS, 0, K.FUEL_MAX);
        this.loadStage(this.stage + 1);
        this.state = STATE.READY;
        this.readyTimer = 2.4;
        this.audio.slidingDoor();
      }
    }
  }

  _updateGameOver(dt) {
    this.gameOverTimer -= dt;
    this.speed = Math.max(0, this.speed - K.MAX_SPEED * 0.7 * dt);
    this.position += this.speed * dt;
    this.audio.setEngine(0.05, 0, this.speed > 10);
    if (this.gameOverTimer <= 0) {
      this.state = STATE.ATTRACT;
      this.attractTimer = 0;
      this.loadStage(1);
      this.stage = 1;
    }
  }

  // ------------------------------------------------------------- main play

  _updatePlay(dt, input) {
    const seg = this.track.segmentAt(this.position);
    const wrecked = this.crashTimer > 0;

    // ---- longitudinal ---------------------------------------------------
    const maxV = this.maxSpeedNow;
    if (wrecked) {
      this.crashTimer -= dt;
      this.speed += K.COAST_DECEL * 1.6 * dt;
      this.spin += this.spinVel * dt;
      this.spinVel = approach(this.spinVel, 0, 9, dt);
      if (this.crashTimer <= 0) { this.spin = 0; this.spinVel = 0; }
    } else {
      if (input.throttle > 0.01) this.speed += K.ACCEL * input.throttle * dt;
      else this.speed += K.COAST_DECEL * dt;
      if (input.brake > 0.01) this.speed += K.BRAKING * input.brake * dt;
    }
    this.braking = input.brake > 0.05 && !wrecked;
    // Over the current ceiling (e.g. nitro just expired): bleed off rather
    // than snapping down, which would feel like hitting a wall.
    if (this.speed > maxV) this.speed = Math.max(maxV, this.speed + K.COAST_DECEL * dt);
    this.speed = clamp(this.speed, 0, Math.max(maxV, this.speed));

    // ---- lateral --------------------------------------------------------
    const speedPct = this.speed / K.MAX_SPEED;
    const dx = dt * K.STEER_RATE * speedPct;
    if (!wrecked) {
      this.playerX += input.steer * dx;
      this.steerVisual = approach(this.steerVisual, input.steer, 6, dt);
    } else {
      // No steering while spinning; you just get to watch.
      this.playerX += this.spinVel * 0.06 * dt;
      this.steerVisual = approach(this.steerVisual, 0, 3, dt);
    }
    // Centrifugal force scales with the square of speed, so lifting works.
    this.playerX -= dx * speedPct * seg.curve * K.CENTRIFUGAL;
    this.playerX = clamp(this.playerX, -K.MAX_OFF_ROAD_X, K.MAX_OFF_ROAD_X);

    // ---- surface --------------------------------------------------------
    const edge = seg.width;
    this.offRoad = Math.abs(this.playerX) > edge;
    if (this.offRoad) {
      // Dirt scrubs speed hard, but only down to a crawl -- it drags you
      // toward the limit rather than teleporting you to it.
      if (this.speed > K.OFF_ROAD_LIMIT) {
        this.speed = Math.max(K.OFF_ROAD_LIMIT, this.speed + K.OFF_ROAD_DECEL * dt);
      }
      this.rumble = Math.min(1, this.rumble + dt * 6);
      this.shake = Math.max(this.shake, 0.25 * speedPct);
      // Falling off a narrow bridge is a wreck, not a scenic detour.
      if (seg.width < 0.8 && Math.abs(this.playerX) > edge + 0.10) {
        this.crash(1.0);
      }
    } else {
      this.rumble = Math.max(0, this.rumble - dt * 5);
    }
    this.speed = Math.max(0, this.speed);

    // ---- advance --------------------------------------------------------
    const prevZ = this.position;
    this.position += this.speed * dt;
    this.stats.distance += (this.position - prevZ) / K.SEG_LENGTH;
    this.addScore(((this.position - prevZ) / K.SEG_LENGTH) * K.SCORE.distance);

    // ---- fuel -----------------------------------------------------------
    const drainScale = 1 + ((this.stage - 1) / 49) * 0.4;
    this.fuel -= (K.FUEL_IDLE_DRAIN + K.FUEL_SPEED_DRAIN * speedPct) * drainScale * dt;
    if (this.fuel <= 0) {
      this.fuel = 0;
      this._endGame();
      return;
    }
    if (this.fuel < 20) {
      this.lowFuelBeep -= dt;
      if (this.lowFuelBeep <= 0) {
        this.lowFuelBeep = this.fuel < 10 ? 0.42 : 0.85;
        this.audio.lowFuel();
      }
    }

    // ---- timers ---------------------------------------------------------
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    this.shieldTimer = Math.max(0, this.shieldTimer - dt);
    this.nitroTimer = Math.max(0, this.nitroTimer - dt);
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);

    // ---- weapons --------------------------------------------------------
    if (!wrecked) {
      if (input.fire) this._tryFire();
      if (input.consume('special')) this._fireMissile();
      if (input.consume('nitro')) this._useNitro();
    }

    // ---- world ----------------------------------------------------------
    this._spawnScheduled();
    this._updateEnemies(dt, false);
    this._updateBullets(dt);
    this._updateRescue(dt);
    this._collidePlayer(prevZ);
    // A wreck can end the run mid-step; stop before scoring a stage clear.
    if (this.state !== STATE.PLAY) return;

    // ---- engine audio ---------------------------------------------------
    // Fake five-speed gearbox: the note climbs and drops rather than sliding
    // from idle to redline in one long whine.
    const gearSpan = 1 / 5;
    const gear = Math.min(4, Math.floor(speedPct / gearSpan));
    const rpm = clamp((speedPct - gear * gearSpan) / gearSpan, 0, 1);
    // Audio params are automated at ~30Hz: at the 120Hz sim rate we would be
    // queueing four times as many ramp events as anyone can hear.
    this._audioAccum += dt;
    if (this._audioAccum >= 1 / 30) {
      this._audioAccum = 0;
      this.audio.setEngine(
        0.18 + rpm * 0.82 + (this.offRoad ? 0.1 : 0),
        input.throttle * 0.8 + (this.nitroTimer > 0 ? 0.2 : 0),
        true,
      );
      this.audio.tickMusic(clamp(speedPct, 0, 1));
    }

    // ---- finish ---------------------------------------------------------
    if (this.position >= this.track.finishZ && !this.finished) {
      this._completeStage();
    }
  }

  // ---------------------------------------------------------------- scoring

  addScore(n) {
    this.score += n;
    if (this.score > this.highScore) this.highScore = Math.floor(this.score);
  }

  _commitHighScore() {
    this.highScore = Math.max(this.highScore, Math.floor(this.score));
    storage.set(K.HIGHSCORE_KEY, Math.floor(this.highScore));
  }

  _completeStage() {
    this.finished = true;
    this.state = STATE.STAGE_END;
    this.stageEndTimer = 2.6;
    this.bonusFuel = this.fuel;
    this.addScore(K.SCORE.stageClear);
    this.audio.stopMusic();
    this.audio.fanfare();
    this._commitHighScore();
  }

  _endGame() {
    this.state = STATE.GAME_OVER;
    this.gameOverTimer = 6.5;
    this.completedRally = false;
    this.audio.stopMusic();
    this.audio.gameOver();
    this.audio.stopEngine();
    this._commitHighScore();
    this.explode(this.playerX, this.position, 1.4);
    this.shake = 1;
  }

  // ---------------------------------------------------------------- weapons

  _tryFire() {
    if (this.fireCooldown > 0) return;
    const w = this.weapon;
    if (this.ammo <= 0) { this._setWeapon(K.WEAPONS.base); return; }
    this.fireCooldown = w.cooldown;
    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const off = pellets === 1 ? 0 : (i - (pellets - 1) / 2) * w.spread;
      const b = this.bullets.acquire();
      b.x = this.playerX + off;
      b.z = this.position + K.SEG_LENGTH * 1.6;
      b.y = 120;
      b.vx = off * 1.4;
      b.vz = w.speed;
      b.life = K.BULLET_LIFE;
      b.damage = w.damage;
      b.hostile = false;
      b.size = w.id === 'base' ? 1 : 1.2;
    }
    if (this.ammo !== Infinity) {
      this.ammo -= 1;
      if (this.ammo <= 0) { this._setWeapon(K.WEAPONS.base); this.audio.uiBlip(false); }
    }
    this.audio.shoot(w.id === 'uz' ? 1.25 : 1);
  }

  _setWeapon(w) {
    this.weapon = w;
    this.ammo = w.ammo;
    this.fireCooldown = Math.min(this.fireCooldown, w.cooldown);
  }

  _fireMissile() {
    if (this.missiles <= 0) { this.audio.uiBlip(false); return; }
    this.missiles -= 1;
    this.audio.bigShot();
    this.flash = 1;
    this.shake = Math.max(this.shake, 0.7);

    const from = this.position;
    const to = this.position + K.CRUISE_MISSILE.range;
    let killed = 0;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.z >= from && e.z <= to && e.def && e.def.hostile) {
        this._killEnemy(i, true);
        killed++;
      }
    }
    // Mines and turrets in the blast radius go too.
    this._forEachObjectInRange(from, to, (obj) => {
      if (obj.dead) return;
      if (obj.kind === 'mine' || obj.kind === 'turret') {
        obj.dead = true;
        this.explode(obj.x, obj.z, obj.kind === 'turret' ? 1.1 : 0.7);
        this.addScore(obj.score || K.SCORE.mine);
        killed++;
      }
    });

    // Visible shockwave running up the road.
    for (let i = 0; i < 26; i++) {
      const p = this.particles.acquire();
      const f = i / 26;
      p.x = lerp(this.playerX, this.playerX + (Math.random() - 0.5) * 1.4, f);
      p.z = lerp(from + 400, to, f);
      p.y = 60 + Math.random() * 400;
      p.vx = (Math.random() - 0.5) * 0.6;
      p.vy = 200 + Math.random() * 400;
      p.vz = 2000;
      p.life = p.maxLife = 0.45 + Math.random() * 0.4;
      p.size = 2 + Math.random() * 3;
      p.gravity = 0.4;
      p.color = Math.random() < 0.5 ? '#ffdd55' : '#ff5522';
    }
    if (killed > 0) this.floater(this.playerX, this.position + 900, `x${killed}`, '#ffdd55');
  }

  _useNitro() {
    if (this.nitroCharges <= 0) { this.audio.uiBlip(false); return; }
    this.nitroCharges -= 1;
    this.nitroTimer = K.NITRO.duration;
    this.audio.nitro();
    this.shake = Math.max(this.shake, 0.4);
    this.floater(this.playerX, this.position + 700, 'NITRO', '#ffaa33');
  }

  // ---------------------------------------------------------------- enemies

  _spawnScheduled() {
    const limit = this.position + SPAWN_AHEAD;
    while (this.spawnCursor < this.spawns.length && this.spawns[this.spawnCursor].z <= limit) {
      const s = this.spawns[this.spawnCursor++];
      if (s.used) continue;
      s.used = true;
      this.enemies.push(makeEnemy(s.type, s.x, s.z));
    }
  }

  _updateEnemies(dt, attract) {
    const behind = this.position - DESPAWN_BEHIND;
    const ahead = this.position + SPAWN_AHEAD * 1.35;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const def = e.def;

      e.z += def.speed * K.MAX_SPEED * dt;
      e.hitFlash = Math.max(0, e.hitFlash - dt * 6);
      e.phase += dt;

      // Only manoeuvre while the player can actually see them; cars far up
      // the road driving perfect lines looks wrong and costs CPU.
      const near = e.z - this.position < K.SEG_LENGTH * 90;

      switch (def.ai) {
        case 'chase':
          if (near) e.x = approach(e.x, clamp(this.playerX, -0.9, 0.9), def.lateral, dt);
          break;
        case 'ram': {
          if (near) {
            const gap = Math.abs(e.z - this.position) / (K.SEG_LENGTH * 40);
            const urgency = clamp(1.4 - gap, 0.2, 1.4);
            e.x = approach(e.x, clamp(this.playerX, -0.95, 0.95), def.lateral * urgency, dt);
          }
          break;
        }
        case 'weave':
          e.x = clamp(e.x + Math.sin(e.phase * 2.6) * def.lateral * dt * 2.4, -0.95, 0.95);
          break;
        case 'miner':
          if (near) {
            e.fireTimer -= dt;
            if (e.fireTimer <= 0) {
              e.fireTimer = def.mineInterval;
              this._dropMine(e.x, e.z - K.SEG_LENGTH * 1.5);
            }
          }
          break;
        default:
          break;
      }

      if (e.z < behind || e.z > ahead) {
        this.enemies.splice(i, 1);
      }
    }

    if (!attract) this._updateTurrets(dt);
  }

  _updateTurrets(dt) {
    this._forEachObjectInRange(
      this.position + K.SEG_LENGTH * 2,
      this.position + K.SEG_LENGTH * 62,
      (obj) => {
        if (obj.kind !== 'turret' || obj.dead) return;
        obj.fireTimer -= dt;
        if (obj.fireTimer <= 0) {
          obj.fireTimer = 1.5 + Math.random() * 1.4;
          const b = this.bullets.acquire();
          // Aim where the van is now, with a little lead -- dodgeable, but
          // only if you are actually moving.
          b.x = this.playerX + (this.playerX - obj.x) * 0.06;
          b.z = obj.z;
          b.y = 180;
          b.vx = 0;
          b.vz = -K.ENEMY_BULLET_SPEED;
          b.life = 2.2;
          b.damage = 1;
          b.hostile = true;
          b.size = 1.4;
          this.audio.shoot(0.6);
        }
      },
    );
  }

  _dropMine(x, z) {
    const seg = this.track.segmentAt(z);
    seg.objects.push({
      kind: 'mine', sprite: 'mine', x, z, w: SPR.mine.worldW,
      solid: true, hp: 1, dead: false, score: K.SCORE.mine, seg: seg.index, dropped: true,
    });
  }

  /** Destroy enemy at index `i`, awarding score and spawning debris. */
  _killEnemy(i, silentScore = false) {
    const e = this.enemies[i];
    this.enemies.splice(i, 1);
    this.explode(e.x, e.z, e.def.w * 2.4);
    this.addScore(e.def.score);
    this.stats.kills++;
    if (!silentScore) this.floater(e.x, e.z, `${e.def.score}`, '#ffdd55');
  }

  // ---------------------------------------------------------------- bullets

  _updateBullets(dt) {
    this.bullets.forEach((b) => {
      b.z += b.vz * dt;
      b.x += b.vx * dt;
      b.life -= dt;

      if (b.life <= 0
        || b.z > this.position + BULLET_RANGE
        || b.z < this.position - K.SEG_LENGTH * 4) {
        this.bullets.release(b);
        return;
      }

      if (b.hostile) {
        // Hostile rounds are checked against the player in _collidePlayer.
        return;
      }

      // Player round vs cars.
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (Math.abs(e.z - b.z) > K.SEG_LENGTH * 1.4) continue;
        if (!overlap(b.x, BULLET_HIT_W, e.x, e.def.w, 1)) continue;
        e.hp -= b.damage;
        e.hitFlash = 1;
        this.bullets.release(b);
        this.spark(b.x, b.z);
        if (e.hp <= 0) this._killEnemy(i);
        return;
      }

      // Player round vs mines and turrets.
      let consumed = false;
      this._forEachObjectInRange(b.z - K.SEG_LENGTH * 2, b.z + K.SEG_LENGTH * 2, (obj) => {
        if (consumed || obj.dead) return;
        if (obj.kind !== 'mine' && obj.kind !== 'turret') return;
        if (Math.abs(obj.z - b.z) > K.SEG_LENGTH * 1.2) return;
        if (!overlap(b.x, BULLET_HIT_W, obj.x, obj.w, 1)) return;
        obj.hp -= b.damage;
        consumed = true;
        this.bullets.release(b);
        this.spark(b.x, b.z);
        if (obj.hp <= 0) {
          obj.dead = true;
          this.explode(obj.x, obj.z, obj.kind === 'turret' ? 1.1 : 0.7);
          const s = obj.score || K.SCORE.mine;
          this.addScore(s);
          this.floater(obj.x, obj.z, `${s}`, '#ffdd55');
          this.stats.kills++;
        }
      });
    });
  }

  // ------------------------------------------------------------- collisions

  /**
   * All player collisions, using swept z intervals so nothing is tunnelled
   * through at 250 mph.
   * @param {number} prevZ position at the start of this step
   */
  _collidePlayer(prevZ) {
    const zLo = prevZ - K.VAN_LENGTH / 2;
    const zHi = this.position + K.VAN_LENGTH / 2;

    // ---- static objects, pickups and hazards ---------------------------
    this._forEachObjectInRange(zLo - K.SEG_LENGTH * 2, zHi + K.SEG_LENGTH * 2, (obj) => {
      if (obj.dead) return;
      const half = K.SEG_LENGTH * 0.55;
      if (obj.z + half < zLo || obj.z - half > zHi) return;
      // Pickups get a generous grab box and hazards a tight one: missing a
      // fuel globe you drove over is infuriating, whereas clipping a rock you
      // only just touched is the game working.
      const box = obj.kind === 'globe' || obj.kind === 'pod' ? 1.25 : 0.78;
      if (!overlap(this.playerX, K.VAN_WIDTH, obj.x, obj.w, box)) return;

      switch (obj.kind) {
        case 'globe':
          obj.dead = true;
          this.fuel = clamp(this.fuel + K.FUEL_GLOBE, 0, K.FUEL_MAX);
          this.addScore(K.SCORE.globe);
          this.stats.globes++;
          this.audio.pickup();
          this.floater(obj.x, obj.z, `+${K.FUEL_GLOBE} FUEL`, '#66ddff');
          break;
        case 'pod':
          obj.dead = true;
          this._grantPod(obj.podKind);
          this.addScore(K.SCORE.pod);
          this.audio.weaponPod();
          break;
        case 'mine':
          obj.dead = true;
          this.explode(obj.x, obj.z, 0.8);
          this.crash(1);
          break;
        case 'turret':
          obj.dead = true;
          this.explode(obj.x, obj.z, 1.0);
          this.crash(1);
          break;
        case 'prop':
          if (!obj.solid) return;
          if (obj.soft) {
            // Cones: annoying, not fatal.
            obj.dead = true;
            this.speed *= 0.94;
            this.audio.scrape();
            this.shake = Math.max(this.shake, 0.2);
          } else {
            this.crash(1);
          }
          break;
        default:
          break;
      }
    });

    // ---- cars ----------------------------------------------------------
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const half = K.VAN_LENGTH * 0.55;
      if (e.z + half < zLo || e.z - half > zHi) continue;
      if (!overlap(this.playerX, K.VAN_WIDTH, e.x, e.def.w, 0.72)) continue;

      if (this.shieldTimer > 0) {
        this._killEnemy(i);
        this.audio.explosion(0.6);
        continue;
      }
      const mode = e.def.contact;
      if (mode === 'flatten') {
        // A minivan versus a motorcycle is not a close contest.
        this._killEnemy(i);
        this.sideswipe(sign(this.playerX - e.x) || 1, 0.5);
      } else if (mode === 'swipe') {
        this.sideswipe(sign(this.playerX - e.x) || 1, 1);
        e.x = clamp(e.x - sign(this.playerX - e.x) * 0.22, -1, 1);
      } else {
        this._killEnemy(i, true);
        this.crash(1);
      }
      break;
    }

    // ---- incoming fire --------------------------------------------------
    this.bullets.forEach((b) => {
      if (!b.hostile) return;
      const half = K.VAN_LENGTH * 0.5;
      if (b.z + half < zLo || b.z - half > zHi) return;
      if (!overlap(this.playerX, K.VAN_WIDTH, b.x, 0.06, 0.9)) return;
      this.bullets.release(b);
      if (this.shieldTimer > 0 || this.invulnTimer > 0) {
        this.spark(b.x, b.z);
        return;
      }
      this.fuel = Math.max(0, this.fuel - K.FUEL_SHOT);
      this.invulnTimer = 0.55;
      this.shake = Math.max(this.shake, 0.5);
      this.spark(b.x, b.z);
      this.audio.explosion(0.4);
      this.floater(this.playerX, this.position + 500, `-${K.FUEL_SHOT} FUEL`, '#ff5533');
    });
  }

  /** Walk static objects on every segment overlapping [zFrom, zTo]. */
  _forEachObjectInRange(zFrom, zTo, fn) {
    const segs = this.track.segments;
    const a = clamp(Math.floor(zFrom / K.SEG_LENGTH), 0, segs.length - 1);
    const b = clamp(Math.floor(zTo / K.SEG_LENGTH), 0, segs.length - 1);
    for (let i = a; i <= b; i++) {
      const list = segs[i].objects;
      for (let k = 0; k < list.length; k++) fn(list[k]);
    }
  }

  // ---------------------------------------------------------------- damage

  /** A full wreck: spin out, lose most of your speed and a chunk of fuel. */
  crash(severity = 1) {
    if (this.invulnTimer > 0 || this.shieldTimer > 0 || this.crashTimer > 0) return;
    this.crashTimer = K.CRASH_SPIN_TIME;
    this.invulnTimer = K.CRASH_SPIN_TIME + K.INVULN_AFTER_CRASH;
    this.spinVel = (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 4);
    this.speed *= K.CRASH_SPEED_KEEP;
    this.fuel = Math.max(0, this.fuel - K.FUEL_CRASH * severity);
    this.stats.crashes++;
    this.shake = 1;
    this.flash = 0.6;
    this.audio.crash();
    this.explode(this.playerX, this.position + 200, 1.0);
    this.floater(this.playerX, this.position + 600, `-${Math.round(K.FUEL_CRASH * severity)} FUEL`, '#ff5533');
    if (this.fuel <= 0) this._endGame();
  }

  /** A glancing blow: shoved sideways, some speed and fuel gone. */
  sideswipe(dir, severity = 1) {
    if (this.shieldTimer > 0) return;
    this.playerX = clamp(this.playerX + dir * K.SIDESWIPE_KICK * 0.22 * severity,
      -K.MAX_OFF_ROAD_X, K.MAX_OFF_ROAD_X);
    this.speed *= 1 - 0.14 * severity;
    if (this.invulnTimer <= 0) {
      this.fuel = Math.max(0, this.fuel - K.FUEL_SIDESWIPE * severity);
      this.invulnTimer = 0.5;
    }
    this.shake = Math.max(this.shake, 0.45 * severity);
    this.audio.scrape();
    if (this.fuel <= 0) this._endGame();
  }

  // ------------------------------------------------------- rescue cruiser

  /**
   * The X-1 Rescue Cruiser: flies over, drops a weapon pod on the road ahead.
   * It is the only friend you have out here and it does not stop.
   */
  _updateRescue(dt) {
    const r = this.rescue;
    if (!r.active) {
      if (this.progress >= r.nextAt && this.progress < 0.94) {
        r.active = true;
        r.timer = K.RESCUE.approachTime;
        r.dropped = false;
        r.dir = Math.random() < 0.5 ? -1 : 1;
        r.x = -r.dir * 2.6;
        r.y = 1;
        r.nextAt = this.progress + K.RESCUE.interval;
      }
      return;
    }

    r.timer -= dt;
    const t = 1 - clamp(r.timer / K.RESCUE.approachTime, 0, 1);
    r.x = lerp(-r.dir * 2.6, r.dir * 2.6, t);
    r.y = 1 - Math.sin(t * Math.PI) * 0.35;

    if (!r.dropped && t >= 0.5) {
      r.dropped = true;
      this._dropPod();
    }
    if (r.timer <= 0) r.active = false;
  }

  _dropPod() {
    const kind = this._choosePodKind();
    const z = this.position + K.RESCUE.dropAhead;
    const seg = this.track.segmentAt(z);
    seg.objects.push({
      kind: 'pod', podKind: kind, sprite: POD_SPRITE[kind], x: this.rng.range(-0.7, 0.7),
      z, w: SPR.podUz.worldW, solid: false, hp: 0, dead: false, seg: seg.index,
    });
    this.audio.uiBlip(true);
  }

  /** Give the player what they are most short of. */
  _choosePodKind() {
    const noAmmo = this.weapon.id === 'base';
    const roll = this.rng.next();
    if (noAmmo && roll < 0.55) return roll < 0.34 ? 'uz' : 'spread';
    if (this.missiles < 2 && roll < 0.72) return 'missile';
    if (this.nitroCharges < 2 && roll < 0.86) return 'nitro';
    if (roll < 0.94) return 'shield';
    return roll < 0.97 ? 'uz' : 'spread';
  }

  _grantPod(kind) {
    switch (kind) {
      case 'uz':
        this._setWeapon(K.WEAPONS.uz);
        this.floater(this.playerX, this.position + 700, 'UZ CANNON', '#ffee55');
        break;
      case 'spread':
        this._setWeapon(K.WEAPONS.spread);
        this.floater(this.playerX, this.position + 700, 'DOOR SPREADER', '#ffee55');
        break;
      case 'missile':
        this.missiles = Math.min(K.CRUISE_MISSILE.maxCount,
          this.missiles + K.CRUISE_MISSILE.podCount);
        this.floater(this.playerX, this.position + 700, 'CRUISE MISSILES', '#ff6644');
        break;
      case 'nitro':
        this.nitroCharges = Math.min(K.NITRO.maxCharges, this.nitroCharges + K.NITRO.podCharges);
        this.floater(this.playerX, this.position + 700, 'NITRO', '#ffaa33');
        break;
      case 'shield':
        this.shieldTimer = K.SHIELD.duration;
        this.audio.shield();
        this.floater(this.playerX, this.position + 700, 'ELECTRO SHIELD', '#66ddff');
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- effects

  explode(x, z, size = 1) {
    const n = Math.round(10 + size * 12);
    for (let i = 0; i < n; i++) {
      const p = this.particles.acquire();
      p.x = x + (Math.random() - 0.5) * 0.2 * size;
      p.z = z + (Math.random() - 0.5) * 300;
      p.y = 60 + Math.random() * 200 * size;
      p.vx = (Math.random() - 0.5) * 1.5 * size;
      p.vy = 260 + Math.random() * 900 * size;
      p.vz = (Math.random() - 0.35) * 3200;
      p.life = p.maxLife = 0.36 + Math.random() * 0.55;
      p.size = 1.5 + Math.random() * 3.5 * size;
      p.gravity = 1;
      const roll = Math.random();
      p.color = roll < 0.4 ? '#ffee88' : roll < 0.75 ? '#ff8822' : '#883311';
    }
    // One missile can kill a dozen cars in a frame; play one boom, not twelve.
    if (this._boomCooldown <= 0) {
      this._boomCooldown = 0.06;
      this.audio.explosion(clamp(size, 0.5, 1.6));
    }
    this.shake = Math.max(this.shake, clamp(size * 0.4, 0.1, 0.9));
  }

  spark(x, z) {
    for (let i = 0; i < 5; i++) {
      const p = this.particles.acquire();
      p.x = x + (Math.random() - 0.5) * 0.08;
      p.z = z;
      p.y = 120 + Math.random() * 80;
      p.vx = (Math.random() - 0.5) * 0.7;
      p.vy = 120 + Math.random() * 260;
      p.vz = (Math.random() - 0.5) * 1200;
      p.life = p.maxLife = 0.14 + Math.random() * 0.14;
      p.size = 1 + Math.random();
      p.gravity = 1;
      p.color = Math.random() < 0.5 ? '#ffffff' : '#ffdd66';
    }
  }

  floater(x, z, text, color) {
    const f = this.floaters.acquire();
    f.x = x; f.z = z; f.y = 260;
    f.text = text; f.color = color;
    f.life = f.maxLife = 1.1;
  }

  _updateParticles(dt) {
    this.particles.forEach((p) => {
      p.life -= dt;
      if (p.life <= 0) { this.particles.release(p); return; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= 1500 * p.gravity * dt;
      if (p.y < 0) { p.y = 0; p.vy *= -0.35; p.vx *= 0.7; p.vz *= 0.7; }
      // Behind the camera is out of play.
      if (p.z < this.cameraZ) this.particles.release(p);
    });
  }

  _updateFloaters(dt) {
    this.floaters.forEach((f) => {
      f.life -= dt;
      f.y += 260 * dt;
      if (f.life <= 0 || f.z < this.cameraZ) this.floaters.release(f);
    });
  }

  // ------------------------------------------------------------------ input

  /** Start button pressed. */
  startPressed() {
    if (this.state === STATE.ATTRACT) {
      this.newGame();
      this.audio.slidingDoor();
      return true;
    }
    if (this.state === STATE.GAME_OVER && this.gameOverTimer < 5.2) {
      this.newGame();
      this.audio.slidingDoor();
      return true;
    }
    return false;
  }
}

const POD_SPRITE = {
  uz: 'podUz', spread: 'podSpread', missile: 'podMissile',
  nitro: 'podNitro', shield: 'podShield',
};

/** Per-theme music: same engine, different mood. */
const THEME_ROOT = { day: 55, dusk: 49, night: 41, fog: 46, rust: 52, snow: 58 };
const THEME_SCALE = {
  day: [0, 3, 5, 7, 10], dusk: [0, 2, 5, 7, 9], night: [0, 1, 5, 7, 8],
  fog: [0, 2, 3, 7, 9], rust: [0, 3, 6, 7, 10], snow: [0, 4, 5, 7, 11],
};
