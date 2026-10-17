/**
 * Signal processing for the electrophysiology panel.
 *
 * Everything here operates on the simulated local field potential the same way
 * an electrophysiologist would treat a real recording: window it, take its
 * spectrum, measure power in the standard bands, and quantify theta-gamma
 * phase-amplitude coupling by Tort's modulation index.
 *
 * Band edges follow common rodent practice; they are conventions, not constants,
 * and papers differ at the margins.
 *   delta 1-4, theta 6-12, beta 15-30, slow gamma 30-50,
 *   fast gamma 60-100, ripple 150-250 Hz
 * Buzsaki & Draguhn 2004; Colgin 2016; Tort et al. 2010 (modulation index).
 */

export const BANDS = [
  { key: 'delta', label: 'delta', lo: 1, hi: 4, note: 'slow-wave, seen when the mouse is still' },
  { key: 'theta', label: 'theta', lo: 6, hi: 12, note: 'running rhythm; speeds up with locomotion' },
  { key: 'beta', label: 'beta', lo: 15, hi: 30, note: 'odour sampling and sensorimotor' },
  { key: 'slowGamma', label: 'slow γ', lo: 30, hi: 50, note: 'CA3 input to CA1' },
  { key: 'fastGamma', label: 'fast γ', lo: 60, hi: 100, note: 'entorhinal input to CA1' },
  { key: 'ripple', label: 'ripple', lo: 150, hi: 250, note: 'sharp-wave ripples, only during immobility' },
];

// ---------------------------------------------------------------- FFT
/** in-place iterative radix-2 Cooley-Tukey; n must be a power of two */
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2], bi = im[i + k + len / 2];
        const tr = br * cr - bi * ci, ti = br * ci + bi * cr;
        re[i + k] = ar + tr; im[i + k] = ai + ti;
        re[i + k + len / 2] = ar - tr; im[i + k + len / 2] = ai - ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** Hann-windowed power spectrum. Returns magnitudes for bins 0..n/2. */
export function spectrum(buf, start, n, out) {
  const re = out?.re || new Float64Array(n);
  const im = out?.im || new Float64Array(n);
  const L = buf.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += buf[(start + i) % L];
  mean /= n;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));   // Hann
    re[i] = (buf[(start + i) % L] - mean) * w;
    im[i] = 0;
  }
  fft(re, im);
  const half = n >> 1;
  const mag = out?.mag || new Float64Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]) / n;
  return mag;
}

/** summed power between two frequencies */
export function bandPower(mag, fs, n, lo, hi) {
  const a = Math.max(1, Math.round((lo * n) / fs));
  const b = Math.min(mag.length - 1, Math.round((hi * n) / fs));
  let p = 0;
  for (let i = a; i <= b; i++) p += mag[i] * mag[i];
  return p;
}

// ---------------------------------------------------------------- Hilbert
/**
 * Band-pass by masking in the frequency domain, then take the analytic signal,
 * giving instantaneous phase and amplitude — the standard way to get a phase
 * series for coupling analysis.
 */
export function analytic(buf, start, n, fs, lo, hi) {
  const re = new Float64Array(n), im = new Float64Array(n);
  const L = buf.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += buf[(start + i) % L];
  mean /= n;
  for (let i = 0; i < n; i++) { re[i] = buf[(start + i) % L] - mean; im[i] = 0; }
  fft(re, im);
  const a = Math.max(1, Math.round((lo * n) / fs));
  const b = Math.min((n >> 1) - 1, Math.round((hi * n) / fs));
  for (let i = 0; i < n; i++) {
    const keep = i >= a && i <= b;
    if (!keep) { re[i] = 0; im[i] = 0; }
    else if (i > 0 && i < n / 2) { re[i] *= 2; im[i] *= 2; }   // analytic signal
  }
  fft(re, im, true);
  return { re, im };
}

/**
 * Tort et al. (2010) modulation index: how unevenly the amplitude of a fast
 * rhythm is distributed across the phase of a slow one. 0 = no coupling.
 */
export function modulationIndex(buf, start, n, fs, phaseBand, ampBand, nbins = 18) {
  const ph = analytic(buf, start, n, fs, phaseBand[0], phaseBand[1]);
  const am = analytic(buf, start, n, fs, ampBand[0], ampBand[1]);
  const sums = new Float64Array(nbins), counts = new Float64Array(nbins);
  for (let i = 0; i < n; i++) {
    let p = Math.atan2(ph.im[i], ph.re[i]) + Math.PI;        // 0..2pi
    let bin = Math.floor((p / (2 * Math.PI)) * nbins);
    if (bin < 0) bin = 0; else if (bin >= nbins) bin = nbins - 1;
    sums[bin] += Math.hypot(am.re[i], am.im[i]);
    counts[bin]++;
  }
  const dist = new Float64Array(nbins);
  let total = 0;
  for (let i = 0; i < nbins; i++) {
    dist[i] = counts[i] ? sums[i] / counts[i] : 0;
    total += dist[i];
  }
  if (total <= 0) return { mi: 0, dist };
  let h = 0;
  for (let i = 0; i < nbins; i++) {
    dist[i] /= total;
    if (dist[i] > 0) h -= dist[i] * Math.log(dist[i]);
  }
  return { mi: (Math.log(nbins) - h) / Math.log(nbins), dist };
}

// ---------------------------------------------------------------- spike stats
/** coefficient of variation of the inter-spike intervals held in a histogram */
export function isiStats(hist, binMs) {
  let n = 0, s = 0, s2 = 0;
  for (let i = 0; i < hist.length; i++) {
    const c = hist[i];
    if (!c) continue;
    const t = (i + 0.5) * binMs;
    n += c; s += c * t; s2 += c * t * t;
  }
  if (n < 2) return { n: 0, meanMs: 0, cv: 0 };
  const mean = s / n;
  const varr = Math.max(0, s2 / n - mean * mean);
  return { n, meanMs: mean, cv: mean > 0 ? Math.sqrt(varr) / mean : 0 };
}
