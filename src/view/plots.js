/**
 * The 2-D panels: scrolling spike raster, LFP and dopamine traces,
 * occupancy-normalised rate maps, and a polar head-direction tuning curve.
 */
import { SLOT, SLOT_ORDER, SEQ_RATE, SEQ_VALUE, ramp, rampCss, INK, SURFACE } from './palette.js';
import { ROLES } from '../neuro/regions.js';

// One source of truth for the 2-D panels' pixel ratio: a draw that scaled its
// geometry by a different ratio than the one the canvas was sized with would
// lay out for a surface of the wrong size.
export const panelDpr = () => Math.min(devicePixelRatio || 1, 1.5);

// Reading clientWidth forces a layout, and resizing a canvas clears it, so the
// measurement is throttled rather than taken on every draw.
const _fitAt = new WeakMap();
function fitCanvas(cv) {
  const now = performance.now();
  if ((now - (_fitAt.get(cv) || -1e9)) < 500) return false;
  _fitAt.set(cv, now);
  const w = cv.clientWidth, h = cv.clientHeight;
  const dpr = panelDpr();
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    return true;
  }
  return false;
}

// ---------------------------------------------- which cells become the rows
/**
 * Sampling a population at an even stride only says something when its cells
 * are interchangeable. A sparse or tuned code has to be sampled *and ordered*
 * by what the cells are tuned to, or the band reads as noise: `wall = i % 4`
 * sampled at stride 4 picked wall 0 four times over, so the whole subicular
 * band only ever fired along +x, and the three grid modules arrived shuffled.
 */
const spread = (idx, k) => Array.from({ length: k },
  (_, i) => idx[Math.min(idx.length - 1, Math.floor(((i + 0.5) * idx.length) / k))]);

const orderBy = (cells, f) => cells.map((c, i) => i).sort((a, b) => f(cells[a]) - f(cells[b]));

/** keep each tuning class as its own block of rows, so blocks can be compared */
const blocks = (cells, k, classOf, within) => {
  const g = new Map();
  for (const i of orderBy(cells, within)) {
    const c = classOf(cells[i]);
    if (!g.has(c)) g.set(c, []);
    g.get(c).push(i);
  }
  const keys = [...g.keys()].sort((a, b) => a - b);
  const out = [];
  keys.forEach((c, j) => out.push(...spread(g.get(c), Math.floor(k / keys.length) + (j < k % keys.length ? 1 : 0))));
  return out;
};

const ROW_ORDER = {
  // fields ordered along +x, so crossing the arena sweeps the band diagonally
  place: (cells, k) => spread(orderBy(cells, (c) => c.cx), k),
  ca3: (cells, k) => spread(orderBy(cells, (c) => c.cx), k),
  // one block per module, each ordered by spatial phase: three visibly
  // different periodicities over the same run
  grid: (cells, k) => blocks(cells, k, (c) => c.mod, (c) => Math.atan2(c.oz, c.ox)),
  // preferred direction, so the HD bump walks down the band as the mouse turns
  hd: (cells, k) => spread(orderBy(cells, (c) => c.pref), k),
  // one block per wall, ordered by preferred distance from it
  border: (cells, k) => blocks(cells, k, (c) => c.wall, (c) => c.d0),
};

// ============================================================ spike raster
/**
 * Rows are grouped into labelled bands, one band per population, in the
 * validated slot order; within a band they are ordered by tuning (see
 * ROW_ORDER). The plot area scrolls by blitting itself leftward, by however
 * many pixels the elapsed time is worth, so the x axis is real time and not
 * frames: a fixed `window` of seconds always spans the plot, and the ruler
 * lines really are one second apart whatever the frame rate.
 */
export class Raster {
  constructor(canvas, legendEl) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.gutter = 58;
    this.window = 30;                // seconds of history across the plot area
    // Rows are a fixed budget: the panel is ~170 css px tall, so one row more
    // somewhere is one row less elsewhere. The sparse, tuned populations are
    // the ones worth rows -- a band of interchangeable cells says the same
    // thing with three rows as with six -- so they are funded out of the
    // homogeneous sensory and motor bands rather than out of row height.
    this.bands = [
      ['mob', 'MOB', 4], ['whisk', 'SSp-bfd', 3], ['v1', 'VISp', 3],
      ['place', 'CA1', 12], ['grid', 'ENTm', 10], ['hd', 'POST', 8], ['border', 'SUB', 8], ['ca3', 'CA3', 4],
      ['mop', 'MOp', 4], ['mos', 'MOs', 3], ['cb', 'CB', 3],
      ['vta', 'VTA', 4], ['acb', 'ACB', 3],
      ['arh', 'ARH', 3], ['lha', 'LHA', 3],
    ];
    this.totalRows = this.bands.reduce((a, b) => a + b[2], 0);
    // spikes seen since the last column was committed, so that nothing is
    // dropped on frames too short to advance the plot by a whole pixel
    this.pend = new Uint8Array(this.totalRows);
    this.rowCell = null;             // flat row -> cell index, per bound brain
    this.colors = null;
    this.boundTo = null;
    this.tAcc = 0;                   // time not yet converted into pixels
    this.secAcc = 0;                 // time since the last ruler tick
    this.secCount = 0;
    if (legendEl) {
      legendEl.innerHTML = SLOT_ORDER
        .map((k) => `<i><s style="background:${SLOT[k]}"></s>${k}</i>`)
        .join('') + `<i style="color:${INK.muted}">${this.window} s · ticks 1 s / 5 s</i>`;
    }
  }

  /** resolve the rows of every band from this brain's own tuning */
  bind(brain) {
    // the two animals are seeded differently, so their fields, grid phases and
    // preferred directions differ: rows have to be rebound when the panel
    // follows the other mouse, or it would draw its spikes in the first
    // mouse's order. The history belongs to that animal too, so it goes.
    this.boundTo = brain;
    this.clear();
    this.rowCell = new Int16Array(this.totalRows);
    this.colors = [];
    let row = 0;
    for (const [key, , count] of this.bands) {
      const p = brain.byKey[key];
      this.colors.push(SLOT[ROLES[p.region]?.group || 'spatial']);
      const order = ROW_ORDER[key];
      const cells = order && p.cells.length === p.n
        ? order(p.cells, count)
        : spread(Array.from({ length: p.n }, (_, i) => i), count);
      for (let i = 0; i < count; i++) this.rowCell[row++] = cells[i];
    }
  }

  layout() {
    const dpr = panelDpr();
    const W = this.cv.width, H = this.cv.height;
    const pad = 3 * dpr;
    const gut = this.gutter * dpr;
    const cur = Math.max(1, Math.round(dpr));      // the "now" edge, never scrolled
    const avail = H - pad * 2;
    const gapTotal = (this.bands.length - 1) * 1.2 * dpr;
    const rowH = (avail - gapTotal) / this.totalRows;
    return { W, H, pad, gut, cur, rowH, dpr, gap: 1.2 * dpr };
  }

  /** @param {Brain} brain */
  draw(brain, dt) {
    if (fitCanvas(this.cv)) this.clear();
    const g = this.ctx;
    const { W, H, pad, gut, cur, rowH, dpr, gap } = this.layout();
    const step = Math.max(1, Math.round(dpr));
    const dataW = W - gut - cur;
    if (dataW <= step) return;
    if (this.boundTo !== brain) this.bind(brain);

    // ---- collect this frame's spikes into the pending column ----
    let row = 0;
    for (const [key, , count] of this.bands) {
      const sp = brain.byKey[key].spikes;
      for (let i = 0; i < count; i++, row++) if (sp[this.rowCell[row]]) this.pend[row] = 1;
    }

    // ---- advance the time axis by however much real time has passed ----
    const pps = dataW / this.window;               // device px per second
    this.tAcc += dt;
    this.secAcc += dt;
    const adv = Math.floor(this.tAcc * pps);
    if (adv < 1) return;                           // too soon to commit a column
    this.tAcc -= adv / pps;

    const shift = Math.min(adv, dataW - step);
    g.drawImage(this.cv, gut + shift, 0, dataW - shift, H, gut, 0, dataW - shift, H);
    const x0 = W - cur - shift;
    g.fillStyle = SURFACE;
    g.fillRect(x0, 0, shift, H);

    // ruler, placed where the second actually fell; every fifth one carries
    // the eye across a 30 s plot, so intervals can still be read off it
    if (this.secAcc >= 1) {
      const tx = Math.max(x0, Math.min(W - cur - step, W - cur - Math.round((this.secAcc - 1) * pps)));
      this.secAcc -= 1;
      this.secCount = (this.secCount + 1) % 5;
      g.fillStyle = this.secCount === 0 ? 'rgba(120,150,180,0.34)' : INK.grid;
      g.fillRect(tx, pad, step, H - pad * 2);
    }

    // ---- the pending spikes ----
    // a mark never falls below ~1.5 css px, or at this scale a single spike
    // would be a sub-pixel sliver; it is drawn ending at the now edge, so it
    // reaches back over the slice it belongs to rather than past it
    const markW = Math.max(shift, Math.round(1.5 * dpr));
    const mx = Math.max(gut, W - cur - markW);
    const markH = Math.max(1, rowH * 0.86);
    row = 0;
    let y = pad;
    for (let b = 0; b < this.bands.length; b++) {
      const count = this.bands[b][2];
      g.fillStyle = this.colors[b];
      for (let i = 0; i < count; i++, row++) {
        if (this.pend[row]) {
          g.fillRect(mx, y + i * rowH, markW, markH);
          this.pend[row] = 0;
        }
      }
      y += count * rowH + gap;
    }

    // ---- gutter: labels and band separators, repainted every frame ----
    g.fillStyle = SURFACE;
    g.fillRect(0, 0, gut, H);
    y = pad;
    g.textBaseline = 'middle';
    g.textAlign = 'right';
    g.font = `${7.6 * dpr}px ui-monospace, monospace`;
    for (let b = 0; b < this.bands.length; b++) {
      const [, label, count] = this.bands[b];
      const bh = count * rowH;
      // colour chip + direct label, so the band is identified without colour
      g.fillStyle = this.colors[b];
      g.fillRect(gut - 4 * dpr, y, 2.5 * dpr, bh);
      g.fillStyle = INK.secondary;
      g.fillText(label, gut - 7 * dpr, y + bh / 2);
      y += bh + gap;
    }
    // the "now" edge sits outside the scrolled strip, so it never smears
    // across the history the way a cursor drawn into the plot would
    g.fillStyle = 'rgba(232,238,246,0.55)';
    g.fillRect(W - cur, 0, cur, H);
  }

  clear() {
    const g = this.ctx;
    g.fillStyle = SURFACE;
    g.fillRect(0, 0, this.cv.width, this.cv.height);
    this.pend.fill(0);
    this.tAcc = 0;
    this.secAcc = 0;
  }
}

// ============================================================ scrolling trace
/** A ring-buffer line plot. Several stacked tracks share one time axis — never
 *  two y-scales on one pair of axes. */
export class Trace {
  constructor(canvas, tracks, { window = 7 } = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.tracks = tracks;            // [{label, color, min, max, get, baseline?, dash?}]
    this.N = 520;
    this.window = window;
    this.buf = tracks.map(() => new Float32Array(this.N));
    this.flags = new Uint8Array(this.N);
    this.i = 0;
    this.acc = 0;
  }

  push(brain, dt) {
    this.acc += dt;
    const period = this.window / this.N;
    while (this.acc >= period) {
      this.acc -= period;
      const i = this.i % this.N;
      for (let k = 0; k < this.tracks.length; k++) this.buf[k][i] = this.tracks[k].get(brain);
      this.flags[i] = brain.ripple.active ? 1 : 0;
      this.i++;
    }
  }

  draw() {
    fitCanvas(this.cv);
    const g = this.ctx, W = this.cv.width, H = this.cv.height;
    const dpr = panelDpr();
    g.fillStyle = '#0b0f15';
    g.fillRect(0, 0, W, H);

    const n = this.tracks.length;
    const padL = 30 * dpr, padR = 2 * dpr, padV = 2 * dpr;
    const th = (H - padV * 2) / n;
    const plotW = W - padL - padR;
    const count = Math.min(this.i, this.N);
    const start = this.i - count;

    for (let k = 0; k < n; k++) {
      const tr = this.tracks[k];
      const top = padV + k * th;
      const h = th - 2 * dpr;
      const y = (v) => top + h - ((v - tr.min) / (tr.max - tr.min)) * h;

      // ripple shading (annotation, labelled below)
      if (tr.shadeRipple) {
        g.fillStyle = 'rgba(213,81,129,0.26)';
        for (let j = 0; j < count; j++) {
          if (this.flags[(start + j) % this.N]) {
            g.fillRect(padL + (j / this.N) * plotW, top, Math.max(1, plotW / this.N + 1), h);
          }
        }
      }

      // recessive baseline
      if (tr.baseline !== undefined) {
        g.strokeStyle = INK.grid;
        g.lineWidth = 1 * dpr;
        g.setLineDash([3 * dpr, 3 * dpr]);
        g.beginPath(); g.moveTo(padL, y(tr.baseline)); g.lineTo(W - padR, y(tr.baseline)); g.stroke();
        g.setLineDash([]);
      }

      // the series
      g.strokeStyle = tr.color;
      g.lineWidth = 2 * dpr;
      g.lineJoin = 'round';
      g.beginPath();
      for (let j = 0; j < count; j++) {
        const v = this.buf[k][(start + j) % this.N];
        const px = padL + (j / this.N) * plotW;
        const py = y(Math.max(tr.min, Math.min(tr.max, v)));
        j ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.stroke();

      // direct label — one series per track, so no legend box is needed
      g.font = `${8 * dpr}px ui-monospace, monospace`;
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.fillStyle = INK.muted;
      g.fillText(tr.label, 2 * dpr, top + 1 * dpr);
      if (tr.maxLabel) {
        g.textBaseline = 'bottom';
        g.fillText(tr.maxLabel, 2 * dpr, top + h);
      }
    }
  }
}

// ============================================================ rate map
/**
 * Occupancy-normalised firing-rate map, the standard way a place or grid cell
 * is shown. Sequential one-hue ramp; unvisited bins stay surface-dark.
 */
export function drawRateMap(canvas, field, { peakOverride } = {}) {
  fitCanvas(canvas);
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const B = field.bins;
  const peak = Math.max(peakOverride ?? field.peak, 0.4);

  const off = drawRateMap._off ||= document.createElement('canvas');
  off.width = off.height = B;
  const og = off.getContext('2d');
  const img = og.createImageData(B, B);
  for (let i = 0; i < B * B; i++) {
    const v = field.data[i];
    let r, gg, b, a;
    if (v < 0) { r = 18; gg = 24; b = 32; a = 255; }          // never visited
    else {
      const t = Math.min(1, v / peak);
      [r, gg, b] = ramp(SEQ_RATE, t);
      a = 255;
    }
    img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a;
  }
  og.putImageData(img, 0, 0);

  g.fillStyle = '#12181f';
  g.fillRect(0, 0, W, H);
  g.imageSmoothingEnabled = true;
  // +z (north) up and +x to the left, so the map matches the overhead camera
  g.save();
  g.translate(W, H);
  g.scale(-1, -1);
  g.drawImage(off, 0, 0, W, H);
  g.restore();

  // colour bar along the bottom edge
  const dpr = panelDpr();
  const bh = 3 * dpr;
  for (let x = 0; x < W; x++) {
    g.fillStyle = rampCss(SEQ_RATE, x / W);
    g.fillRect(x, H - bh, 1, bh);
  }
}

// ============================================================ polar tuning
/** Head-direction tuning: one series, so the title names it and no legend is used. */
export function drawPolar(canvas, tuning, cells, cellIdx, heading, decoded) {
  fitCanvas(canvas);
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const dpr = panelDpr();
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.41;
  g.fillStyle = '#12181f';
  g.fillRect(0, 0, W, H);

  // recessive polar grid
  g.strokeStyle = INK.grid;
  g.lineWidth = 1 * dpr;
  for (const f of [0.5, 1]) {
    g.beginPath(); g.arc(cx, cy, R * f, 0, Math.PI * 2); g.stroke();
  }
  g.beginPath(); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R);
  g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.stroke();

  const peak = Math.max(tuning.peak, 1);
  const N = tuning.bins;
  // screen: angle 0 (+z, "north") points up, clockwise with heading
  const pt = (ang, r) => [cx - Math.sin(ang) * r, cy - Math.cos(ang) * r];

  g.beginPath();
  for (let i = 0; i <= N; i++) {
    const k = i % N;
    const ang = (k / N) * Math.PI * 2;
    const r = R * Math.min(1, tuning.data[k] / peak);
    const [x, y] = pt(ang, r);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();
  g.fillStyle = 'rgba(217,89,38,0.3)';
  g.fill();
  g.strokeStyle = SLOT.spatial;
  g.lineWidth = 2 * dpr;
  g.stroke();

  // the cell's underlying preferred direction
  if (cells && cells[cellIdx]) {
    const [x, y] = pt(cells[cellIdx].pref, R);
    g.strokeStyle = 'rgba(232,238,246,0.3)';
    g.lineWidth = 1 * dpr;
    g.setLineDash([2 * dpr, 3 * dpr]);
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke();
    g.setLineDash([]);
  }

  // where the mouse is actually facing, and where the population says it faces
  const arrow = (ang, col, len, wid) => {
    const [x, y] = pt(ang, len);
    g.strokeStyle = col; g.lineWidth = wid * dpr;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke();
    g.fillStyle = col;
    g.beginPath(); g.arc(x, y, 2.4 * dpr, 0, Math.PI * 2); g.fill();
  };
  if (decoded !== undefined) arrow(decoded, 'rgba(159,178,200,0.75)', R * 0.78, 1.5);
  arrow(heading, INK.primary, R * 0.56, 2);

  g.font = `${7.5 * dpr}px ui-monospace, monospace`;
  g.fillStyle = INK.muted;
  g.textAlign = 'center';
  g.fillText('N', cx, 8 * dpr);
}

export { SLOT };
