/** Figures are drawn from captured simulation data, at a size suitable for PDF. */
const C = { ink: '#182f3b', muted: '#5d737e', grid: '#dce6e9', teal: '#168979', blue: '#3e79c5', orange: '#c77c31' };

function surface(title, height = 520) {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = height;
  const g = canvas.getContext('2d');
  g.fillStyle = '#f6f9fa'; g.fillRect(0, 0, canvas.width, height);
  g.fillStyle = C.ink; g.font = '600 25px system-ui, sans-serif';
  g.fillText(title, 28, 43);
  g.font = '19px system-ui, sans-serif';
  return { canvas, g };
}

function figure(canvas, title, caption) {
  return { title, caption, width: canvas.width, height: canvas.height,
    url: canvas.toDataURL('image/jpeg', 0.92) };
}

export function canvasFigure(source, title, caption) {
  if (!source?.width || !source?.height) return null;
  const { canvas, g } = surface(title, 650);
  g.fillStyle = '#101b26'; g.fillRect(24, 65, 952, 560);
  const scale = Math.min(952 / source.width, 560 / source.height);
  const width = source.width * scale, height = source.height * scale;
  g.drawImage(source, 24 + (952 - width) / 2, 65 + (560 - height) / 2, width, height);
  return figure(canvas, title, caption);
}

function bars(title, rows, caption, { percent = false } = {}) {
  const { canvas, g } = surface(title, Math.max(330, 100 + rows.length * 43));
  const max = percent ? 100 : Math.max(1, ...rows.map((row) => row.value));
  const left = 280, right = 920, top = 80, width = right - left;
  g.lineWidth = 1;
  for (let tick = 0; tick <= 4; tick++) {
    const x = left + tick / 4 * width;
    g.strokeStyle = C.grid; g.beginPath(); g.moveTo(x, top - 15); g.lineTo(x, canvas.height - 35); g.stroke();
  }
  for (const [i, row] of rows.entries()) {
    const y = top + i * 43;
    g.fillStyle = C.ink; g.textAlign = 'left'; g.fillText(row.label, 28, y + 18, 235);
    g.fillStyle = '#e3ecee'; g.fillRect(left, y, width, 27);
    g.fillStyle = row.color || C.teal; g.fillRect(left, y, Math.max(0, row.value) / max * width, 27);
    g.fillStyle = C.ink; g.textAlign = 'right'; g.fillText(`${row.value}${percent ? '%' : ''}`, 973, y + 20);
  }
  g.textAlign = 'left';
  return figure(canvas, title, caption);
}

export function colonyFigures(d, mice) {
  const figures = [bars('Population by cage', d.grid.boxes.map((box) =>
    ({ label: box.cond.name, value: box.population })), 'Living mice in each cage at the snapshot. Counts describe the whole colony.')];
  if (mice.length) {
    const groups = [['Good · 80–100%', 0, C.teal], ['Reduced · 50–79%', 0, C.orange], ['Low · below 50%', 0, '#c65a6c'], ['Died', 0, '#687887']];
    for (const mouse of mice) groups[mouse.dead ? 3 : mouse.condition >= 0.8 ? 0 : mouse.condition >= 0.5 ? 1 : 2][1]++;
    figures.push(bars('Condition of selected mice', groups.map(([label, value, color]) => ({ label, value, color })),
      `${mice.length} selected mice, grouped by model body condition. “Died” is counted separately.`));
  }
  return figures;
}

export function neuralFigures(d) {
  const mouse = d.mice.find((m) => m.name === d.observedMouse);
  if (!mouse) return [];
  const figures = [bars(`Regional activity · ${mouse.name}`, [...mouse.brain.regions].sort((a, b) => b.hz - a.hz).slice(0, 10)
    .map((region) => ({ label: region.acr, value: +region.hz.toFixed(1), color: C.blue })),
    `Ten most active modeled regions for ${mouse.name}. Values are mean display-smoothed firing rates in Hz at the snapshot.`)];
  const tracks = (d.signalTracks || []).filter((track) => track.values.length >= 2);
  if (!tracks.length) return figures;
  const { canvas, g } = surface(`Recorded signals · ${mouse.name}`, 760);
  for (const [i, track] of tracks.entries()) {
    const x0 = 95, x1 = 964, y0 = 105 + i * 215, height = 140;
    const min = Math.min(track.min, ...track.values);
    const max = Math.max(track.max, ...track.values.map((value) => value * 1.05));
    const y = (value) => y0 + height * (1 - (value - min) / (max - min));
    g.fillStyle = C.ink; g.font = '600 19px system-ui, sans-serif'; g.fillText(`${track.label} · ${track.unit}`, x0, y0 - 16);
    g.font = '17px system-ui, sans-serif';
    for (let step = 0; step <= 2; step++) {
      const value = min + (max - min) * step / 2;
      const py = y(value);
      g.strokeStyle = C.grid; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, py); g.lineTo(x1, py); g.stroke();
      g.fillStyle = C.muted; g.textAlign = 'right'; g.fillText(value.toFixed(1), x0 - 12, py + 5);
    }
    const duration = (track.values.length - 1) * track.period;
    g.fillStyle = C.muted;
    g.textAlign = 'left'; g.fillText(`−${duration.toFixed(1)} s`, x0, y0 + height + 26);
    g.textAlign = 'right'; g.fillText('snapshot', x1, y0 + height + 26);
    g.textAlign = 'left';
    g.strokeStyle = [C.teal, C.orange, C.blue][i % 3]; g.lineWidth = 2.5; g.beginPath();
    track.values.forEach((value, j) => {
      const x = x0 + j / (track.values.length - 1) * (x1 - x0);
      const py = y(value);
      j ? g.lineTo(x, py) : g.moveTo(x, py);
    });
    g.stroke();
  }
  figures.push(figure(canvas, `Recorded signals · ${mouse.name}`,
    `Recent display samples of CA1 local field potential (model units), VTA dopamine firing (Hz), and normalized learned value V(s). Each track has its own labeled scale and time window; time runs left to right.`));
  return figures;
}
