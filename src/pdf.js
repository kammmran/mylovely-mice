/**
 * A small PDF writer, so the session report can be handed to someone who does
 * not have the simulator open.
 *
 * No dependencies, because the rest of this project has none either: a PDF is
 * a text format, and a document that only needs the fourteen standard fonts
 * does not need any of a PDF library. It writes A4 pages of Helvetica with
 * headings, tables and embedded JPEG figures, and breaks pages as needed.
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
  A: .667, B: .667, C: .722, D: .722, E: .667, F: .611, G: .778, H: .722,
  K: .667, L: .556, N: .722, O: .778, P: .667, Q: .778, R: .722, S: .667,
  T: .611, U: .722, V: .667, X: .667, Y: .667, Z: .611,
  a: .556, b: .556, c: .5, d: .556, e: .556, g: .556, h: .556,
  k: .5, n: .556, o: .556, p: .556, q: .556, s: .5, u: .556,
  v: .5, x: .5, y: .5, z: .5,
};
for (const d of '0123456789') WIDTHS[d] = 0.556;
const BOLD_WIDTHS = { ...WIDTHS, A: .722, B: .722, J: .556, K: .722, L: .611,
  W: 1, X: .722, Y: .722, b: .611, c: .556, d: .611, f: .333, g: .611,
  h: .611, i: .278, j: .278, k: .556, l: .278, m: .889, n: .611,
  o: .611, p: .611, q: .611, r: .389, s: .556, t: .333, u: .611,
  v: .556, w: .778, x: .556, y: .556 };

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
    this.images = [];
    this.newPage();
  }

  get width() { return this.size[0] - this.margin * 2; }
  get left() { return this.margin; }
  get right() { return this.size[0] - this.margin; }

  textWidth(s, size, font = 'F1') {
    if (font === 'F3') return ascii(s).length * size * 0.6;
    let w = 0;
    const widths = font === 'F2' ? BOLD_WIDTHS : WIDTHS;
    for (const ch of ascii(s)) w += (widths[ch] !== undefined ? widths[ch] : W_DEFAULT) * size;
    return w;
  }

  wrap(s, width, size, font = 'F1') {
    const lines = []; let line = '';
    for (const word of ascii(s).split(/\s+/).filter(Boolean)) {
      if (line && this.textWidth(`${line} ${word}`, size, font) > width) { lines.push(line); line = ''; }
      for (const char of (line ? ` ${word}` : word)) {
        if (this.textWidth(line + char, size, font) > width && line) { lines.push(line); line = ''; }
        line += char;
      }
    }
    if (line) lines.push(line);
    return lines;
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
    for (const line of this.wrap(s, this.width - indent, size, font)) {
      this.line(line, { size, font, colour, x: this.left + indent, gap });
    }
    return this;
  }

  h1(s) {
    this.room(26);
    this.y -= 6;
    return this.text(s, { size: 17, font: 'F2', colour: [0.08, 0.1, 0.13], gap: 6 });
  }

  h2(s) {
    this.room(60);
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
    const px = x == null ? this.left : x;
    const lines = this.wrap(value, this.right - px - labelW, size, 'F3');
    this.room(Math.max(1, lines.length) * (size + 3));
    this.y -= size;
    this.ops.push(`BT /F1 ${size} Tf 0.45 0.47 0.5 rg 1 0 0 1 ${px.toFixed(1)} ${this.y.toFixed(1)} Tm (${esc(label)}) Tj ET`);
    lines.forEach((line, index) => {
      this.ops.push(`BT /F3 ${size} Tf 0.1 0.12 0.15 rg 1 0 0 1 ${(px + labelW).toFixed(1)} ${(this.y - index * (size + 3)).toFixed(1)} Tm (${esc(line)}) Tj ET`);
    });
    this.y -= Math.max(0, lines.length - 1) * (size + 3);
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
    const columns = widths.map((width) => width / total * this.width);
    const xs = [];
    let acc = this.left;
    for (const w of widths) { xs.push(acc); acc += (w / total) * this.width; }
    const wrap = (value, width) => this.wrap(value, width - 8, size);
    const row = (cells, bold = false) => {
      const lines = cells.map((cell, index) => this.wrap(cell, columns[index] - 8, size, bold ? 'F2' : 'F1'));
      const height = Math.max(...lines.map((cell) => cell.length)) * (size + 3) + 8;
      this.room(height);
      if (bold) this.ops.push(`0.92 0.95 0.96 rg ${this.left} ${(this.y - height).toFixed(1)} ${this.width} ${height.toFixed(1)} re f`);
      lines.forEach((cell, i) => cell.forEach((line, j) => {
        this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf 0.15 0.20 0.24 rg 1 0 0 1 ${(xs[i] + 3).toFixed(1)} ${(this.y - size - 4 - j * (size + 3)).toFixed(1)} Tm (${esc(line)}) Tj ET`);
      }));
      this.y -= height;
    };
    row(headers, true);
    for (const r of rows) {
      const height = Math.max(...r.map((cell, i) => wrap(cell, columns[i]).length)) * (size + 3) + 8;
      if (this.y - height < this.margin + 18) { this.newPage(); row(headers, true); }
      row(r);
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

  /** A print-sized JPEG figure, with a caption kept on the same page. */
  image(figure, { width = this.width, maxHeight = 400 } = {}) {
    if (!figure?.url?.startsWith('data:image/jpeg;base64,')) return this;
    const height = Math.min(maxHeight, width * figure.height / figure.width);
    width = height * figure.width / figure.height;
    this.room(height + 65);
    const bytes = atob(figure.url.split(',')[1]);
    const hex = Array.from(bytes, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('') + '>';
    const name = `Im${this.images.length + 1}`;
    this.images.push({ name, width: figure.width, height: figure.height, hex });
    this.ops.push(`q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${(this.left + (this.width - width) / 2).toFixed(2)} ${(this.y - height).toFixed(2)} cm /${name} Do Q`);
    this.y -= height + 8;
    this.text(figure.caption || figure.title, { size: 8, colour: [0.36, 0.41, 0.46], gap: 2 });
    return this.gap(9);
  }

  /** A compact summary band that also prints clearly in grayscale. */
  metrics(items) {
    this.room(65);
    const width = this.width / items.length;
    items.forEach(([label, value], i) => {
      const x = this.left + i * width;
      this.ops.push(`0.93 0.96 0.96 rg ${x.toFixed(2)} ${(this.y - 58).toFixed(2)} ${(width - 6).toFixed(2)} 58 re f`);
      this.ops.push(`BT /F2 18 Tf 0.06 0.29 0.27 rg 1 0 0 1 ${(x + 10).toFixed(2)} ${(this.y - 26).toFixed(2)} Tm (${esc(value)}) Tj ET`);
      this.ops.push(`BT /F1 8 Tf 0.35 0.41 0.45 rg 1 0 0 1 ${(x + 10).toFixed(2)} ${(this.y - 44).toFixed(2)} Tm (${esc(label)}) Tj ET`);
    });
    this.y -= 67;
    return this;
  }

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
    const imageIds = this.images.map((image) => [image.name, add(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${image.hex.length} >>\nstream\n${image.hex}\nendstream`)]);
    for (const ops of this.pages) {
      const stream = ops.join('\n');
      const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 `
        + `${this.size[0].toFixed(2)} ${this.size[1].toFixed(2)}] /Resources << /Font << `
        + `/F1 ${fontIds.F1} 0 R /F2 ${fontIds.F2} 0 R /F3 ${fontIds.F3} 0 R >> `
        + `/XObject << ${imageIds.map(([name, id]) => `/${name} ${id} 0 R`).join(' ')} >> >> `
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
