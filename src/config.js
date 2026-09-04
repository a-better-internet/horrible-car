/*
 * Every tunable in Horrible Car lives here.
 *
 * Units: distance is in "road units"; SEG_LENGTH units make one road segment.
 * Speed is road units per second.  Lateral position is normalised so that
 * x = +/-1 sits exactly on the painted road edge, which keeps collision maths
 * and sprite scaling in the same space.
 */

/*
 * Render buffer.
 *
 * The Atari System 1 raster was 320x240 (see Arcade-atarisys1.sv).  We render
 * at exactly twice that: the 4:3 shape and the arcade framing are preserved,
 * but there are four times as many pixels to describe a car with, which
 * matters a great deal when it is closing at 250 mph.  RES is the factor
 * between the original raster and this one; hardcoded pixel sizes in the
 * renderer are expressed in original-raster units and multiplied by it.
 */
export const BASE_W = 320;
export const BASE_H = 240;
export const RES = 2;
export const SCREEN_W = BASE_W * RES;
export const SCREEN_H = BASE_H * RES;
export const ASPECT = 4 / 3;

/** The HUD is laid out in original-raster units and scaled up by this. */
export const UI_SCALE = RES;

/** Simulation runs on a fixed step so physics never depend on framerate. */
export const STEP = 1 / 120;
export const MAX_FRAME_TIME = 0.25;   // never simulate more than this per rAF

// ---------------------------------------------------------------- road/camera
export const SEG_LENGTH = 200;
export const ROAD_WIDTH = 2000;       // half-width of the tarmac in road units
export const RUMBLE_WIDTH = ROAD_WIDTH / 5;
export const LANES = 4;
/*
 * Camera.
 *
 * Road Blasters put the eye high and well back from the car: you see a long
 * way up the road, the car is small, and it sits high enough in the frame
 * that there is tarmac below it.  That framing is what makes aiming possible
 * -- a low chase camera hides the very lane you are shooting into.
 *
 * PLAYER_Z is the camera-to-van distance.  At exactly CAMERA_HEIGHT *
 * CAMERA_DEPTH the van projects to the bottom edge of the screen; every
 * multiple beyond that lifts it up the frame and shrinks it by the same
 * factor.  PLAYER_PULLBACK is therefore the single knob for "how zoomed out".
 */
export const CAMERA_HEIGHT = 1600;
export const CAMERA_DEPTH = 1 / Math.tan(((100 / 2) * Math.PI) / 180); // 100 deg FOV
export const DRAW_DISTANCE = 220;     // segments drawn ahead of the camera
export const PLAYER_PULLBACK = 1.85;
export const PLAYER_Z = CAMERA_HEIGHT * CAMERA_DEPTH * PLAYER_PULLBACK;

/** Projection scale at the van's own depth -- constant, so precompute it. */
export const PLAYER_SCALE = CAMERA_DEPTH / PLAYER_Z;
/** Screen y of the road surface under the van, in buffer pixels. */
export const PLAYER_GROUND_Y = SCREEN_H / 2 + PLAYER_SCALE * CAMERA_HEIGHT * (SCREEN_H / 2);

// ---------------------------------------------------------------- van physics
export const MAX_SPEED = SEG_LENGTH / STEP / 2;  // 12000 u/s, one seg per 60Hz frame
export const MPH_PER_UNIT = 250 / MAX_SPEED;     // speedo calibration

/** A 1994 Caravan is not quick.  ~7s to top speed, and it hates stopping. */
export const ACCEL = MAX_SPEED / 7.0;
export const BRAKING = -MAX_SPEED / 2.4;
export const COAST_DECEL = -MAX_SPEED / 7.0;
export const OFF_ROAD_DECEL = -MAX_SPEED / 1.5;
export const OFF_ROAD_LIMIT = MAX_SPEED / 3.2;
export const CENTRIFUGAL = 0.18;      // how hard curves push you outward
/**
 * Hard limit on how far off the centreline the van can get, in road
 * half-widths.  Beyond roughly this point you are among solid scenery
 * anyway, and letting the van wander further just fills the screen with a
 * tree you are standing next to.
 */
export const MAX_OFF_ROAD_X = 2.2;
export const STEER_RATE = 2.35;       // road-widths/sec of lateral travel at speed

/** Wheel feel: the arcade used an analog wheel, so digital keys are ramped. */
export const WHEEL_ACCEL = 4.6;       // units/sec toward full lock
export const WHEEL_RETURN = 6.2;      // units/sec back to centre when released

// ---------------------------------------------------------------- fuel/timer
/*
 * Fuel, in two tanks.
 *
 * The cabinet's HUD read "FUEL / RESERVE / MAIN TANK", and splitting it that
 * way is the whole tension of the game: the main tank running dry is not the
 * end, it is the warning.  What follows is a short, loud, obviously-final
 * stretch on the reserve where every globe matters.
 */
export const FUEL_MAX = 100;
export const FUEL_START = 72;
export const RESERVE_MAX = 30;
export const RESERVE_START = 30;
export const RESERVE_STAGE_BONUS = 9;
export const FUEL_IDLE_DRAIN = 1.45;  // per second at a standstill
export const FUEL_SPEED_DRAIN = 3.05; // extra per second at full throttle
export const FUEL_GLOBE = 11;
export const FUEL_CRASH = 9;          // scenery / head-on wreck
export const FUEL_SIDESWIPE = 3.5;
export const FUEL_SHOT = 5;           // taking a turret round
export const FUEL_STAGE_BONUS = 26;   // topped up between stages

// ---------------------------------------------------------------- dimensions
// All widths are fractions of ROAD_WIDTH (the road half-width).
export const VAN_WIDTH = 0.38;
export const VAN_LENGTH = 420;        // road units, for z-overlap tests

// ---------------------------------------------------------------- weapons
export const WEAPONS = {
  base: {
    id: 'base', name: 'HOOD CANNON', short: 'HOOD',
    cooldown: 0.26, damage: 1, ammo: Infinity, speed: 26000, spread: 0,
  },
  uz: {
    id: 'uz', name: 'UZ CANNON', short: 'UZ',
    cooldown: 0.075, damage: 1, ammo: 140, speed: 32000, spread: 0.02,
  },
  spread: {
    id: 'spread', name: 'DOOR SPREADER', short: 'SPRD',
    cooldown: 0.34, damage: 1, ammo: 60, speed: 26000, spread: 0.16, pellets: 3,
  },
};

export const CRUISE_MISSILE = {
  /** Wipes everything in this many road units ahead of the van. */
  range: SEG_LENGTH * 95,
  startCount: 0,
  podCount: 2,
  maxCount: 6,
};

export const NITRO = { duration: 4.2, boost: 1.42, podCharges: 2, maxCharges: 6 };
export const SHIELD = { duration: 8.5 };

// ---------------------------------------------------------------- combat
export const BULLET_LIFE = 1.5;       // seconds before a round despawns
export const ENEMY_BULLET_SPEED = 9000;  // closing speed toward the player
export const CRASH_SPIN_TIME = 1.35;  // loss of control after a wreck
export const CRASH_SPEED_KEEP = 0.22; // fraction of speed retained in a wreck
export const SIDESWIPE_KICK = 0.55;   // lateral shove, in road-widths/sec
export const INVULN_AFTER_CRASH = 1.6;

// ---------------------------------------------------------------- scoring
/*
 * Scoring.
 *
 * Kill and near-miss points are multiplied; distance, pickups and the
 * end-of-stage payout are not, so the multiplier rewards fighting rather than
 * simply surviving.
 */
export const SCORE = {
  sedan: 200, coupe: 350, cycle: 250, command: 600, turret: 450,
  mine: 100, globe: 150, pod: 300, nearMiss: 80,
  perFuelUnit: 100,     // end-of-stage bonus
  stageClear: 2000,
  distance: 1,          // per segment travelled
};

/** Multiplier: climbs with kills and clean passes, resets on a wreck. */
export const MULTIPLIER_MAX = 8;
export const CHAIN_PER_LEVEL = 4;     // chained hits per multiplier step
export const CHAIN_TIMEOUT = 6.0;     // seconds of no action before it decays
/** Lateral gap, in road half-widths, that still counts as a near miss. */
export const NEAR_MISS_X = 0.62;

// ---------------------------------------------------------------- stages
export const TOTAL_STAGES = 50;
export const STAGE_THEME_ORDER = ['day', 'day', 'dusk', 'night', 'fog', 'rust', 'snow'];

/** The Rescue Cruiser flyover that delivers weapon pods. */
export const RESCUE = {
  firstAt: 0.28,        // fraction through the stage
  interval: 0.34,       // stage fractions between flyovers
  approachTime: 2.6,    // seconds of flyover before the pod is released
  dropAhead: SEG_LENGTH * 46,
};

export const HIGHSCORE_KEY = 'horriblecar.highscore.v1';
export const SETTINGS_KEY = 'horriblecar.settings.v1';
