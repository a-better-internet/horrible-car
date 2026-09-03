/*
 * Renderer.
 *
 * Draw order matters and is deliberate:
 *   1. sky + horizon (parallax with curvature and hills)
 *   2. road, drawn NEAR to FAR while tracking `maxy`, so a crest occludes
 *      whatever lies behind it instead of painting over the foreground
 *   3. sprites, drawn FAR to NEAR so nearer objects overlap further ones,
 *      each clipped against its segment's recorded `clip` line
 *   4. the van, then screen effects, then the HUD
 *
 * Nothing here mutates game state.
 */

import * as K from './config.js';
import { project } from './road.js';
import { THEMES, UI, mix, cssa } from './palette.js';
import { SPR } from './sprites.js';
import { clamp, lerp, exponentialFog } from './util.js';
import { STATE } from './game.js';
import { textCenteredShadow } from './font.js';

const W = K.SCREEN_W;
const H = K.SCREEN_H;

/** Sprite size, per road unit of width, at the segment's projection scale. */
const HALF_W = W / 2;
/** Bullet and particle sizes are in road units so they scale like everything else. */
const BULLET_WORLD_W = 70;
const PARTICLE_WORLD_W = 34;

/*
 * Sprite near plane.
 *
 * The projection scale is 1/z, so an object level with the camera projects to
 * an effectively infinite size.  Anything nearer than half the camera-to-van
 * distance is beside or behind the van and must not be drawn: without this, a
 * roadside billboard you have just passed expands to fill the entire screen
 * with a wall of colour.
 */
const SPRITE_NEAR_Z = K.PLAYER_Z * 0.85;
/** Belt-and-braces size cap for the pathological cases the near plane misses. */
const SPRITE_MAX_W = W * 3;

export class Renderer {
  /** @param {CanvasRenderingContext2D} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.skyOffset = 0;
  }

  /**
   * @param {import('./game.js').Game} g
   * @param {number} dt seconds since the last rendered frame (for parallax)
   */
  render(g, dt) {
    const ctx = this.ctx;
    const theme = THEMES[g.theme] || THEMES.day;

    ctx.save();

    // Screen shake, applied as a whole-picture offset in integer pixels so
    // the image never lands between the pixel grid.
    let sx = 0, sy = 0;
    if (g.shake > 0.01) {
      const amp = g.shake * 4;
      sx = Math.round((Math.random() - 0.5) * amp);
      sy = Math.round((Math.random() - 0.5) * amp);
      ctx.translate(sx, sy);
    }

    const base = g.track.segmentAt(g.cameraZ);
    const basePercent = percentRemaining(g.cameraZ, K.SEG_LENGTH);
    const playerSeg = g.track.segmentAt(g.position);
    const playerPercent = percentRemaining(g.position, K.SEG_LENGTH);
    const playerY = lerp(playerSeg.p1.world.y, playerSeg.p2.world.y, playerPercent);

    const cameraX = g.playerX * K.ROAD_WIDTH;
    const cameraY = playerY + K.CAMERA_HEIGHT;
    const cameraZ = g.cameraZ;

    // Parallax: the skyline slides against the curvature you are turning into.
    this.skyOffset += base.curve * (g.speed / K.MAX_SPEED) * dt * 34;

    this._drawSky(theme, g);

    // ---- road ------------------------------------------------------------
    const segs = g.track.segments;
    let maxy = H;
    let horizonY = H;
    let x = 0;
    let dx = -(base.curve * basePercent);
    const last = segs.length - 1;
    let drawn = 0;

    for (let n = 0; n < K.DRAW_DISTANCE; n++) {
      const idx = base.index + n;
      if (idx > last) break;
      const seg = segs[idx];
      seg.clip = maxy;
      seg.fog = exponentialFog(n / K.DRAW_DISTANCE, theme.fogDensity);
      seg.dyn.length = 0;

      project(seg.p1, cameraX - x, cameraY, cameraZ, K.CAMERA_DEPTH, W, H,
        K.ROAD_WIDTH * seg.width);
      project(seg.p2, cameraX - x - dx, cameraY, cameraZ, K.CAMERA_DEPTH, W, H,
        K.ROAD_WIDTH * seg.width);

      x += dx;
      dx += seg.curve;
      drawn = n;

      // Sprites still draw on a segment whose tarmac is skipped -- the clip
      // line above already hides anything genuinely behind a crest, and
      // gating sprites on the road fill would pop cars in and out on hills.
      seg.visible = seg.p1.camera.z > K.CAMERA_DEPTH && seg.p1.screen.w > 0;
      if (!seg.visible) continue;

      // Back-facing, or already hidden by a nearer crest: no tarmac, but the
      // segment stays available to the sprite pass.
      if (seg.p2.screen.y >= seg.p1.screen.y) continue;
      if (seg.p2.screen.y >= maxy) continue;

      this._drawSegment(theme, seg);
      maxy = seg.p2.screen.y;
      horizonY = maxy;
    }

    // Skyline sits on whatever the road turned out to be the horizon.
    this._drawHills(theme, horizonY);

    // ---- bucket everything dynamic into its segment ----------------------
    this._bucket(g, base.index, base.index + drawn);

    // ---- sprites, far to near -------------------------------------------
    for (let n = drawn; n >= 0; n--) {
      const idx = base.index + n;
      if (idx > last) continue;
      const seg = segs[idx];
      if (!seg.visible) continue;

      const objs = seg.objects;
      for (let i = 0; i < objs.length; i++) {
        const o = objs[i];
        if (o.dead) continue;
        this._drawWorldSprite(g, seg, spriteFor(g, o), o.x, o.yWorld || 0, seg.fog);
      }
      const dyn = seg.dyn;
      if (dyn.length > 1) dyn.sort(byDepthDesc);
      for (let i = 0; i < dyn.length; i++) this._drawDynamic(g, seg, dyn[i]);
    }

    // ---- the van ---------------------------------------------------------
    if (g.state !== STATE.GAME_OVER || g.gameOverTimer > 5.4) {
      this._drawPlayer(g, playerSeg, theme);
    }

    // ---- the Rescue Cruiser ---------------------------------------------
    if (g.rescue.active) this._drawRescue(g);

    ctx.restore();

    // ---- full-screen effects --------------------------------------------
    if (theme.dark > 0) {
      // Night and dusk: darken everything, then punch a headlight cone back in.
      ctx.fillStyle = cssa(0, 0, 0, 2, theme.dark);
      ctx.fillRect(0, 0, W, H);
      this._drawHeadlights(theme);
    }
    if (g.flash > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${clamp(g.flash * 0.5, 0, 0.6)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (g.shieldTimer > 0) {
      const a = 0.10 + Math.sin(g.time * 22) * 0.05;
      ctx.fillStyle = `rgba(90,190,255,${clamp(a, 0, 0.2)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ------------------------------------------------------------------ sky

  /**
   * Sky.
   *
   * Painted over the WHOLE screen, deliberately.  The road pass then paints
   * grass and tarmac downward from the furthest visible segment, so the
   * boundary between sky and world is wherever the road actually ends.  An
   * independently guessed horizon line (from camera height, say) disagrees
   * with the projected road on hills and leaves a slab of ground colour
   * hanging in mid-air.
   */
  _drawSky(theme, g) {
    const ctx = this.ctx;

    // Banded rather than smooth: a true gradient is a colour resolution the
    // hardware never had.
    const bands = 8;
    const bandH = Math.ceil(H / bands) + 1;
    for (let i = 0; i < bands; i++) {
      ctx.fillStyle = mix(theme.sky, theme.skyLow, i / (bands - 1));
      ctx.fillRect(0, Math.round((H * i) / bands), W, bandH);
    }

    // Stars go in before the road, so the road occludes the ones that should
    // be below the horizon.
    if (theme.dark > 0.3) {
      ctx.fillStyle = UI.white;
      const twinkle = Math.floor(g.time * 2);
      for (let i = 0; i < 46; i++) {
        const sxx = (i * 8237) % W;
        const syy = (i * 3391) % Math.round(H * 0.55);
        if ((i + twinkle) % 11 !== 0) ctx.fillRect(sxx, syy, 1, 1);
      }
    }
  }

  /**
   * Distant scenery, sitting on the real horizon.
   *
   * Drawn after the road because only then do we know where the horizon is:
   * `horizonY` is the top edge of the furthest tarmac we managed to draw.
   * Everything above it is untouched sky, which is exactly the band these
   * belong in.
   */
  _drawHills(theme, horizonY) {
    const ctx = this.ctx;
    const y = clamp(horizonY, 0, H);
    if (y <= 0) return;
    const off = ((this.skyOffset % 340) + 340) % 340;
    ctx.fillStyle = mix(theme.haze, theme.ground[1], 0.42);
    for (let k = -1; k <= 1; k++) {
      const bx = Math.round(-off + k * 340);
      for (let i = 0; i < 11; i++) {
        const hx = bx + i * 31;
        if (hx > W || hx + 30 < 0) continue;
        const hh = 9 + ((i * 7919) % 19);
        ctx.fillRect(hx, y - hh, 28, hh + 1);
        ctx.fillRect(hx + 6, y - hh - 5, 15, 6);
      }
    }
    // A haze band right on the horizon so the skyline does not sit on the
    // road like a sticker.
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = theme.haze;
    ctx.fillRect(0, y - 3, W, 4);
    ctx.globalAlpha = 1;
  }

  // ----------------------------------------------------------------- road

  _drawSegment(theme, seg) {
    const ctx = this.ctx;
    const p1 = seg.p1.screen;
    const p2 = seg.p2.screen;
    const alt = seg.alt ? 0 : 1;

    const grass = theme.ground[alt];
    const road = theme.road[alt];
    const rumble = theme.rumble[alt];

    // Grass band for this slice of the screen.
    ctx.fillStyle = grass;
    ctx.fillRect(0, p2.y, W, p1.y - p2.y);

    // A narrow bridge has no shoulder: black void either side.
    if (seg.width < 0.8) {
      ctx.fillStyle = '#000';
      const pad1 = Math.round(p1.w * 1.9);
      const pad2 = Math.round(p2.w * 1.9);
      polygon(ctx, p1.x - pad1, p1.y, p1.x + pad1, p1.y, p2.x + pad2, p2.y, p2.x - pad2, p2.y);
    }

    // Rumble strips.
    const r1 = p1.w / 5;
    const r2 = p2.w / 5;
    ctx.fillStyle = rumble;
    polygon(ctx, p1.x - p1.w - r1, p1.y, p1.x - p1.w, p1.y, p2.x - p2.w, p2.y,
      p2.x - p2.w - r2, p2.y);
    polygon(ctx, p1.x + p1.w + r1, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y,
      p2.x + p2.w + r2, p2.y);

    // Tarmac.
    ctx.fillStyle = road;
    polygon(ctx, p1.x - p1.w, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x - p2.w, p2.y);

    // Lane markings on the light band only, so they read as dashes.
    if (!seg.alt && p1.w > 2) {
      const lanes = K.LANES;
      const lw1 = (p1.w * 2) / lanes;
      const lw2 = (p2.w * 2) / lanes;
      const t1 = Math.max(1, (p1.w * 2) / 110);
      const t2 = Math.max(1, (p2.w * 2) / 110);
      ctx.fillStyle = theme.lane;
      let lx1 = p1.x - p1.w + lw1;
      let lx2 = p2.x - p2.w + lw2;
      for (let l = 1; l < lanes; l++) {
        polygon(ctx, lx1 - t1, p1.y, lx1 + t1, p1.y, lx2 + t2, p2.y, lx2 - t2, p2.y);
        lx1 += lw1;
        lx2 += lw2;
      }
    }

    // Distance fog: one flat wash over the slice we just drew.
    if (seg.fog < 0.98) {
      ctx.globalAlpha = clamp(1 - seg.fog, 0, 1);
      ctx.fillStyle = theme.haze;
      ctx.fillRect(0, p2.y, W, p1.y - p2.y);
      ctx.globalAlpha = 1;
    }
  }

  // -------------------------------------------------------------- bucketing

  /**
   * Sort every moving thing into the segment it currently occupies, so the
   * far-to-near sprite pass gets correct depth ordering and hill clipping
   * for free.
   */
  _bucket(g, fromIdx, toIdx) {
    const segs = g.track.segments;
    const put = (item, z) => {
      const i = Math.floor(z / K.SEG_LENGTH);
      if (i < fromIdx || i > toIdx || i < 0 || i >= segs.length) return;
      segs[i].dyn.push(item);
    };

    for (let i = 0; i < g.enemies.length; i++) {
      const e = g.enemies[i];
      e._render = 'enemy';
      e._z = e.z;
      put(e, e.z);
    }
    g.bullets.forEach((b) => { b._render = 'bullet'; b._z = b.z; put(b, b.z); });
    g.particles.forEach((p) => { p._render = 'particle'; p._z = p.z; put(p, p.z); });
    g.floaters.forEach((f) => { f._render = 'floater'; f._z = f.z; put(f, f.z); });
  }

  // --------------------------------------------------------------- sprites

  /**
   * Blit a baked sprite standing on the road at `seg`, offset `xNorm` road
   * half-widths from the centreline and `yWorld` road units off the deck.
   */
  _drawWorldSprite(g, seg, spr, xNorm, yWorld, fog, tint = null, alpha = 1) {
    if (!spr) return;
    const p = seg.p1.screen;
    if (p.scale <= 0 || p.w <= 0) return;
    if (seg.p1.camera.z < SPRITE_NEAR_Z) return;

    // Sprites use the *full* road width, not the segment's narrowed width,
    // so a car does not shrink when it drives onto a bridge.  Derived from
    // the projection scale rather than the rounded p.w, which loses
    // precision at distance.
    const fullW = p.scale * K.ROAD_WIDTH * HALF_W;
    const destW = Math.max(1, Math.round(spr.worldW * fullW));
    const destH = Math.max(1, Math.round(destW * spr.aspect));
    if (destW > SPRITE_MAX_W) return;

    const destX = Math.round(p.x + fullW * xNorm - destW / 2);
    const yShift = Math.round(p.scale * yWorld * H * 0.5);
    const destY = Math.round(p.y - destH - yShift);

    if (destX > W || destX + destW < 0) return;

    // Clip against the crest line recorded for this segment.
    const clipY = seg.clip;
    const bottom = destY + destH;
    const clipH = clipY > 0 ? Math.max(0, bottom - clipY) : 0;
    if (clipH >= destH) return;

    const ctx = this.ctx;
    const srcH = Math.max(1, Math.round(spr.h * (1 - clipH / destH)));
    const drawH = destH - clipH;

    // Distance fade is done with alpha, not by washing a haze rectangle over
    // the sprite: the sprite's bounding box is mostly transparent, so a wash
    // would paint a visible square halo around every distant tree.  The road
    // behind is already fogged, so fading toward it gives the same result
    // with no box.
    const a = alpha * clamp(fog * 1.12, 0.12, 1);
    if (a < 1) ctx.globalAlpha = a;
    ctx.drawImage(spr.canvas, 0, 0, spr.w, srcH, destX, destY, destW, drawH);

    // Hit flash: re-draw the sprite additively so only its own pixels light
    // up.  A filled rectangle would flash the empty corners too.
    if (tint) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.75;
      ctx.drawImage(spr.canvas, 0, 0, spr.w, srcH, destX, destY, destW, drawH);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  _drawDynamic(g, seg, item) {
    switch (item._render) {
      case 'enemy': {
        const spr = SPR[item.def.oncoming ? item.def.spriteFront : item.def.sprite];
        this._drawWorldSprite(g, seg, spr, item.x, 0, seg.fog,
          item.hitFlash > 0.3 ? UI.white : null);
        break;
      }
      case 'bullet': this._drawBullet(seg, item); break;
      case 'particle': this._drawParticle(seg, item); break;
      case 'floater': this._drawFloater(seg, item); break;
      default: break;
    }
  }

  _drawBullet(seg, b) {
    const p = seg.p1.screen;
    if (seg.p1.camera.z < SPRITE_NEAR_Z * 0.5) return;
    if (p.scale <= 0) return;
    const fullW = p.scale * K.ROAD_WIDTH * HALF_W;
    const size = clamp(Math.round(p.scale * BULLET_WORLD_W * b.size * HALF_W), 1, 24);
    const x = Math.round(p.x + fullW * b.x);
    const y = Math.round(p.y - p.scale * b.y * H * 0.5);
    const ctx = this.ctx;
    if (y > seg.clip) return;
    ctx.fillStyle = b.hostile ? UI.red : UI.yellow;
    ctx.fillRect(x - (size >> 1), y - size, Math.max(1, size), Math.max(2, size * 2));
    ctx.fillStyle = UI.white;
    ctx.fillRect(x - 1, y - size, 2, Math.max(1, size));
  }

  _drawParticle(seg, p0) {
    const p = seg.p1.screen;
    if (seg.p1.camera.z < SPRITE_NEAR_Z * 0.5) return;
    if (p.scale <= 0) return;
    const fullW = p.scale * K.ROAD_WIDTH * HALF_W;
    const s = clamp(Math.round(p.scale * PARTICLE_WORLD_W * p0.size * HALF_W), 1, 40);
    const x = Math.round(p.x + fullW * p0.x);
    const y = Math.round(p.y - p.scale * p0.y * H * 0.5);
    if (y > seg.clip) return;
    const ctx = this.ctx;
    ctx.globalAlpha = clamp(p0.life / p0.maxLife, 0, 1);
    ctx.fillStyle = p0.color;
    ctx.fillRect(x - (s >> 1), y - (s >> 1), s, s);
    ctx.globalAlpha = 1;
  }

  _drawFloater(seg, f) {
    const p = seg.p1.screen;
    if (seg.p1.camera.z < SPRITE_NEAR_Z * 0.5) return;
    if (p.scale <= 0 || p.w < 6) return;
    const fullW = p.scale * K.ROAD_WIDTH * HALF_W;
    const x = Math.round(p.x + fullW * f.x);
    const y = Math.round(p.y - p.scale * f.y * H * 0.5);
    if (y > seg.clip || y < -10) return;
    const ctx = this.ctx;
    ctx.globalAlpha = clamp(f.life / f.maxLife, 0, 1);
    textCenteredShadow(ctx, f.text, x, y, f.color, 1);
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- player

  _drawPlayer(g, seg, theme) {
    const ctx = this.ctx;
    const bounce = g.speed > 0
      ? Math.sin(g.time * 26) * 1.2 * (g.speed / K.MAX_SPEED) * (g.offRoad ? 2.6 : 0.6)
      : 0;
    const frame = clamp(Math.round(g.steerVisual * 2) + 2, 0, 4);
    const spr = SPR.van[frame];

    // The van is drawn at a fixed size at a fixed place: it is the camera's
    // anchor, not a world object.
    // Sized and placed so the van's wheels sit just above the HUD panel:
    // any lower and the shadow disappears behind it and the van looks like
    // it is floating.
    const destW = Math.round(W * 0.285);
    const destH = Math.round(destW * spr.aspect);
    let destX = Math.round(W / 2 - destW / 2);
    const destY = Math.round(H - 28 - destH + bounce);

    // Curve lean: the van visually drifts against the corner.
    const curveLean = Math.round(-seg.curve * 1.6 - g.steerVisual * 3);
    destX += curveLean;

    // Ground shadow, drawn flat and unrotated: a shadow that spins with a
    // wrecking van reads as a black wedge stuck to the bodywork.
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(destX + 4, destY + destH - 3, destW - 8, 4);

    // Blink while invulnerable, but never blink out entirely.
    if (g.invulnTimer > 0 && Math.floor(g.time * 18) % 2 === 0 && g.crashTimer <= 0) {
      ctx.globalAlpha = 0.45;
    }

    if (g.crashTimer > 0) {
      // Spinning out: rotate about the van's centre.
      ctx.save();
      ctx.translate(destX + destW / 2, destY + destH / 2);
      ctx.rotate(g.spin);
      ctx.drawImage(spr.canvas, -destW / 2, -destH / 2, destW, destH);
      ctx.restore();
    } else {
      ctx.drawImage(spr.canvas, destX, destY, destW, destH);
    }
    ctx.globalAlpha = 1;

    // Electro Shield bubble.
    if (g.shieldTimer > 0) {
      const pulse = 2 + Math.sin(g.time * 16) * 1.5;
      ctx.strokeStyle = g.shieldTimer < 2 && Math.floor(g.time * 10) % 2 === 0
        ? UI.white : UI.cyan;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        Math.round(destX - pulse), Math.round(destY - pulse),
        Math.round(destW + pulse * 2), Math.round(destH + pulse * 2),
      );
    }

    // Nitro flame out the back.
    if (g.nitroTimer > 0) {
      const fl = 4 + Math.random() * 7;
      ctx.fillStyle = Math.random() < 0.5 ? UI.yellow : UI.red;
      ctx.fillRect(destX + destW * 0.30, destY + destH - 2, destW * 0.14, fl);
      ctx.fillRect(destX + destW * 0.56, destY + destH - 2, destW * 0.14, fl);
    }

    // Dust plume when you put two wheels on the shoulder.  Kicked up around
    // the wheels only -- spraying it over the whole sprite just repaints the
    // van in grass colour.
    if (g.offRoad && g.speed > 200) {
      ctx.fillStyle = mix(theme.ground[0], UI.white, 0.35);
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 10; i++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const px = destX + destW / 2 + side * (destW * 0.34 + Math.random() * destW * 0.30);
        const py = destY + destH - Math.random() * 12;
        const s = 1 + Math.random() * 3;
        ctx.fillRect(px | 0, py | 0, s, s);
      }
      ctx.globalAlpha = 1;
    }
  }

  _drawRescue(g) {
    const ctx = this.ctx;
    const spr = SPR.plane;
    const r = g.rescue;
    const scale = 0.62;
    const destW = Math.round(W * 0.22 * scale + 34);
    const destH = Math.round(destW * spr.aspect);
    const destX = Math.round(W / 2 + r.x * (W * 0.38) - destW / 2);
    const destY = Math.round(H * 0.10 + r.y * 26);
    ctx.drawImage(spr.canvas, destX, destY, destW, destH);
  }

  _drawHeadlights(theme) {
    // Two cones of light on the road ahead.  Cheap, but it sells the dark.
    const ctx = this.ctx;
    const cx = W / 2;
    const top = H * 0.46;
    const grad = ctx.createLinearGradient(0, H, 0, top);
    grad.addColorStop(0, `rgba(255,246,200,${0.20 + theme.dark * 0.30})`);
    grad.addColorStop(1, 'rgba(255,246,200,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx - 26, H);
    ctx.lineTo(cx + 26, H);
    ctx.lineTo(cx + 34, top);
    ctx.lineTo(cx - 34, top);
    ctx.closePath();
    ctx.fill();
  }
}

// ------------------------------------------------------------------ helpers

function polygon(ctx, x1, y1, x2, y2, x3, y3, x4, y4) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

const percentRemaining = (n, total) => ((n % total) + total) % total / total;

const byDepthDesc = (a, b) => b._z - a._z;

/** Resolve the sprite for a static object, including animated globes. */
function spriteFor(g, o) {
  if (o.kind === 'globe') {
    const f = Math.floor((g.time * 8 + (o.phase || 0) * 4) % SPR.globe.length);
    return SPR.globe[f];
  }
  return SPR[o.sprite];
}

