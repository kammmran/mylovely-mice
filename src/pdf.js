/**
 * A small PDF writer, so the session report can be handed to someone who does
 * not have the simulator open.
 *
 * No dependencies, because the rest of this project has none either: a PDF is
 * a text format, and a document that only needs the fourteen standard fonts
 * does not need any of a PDF library. It writes A4 pages of Helvetica with
 * headings, key/value rows, tables and rules, keeps a cursor, and breaks the
 * page when it runs out of room.
 *
 * Two constraints the format imposes, both handled here:
 *   - the cross-reference table at the end is a list of byte offsets into the
 *     file, so every object's position has to be known exactly. Output is
 *     therefore ASCII only, which makes string length and byte length the
 *     same thing, and anything else is transliterated on the way in.
 *   - text is drawn, not laid out, so wrapping is done here against a width
 *     table for Helvetica.
 */

const A4 = [595.28, 841.89];

/** Helvetica advance widths, per 1 pt of font size, close enough to wrap on */
const W_DEFAULT = 0.55;
const WIDTHS = {
  ' ': 0.278, '!': 0.278, '"': 0.355, '#': 0.556, '$': 0.556, '%': 0.889, '&': 0.667,
  "'": 0.191, '(': 0.333, ')': 0.333, '*': 0.389, '+': 0.584, ',': 0.278, '-': 0.333,
  '.': 0.278, '/': 0.278, ':': 0.278, ';': 0.278, '<': 0.584, '=': 0.584, '>': 0.584,
  '?': 0.556, '@': 1.015, '[': 0.278, '\\': 0.278, ']': 0.278, '^': 0.469, '_': 0.556,
  '`': 0.333, '{': 0.334, '|': 0.26, '}': 0.334, '~': 0.584,
  f: 0.278, i: 0.222, j: 0.222, l: 0.222, r: 0.333, t: 0.278,
  m: 0.833, w: 0.722, I: 0.278, J: 0.5, M: 0.833, W: 0.944,
};
for (const d of '0123456789') WIDTHS[d] = 0.556;

/** the file is ASCII, so anything else has to become something that is */
const TRANSLIT = {
  '—': '--', '–': '-', '’': "'", '‘': "'", '“': '"', '”': '"',
  '×': 'x', '·': '-', '…': '...', '→': '->', '≤': '<=', '≥': '>=',
  '°': ' deg', 'é': 'e', 'ü': 'u', 'ö': 'o', 'ä': 'a', 'è': 'e',
  '♂': '(m)', '♀': '(f)', ' ': ' ', '•': '-', 'θ': 'theta',
  'μ': 'u', 'α': 'alpha', 'β': 'beta', 'γ': 'gamma',
};
function ascii(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    if (ch.charCodeAt(0) < 128) out += ch;
    else out += (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : '?');
  }
  return out;
}
const esc = (s) => ascii(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

export class Pdf {
  constructor({ title = 'report', author = 'mylovely-mice', margin = 46, size = A4 } = {}) {
    this.title = ascii(title);
    this.author = ascii(author);
    this.size = size;
    this.margin = margin;
    this.pages = [];
    this.ops = null;
    this.y = 0;
    this.footer = null;
    this.newPage();
  }

  get width() { return this.size[0] - this.margin * 2; }
  get left() { return this.margin; }
  get right() { return this.size[0] - this.margin; }

  textWidth(s, size) {
    let w = 0;
    for (const ch of ascii(s)) w += (WIDTHS[ch] !== undefined ? WIDTHS[ch] : W_DEFAULT) * size;
    return w;
  }

  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = this.size[1] - this.margin;
    if (this.pages.length > 1 && this.footer) this.drawFooter();
    return this;
  }

  /** make sure `need` points of vertical room exist, or start a page */
  room(need) {
    if (this.y - need < this.margin + 18) this.newPage();
    return this;
  }

  drawFooter() {
    const n = this.pages.length;
    const s = `${this.footer}  -  page ${n}`;
    this.ops.push('BT /F1 7.5 Tf 0.45 0.45 0.45 rg '
      + `1 0 0 1 ${this.left.toFixed(1)} ${(this.margin - 12).toFixed(1)} Tm (${esc(s)}) Tj ET`);
  }

  /** one line of text at the cursor, no wrapping */
  line(s, { size = 9.5, font = 'F1', colour = [0.12, 0.14, 0.17], x = null, gap = 3 } = {}) {
    this.room(size + gap);
    this.y -= size;
    const px = x == null ? this.left : x;
    this.ops.push(`BT /${font} ${size} Tf ${colour.map((c) => c.toFixed(2)).join(' ')} rg `
      + `1 0 0 1 ${px.toFixed(1)} ${this.y.toFixed(1)} Tm (${esc(s)}) Tj ET`);
    this.y -= gap;
    return this;
  }

  /** wrapped body text */
  text(s, { size = 9.5, font = 'F1', colour = [0.2, 0.22, 0.26], indent = 0, gap = 2.4 } = {}) {
    const max = this.width - indent;
    const words = ascii(s).split(/\s+/).filter(Boolean);
    let cur = '';
    for (const w of words) {
      const probe = cur ? `${cur} ${w}` : w;
      if (this.textWidth(probe, size) > max && cur) {
        this.line(cur, { size, font, colour, x: this.left + indent, gap });
        cur = w;
      } else cur = probe;
    }
    if (cur) this.line(cur, { size, font, colour, x: this.left + indent, gap });
    return this;
  }

  h1(s) {
    this.room(26);
    this.y -= 6;
    return this.line(s, { size: 17, font: 'F2', colour: [0.08, 0.1, 0.13], gap: 6 });
  }

  h2(s) {
    this.room(24);
    this.y -= 9;
    this.line(s, { size: 12, font: 'F2', colour: [0.08, 0.1, 0.13], gap: 4 });
    return this.rule();
  }

  h3(s, right = null) {
    this.room(18);
    this.y -= 5;
    this.line(s, { size: 10.5, font: 'F2', colour: [0.1, 0.12, 0.16], gap: 1.5 });
    if (right) {
      // on the same baseline as the heading, which line() has just moved past
      const baseline = this.y + 1.5;
      const w = this.textWidth(right, 8.5);
      this.ops.push(`BT /F1 8.5 Tf 0.45 0.45 0.45 rg 1 0 0 1 ${(this.right - w).toFixed(1)} `
        + `${baseline.toFixed(1)} Tm (${esc(right)}) Tj ET`);
    }
    return this;
  }

  rule(colour = [0.82, 0.84, 0.87]) {
    this.room(6);
    this.y -= 3;
    this.ops.push(`${colour.map((c) => c.toFixed(2)).join(' ')} RG 0.6 w `
      + `${this.left.toFixed(1)} ${this.y.toFixed(1)} m ${this.right.toFixed(1)} ${this.y.toFixed(1)} l S`);
    this.y -= 4;
    return this;
  }

  gap(h = 6) { this.y -= h; return this; }

  /** a label and a value on one line, label grey, value black */
  kv(label, value, { size = 9, labelW = 112, x = null } = {}) {
    this.room(size + 3);
    this.y -= size;
    const px = x == null ? this.left : x;
    this.ops.push(`BT /F1 ${size} Tf 0.45 0.47 0.5 rg 1 0 0 1 ${px.toFixed(1)} ${this.y.toFixed(1)} Tm (${esc(label)}) Tj ET`);
    this.ops.push(`BT /F3 ${size} Tf 0.1 0.12 0.15 rg 1 0 0 1 ${(px + labelW).toFixed(1)} ${this.y.toFixed(1)} Tm (${esc(value)}) Tj ET`);
    this.y -= 3;
    return this;
  }

  /** several label/value pairs laid out in columns */
  kvGrid(pairs, cols = 2) {
    const colW = this.width / cols;
    for (let i = 0; i < pairs.length; i += cols) {
      const row = pairs.slice(i, i + cols);
      this.room(12);
      this.y -= 9;
      row.forEach(([k, v], j) => {
        const x = this.left + j * colW;
        this.ops.push(`BT /F1 8.5 Tf 0.45 0.47 0.5 rg 1 0 0 1 ${x.toFixed(1)} ${this.y.toFixed(1)} Tm (${esc(k)}) Tj ET`);
        this.ops.push(`BT /F3 8.5 Tf 0.1 0.12 0.15 rg 1 0 0 1 ${(x + colW * 0.52).toFixed(1)} ${this.y.toFixed(1)} Tm (${esc(v)}) Tj ET`);
      });
      this.y -= 3;
    }
    return this;
  }

  /** a table with a header row; widths are fractions of the text column */
  table(headers, rows, widths, { size = 8.5 } = {}) {
    const total = widths.reduce((a, b) => a + b, 0);
    const xs = [];
    let acc = this.left;
    for (const w of widths) { xs.push(acc); acc += (w / total) * this.width; }
    const header = () => {
      this.room(18);
      this.y -= 10;
      headers.forEach((h, i) => {
        this.ops.push(`BT /F2 ${size} Tf 0.4 0.42 0.46 rg 1 0 0 1 ${xs[i].toFixed(1)} ${this.y.toFixed(1)} Tm (${esc(h)}) Tj ET`);
      });
      this.y -= 2;
      this.rule([0.7, 0.72, 0.76]);
    };
    header();
    for (const r of rows) {
      if (this.y - 12 < this.margin + 18) { this.newPage(); header(); }
      this.y -= 10;
      r.forEach((cell, i) => {
        const font = i === 0 ? 'F1' : 'F3';
        this.ops.push(`BT /${font} ${size} Tf 0.15 0.17 0.2 rg 1 0 0 1 ${xs[i].toFixed(1)} ${this.y.toFixed(1)} Tm (${esc(cell)}) Tj ET`);
      });
      this.y -= 2;
    }
    return this;
  }

  bullet(s, { size = 9, indent = 10 } = {}) {
    this.room(size + 4);
    const startY = this.y - size;
    this.ops.push(`BT /F1 ${size} Tf 0.5 0.3 0.4 rg 1 0 0 1 ${this.left.toFixed(1)} ${startY.toFixed(1)} Tm (-) Tj ET`);
    this.text(s, { size, indent, gap: 2.2 });
    return this;
  }

  setFooter(s) { this.footer = ascii(s); if (this.pages.length === 1) this.drawFooter(); return this; }

  // ------------------------------------------------------------------ output
  /** the whole file, as bytes */
  bytes() {
    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };   // 1-based ids

    const catalogId = add(null);          // filled once the page tree id is known
    const pagesId = add(null);
    const fontIds = {
      F1: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
      F2: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
      F3: add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>'),
    };
    const pageIds = [];
    for (const ops of this.pages) {
      const stream = ops.join('\n');
      const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 `
        + `${this.size[0].toFixed(2)} ${this.size[1].toFixed(2)}] /Resources << /Font << `
        + `/F1 ${fontIds.F1} 0 R /F2 ${fontIds.F2} 0 R /F3 ${fontIds.F3} 0 R >> >> `
        + `/Contents ${contentId} 0 R >>`));
    }
    const infoId = add(`<< /Title (${esc(this.title)}) /Producer (${esc(this.author)}) >>`);
    objs[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] `
      + `/Count ${pageIds.length} >>`;

    // assemble, tracking the byte offset of every object for the xref table
    let out = '%PDF-1.4\n';
    const offsets = [0];
    objs.forEach((body, i) => {
      offsets[i + 1] = out.length;
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objs.length; i++) {
      out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n`
      + `startxref\n${xref}\n%%EOF\n`;

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }

  /** hand it to the browser as a download */
  save(filename) {
    const blob = new Blob([this.bytes()], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}
