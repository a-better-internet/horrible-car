/*
 * Horrible Car -- bootstrap and main loop.
 *
 * A browser port of Atari's Road Blasters (1987), digested from the MiSTer
 * Atari System 1 core: the 320x240 raster, the CRAM intensity/RGB colour
 * model, and the cabinet's analog wheel + one-sided pedal control shape all
 * come from that hardware.  The car does not.
 *
 * The loop is a fixed-timestep accumulator.  Physics, fuel drain and
 * collision sweeps always advance by exactly config.STEP, so a 144Hz monitor
 * and a struggling laptop play the same game.
 */

import * as K from './config.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { buildSprites } from './sprites.js';
import { Game, STATE } from './game.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { UI } from './palette.js';
import { text } from './font.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('screen'));
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

buildSprites();

const audio = new AudioEngine();
const input = new Input(canvas);
const game = new Game(audio);
const renderer = new Renderer(ctx);
const hud = new Hud(ctx);

let paused = false;
let showDebug = false;

// --------------------------------------------------------------- presentation

/**
 * Size the canvas element so the 320x240 buffer scales up cleanly.
 * Integer scaling is preferred (every game pixel becomes an exact square);
 * we only fall back to a fractional scale when integer would waste more than
 * ~15% of the available area, which mostly happens on short windows.
 */
function resize() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fit = Math.min(vw / K.SCREEN_W, vh / K.SCREEN_H);
  const intScale = Math.floor(fit);
  const scale = intScale >= 1 && intScale / fit >= 0.85 ? intScale : fit;
  const w = Math.max(K.SCREEN_W, Math.round(K.SCREEN_W * scale));
  const h = Math.max(K.SCREEN_H, Math.round(K.SCREEN_H * scale));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();

const hint = document.getElementById('controls-hint');
let hintTimer = 0;

// ---------------------------------------------------------------- audio gate

/**
 * Browsers will not let us make a sound until the user does something.  Try
 * on every early gesture until one of them succeeds.
 */
function unlockAudio() {
  if (audio.init() && audio.ctx && audio.ctx.state === 'running') {
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
  }
}
window.addEventListener('keydown', unlockAudio);
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('touchstart', unlockAudio);

// -------------------------------------------------------------------- pause

function setPaused(p) {
  // The attract loop is a demo, not a game in progress: pausing it just
  // parks a PAUSED banner over the title screen.
  if (p && game.state === STATE.ATTRACT) return;
  if (paused === p) return;
  paused = p;
  if (paused) {
    audio.stopEngine();
    audio.stopMusic();
  } else if (game.state === STATE.PLAY) {
    audio.startMusic();
  }
}

// Losing focus mid-corner and coming back to a wreck is nobody's idea of a
// good time, so we pause instead.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
});
window.addEventListener('blur', () => setPaused(true));

function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) {
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  } else if (document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

// ---------------------------------------------------------------- main loop

let last = performance.now();
let accumulator = 0;
let fps = 60;
let fpsAccum = 0;
let fpsFrames = 0;

/** Hard ceiling on catch-up steps: better to slow down than to spiral. */
const MAX_STEPS = 8;

function frame(now) {
  requestAnimationFrame(frame);

  let dt = (now - last) / 1000;
  last = now;
  // A backgrounded tab can hand us a multi-second delta; simulating it would
  // teleport the van through the entire stage.
  if (!(dt > 0) || dt > K.MAX_FRAME_TIME) dt = K.MAX_FRAME_TIME;

  fpsAccum += dt;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    fps = fpsFrames / fpsAccum;
    fpsAccum = 0;
    fpsFrames = 0;
  }

  // ---- global commands (consumed so a step cannot re-trigger them) ------
  if (input.consume('pause') && game.state !== STATE.ATTRACT) {
    setPaused(!paused);
    audio.uiBlip(!paused);
  }
  if (input.consume('mute')) {
    audio.init();
    audio.setMuted(!audio.muted);
  }
  if (input.consume('fullscreen')) toggleFullscreen();
  if (input.consume('debug')) showDebug = !showDebug;
  if (input.consume('start')) {
    audio.init();
    if (game.startPressed()) setPaused(false);
  }

  if (input.edges.any && hintTimer < 900) hintTimer = 900;

  // ---- simulate --------------------------------------------------------
  if (!paused) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= K.STEP && steps < MAX_STEPS) {
      input.update(K.STEP);
      game.update(K.STEP, input);
      accumulator -= K.STEP;
      steps++;
    }
    // Could not keep up: drop the backlog rather than accumulating debt that
    // makes the next frames worse.
    if (steps === MAX_STEPS) accumulator = 0;
  }

  // ---- draw ------------------------------------------------------------
  renderer.render(game, dt);

  // The HUD is authored in original-raster (320x240) units and scaled up.
  // Drawing it through a transform keeps every layout constant in one
  // coordinate system, and because the font is built from rectangles it
  // lands on exact pixel boundaries at integer scales.
  ctx.save();
  ctx.scale(K.UI_SCALE, K.UI_SCALE);
  hud.render(game, paused);
  if (showDebug) drawDebug();
  if (audio.muted) drawMuted();
  ctx.restore();
  input.endFrame();

  // Fade the keyboard hint out once the player is clearly playing.
  if (hint && hintTimer > 0) {
    hintTimer -= dt * 1000;
    if (hintTimer <= 0) hint.classList.add('faded');
  }
}

function drawDebug() {
  const lines = [
    `FPS ${fps.toFixed(0)}  STEP ${(K.STEP * 1000).toFixed(1)}MS`,
    `POS ${(game.position / K.SEG_LENGTH).toFixed(1)} SEG  X ${game.playerX.toFixed(2)}`,
    `SPD ${game.speed.toFixed(0)}  ${game.mph} MPH  OFFROAD ${game.offRoad ? 'Y' : 'N'}`,
    `CARS ${game.enemies.length}  BUL ${game.bullets.activeCount}  PRT ${game.particles.activeCount}`,
    `STATE ${game.state}  FUEL ${game.fuel.toFixed(1)}`,
  ];
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 60, 178, lines.length * 8 + 4);
  for (let i = 0; i < lines.length; i++) text(ctx, lines[i], 3, 62 + i * 8, UI.green, 1);
}

function drawMuted() {
  text(ctx, 'MUTE', K.BASE_W - 26, 24, UI.dim, 1);
}

// Draw one frame immediately so the title screen appears before any input.
requestAnimationFrame((t) => { last = t; frame(t); });

// Focus the canvas so keyboard input works without a click.
canvas.focus({ preventScroll: true });
canvas.addEventListener('pointerdown', () => canvas.focus({ preventScroll: true }));

// Expose for debugging from the console; harmless in production.
window.HorribleCar = {
  game, audio, input, renderer,
  get paused() { return paused; },
  setPaused,
};
