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
import { project, DECO } from './road.js';
import { THEMES, UI, mix, cssa, withAlpha } from './palette.js';
import { SPR } from './sprites.js';
import { skylineFor, TILE_W, TILE_H } from './skyline.js';
import { clamp, lerp, exponentialFog } from './util.js';
import { STATE } from './game.js';
import { textCenteredShadow } from './font.js';

const W = K.SCREEN_W;
const H = K.SCREEN_H;
/** Hardcoded pixel sizes below are in original-raster units; R scales them. */
const R = K.RES;

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

/*
 * Headlight geometry, in ROAD space.
 *
 * Exported so the invariants below can be tested rather than merely intended.
 *
 * Widths are in road half-widths (1.0 = the painted edge).  A headlight is a
 * small lamp, so the beam must START narrower than the van -- an early
 * version had the near width above a full van width, which put the origin at
 * nearly three van widths across and made the light read as a glow leaking
 * out from under the car:
 *
 *     2 * BEAM_NEAR_W  <  VAN_WIDTH
 *
 * It then opens out with distance the way a cone does.  BEAM_SPREAD is the
 * extra half-width added over the full range, so at the far end the beam is
 * BEAM_NEAR_W + BEAM_SPREAD across -- wider than the road, which is correct:
 * that far out a real low beam washes the shoulders too.
 */
export const HEADLIGHT_RANGE = 58;    // segments of throw
export const BEAM_NEAR_W = 0.17;
export const BEAM_SPREAD = 1.15;
/** Belt-and-braces size cap for the pathological cases the near plane misses. */
const SPRITE_MAX_W = W * 3;

export class Renderer {
  /** @param {CanvasRenderingContext2D} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.skyOffset = 0;
    /**
     * Lamps to light up after the night wash.  The wash is painted over the
     * world *after* the sprite pass, so anything that is supposed to glow has
     * to be deferred past it -- otherwise we would be dimming the lights.
     * Reused between frames rather than reallocated.
     */
    this.lamps = [];
    this.lampCount = 0;
    this.night = 0;
    this.vanishX = K.SCREEN_W / 2;
    this.vanishY = K.SCREEN_H / 2;
  }

  /**
   * @param {import('./game.js').Game} g
   * @param {number} dt seconds since the last rendered frame (for parallax)
   */
  render(g, dt) {
    const ctx = this.ctx;
    const theme = THEMES[g.theme] || THEMES.day;
    this.night = theme.dark;
    this.lampCount = 0;

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
      // Where the road disappears.  The headlights aim at this, so they
      // follow the tarmac round a bend instead of pointing off into a field.
      this.vanishX = seg.p2.screen.x;
      this.vanishY = maxy;
    }

    // Skyline sits on whatever the road turned out to be the horizon.
    this._drawHills(g.theme, theme, horizonY);

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

    // ---- the Rescue Cruiser ---------------------------------------------
    // Before the night wash, because it is up in the sky with everything else.
    if (g.rescue.active) this._drawRescue(g);

    // ---- nightfall -------------------------------------------------------
    // Applied to the world but NOT to the van or its beams: the headlights
    // have to brighten an already-dark scene, so anything additive must come
    // after this.  Overdrawn past the edges so screen shake cannot expose an
    // unwashed border.
    if (theme.dark > 0) {
      // A very dark blue rather than flat black: night on a highway is
      // moonlit, and a pure-black wash just greys everything out.
      ctx.fillStyle = cssa(2, 0, 0, 4, theme.dark);
      ctx.fillRect(-32, -32, W + 64, H + 64);
      // Headlights before the lamps, so a car caught in the beam is lit by it
      // and still shows its own tail-lights on top.
      if (theme.dark > 0.08) this._drawHeadlightWash(g, theme, base.index, drawn);
      this._flushLamps();
    }

    // ---- the van, and the light it throws -------------------------------
    if (g.state !== STATE.GAME_OVER || g.gameOverTimer > 5.4) {
      this._drawPlayer(g, playerSeg, theme);
    }

    ctx.restore();

    // ---- full-screen effects --------------------------------------------
    if (g.flash > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${clamp(g.flash * 0.5, 0, 0.6)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (g.shieldTimer > 0) {
      const a = 0.10 + Math.sin(g.time * 22) * 0.05;
      ctx.fillStyle = `rgba(90,190,255,${clamp(a, 0, 0.2)})`;
      ctx.fillRect(0, 0, W, H);
    }

    this._drawSpeedStreaks(g);
    this._drawVignette();
  }

  /**
   * Motion streaks at high speed: short strokes flying outward from the
   * vanishing point.  Only above ~70% of top speed, so they read as an event
   * rather than as permanent screen dirt.
   */
  _drawSpeedStreaks(g) {
    const pct = g.speed / K.MAX_SPEED;
    if (pct < 0.70) return;
    const ctx = this.ctx;
    const intensity = (pct - 0.70) / 0.30;
    const vx = this.vanishX;
    const vy = this.vanishY;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(255,255,255,${(0.05 + intensity * 0.13).toFixed(3)})`;
    ctx.lineWidth = R;
    ctx.beginPath();
    for (let i = 0; i < 14; i++) {
      // Deterministic angles, animated outward, so they do not shimmer.
      const ang = (i / 14) * Math.PI * 2 + i * 0.7;
      const phase = ((g.time * (2 + intensity * 3) + i * 0.37) % 1);
      const r0 = 0.25 + phase * 0.85;
      const r1 = r0 + 0.10 + intensity * 0.12;
      const scale = Math.max(W, H);
      ctx.moveTo(vx + Math.cos(ang) * r0 * scale, vy + Math.sin(ang) * r0 * scale * 0.7);
      ctx.lineTo(vx + Math.cos(ang) * r1 * scale, vy + Math.sin(ang) * r1 * scale * 0.7);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Corner darkening, baked once.  A radial gradient rebuilt every frame over
   * the whole buffer is a surprisingly large cost for something that never
   * changes.
   */
  _drawVignette() {
    if (!this._vignette) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const vc = c.getContext('2d');
      const grad = vc.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34,
        W / 2, H / 2, Math.max(W, H) * 0.78);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.34)');
      vc.fillStyle = grad;
      vc.fillRect(0, 0, W, H);
      this._vignette = c;
    }
    this.ctx.drawImage(this._vignette, 0, 0);
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

    // Sun or moon, with a soft halo.  Drawn before the clouds so they can
    // pass in front of it.
    if (theme.orb) {
      const ox = Math.round(W * theme.orb.x);
      const oy = Math.round(H * theme.orb.y);
      const rad = theme.orb.r * R;
      // The halo must fade to TRANSPARENT, not to the sky colour: the sky is
      // banded, so a gradient ending on one flat colour paints a visible
      // square wherever the band underneath differs.
      const halo = ctx.createRadialGradient(ox, oy, rad * 0.7, ox, oy, rad * 4.6);
      halo.addColorStop(0, withAlpha(theme.orb.halo, 0.75));
      halo.addColorStop(0.35, withAlpha(theme.orb.halo, 0.30));
      halo.addColorStop(1, withAlpha(theme.orb.halo, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(ox, oy, rad * 4.6, 0, Math.PI * 2);
      ctx.fill();
      // Chunky disc from horizontal spans, to stay in keeping with the rest.
      ctx.fillStyle = theme.orb.core;
      for (let y = -rad; y <= rad; y++) {
        const hw = Math.round(Math.sqrt(Math.max(0, rad * rad - y * y)));
        ctx.fillRect(ox - hw, oy + y, hw * 2, 1);
      }
      // A bite out of the moon.
      if (theme.dark > 0.4) {
        ctx.fillStyle = theme.sky;
        for (let y = -rad; y <= rad; y++) {
          const hw = Math.round(Math.sqrt(Math.max(0, rad * rad - y * y)));
          ctx.fillRect(ox - hw + rad * 0.75, oy + y - rad * 0.25, hw * 2, 1);
        }
      }
    }

    // Clouds.
    //
    // Stacked, tapering spans rather than plain rectangles: a cloud drawn as
    // one filled box reads as a brick floating in the sky, which at dusk is
    // extremely obvious.  Each is a few rows that narrow toward the top, with
    // a lit crown and a shaded base, at low alpha so they sit in the sky
    // rather than on top of it.
    if (theme.clouds > 0) {
      const span = W * 2;
      const drift = ((this.skyOffset * 0.16) % span + span) % span;
      const body = mix(theme.sky, theme.skyLow, 0.60);
      const crown = mix(theme.sky, UI.white, theme.dark > 0.3 ? 0.05 : 0.34);
      for (let i = 0; i < theme.clouds; i++) {
        const seed = i * 9176 + 311;
        const cw = (46 + (seed % 64)) * R;
        const rows = 4 + (seed % 3);
        const rowH = 3 * R;
        // Keep clear of the HUD strip and stay above the horizon.
        const cy = Math.round(H * 0.09 + ((seed >> 4) % 20) * R);
        let cx = ((seed % span) - drift) % span;
        if (cx < -cw) cx += span;

        for (let rIdx = 0; rIdx < rows; rIdx++) {
          const t = rIdx / (rows - 1);          // 0 at the base, 1 at the crown
          const w2 = cw * (1 - t * 0.62);
          const off = (cw - w2) * (0.35 + ((seed >> (rIdx + 2)) % 5) / 12);
          ctx.globalAlpha = 0.20 + (1 - t) * 0.16;
          ctx.fillStyle = rIdx >= rows - 2 ? crown : body;
          ctx.fillRect(Math.round(cx + off), Math.round(cy - rIdx * rowH),
            Math.round(w2), rowH + 1);
        }
        ctx.globalAlpha = 1;
      }
    }

    // Stars go in before the road, so the road occludes the ones that should
    // be below the horizon.
    if (theme.dark > 0.3) {
      ctx.fillStyle = UI.white;
      const twinkle = Math.floor(g.time * 2);
      for (let i = 0; i < 46 * R; i++) {
        const sxx = (i * 8237) % W;
        const syy = (i * 3391) % Math.round(H * 0.55);
        if ((i + twinkle) % 11 !== 0) ctx.fillRect(sxx, syy, R, R);
      }
    }
  }

  /**
   * The city, sitting on the real horizon.
   *
   * Drawn after the road because only then do we know where the horizon is:
   * `horizonY` is the top edge of the furthest tarmac we managed to draw.
   * Everything above it is untouched sky, which is exactly the band the
   * skyline belongs in.
   */
  _drawHills(themeName, theme, horizonY) {
    const ctx = this.ctx;
    const y = clamp(horizonY, 0, H);
    if (y <= 0) return;

    const tile = skylineFor(themeName, theme);
    // Scroll against the curve you are turning into.  The tile is wider than
    // the screen, so two blits cover it for any offset.
    const off = ((this.skyOffset % TILE_W) + TILE_W) % TILE_W;
    const top = y - TILE_H;
    for (let x = -off; x < W; x += TILE_W) {
      ctx.drawImage(tile, Math.round(x), Math.round(top));
    }

    // Haze band along the waterline so the city does not sit on the road
    // like a sticker.
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = theme.haze;
    ctx.fillRect(0, y - 3 * R, W, 4 * R);
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

    // ---- surface decoration --------------------------------------------
    // Cheap, but it is what stops a long straight from reading as a
    // treadmill: the eye needs irregular features to measure speed against.
    if (seg.deco && p1.w > 3) {
      if (seg.deco & DECO.PATCH) {
        ctx.fillStyle = seg.alt ? theme.road[1] : theme.road[0];
        polygon(ctx,
          p1.x - p1.w * 0.62, p1.y, p1.x + p1.w * 0.10, p1.y,
          p2.x + p2.w * 0.10, p2.y, p2.x - p2.w * 0.62, p2.y);
      }
      if (seg.deco & DECO.SKID) {
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        for (const off of [-0.30, -0.16]) {
          polygon(ctx,
            p1.x + p1.w * off, p1.y, p1.x + p1.w * (off + 0.07), p1.y,
            p2.x + p2.w * (off + 0.07), p2.y, p2.x + p2.w * off, p2.y);
        }
      }
      if (seg.deco & DECO.JOINT) {
        ctx.fillStyle = 'rgba(0,0,0,0.34)';
        polygon(ctx,
          p1.x - p1.w, p1.y, p1.x + p1.w, p1.y,
          p2.x + p2.w, p2.y, p2.x - p2.w, p2.y);
      }
    }

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

    // ---- guardrails ------------------------------------------------------
    // Only on the narrow sections.  A bridge with nothing at the edge is
    // exactly where you most want a visual cue that the shoulder has gone.
    if ((seg.deco & DECO.RAIL) && p1.w > 2) {
      const railH = Math.max(2, Math.round(p1.w * 0.20));
      const postW = Math.max(1, Math.round(p1.w * 0.05));
      for (const side of [-1, 1]) {
        const x1 = p1.x + side * (p1.w + p1.w * 0.10);
        const x2 = p2.x + side * (p2.w + p2.w * 0.10);
        ctx.fillStyle = theme.rumble[0];
        polygon(ctx, x1, p1.y - railH, x1 + side * postW * 2, p1.y - railH,
          x2 + side * postW * 2, p2.y - railH * 0.7, x2, p2.y - railH * 0.7);
        if (!seg.alt) {
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(Math.round(x1), Math.round(p1.y - railH), postW, railH);
        }
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

    // Contact shadow.  Without one, traffic looks pasted onto the road
    // instead of standing on it.
    if (spr.shadow && yWorld === 0 && destW > 6) {
      const sw = destW * spr.shadow;
      const sh = Math.max(1, Math.round(destH * 0.055));
      ctx.globalAlpha = clamp(0.42 * fog, 0, 0.42);
      ctx.fillStyle = '#000';
      ctx.fillRect(Math.round(destX + (destW - sw) / 2), Math.round(p.y - sh),
        Math.round(sw), sh * 2);
      ctx.globalAlpha = 1;
    }

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

    // After dark, remember where this sprite's lamps landed.  Skipped for
    // very distant sprites, where the glow would be larger than the car.
    if (this.night > 0.05 && spr.lamps && destW >= 12 && clipH < destH * 0.5) {
      this._queueLamps(spr, destX, destY, destW, drawH, a);
    }
  }

  /** Record one sprite's lamp rectangles in screen space for the glow pass. */
  _queueLamps(spr, dx, dy, dw, dh, alpha) {
    for (let i = 0; i < spr.lamps.length; i++) {
      const L = spr.lamps[i];
      let slot = this.lamps[this.lampCount];
      if (!slot) { slot = { x: 0, y: 0, w: 0, h: 0, c: '', a: 1 }; this.lamps.push(slot); }
      slot.x = dx + L.x * dw;
      slot.y = dy + L.y * dh;
      slot.w = Math.max(1, L.w * dw);
      slot.h = Math.max(1, L.h * dh);
      slot.c = L.c;
      slot.a = alpha;
      this.lampCount++;
    }
  }

  /**
   * Paint every queued lamp additively: a hot core inside a soft halo.  Two
   * rectangles per lamp reads as a glow at this scale and costs nothing next
   * to a real blur.
   */
  _flushLamps() {
    if (this.lampCount === 0) return;
    const ctx = this.ctx;
    const strength = clamp(this.night * 2.0, 0.25, 1);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.lampCount; i++) {
      const L = this.lamps[i];
      ctx.globalAlpha = clamp(0.28 * strength * L.a, 0, 1);
      ctx.fillStyle = L.c;
      ctx.fillRect(
        Math.round(L.x - L.w * 0.8), Math.round(L.y - L.h * 0.9),
        Math.round(L.w * 2.6), Math.round(L.h * 2.8),
      );
      ctx.globalAlpha = clamp(0.9 * strength * L.a, 0, 1);
      ctx.fillRect(Math.round(L.x), Math.round(L.y), Math.round(L.w), Math.round(L.h));
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
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
    const size = clamp(Math.round(p.scale * BULLET_WORLD_W * b.size * HALF_W), R, 24 * R);
    const x = Math.round(p.x + fullW * b.x);
    const y = Math.round(p.y - p.scale * b.y * H * 0.5);
    const ctx = this.ctx;
    if (y > seg.clip) return;
    // Tracer: a faint tail behind a hot core, so a round in flight reads as
    // motion rather than as a dot that happens to be in a new place.
    const len = Math.max(3, size * 3);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = b.hostile ? UI.red : UI.amber;
    ctx.fillRect(x - (size >> 2) - 1, y - size, Math.max(1, size >> 1) + 1, len);
    ctx.globalAlpha = 1;
    ctx.fillStyle = b.hostile ? UI.red : UI.yellow;
    ctx.fillRect(x - (size >> 1), y - size, Math.max(1, size), Math.max(2, size * 2));
    ctx.fillStyle = UI.white;
    ctx.fillRect(x - (R >> 1), y - size, Math.max(1, R), Math.max(1, size));
  }

  _drawParticle(seg, p0) {
    const p = seg.p1.screen;
    if (seg.p1.camera.z < SPRITE_NEAR_Z * 0.5) return;
    if (p.scale <= 0) return;
    const fullW = p.scale * K.ROAD_WIDTH * HALF_W;
    const s = clamp(Math.round(p.scale * PARTICLE_WORLD_W * p0.size * HALF_W), R, 40 * R);
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
    if (p.scale <= 0 || p.w < 6 * R) return;
    const fullW = p.scale * K.ROAD_WIDTH * HALF_W;
    const x = Math.round(p.x + fullW * f.x);
    const y = Math.round(p.y - p.scale * f.y * H * 0.5);
    if (y > seg.clip || y < -10) return;
    const ctx = this.ctx;
    ctx.globalAlpha = clamp(f.life / f.maxLife, 0, 1);
    textCenteredShadow(ctx, f.text, x, y, f.color, R);
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- player

  /**
   * The van.
   *
   * Size and screen position come from the projection at the van's own depth
   * rather than from hardcoded screen fractions, so CAMERA_HEIGHT and
   * PLAYER_PULLBACK in config.js genuinely control the framing: pull the
   * camera back and the van shrinks and rises up the frame exactly as a real
   * one would.  Its depth is constant, so all of this is precomputed.
   */
  _drawPlayer(g, seg, theme) {
    const ctx = this.ctx;
    const speedFrac = g.speed / K.MAX_SPEED;
    const bounce = g.speed > 0
      ? Math.sin(g.time * 26) * 1.2 * R * speedFrac * (g.offRoad ? 2.6 : 0.6)
      : 0;
    const frame = clamp(Math.round(g.steerVisual * 2) + 2, 0, 4);
    const spr = SPR.van[frame];

    const roadHalfPx = K.PLAYER_SCALE * K.ROAD_WIDTH * (W / 2);
    const destW = Math.round(spr.worldW * roadHalfPx);
    const destH = Math.round(destW * spr.aspect);
    const groundY = Math.round(K.PLAYER_GROUND_Y + bounce);
    const destY = groundY - destH;

    // The camera tracks playerX, so the van is always horizontally centred.
    // Two small offsets on top of that:
    //   - the tail swings AWAY from the steer.  You are steering the front
    //     wheels: point the nose right and the back end comes left, which is
    //     the end you are looking at.  Paired with the yaw frames (which put
    //     the van's right flank into view when the nose goes right), this is
    //     what makes it feel like driving the front of the van rather than
    //     dragging it round by the back.
    //   - and it drifts toward the OUTSIDE of a corner, which is where
    //     cornering load actually pushes it.
    const steerShift = -g.steerVisual * 3.4;
    const curveDrift = -seg.curve * 0.9;
    const destX = Math.round(W / 2 - destW / 2) + Math.round((steerShift + curveDrift) * R);

    // Ground shadow, drawn flat and unrotated: a shadow that spins with a
    // wrecking van reads as a black wedge stuck to the bodywork.
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(destX + 3 * R, groundY - 2 * R, destW - 6 * R, 3 * R);

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

    // Muzzle flash at the roof cannon.  Additive, and gone in a frame or two.
    if (g.muzzleFlash > 0) {
      const f = clamp(g.muzzleFlash / 0.06, 0, 1);
      const mx = destX + destW / 2;
      const my = destY + destH * 0.02;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = f;
      ctx.fillStyle = UI.yellow;
      ctx.fillRect(mx - destW * 0.10, my - 5 * R, destW * 0.20, 6 * R);
      ctx.fillStyle = UI.white;
      ctx.fillRect(mx - destW * 0.04, my - 8 * R, destW * 0.08, 8 * R);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Brake lights.
    if (g.braking) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,60,20,0.75)';
      ctx.fillRect(destX + destW * 0.06, destY + destH * 0.26, destW * 0.12, destH * 0.34);
      ctx.fillRect(destX + destW * 0.82, destY + destH * 0.26, destW * 0.12, destH * 0.34);
      ctx.globalCompositeOperation = 'source-over';
    }

    // Electro Shield bubble.
    if (g.shieldTimer > 0) {
      const pulse = (2 + Math.sin(g.time * 16) * 1.5) * R;
      ctx.strokeStyle = g.shieldTimer < 2 && Math.floor(g.time * 10) % 2 === 0
        ? UI.white : UI.cyan;
      ctx.lineWidth = R;
      ctx.strokeRect(
        Math.round(destX - pulse), Math.round(destY - pulse),
        Math.round(destW + pulse * 2), Math.round(destH + pulse * 2),
      );
    }

    // Nitro flame out the back.
    if (g.nitroTimer > 0) {
      const fl = (4 + Math.random() * 7) * R;
      ctx.fillStyle = Math.random() < 0.5 ? UI.yellow : UI.red;
      ctx.fillRect(destX + destW * 0.30, groundY - 2 * R, destW * 0.14, fl);
      ctx.fillRect(destX + destW * 0.56, groundY - 2 * R, destW * 0.14, fl);
    }

    // Dust plume when you put two wheels on the shoulder.  Kicked up around
    // the wheels only -- spraying it over the whole sprite just repaints the
    // van in grass colour.
    if (g.offRoad && g.speed > 200) {
      ctx.fillStyle = mix(theme.ground[0], UI.white, 0.35);
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 12; i++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const px = destX + destW / 2 + side * (destW * 0.34 + Math.random() * destW * 0.30);
        const py = groundY - Math.random() * 10 * R;
        const sz = (1 + Math.random() * 3) * R;
        ctx.fillRect(px | 0, py | 0, sz, sz);
      }
      ctx.globalAlpha = 1;
    }
  }

  _drawRescue(g) {
    const ctx = this.ctx;
    const spr = SPR.plane;
    const r = g.rescue;
    const scale = 0.62;
    const destW = Math.round(W * 0.22 * scale + 34 * R);
    const destH = Math.round(destW * spr.aspect);
    const destX = Math.round(W / 2 + r.x * (W * 0.38) - destW / 2);
    const destY = Math.round(H * 0.10 + r.y * 26);
    ctx.drawImage(spr.canvas, destX, destY, destW, destH);
  }

  /**
   * Headlights, lit in ROAD SPACE.
   *
   * This is the part that was wrong for several attempts, so it is worth
   * writing down why.
   *
   * The road is not a picture -- it is a list of segments, each already
   * projected to screen this frame.  Anything that is supposed to LIE ON the
   * road has to be drawn segment by segment using those same projections.
   * Earlier versions drew the beam as one screen-space polygon, and no
   * quadrilateral can follow a surface that curves, crests and dips: it
   * always reads as a decal pasted over the picture rather than as light
   * falling on tarmac.
   *
   * Drawn per segment, every hard problem solves itself:
   *   - the beam bends with the road, because the segments do;
   *   - it rides over crests and down into dips, for the same reason;
   *   - it narrows in perspective exactly like the road, because it uses the
   *     road's own scale;
   *   - it is hidden behind a hill by the same `clip` line as everything else.
   *
   * Lateral extent grows with distance in WORLD units (a real beam is a cone,
   * roughly `w0 + d*tan(spread)` across); perspective then does the right
   * thing to it for free.  Intensity falls off with distance the way
   * illuminance does, and two nested passes -- a wide dim spill and a narrow
   * bright core -- give the beam a soft edge.
   *
   * Additive, as the standard technique for headlights requires, and drawn
   * after the night wash so it brightens an already-dark scene rather than
   * being dimmed along with it.
   */
  _drawHeadlightWash(g, theme, baseIndex, drawn) {
    const ctx = this.ctx;
    const segs = g.track.segments;

    // The van sits this many segments ahead of the camera; the lamps are on
    // its nose, so start a segment further on and let the body mask the gap.
    const fromN = Math.floor(K.PLAYER_Z / K.SEG_LENGTH) + 1;
    const range = HEADLIGHT_RANGE;
    const strength = 0.14 + theme.dark * 0.92;

    // Beam aim, in road half-widths from the centreline.  Following the
    // road's own coordinates means the light stays in your lane through a
    // corner; the small steer term lets it lead the wheel, which also sells
    // the sense of steering the front of the van.
    const aim = clamp(g.playerX + g.steerVisual * 0.34, -2, 2);

    ctx.globalCompositeOperation = 'lighter';

    for (let n = fromN; n < Math.min(fromN + range, drawn); n++) {
      const seg = segs[baseIndex + n];
      if (!seg || !seg.visible) continue;
      const s1 = seg.p1.screen;
      const s2 = seg.p2.screen;
      // Behind a crest, or degenerate.
      if (s1.y > seg.clip || s2.y >= s1.y) continue;

      const t0 = (n - fromN) / range;
      const t1 = (n + 1 - fromN) / range;

      // Inverse-square-ish falloff, so the tarmac just ahead of the bumper is
      // bright and the far end fades out instead of stopping dead.
      const fall = 1 / (1 + (t0 * 3.1) * (t0 * 3.1));
      if (fall < 0.02) break;

      // Full-road-width pixel scale for each end of the segment.
      const f1 = s1.scale * K.ROAD_WIDTH * HALF_W;
      const f2 = s2.scale * K.ROAD_WIDTH * HALF_W;

      const band = (spreadNear, spreadFar, alpha, tint) => {
        const h1 = spreadNear + t0 * spreadFar;
        const h2 = spreadNear + t1 * spreadFar;
        ctx.fillStyle = `rgba(${tint},${(alpha).toFixed(4)})`;
        polygon(ctx,
          s1.x + f1 * (aim - h1), s1.y,
          s1.x + f1 * (aim + h1), s1.y,
          s2.x + f2 * (aim + h2), s2.y,
          s2.x + f2 * (aim - h2), s2.y);
      };

      // Wide soft spill, then a tight bright core inside it.
      band(BEAM_NEAR_W * 2.2, BEAM_SPREAD * 1.40, strength * fall * 0.26, '255,234,168');
      band(BEAM_NEAR_W * 1.3, BEAM_SPREAD * 1.02, strength * fall * 0.34, '255,244,198');
      band(BEAM_NEAR_W, BEAM_SPREAD * 0.72, strength * fall * 0.30, '255,251,228');
    }

    ctx.globalCompositeOperation = 'source-over';
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

