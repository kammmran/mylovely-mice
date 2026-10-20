/** Shared predator motion and sensory rules. Distances and timings are display parameters. */
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

export function predatorPose(key, t, duration) {
  if (key === 'cat') {
    const approach = Math.min(clamp(t / 1.4), clamp((duration - t) / 1.8));
    return { x: .81 + .22 * (1 - approach), y: .004,
      z: .12 + Math.sin(t * 1.3) * .065, heading: -Math.PI / 2 + Math.sin(t * .8) * .08,
      approach, progress: t / duration };
  }
  const progress = clamp(t / duration), arc = Math.sin(progress * Math.PI);
  return { x: -.76 + 1.52 * progress, y: .69 - .36 * arc,
    z: -.3 + .6 * progress, heading: Math.atan2(1.52, .6),
    approach: arc, progress };
}

export function predatorExposure(predator, x, z, heading = 0, sheltered = false) {
  if (!predator) return { visual: 0, looming: 0, imminence: 0 };
  const pose = predatorPose(predator.key, predator.t, predator.dur);
  const dx = pose.x - x, dz = pose.z - z, distance = Math.hypot(dx, dz);
  const bearing = Math.atan2(dx, dz);
  const cover = sheltered ? .1 : 1;
  if (predator.key === 'cat') {
    // Peripheral detection remains possible; a close predator overrides facing.
    const proximity = clamp(1 - distance / 1.25);
    const facing = .4 + .6 * Math.max(0, Math.cos(bearing - heading));
    const visual = clamp((.25 + proximity * .75) * Math.max(facing, proximity) * pose.approach * cover);
    return { visual, looming: 0, imminence: (.35 + .65 * proximity) * pose.approach * cover,
      source: { x: pose.x, z: pose.z }, sourceDist: distance, sourceBearing: bearing };
  }
  const proximity = clamp(1 - distance / 1.1), passing = Math.sin(pose.progress * Math.PI);
  const looming = clamp(passing * (.45 + .55 * proximity) * cover);
  return { visual: clamp((.35 + .65 * proximity) * passing * cover), looming,
    imminence: looming, source: { x: pose.x, z: pose.z }, sourceDist: distance, sourceBearing: bearing };
}
