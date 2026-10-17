/**
 * Colour parameters, validated with the dataviz skill's checker
 * (scripts/validate_palette.js) against this app's dark surface #0b0f15:
 *
 *   categorical slots 1-5, dark column, adjacent pairlist:
 *     lightness band PASS · chroma floor PASS · CVD sep PASS (worst 8.4 protan)
 *     normal-vision floor PASS (worst 19.3) · contrast vs surface PASS
 *
 * Each system keeps its colour everywhere it appears (bars, raster bands,
 * traces), and every band also carries a text label, so identity is never
 * colour alone. Band order on screen follows the validated slot order.
 */

export const SURFACE = '#0b0f15';

/** one fixed hue per brain system — slot order 1..5 */
export const SLOT = {
  sensory: '#3987e5',   // slot 1 blue
  spatial: '#d95926',   // slot 2 orange
  motor:   '#199e70',   // slot 3 aqua
  reward:  '#c98500',   // slot 4 yellow
  state:   '#d55181',   // slot 5 magenta
};

/** the order bands and legends must appear in for the palette to stay valid */
export const SLOT_ORDER = ['sensory', 'spatial', 'motor', 'reward', 'state'];

export const SYSTEM_LABEL = {
  sensory: 'sensory',
  spatial: 'spatial map',
  motor: 'motor',
  reward: 'reward',
  state: 'internal state',
};

/** sequential, one hue (blue 700->100): firing-rate heatmaps. 0 recedes to the surface. */
export const SEQ_RATE = ['#0d366b', '#184f95', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];

/** sequential, one hue (16 deg spread): the learned value field. */
export const SEQ_VALUE = ['#2e1e00', '#533600', '#7a5000', '#a06a00', '#c98500', '#e0b74c', '#f6e0a8'];

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const STOPS = new WeakMap();

/** sample a ramp at t in [0,1] -> [r,g,b] 0..255 */
export function ramp(stops, t) {
  let rgb = STOPS.get(stops);
  if (!rgb) { rgb = stops.map(hex); STOPS.set(stops, rgb); }
  const k = Math.max(0, Math.min(1, t)) * (rgb.length - 1);
  const i = Math.floor(k), f = k - i;
  const a = rgb[i], b = rgb[Math.min(rgb.length - 1, i + 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function rampCss(stops, t) {
  const [r, g, b] = ramp(stops, t);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

export const INK = { primary: '#e8eef6', secondary: '#9fb2c8', muted: '#64788f', grid: 'rgba(120,150,180,0.14)' };
