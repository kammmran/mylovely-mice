export const WORLD_SETTINGS_KEY = 'mlm-world-v1';
export const DEFAULT_WORLD = { cages: 9, micePerCage: null, mutationRate: .01 };

export function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a whole number of at least 1.`);
  return number;
}
export function validateWorldSettings(value = {}) {
  const cages = positiveInteger(value.cages ?? 9, 'Cage count');
  const micePerCage = value.micePerCage === '' || value.micePerCage == null ? null : positiveInteger(value.micePerCage, 'Mice per cage');
  const mutationRate = Number(value.mutationRate ?? .01);
  if (!Number.isFinite(mutationRate) || mutationRate < 0 || mutationRate > 1) throw new Error('Mutation probability must be between 0% and 100%.');
  return { cages, micePerCage, mutationRate };
}
export function readWorldSettings(storage) {
  try { return validateWorldSettings(JSON.parse(storage.getItem(WORLD_SETTINGS_KEY) || '{}')); }
  catch { return { ...DEFAULT_WORLD }; }
}
export function cageLayout(count) {
  count = positiveInteger(count, 'Cage count');
  const columns = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / columns);
  const centerRow = Math.floor((rows - 1) / 2), centerCol = Math.floor((columns - 1) / 2);
  const centre = centerRow * columns + centerCol;
  const defaults = ['dry', 'bright', 'hungry', 'males', 'control', 'rich', 'crowded', 'predator', 'noisy'];
  const cycle = ['dry', 'bright', 'hungry', 'males', 'rich', 'crowded', 'predator', 'noisy'];
  return { columns, rows, centre, cells: Array.from({ length: count }, (_, id) => ({
    id, row: Math.floor(id / columns), col: id % columns,
    key: count === 9 ? defaults[id] : id === centre ? 'control' : cycle[(id < centre ? id : id - 1) % cycle.length],
    x: (id % columns) - (columns - 1) / 2,
    z: Math.floor(id / columns) - (rows - 1) / 2,
  })) };
}
