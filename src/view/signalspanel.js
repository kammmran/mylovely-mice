/**
 * The electrophysiology panel: everything you would normally read off an
 * electrode and a physiological monitor, computed live from the simulated
 * signals rather than displayed as stored numbers.
 *
 * Where real recorded data exists for a region (Allen Brain Observatory
 * Neuropixels, 99,120 sorted units) the model's own rate is drawn against the
 * recorded distribution, so you can see where it agrees and where it does not.
 */
import { BANDS, spectrum, bandPower, modulationIndex, isiStats } from '../neuro/signals.js';
import { SLOT, INK } from './palette.js';

const N = 1024;                       // FFT window: ~1 s at 1 kHz
const BAND_COLOR = {
  delta: '#5b6b7f', theta: SLOT.spatial, beta: SLOT.motor,
  slowGamma: SLOT.sensory, fastGamma: '#7aa7f0', ripple: SLOT.state,
};

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function fit(cv, h) {
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  const w = cv.clientWidth || 360;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  return cv.getContext('2d');
}

export function mountSignals({ getBrain, getRegion, metrics }) {
  const card = el('div', 'float');
  card.id = 'signals';
  card.style.cssText = 'left:12px;top:104px;width:396px;z-index:30;display:none';
  card.innerHTML = `
    <h5 data-fold><span>signals</span><span class="tw">▾</span></h5>
    <div class="body" id="sig-body"></div>`;
  document.body.appendChild(card);

  const body = card.querySelector('#sig-body');
  body.style.cssText = 'max-height:min(72vh,600px);overflow-y:auto;padding-right:4px';

  const mk = (title, note) => {
    const w = el('div', 'sig-sec');
    w.appendChild(el('div', 'sig-h', `${title}${note ? `<i>${note}</i>` : ''}`));
    body.appendChild(w);
    return w;
  };

  // ---- spectrum ----
  const sSpec = mk('field potential spectrum', '1&ndash;250 Hz, 1 s window');
  const cSpec = el('canvas'); cSpec.style.cssText = 'width:100%;height:84px;display:block';
  sSpec.appendChild(cSpec);
  const specLbl = el('div', 'sig-sub', '');
  sSpec.appendChild(specLbl);

  // ---- band powers ----
  const sBand = mk('band power', 'share of total, log scale');
  const bandRows = {};
  for (const b of BANDS) {
    const r = el('div', 'sig-band');
    r.innerHTML = `<span class="bl">${b.label}</span>
      <span class="bt"><i></i></span><span class="bv">0%</span>`;
    r.title = `${b.lo}–${b.hi} Hz · ${b.note}`;
    r.querySelector('i').style.background = BAND_COLOR[b.key];
    sBand.appendChild(r);
    bandRows[b.key] = { fill: r.querySelector('i'), val: r.querySelector('.bv') };
  }

  // ---- coupling ----
  const sCouple = mk('theta–gamma coupling', 'Tort modulation index');
  const cCouple = el('canvas'); cCouple.style.cssText = 'width:100%;height:54px;display:block';
  sCouple.appendChild(cCouple);
  const coupLbl = el('div', 'sig-sub', '');
  sCouple.appendChild(coupLbl);

  // ---- ISI ----
  const sIsi = mk('inter-spike intervals', '');
  const cIsi = el('canvas'); cIsi.style.cssText = 'width:100%;height:54px;display:block';
  sIsi.appendChild(cIsi);
  const isiLbl = el('div', 'sig-sub', '');
  sIsi.appendChild(isiLbl);

  // ---- model against real recordings ----
  const sReal = mk('model vs recorded', 'Allen Neuropixels');
  const cReal = el('canvas'); cReal.style.cssText = 'width:100%;height:40px;display:block';
  sReal.appendChild(cReal);
  const realLbl = el('div', 'sig-sub', '');
  sReal.appendChild(realLbl);

  // ---- autonomic ----
  const sAuto = mk('body', 'derived from arousal and locomotion');
  const autoRow = el('div', 'sig-auto');
  autoRow.innerHTML = `
    <div><label>heart</label><b id="sig-hr">—</b><i>bpm</i></div>
    <div><label>breathing</label><b id="sig-br">—</b><i>/min</i></div>
    <div><label>pupil</label><b id="sig-pu">—</b><i>mm</i></div>
    <div><label>arousal</label><b id="sig-ar">—</b><i>%</i></div>`;
  sAuto.appendChild(autoRow);

  let acc = 0, lastSpec = null;

  function drawSpectrum(mag, fs, peakHz) {
    const g = fit(cSpec, 84), W = cSpec.width, H = cSpec.height;
    g.fillStyle = '#080c12'; g.fillRect(0, 0, W, H);
    const f2x = (f) => (Math.log10(Math.max(1, f)) / Math.log10(250)) * W;
    // band regions behind the trace
    for (const b of BANDS) {
      g.fillStyle = BAND_COLOR[b.key] + '20';
      g.fillRect(f2x(b.lo), 0, f2x(b.hi) - f2x(b.lo), H);
    }
    let peak = 1e-12;
    for (let i = 1; i < mag.length; i++) if (mag[i] > peak) peak = mag[i];
    g.strokeStyle = INK.primary; g.lineWidth = 1.4; g.beginPath();
    for (let i = 1; i < mag.length; i++) {
      const f = (i * fs) / N;
      if (f > 250) break;
      const y = H - (Math.log10(1 + (mag[i] / peak) * 99) / 2) * H;
      const x = f2x(f);
      i === 1 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
    g.font = `${8 * Math.min(devicePixelRatio || 1, 1.5)}px ui-monospace, monospace`;
    g.fillStyle = INK.muted; g.textAlign = 'center';
    for (const f of [1, 4, 10, 30, 100, 250]) g.fillText(String(f), f2x(f), H - 2);
    specLbl.innerHTML = `peak <b>${peakHz.toFixed(1)} Hz</b> &nbsp;·&nbsp; x-axis log Hz`;
  }

  function drawCoupling(dist, mi) {
    const g = fit(cCouple, 54), W = cCouple.width, H = cCouple.height;
    g.fillStyle = '#080c12'; g.fillRect(0, 0, W, H);
    const n = dist.length, bw = W / (n * 2);
    let mx = 1e-9;
    for (const v of dist) if (v > mx) mx = v;
    // two theta cycles, so the modulation is legible
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < n; i++) {
        const h = (dist[i] / mx) * (H - 14);
        g.fillStyle = SLOT.sensory;
        g.fillRect((c * n + i) * bw, H - h, bw - 1, h);
      }
    }
    g.strokeStyle = 'rgba(217,89,38,0.75)'; g.lineWidth = 1.2; g.beginPath();
    for (let x = 0; x < W; x++) {
      const y = H - 8 - Math.sin((x / W) * Math.PI * 4) * 6;
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    coupLbl.innerHTML = `MI <b>${mi.toFixed(4)}</b> &nbsp;·&nbsp; slow &gamma; amplitude by &theta; phase`;
  }

  function drawIsi(hist, stats, acr) {
    const g = fit(cIsi, 54), W = cIsi.width, H = cIsi.height;
    g.fillStyle = '#080c12'; g.fillRect(0, 0, W, H);
    let mx = 1;
    for (const v of hist) if (v > mx) mx = v;
    const bw = W / hist.length;
    for (let i = 0; i < hist.length; i++) {
      const h = (hist[i] / mx) * (H - 4);
      g.fillStyle = SLOT.spatial;
      g.fillRect(i * bw, H - h, Math.max(1, bw - 1), h);
    }
    isiLbl.innerHTML = stats.n
      ? `${acr} &nbsp; ${stats.n} intervals, 0&ndash;1 s &nbsp;·&nbsp; mean <b>${stats.meanMs.toFixed(0)} ms</b> &nbsp;·&nbsp; CV <b>${stats.cv.toFixed(2)}</b> ${stats.cv > 0.8 ? '(irregular, Poisson-like)' : '(fairly regular)'}`
      : `${acr} &nbsp; not enough spikes yet`;
  }

  function drawReal(acr, modelHz) {
    const g = fit(cReal, 40), W = cReal.width, H = cReal.height;
    g.fillStyle = '#080c12'; g.fillRect(0, 0, W, H);
    const rec = metrics && metrics.regions && metrics.regions[acr];
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    g.font = `${8.5 * dpr}px ui-monospace, monospace`;
    if (!rec) {
      g.fillStyle = INK.muted; g.textAlign = 'center';
      g.fillText('no Neuropixels recordings of this region in the dataset', W / 2, H / 2 + 3);
      realLbl.innerHTML = '';
      return;
    }
    const f = rec.firing_rate_hz;
    const maxHz = Math.max(f.p95, modelHz, 1) * 1.1;
    const x = (v) => (v / maxHz) * (W - 8) + 4;
    const yb = H * 0.56;
    // recorded interquartile range with the median marked
    g.fillStyle = 'rgba(57,135,229,0.3)';
    g.fillRect(x(f.p25), yb - 9, x(f.p75) - x(f.p25), 18);
    g.strokeStyle = SLOT.sensory; g.lineWidth = 2 * dpr;
    g.beginPath(); g.moveTo(x(f.median), yb - 11); g.lineTo(x(f.median), yb + 11); g.stroke();
    // the model's current rate
    g.strokeStyle = SLOT.reward; g.lineWidth = 2 * dpr;
    g.beginPath(); g.moveTo(x(modelHz), yb - 13); g.lineTo(x(modelHz), yb + 13); g.stroke();
    g.fillStyle = SLOT.reward;
    g.beginPath(); g.arc(x(modelHz), yb - 13, 2.6 * dpr, 0, Math.PI * 2); g.fill();
    g.fillStyle = INK.muted; g.textAlign = 'left';
    g.fillText('0', 4, H - 2);
    g.textAlign = 'right';
    g.fillText(`${maxHz.toFixed(0)} Hz`, W - 3, H - 2);
    realLbl.innerHTML =
      `<span style="color:${SLOT.sensory}">recorded</span> median <b>${f.median.toFixed(2)} Hz</b>
       (IQR ${f.p25.toFixed(2)}&ndash;${f.p75.toFixed(2)}, n=${rec.n_units}) &nbsp;·&nbsp;
       <span style="color:${SLOT.reward}">model</span> <b>${modelHz.toFixed(2)} Hz</b>`;
  }

  function update(dt) {
    if (card.style.display === 'none' || card.hasAttribute('data-collapsed')) return;
    acc += dt;
    if (acc < 0.25) return;
    acc = 0;
    const brain = getBrain();
    if (!brain) return;
    const w = brain.lfpWindow(N);
    const mag = spectrum(w.buf, w.start, w.n);
    lastSpec = mag;

    let peakHz = 0, peakV = 0;
    for (let i = 1; i < mag.length; i++) {
      const f = (i * w.fs) / N;
      if (f > 250) break;
      if (mag[i] > peakV) { peakV = mag[i]; peakHz = f; }
    }
    drawSpectrum(mag, w.fs, peakHz);

    let total = 0;
    const powers = {};
    for (const b of BANDS) {
      powers[b.key] = bandPower(mag, w.fs, N, b.lo, b.hi);
      total += powers[b.key];
    }
    for (const b of BANDS) {
      const frac = total > 0 ? powers[b.key] / total : 0;
      // theta outweighs the rest by orders of magnitude while the mouse runs,
      // so the bar is log-scaled (-40 dB to 0) or everything else reads as zero
      const db = 10 * Math.log10(Math.max(frac, 1e-5));
      bandRows[b.key].fill.style.width = `${(Math.max(0, (db + 40) / 40) * 100).toFixed(1)}%`;
      bandRows[b.key].val.textContent = frac >= 0.01 ? `${(frac * 100).toFixed(0)}%` : `${db.toFixed(0)}dB`;
    }

    const { mi, dist } = modulationIndex(w.buf, w.start, w.n, w.fs, [6, 12], [30, 50]);
    drawCoupling(dist, mi);

    const acr = getRegion();
    const pops = brain.byRegion[acr] || [];
    const pop = pops[0];
    if (pop) {
      drawIsi(pop.isiHist, isiStats(pop.isiHist, 10), acr);
      const hz = pops.reduce((a, p) => a + p.smooth, 0) / pops.length;
      drawReal(acr, hz);
    }

    // ---- autonomic ----
    // mouse heart rate 500-740 bpm, respiration 80-230/min at rest and far
    // faster while sniffing, pupil 0.5-2 mm and tracking arousal
    const speedN = Math.min(1, (brain.lastSpeed || 0) / 0.45);
    const stress = Math.min(1, (brain.byKey.pag?.smooth || 0) / 12);
    const arousal = Math.max(0, Math.min(1, 0.2 + 0.55 * speedN + 0.35 * stress));
    document.getElementById('sig-hr').textContent = Math.round(500 + 240 * arousal);
    document.getElementById('sig-br').textContent = Math.round((brain.sniffFreq || 3) * 60);
    document.getElementById('sig-pu').textContent = (0.55 + 1.15 * arousal).toFixed(2);
    document.getElementById('sig-ar').textContent = Math.round(arousal * 100);
  }

  function open(on) {
    card.style.display = on ? '' : 'none';
    if (on) card.removeAttribute('data-collapsed');
  }
  const isOpen = () => card.style.display !== 'none';

  return { update, open, isOpen, card };
}
