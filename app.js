/**
 * app.js – TutuDVD Old-TV Bouncing-Text Screensaver
 *
 * Key exported / notable functions (described in JSDoc below):
 *   loadTextsFromFile(file)
 *   loadTextsFromDefaultCsv(seed)
 *   parseCSV(text)
 *   parseJSON(text)
 *   stepSimulation(dt)
 *   handleCollisions()
 *   exportVideoWebM()
 *   exportFramesZip()
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════════════
   1.  CONSTANTS & DEFAULTS
   ═══════════════════════════════════════════════════════════════════════ */

/** Target number of scanlines at export/full resolution. */
const TARGET_SCANLINE_COUNT = 300;

/** Video bitrate for WebM export (bits per second). */
const VIDEO_BITRATE = 8_000_000;
const TOP_TAGLINE = 'NASONE TI CHIAMA PI NOMI';
const BOTTOM_TAGLINE = 'XYZ 🌣 VIAGGIO INTORNO AL SOLE';
const MOVING_TEXT_MIN_SIZE = 8;
const MOVING_TEXT_MAX_WIDTH_RATIO = 0.92;
const TRAIL_LIFE_FRAMES = 140;
const TRAIL_MAX_ALPHA = 0.35;
const DEFAULT_TRAIL_GAP = 42;
const TRAIL_SAMPLE_DISTANCE_RATIO = 0.75;
const TRAIL_ECHO_DELAY_FRAMES = 14;
const DEFAULT_NAMES_CSV = 'soprannomi.csv';
const DEFAULT_PICK_MIN = 20;
const DEFAULT_PICK_MAX = 30;

const DEFAULT_TEXTS = [
  'tutudvd',
  'ciao bella',
  'la scuola open source',
  'festa di tutu',
  'BOUNCE',
  '¡holá!',
  'dvd screensaver',
  'projection mapping',
  'loop forever',
  'open source',
  'creative coding',
  'canvas 2d',
  'deterministic',
  'video mapping',
  'seedable rng',
  'WebM export',
  'scanlines on',
  'la festa continua',
  '∞',
  'press start',
];

/* ═══════════════════════════════════════════════════════════════════════
   2.  SEEDED RNG  (Mulberry32)
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Hash a string into a 32-bit integer (djb2 variant).
 * @param {string} s
 * @returns {number}
 */
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  }
  return h >>> 0;
}

/**
 * Create a seeded pseudo-random number generator (Mulberry32).
 * Returns a function () => float in [0, 1).
 * @param {number|string} seed
 * @returns {() => number}
 */
function createRng(seed) {
  let s = (typeof seed === 'string') ? hashString(seed) : (seed >>> 0);
  // Mulberry32
  return function () {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   3.  TEXT PARSING
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Parse a CSV-like file: one string per line, empty lines ignored.
 * @param {string} text  Raw file contents.
 * @returns {string[]}
 */
function parseCSV(text) {
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

/**
 * Parse a JSON file.  Accepts either an array or { items: [...] }.
 * @param {string} text  Raw file contents.
 * @returns {string[]}
 */
function parseJSON(text) {
  const data = JSON.parse(text);
  if (Array.isArray(data)) return data.map(String);
  if (data && Array.isArray(data.items)) return data.items.map(String);
  throw new Error('JSON must be an array or { "items": [...] }');
}

/**
 * Load texts from a File object (JSON or CSV/TXT).
 * Updates the global `state.texts` list and resets the index.
 * @param {File} file
 * @returns {Promise<void>}
 */
function loadTextsFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const raw = e.target.result;
        const isJSON = file.name.toLowerCase().endsWith('.json');
        state.texts = isJSON ? parseJSON(raw) : parseCSV(raw);
        if (state.texts.length === 0) throw new Error('No texts found in file');
        state.textIndex = 0;
        console.info(`Loaded ${state.texts.length} text(s) from ${file.name}`);
        resolve();
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsText(file);
  });
}

/**
 * Pick a subset of entries that is random but spread across the whole source list.
 * @param {string[]} items
 * @param {() => number} rng
 * @param {number} minCount
 * @param {number} maxCount
 * @returns {string[]}
 */
function pickDistributedSubset(items, rng, minCount, maxCount) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const upper = Math.max(1, Math.min(items.length, maxCount));
  const lower = Math.max(1, Math.min(upper, minCount));
  const count = lower + Math.floor(rng() * (upper - lower + 1));
  const bucketSize = items.length / count;
  const picks = [];

  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.max(start, Math.floor((i + 1) * bucketSize) - 1);
    const idx = start + Math.floor(rng() * (end - start + 1));
    picks.push(items[idx]);
  }

  // Shuffle picked entries for better perceived randomness.
  for (let i = picks.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }

  return picks;
}

/**
 * Load names from the bundled CSV and choose a distributed random subset.
 * @param {string|number} seed
 * @returns {Promise<void>}
 */
async function loadTextsFromDefaultCsv(seed) {
  const response = await fetch(DEFAULT_NAMES_CSV, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load ${DEFAULT_NAMES_CSV} (${response.status})`);
  }
  const raw = await response.text();
  const allNames = parseCSV(raw);
  if (allNames.length === 0) {
    throw new Error(`${DEFAULT_NAMES_CSV} is empty`);
  }
  const rng = createRng(seed || 'tutudvd');
  state.texts = pickDistributedSubset(allNames, rng, DEFAULT_PICK_MIN, DEFAULT_PICK_MAX);
  state.textIndex = 0;
}

/* ═══════════════════════════════════════════════════════════════════════
   4.  SIMULATION STATE
   ═══════════════════════════════════════════════════════════════════════ */

const state = {
  // texts
  texts: [...DEFAULT_TEXTS],
  textIndex: 0,

  // position & velocity (in preview-canvas coordinates)
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,

  // colours cycling
  hue: 0,

  // counters
  bounces: 0,

  // running flag
  running: false,

  // rng instance (reset on each seed change)
  rng: createRng('tutudvd'),

  // for rAF
  _rafId: null,
  _lastTs: null,

  // export cancellation
  _exportCancelled: false,

  // fading trail history
  trailPoints: [],
  trailEchoDelay: 0,
};

/* ═══════════════════════════════════════════════════════════════════════
   5.  CANVAS & DOM REFERENCES
   ═══════════════════════════════════════════════════════════════════════ */

const canvas  = document.getElementById('screen');
const ctx     = canvas.getContext('2d');
const wrap    = document.getElementById('canvas-wrap');

const inpSeed     = document.getElementById('inp-seed');
const inpSpeed    = document.getElementById('inp-speed');
const inpPadding  = document.getElementById('inp-padding');
const inpFontSize = document.getElementById('inp-fontsize');
const inpTrailGap = document.getElementById('inp-trailgap');
const selFps      = document.getElementById('sel-fps');
const selRes      = document.getElementById('sel-res');
const inpDuration = document.getElementById('inp-duration');
const selFormat   = document.getElementById('sel-format');
const chkScanlines = document.getElementById('chk-scanlines');
const chkVignette  = document.getElementById('chk-vignette');
const chkDebug     = document.getElementById('chk-debug');

const btnStartStop = document.getElementById('btn-startstop');
const btnReset     = document.getElementById('btn-reset');
const btnExport    = document.getElementById('btn-export');
const btnCancelExp = document.getElementById('btn-cancel-export');
const btnLoad      = document.getElementById('btn-load');
const fileInput    = document.getElementById('file-input');

const debugEl    = document.getElementById('debug');
const dbgBounces = document.getElementById('dbg-bounces');
const dbgIndex   = document.getElementById('dbg-index');
const dbgText    = document.getElementById('dbg-text');
const dbgPos     = document.getElementById('dbg-pos');
const dbgVel     = document.getElementById('dbg-vel');

const progressWrap  = document.getElementById('progress-wrap');
const progressLabel = document.getElementById('progress-label');
const progressFill  = document.getElementById('progress-bar-fill');

/* ═══════════════════════════════════════════════════════════════════════
   6.  LAYOUT
   ═══════════════════════════════════════════════════════════════════════ */

/** Resize preview canvas to fill the wrap div while keeping 16:9. */
function resizeCanvas() {
  const { clientWidth: W, clientHeight: H } = wrap;
  // Try to fill available space with 16:9
  let cw = W, ch = Math.round(W * 9 / 16);
  if (ch > H) { ch = H; cw = Math.round(H * 16 / 9); }
  canvas.width  = cw;
  canvas.height = ch;
  // If simulation was initialised, keep position in bounds
  clampPosition();
}

/* ═══════════════════════════════════════════════════════════════════════
   7.  HELPERS
   ═══════════════════════════════════════════════════════════════════════ */

function getSettings() {
  return {
    seed:     inpSeed.value || 'tutudvd',
    speed:    Math.max(10, parseFloat(inpSpeed.value) || 180),
    padding:  Math.max(0, parseFloat(inpPadding.value) || 20),
    fontSize: Math.max(8, parseFloat(inpFontSize.value) || 48),
    trailGap: Math.max(1, parseFloat(inpTrailGap.value) || DEFAULT_TRAIL_GAP),
    fps:      parseInt(selFps.value, 10) || 60,
    duration: Math.max(1, parseFloat(inpDuration.value) || 30),
    exportRes: selRes.value,
    format:   selFormat.value,
    scanlines: chkScanlines.checked,
    vignette:  chkVignette.checked,
  };
}

/** Compute the safe inner screen rect (accounting for bezel + padding). */
function getScreenRect(cw, ch, padding) {
  const bezel = Math.min(cw, ch) * 0.04;  // ~4 % of min dimension
  return {
    x: bezel + padding,
    y: bezel + padding,
    w: cw - 2 * bezel - 2 * padding,
    h: ch - 2 * bezel - 2 * padding,
  };
}

/**
 * Measure text bounding box in the current canvas context.
 * Returns { w, h } where h is approximated from the font metrics.
 */
function measureText(ctx, text, fontSize, fontWeight = 700) {
  ctx.font = `${fontWeight} ${fontSize}px 'Savate', 'Courier New', Courier, sans-serif`;
  const m = ctx.measureText(text);
  const w = m.width;
  // Use actual bounding box if available, otherwise approximate
  const h = (m.actualBoundingBoxAscent !== undefined && m.actualBoundingBoxDescent !== undefined)
    ? (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent)
    : fontSize * 0.8;
  return { w, h };
}

/**
 * Fit moving text width inside the usable screen rect by reducing size if needed.
 * Returns the effective font size plus measured width/height.
 */
function getMovingTextMetrics(ctx2d, text, requestedFontSize, sr) {
  const maxWidth = Math.max(1, sr.w * MOVING_TEXT_MAX_WIDTH_RATIO);
  let fontSize = Math.max(MOVING_TEXT_MIN_SIZE, requestedFontSize);
  let metrics = measureText(ctx2d, text, fontSize, 700);
  while (fontSize > MOVING_TEXT_MIN_SIZE && metrics.w > maxWidth) {
    fontSize--;
    metrics = measureText(ctx2d, text, fontSize, 700);
  }
  return { fontSize, w: metrics.w, h: metrics.h };
}

/** Clamp position so the text stays inside the screen rect. */
function clampPosition() {
  const s = getSettings();
  const sr = getScreenRect(canvas.width, canvas.height, s.padding);
  const { w: tw, h: th } = getMovingTextMetrics(ctx, state.texts[state.textIndex], s.fontSize, sr);
  const hw = tw / 2, hh = th / 2;

  const minX = sr.x + hw, maxX = sr.x + sr.w - hw;
  const minY = sr.y + hh, maxY = sr.y + sr.h - hh;

  // Only clamp if the text actually fits; otherwise center
  if (maxX > minX) state.x = Math.min(maxX, Math.max(minX, state.x));
  else state.x = sr.x + sr.w / 2;

  if (maxY > minY) state.y = Math.min(maxY, Math.max(minY, state.y));
  else state.y = sr.y + sr.h / 2;
}

/* ═══════════════════════════════════════════════════════════════════════
   8.  INITIALISATION / RESET
   ═══════════════════════════════════════════════════════════════════════ */

/** Initialise / reset simulation with current settings. */
function resetSimulation() {
  const s = getSettings();
  state.rng = createRng(s.seed);

  const sr = getScreenRect(canvas.width, canvas.height, s.padding);
  const { w: tw, h: th } = getMovingTextMetrics(ctx, state.texts[0], s.fontSize, sr);
  const minX = sr.x + tw / 2;
  const maxX = sr.x + sr.w - tw / 2;
  const minY = sr.y + th / 2;
  const maxY = sr.y + sr.h - th / 2;

  // Start at a random position inside the screen rect
  state.x = maxX > minX ? minX + state.rng() * (maxX - minX) : sr.x + sr.w / 2;
  state.y = maxY > minY ? minY + state.rng() * (maxY - minY) : sr.y + sr.h / 2;

  // Random initial direction (diagonal-ish, avoid axis-aligned)
  const angle = (0.3 + state.rng() * 0.9) * Math.PI / 2;  // 17°–69° ish
  const quadrant = Math.floor(state.rng() * 4);
  const signX = (quadrant & 1) ? 1 : -1;
  const signY = (quadrant & 2) ? 1 : -1;
  state.vx = signX * Math.cos(angle) * s.speed;
  state.vy = signY * Math.sin(angle) * s.speed;

  state.hue      = Math.floor(state.rng() * 360);
  state.bounces  = 0;
  state.textIndex = 0;
  state._lastTs  = null;
  state.trailPoints = [];
  state.trailEchoDelay = 0;
}

/* ═══════════════════════════════════════════════════════════════════════
   9.  SIMULATION  STEP
   ═══════════════════════════════════════════════════════════════════════ */

const MAX_SUBSTEPS = 8;

/**
 * Advance the simulation by dt seconds.
 * Uses multiple sub-steps to prevent tunnelling at high speeds.
 * @param {number} dt  Delta-time in seconds.
 * @param {object} ctx2d  Canvas 2D context (used only for text measurement).
 * @param {number} cw  Canvas width.
 * @param {number} ch  Canvas height.
 * @param {object} [settings] Optional settings override (used by export).
 */
function stepSimulation(dt, ctx2d, cw, ch, settings) {
  const s = settings || getSettings();
  const sr = getScreenRect(cw, ch, s.padding);
  const maxTravel = Math.max(Math.abs(state.vx * dt), Math.abs(state.vy * dt));
  const substeps = Math.min(MAX_SUBSTEPS, Math.ceil(maxTravel / (Math.min(sr.w, sr.h) * 0.3)) + 1);
  const subDt = dt / substeps;

  for (let i = 0; i < substeps; i++) {
    state.x += state.vx * subDt;
    state.y += state.vy * subDt;
    handleCollisions(ctx2d, cw, ch, s, sr);
  }
}

/**
 * Handle collisions with the inner screen bounds.
 * On a bounce: reflect velocity axis, clamp position, advance text, shift hue.
 * If both axes collide in the same step (corner), both axes reflect but only
 * ONE bounce event is counted (see inline note).
 * @param {CanvasRenderingContext2D} ctx2d
 * @param {number} cw  Canvas width.
 * @param {number} ch  Canvas height.
 * @param {object} s   Settings object.
 * @param {object} sr  Screen rect { x, y, w, h }.
 */
function handleCollisions(ctx2d, cw, ch, s, sr) {
  const { w: tw, h: th } = getMovingTextMetrics(ctx2d, state.texts[state.textIndex], s.fontSize, sr);
  const hw = tw / 2, hh = th / 2;

  const minX = sr.x + hw, maxX = sr.x + sr.w - hw;
  const minY = sr.y + hh, maxY = sr.y + sr.h - hh;

  let hit = false;

  // Guard: if text doesn't fit, just center and stop
  if (maxX <= minX) { state.x = sr.x + sr.w / 2; state.vx = 0; }
  else if (state.x < minX) { state.x = minX; state.vx = Math.abs(state.vx); hit = true; }
  else if (state.x > maxX) { state.x = maxX; state.vx = -Math.abs(state.vx); hit = true; }

  if (maxY <= minY) { state.y = sr.y + sr.h / 2; state.vy = 0; }
  else if (state.y < minY) { state.y = minY; state.vy = Math.abs(state.vy); hit = true; }
  else if (state.y > maxY) { state.y = maxY; state.vy = -Math.abs(state.vy); hit = true; }

  // ONE bounce event even if both axes reflected (corner case)
  if (hit) {
    state.bounces++;
    // Advance text
    state.textIndex = (state.textIndex + 1) % state.texts.length;
    // Shift hue by a random amount (20–80 degrees)
    state.hue = (state.hue + 20 + Math.floor(state.rng() * 60)) % 360;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   10.  RENDERING
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Draw one frame onto the given context.
 * Separated from the global `canvas` so the same function works during export.
 */
function drawFrame(ctx2d, cw, ch, settings) {
  const s = settings || getSettings();
  const sr = getScreenRect(cw, ch, s.padding);
  const bezel = Math.min(cw, ch) * 0.04;

  // ── Background ──────────────────────────────────────────────────────
  ctx2d.clearRect(0, 0, cw, ch);

  // Outer bezel gradient
  const grad = ctx2d.createLinearGradient(0, 0, cw, ch);
  grad.addColorStop(0, '#2e2e2e');
  grad.addColorStop(0.5, '#1a1a1a');
  grad.addColorStop(1, '#111');
  ctx2d.fillStyle = grad;
  ctx2d.beginPath();
  const br = bezel * 1.5;
  roundRect(ctx2d, 0, 0, cw, ch, br);
  ctx2d.fill();

  // Inner screen
  ctx2d.fillStyle = '#fff';
  ctx2d.beginPath();
  const ir = bezel * 0.8;
  roundRect(ctx2d, bezel * 0.5, bezel * 0.5, cw - bezel, ch - bezel, ir);
  ctx2d.fill();

  // ── Moving text ──────────────────────────────────────────────────────
  const text = state.texts[state.textIndex];
  const movingMetrics = getMovingTextMetrics(ctx2d, text, s.fontSize, sr);
  const movingFontSize = movingMetrics.fontSize;
  ctx2d.font = `700 ${movingFontSize}px 'Savate', 'Courier New', Courier, sans-serif`;
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'middle';

  // Colour from hue
  const colour = `hsl(${state.hue}, 90%, 60%)`;
  ageTrailPoints();
  recordTrailPoint(text, movingFontSize, s);
  drawMotionTrails(ctx2d);

  ctx2d.shadowBlur = 0;
  ctx2d.fillStyle = colour;
  ctx2d.fillText(text, state.x, state.y);

  // ── Static top/bottom taglines ───────────────────────────────────────
  drawTaglines(ctx2d, sr, s.fontSize);

  // ── Scanlines overlay ────────────────────────────────────────────────
  if (s.scanlines) {
    drawScanlines(ctx2d, cw, ch);
  }

  // ── Vignette overlay ─────────────────────────────────────────────────
  if (s.vignette) {
    drawVignette(ctx2d, cw, ch);
  }
}

/** Increase trail sample age and discard samples that are fully faded out. */
function ageTrailPoints() {
  for (const point of state.trailPoints) point.age++;
  state.trailPoints = state.trailPoints.filter(point => point.age <= TRAIL_LIFE_FRAMES);
  if (state.trailEchoDelay > 0) state.trailEchoDelay--;
}

/** Record the current logo position as a trail sample. */
function recordTrailPoint(text, fontSize, settings) {
  const last = state.trailPoints[state.trailPoints.length - 1];
  const minGap = settings && Number.isFinite(settings.trailGap)
    ? settings.trailGap
    : DEFAULT_TRAIL_GAP;
  const sampleDistance = Math.max(minGap, fontSize * TRAIL_SAMPLE_DISTANCE_RATIO);
  if (state.trailEchoDelay > 0) return;
  if (last && last.text === text && Math.hypot(state.x - last.x, state.y - last.y) < sampleDistance) {
    return;
  }
  state.trailPoints.push({
    x: state.x,
    y: state.y,
    text,
    fontSize,
    hue: state.hue,
    age: 0,
  });
  state.trailEchoDelay = TRAIL_ECHO_DELAY_FRAMES;
}

/** Draw fading trajectory trails from stored historical samples. */
function drawMotionTrails(ctx2d) {
  if (state.trailPoints.length === 0) return;

  ctx2d.save();
  ctx2d.shadowBlur = 0;
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'middle';

  for (const point of state.trailPoints) {
    if (point.age <= 0) continue; // current position is drawn as the main text
    const t = 1 - (point.age / TRAIL_LIFE_FRAMES);
    if (t <= 0) continue;
    const alpha = TRAIL_MAX_ALPHA * t * t;
    if (alpha <= 0.005) continue;
    ctx2d.font = `700 ${point.fontSize}px 'Savate', 'Courier New', Courier, sans-serif`;
    ctx2d.fillStyle = `hsla(${point.hue}, 90%, 45%, ${alpha.toFixed(3)})`;
    ctx2d.fillText(point.text, point.x, point.y);
  }
  ctx2d.restore();
}

/** Draw fixed taglines at the top and bottom of the inner screen area. */
function drawTaglines(ctx2d, screenRect, baseFontSize) {
  const topText = TOP_TAGLINE.toUpperCase();
  const bottomText = BOTTOM_TAGLINE.toUpperCase();
  const maxWidth = screenRect.w * 0.94;
  const minSize = 10;
  let size = Math.max(16, Math.round(baseFontSize * 0.34));

  // Fit both strings on one line using the same font size.
  while (size > minSize) {
    ctx2d.font = `500 ${size}px 'Savate', 'Courier New', Courier, sans-serif`;
    if (
      ctx2d.measureText(topText).width <= maxWidth &&
      ctx2d.measureText(bottomText).width <= maxWidth
    ) {
      break;
    }
    size--;
  }

  const margin = Math.max(8, Math.round(size * 0.4));

  ctx2d.save();
  ctx2d.font = `500 ${size}px 'Savate', 'Courier New', Courier, sans-serif`;
  ctx2d.fillStyle = '#000';
  ctx2d.shadowBlur = 0;
  ctx2d.textAlign = 'center';

  ctx2d.textBaseline = 'top';
  ctx2d.fillText(topText, screenRect.x + screenRect.w / 2, screenRect.y + margin);

  ctx2d.textBaseline = 'bottom';
  ctx2d.fillText(
    bottomText,
    screenRect.x + screenRect.w / 2,
    screenRect.y + screenRect.h - margin
  );
  ctx2d.restore();
}

/** Draw horizontal scanlines over the full canvas. */
function drawScanlines(ctx2d, cw, ch) {
  const lineSpacing = Math.max(2, Math.round(ch / TARGET_SCANLINE_COUNT));
  ctx2d.save();
  ctx2d.globalAlpha = 0.08;
  ctx2d.fillStyle = '#000';
  for (let y = 0; y < ch; y += lineSpacing * 2) {
    ctx2d.fillRect(0, y, cw, lineSpacing);
  }
  ctx2d.restore();
}

/** Draw a radial vignette (dark edges). */
function drawVignette(ctx2d, cw, ch) {
  const cx = cw / 2, cy = ch / 2;
  const r = Math.sqrt(cx * cx + cy * cy);
  const vg = ctx2d.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx2d.save();
  ctx2d.fillStyle = vg;
  ctx2d.fillRect(0, 0, cw, ch);
  ctx2d.restore();
}

/**
 * Polyfill for roundRect path (supported natively in modern browsers,
 * but we inline for safety).
 */
function roundRect(ctx2d, x, y, w, h, r) {
  if (ctx2d.roundRect) {
    ctx2d.roundRect(x, y, w, h, r);
  } else {
    r = Math.min(r, w / 2, h / 2);
    ctx2d.moveTo(x + r, y);
    ctx2d.arcTo(x + w, y, x + w, y + h, r);
    ctx2d.arcTo(x + w, y + h, x, y + h, r);
    ctx2d.arcTo(x, y + h, x, y, r);
    ctx2d.arcTo(x, y, x + w, y, r);
    ctx2d.closePath();
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   11.  ANIMATION LOOP
   ═══════════════════════════════════════════════════════════════════════ */

function tick(ts) {
  if (!state.running) return;

  if (state._lastTs === null) state._lastTs = ts;
  const rawDt = Math.min((ts - state._lastTs) / 1000, 0.1);  // cap at 100 ms
  state._lastTs = ts;

  const s = getSettings();
  stepSimulation(rawDt, ctx, canvas.width, canvas.height, s);
  drawFrame(ctx, canvas.width, canvas.height, s);
  updateDebug();

  state._rafId = requestAnimationFrame(tick);
}

function startAnimation() {
  if (state.running) return;
  state.running = true;
  state._lastTs = null;
  btnStartStop.textContent = '⏸ Pause';
  state._rafId = requestAnimationFrame(tick);
}

function pauseAnimation() {
  state.running = false;
  if (state._rafId) { cancelAnimationFrame(state._rafId); state._rafId = null; }
  btnStartStop.textContent = '▶ Start';
}

/* ═══════════════════════════════════════════════════════════════════════
   12.  DEBUG OVERLAY
   ═══════════════════════════════════════════════════════════════════════ */

function updateDebug() {
  if (debugEl.classList.contains('hidden')) return;
  dbgBounces.textContent = state.bounces;
  dbgIndex.textContent   = state.textIndex;
  dbgText.textContent    = state.texts[state.textIndex];
  dbgPos.textContent     = `${state.x.toFixed(1)}, ${state.y.toFixed(1)}`;
  dbgVel.textContent     = `${state.vx.toFixed(1)}, ${state.vy.toFixed(1)}`;
}

/* ═══════════════════════════════════════════════════════════════════════
   13.  EXPORT HELPERS
   ═══════════════════════════════════════════════════════════════════════ */

/** Parse an export resolution string like "1920x1080" → { w, h }. */
function parseResolution(resStr, previewW, previewH) {
  if (resStr === 'preview') return { w: previewW, h: previewH };
  const parts = resStr.split('x');
  return { w: parseInt(parts[0], 10), h: parseInt(parts[1], 10) };
}

/** Scale simulation position/velocity from preview canvas to export canvas. */
function scaleStateToCanvas(exportW, exportH) {
  const scaleX = exportW / canvas.width;
  const scaleY = exportH / canvas.height;
  return {
    x:  state.x  * scaleX,
    y:  state.y  * scaleY,
    vx: state.vx * scaleX,
    vy: state.vy * scaleY,
  };
}

/** Show / hide the progress bar UI. */
function setExportProgress(current, total) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  progressWrap.classList.add('active');
  progressLabel.textContent = `Exporting… ${current} / ${total} frames`;
  progressFill.style.width = `${pct.toFixed(1)}%`;
}
function hideExportProgress() {
  progressWrap.classList.remove('active');
}

/**
 * Build a filename prefix with timestamp + seed + resolution.
 * @param {string} seed
 * @param {number} w
 * @param {number} h
 * @returns {string}
 */
function exportFilename(seed, w, h) {
  const d = new Date();
  // Format: YYYY-MM-DD_HH-MM-SS
  const ts = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-') + '_' + [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join('-');
  const safeSeed = seed.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `tutudvd_${ts}_seed-${safeSeed}_${w}x${h}`;
}

/* ═══════════════════════════════════════════════════════════════════════
   14.  EXPORT – WebM via MediaRecorder
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Export the animation as a WebM video using canvas.captureStream() + MediaRecorder.
 * Runs deterministically: advances simulation by exact 1/fps timestep per frame,
 * then manually draws each frame onto a dedicated off-screen canvas whose stream
 * is fed to MediaRecorder.
 *
 * Note: MediaRecorder / captureStream are not available in all browsers.
 * Falls back to exportFramesZip() automatically.
 */
async function exportVideoWebM() {
  if (!canvas.captureStream || !window.MediaRecorder) {
    console.warn('MediaRecorder not available – falling back to PNG sequence');
    return exportFramesZip();
  }

  const s = getSettings();
  const { w: expW, h: expH } = parseResolution(s.exportRes, canvas.width, canvas.height);
  const fps = s.fps;
  const totalFrames = Math.round(s.duration * fps);
  const dt = 1 / fps;

  // Scale font size and speed to export canvas
  const scaleX = expW / canvas.width;
  const expFontSize = Math.round(s.fontSize * scaleX);
  const expSpeed = s.speed * scaleX;

  // Off-screen canvas for export
  const expCanvas = document.createElement('canvas');
  expCanvas.width  = expW;
  expCanvas.height = expH;
  const expCtx = expCanvas.getContext('2d');

  // Capture stream
  const stream = expCanvas.captureStream(fps);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_BITRATE });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  recorder.start();

  // Snapshot of current simulation state (so we don't mutate live state)
  const savedState = {
    ...state,
    trailPoints: state.trailPoints.map(point => ({ ...point })),
  };

  // Re-initialise simulation deterministically for export
  state.rng = createRng(s.seed);
  const sr0 = getScreenRect(expW, expH, s.padding);
  const { w: tw0, h: th0 } = getMovingTextMetrics(expCtx, state.texts[0], expFontSize, sr0);
  const minX0 = sr0.x + tw0 / 2;
  const maxX0 = sr0.x + sr0.w - tw0 / 2;
  const minY0 = sr0.y + th0 / 2;
  const maxY0 = sr0.y + sr0.h - th0 / 2;
  state.x  = maxX0 > minX0 ? minX0 + state.rng() * (maxX0 - minX0) : sr0.x + sr0.w / 2;
  state.y  = maxY0 > minY0 ? minY0 + state.rng() * (maxY0 - minY0) : sr0.y + sr0.h / 2;
  const angle0 = (0.3 + state.rng() * 0.9) * Math.PI / 2;
  const q0 = Math.floor(state.rng() * 4);
  state.vx = ((q0 & 1) ? 1 : -1) * Math.cos(angle0) * expSpeed;
  state.vy = ((q0 & 2) ? 1 : -1) * Math.sin(angle0) * expSpeed;
  state.hue = Math.floor(state.rng() * 360);
  state.bounces = 0;
  state.textIndex = 0;
  state.trailPoints = [];
  state.trailEchoDelay = 0;

  // Override font size and speed in settings for export frames
  const expSettings = { ...s, fontSize: expFontSize, speed: expSpeed, trailGap: s.trailGap * scaleX };

  state._exportCancelled = false;
  btnCancelExp.style.display = '';
  btnExport.disabled = true;

  try {
    for (let f = 0; f < totalFrames; f++) {
      if (state._exportCancelled) break;

      // Advance simulation
      stepSimulation(dt, expCtx, expW, expH, expSettings);
      // Draw frame
      drawFrame(expCtx, expW, expH, expSettings);

      // Update progress every 10 frames to stay responsive
      if (f % 10 === 0) {
        setExportProgress(f, totalFrames);
        // Yield to browser
        await new Promise(r => setTimeout(r, 0));
      }
    }
  } finally {
    // Restore live simulation state
    Object.assign(state, savedState);
    state.trailPoints = savedState.trailPoints.map(point => ({ ...point }));
  }

  recorder.stop();

  await new Promise(r => { recorder.onstop = r; });

  const blob = new Blob(chunks, { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${exportFilename(s.seed, expW, expH)}.webm`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  setExportProgress(totalFrames, totalFrames);
  setTimeout(hideExportProgress, 1500);
  btnCancelExp.style.display = 'none';
  btnExport.disabled = false;
}

/* ═══════════════════════════════════════════════════════════════════════
   15.  EXPORT – PNG sequence in ZIP  (JSZip)
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Load JSZip dynamically from CDN.
 * @returns {Promise<JSZip constructor>}
 */
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = window._JSZIP_CDN;
    script.onload  = () => resolve(window.JSZip);
    script.onerror = () => reject(new Error('Failed to load JSZip'));
    document.head.appendChild(script);
  });
}

/**
 * Export the animation as a ZIP of PNG frames.
 * Used when MediaRecorder is unavailable or explicitly requested.
 * Same deterministic approach as exportVideoWebM.
 */
async function exportFramesZip() {
  let JSZip;
  try {
    JSZip = await loadJSZip();
  } catch (err) {
    alert('Could not load JSZip: ' + err.message);
    return;
  }

  const s = getSettings();
  const { w: expW, h: expH } = parseResolution(s.exportRes, canvas.width, canvas.height);
  const fps = s.fps;
  const totalFrames = Math.round(s.duration * fps);
  const dt = 1 / fps;

  const scaleX = expW / canvas.width;
  const expFontSize = Math.round(s.fontSize * scaleX);
  const expSpeed = s.speed * scaleX;

  const expCanvas = document.createElement('canvas');
  expCanvas.width  = expW;
  expCanvas.height = expH;
  const expCtx = expCanvas.getContext('2d');

  // Snapshot + deterministic re-init (same logic as exportVideoWebM)
  const savedState = {
    ...state,
    trailPoints: state.trailPoints.map(point => ({ ...point })),
  };
  state.rng = createRng(s.seed);
  const sr0 = getScreenRect(expW, expH, s.padding);
  const { w: tw0, h: th0 } = getMovingTextMetrics(expCtx, state.texts[0], expFontSize, sr0);
  const minX0 = sr0.x + tw0 / 2;
  const maxX0 = sr0.x + sr0.w - tw0 / 2;
  const minY0 = sr0.y + th0 / 2;
  const maxY0 = sr0.y + sr0.h - th0 / 2;
  state.x  = maxX0 > minX0 ? minX0 + state.rng() * (maxX0 - minX0) : sr0.x + sr0.w / 2;
  state.y  = maxY0 > minY0 ? minY0 + state.rng() * (maxY0 - minY0) : sr0.y + sr0.h / 2;
  const angle0 = (0.3 + state.rng() * 0.9) * Math.PI / 2;
  const q0 = Math.floor(state.rng() * 4);
  state.vx = ((q0 & 1) ? 1 : -1) * Math.cos(angle0) * expSpeed;
  state.vy = ((q0 & 2) ? 1 : -1) * Math.sin(angle0) * expSpeed;
  state.hue = Math.floor(state.rng() * 360);
  state.bounces = 0;
  state.textIndex = 0;
  state.trailPoints = [];
  state.trailEchoDelay = 0;

  const expSettings = { ...s, fontSize: expFontSize, speed: expSpeed, trailGap: s.trailGap * scaleX };
  const zip = new JSZip();
  const folder = zip.folder(exportFilename(s.seed, expW, expH));

  state._exportCancelled = false;
  btnCancelExp.style.display = '';
  btnExport.disabled = true;

  try {
    for (let f = 0; f < totalFrames; f++) {
      if (state._exportCancelled) break;

      stepSimulation(dt, expCtx, expW, expH, expSettings);
      drawFrame(expCtx, expW, expH, expSettings);

      // Add PNG to zip
      const frameNum = String(f).padStart(6, '0');
      const dataUrl = expCanvas.toDataURL('image/png');
      const base64  = dataUrl.split(',')[1];
      folder.file(`frame_${frameNum}.png`, base64, { base64: true });

      if (f % 5 === 0) {
        setExportProgress(f, totalFrames);
        await new Promise(r => setTimeout(r, 0));
      }
    }
  } finally {
    Object.assign(state, savedState);
    state.trailPoints = savedState.trailPoints.map(point => ({ ...point }));
  }

  setExportProgress(totalFrames, totalFrames);
  progressLabel.textContent = 'Zipping…';

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${exportFilename(s.seed, expW, expH)}_frames.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  setTimeout(hideExportProgress, 1500);
  btnCancelExp.style.display = 'none';
  btnExport.disabled = false;
}

/* ═══════════════════════════════════════════════════════════════════════
   16.  EVENT WIRING
   ═══════════════════════════════════════════════════════════════════════ */

// Start / Pause toggle
btnStartStop.addEventListener('click', () => {
  if (state.running) pauseAnimation();
  else               startAnimation();
});

// Reset
btnReset.addEventListener('click', () => {
  pauseAnimation();
  resetSimulation();
  drawFrame(ctx, canvas.width, canvas.height);
  updateDebug();
});

// Export
btnExport.addEventListener('click', async () => {
  const s = getSettings();
  const wasPaused = !state.running;
  pauseAnimation();

  try {
    if (s.format === 'zip') {
      await exportFramesZip();
    } else {
      await exportVideoWebM();
    }
  } catch (err) {
    console.error('Export failed:', err);
    alert('Export failed: ' + err.message);
    hideExportProgress();
    btnCancelExp.style.display = 'none';
    btnExport.disabled = false;
  }

  if (!wasPaused) startAnimation();
});

// Cancel export
btnCancelExp.addEventListener('click', () => {
  state._exportCancelled = true;
  btnCancelExp.style.display = 'none';
  hideExportProgress();
  btnExport.disabled = false;
});

// Load texts
btnLoad.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    await loadTextsFromFile(file);
    alert(`Loaded ${state.texts.length} text(s).`);
  } catch (err) {
    alert('Error loading file: ' + err.message);
  }
  fileInput.value = '';
});

// Debug toggle
chkDebug.addEventListener('change', () => {
  debugEl.classList.toggle('hidden', !chkDebug.checked);
});

// Window resize
window.addEventListener('resize', () => {
  resizeCanvas();
  if (!state.running) drawFrame(ctx, canvas.width, canvas.height);
});

/* ═══════════════════════════════════════════════════════════════════════
   17.  BOOT
   ═══════════════════════════════════════════════════════════════════════ */

async function boot() {
  resizeCanvas();
  try {
    await loadTextsFromDefaultCsv(inpSeed.value || 'tutudvd');
    console.info(`Loaded ${state.texts.length} names from ${DEFAULT_NAMES_CSV}`);
  } catch (err) {
    console.warn(`Could not load ${DEFAULT_NAMES_CSV}, using built-in defaults:`, err);
    state.texts = [...DEFAULT_TEXTS];
    state.textIndex = 0;
  }
  resetSimulation();
  drawFrame(ctx, canvas.width, canvas.height);
}

boot();
