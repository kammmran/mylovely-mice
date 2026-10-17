/**
 * Measured biometrics for an adult laboratory mouse.
 *
 * This file is the single source of truth for every physical number the mouse
 * rig uses: segment lengths, joint ranges of motion, the gait repertoire,
 * whisking kinematics and respiratory rates. Each value carries its units and
 * a `source` key into SOURCES below, so a number can never drift away from the
 * work it came from.
 *
 * `data/mouse_biometrics.json` is generated from BIOMETRICS and holds the same
 * values for anything outside the browser that wants them. The derived
 * constants at the bottom (MORPH, ROM, GAITS, WHISK, SNIFF) are what
 * `mouse.js` actually consumes, pre-converted to the units the rig works in:
 * metres and radians.
 *
 * Nothing here is a recording. These are published population measurements
 * used to parameterise a model.
 */

const DEG = Math.PI / 180;

// ---------------------------------------------------------------- sources
export const SOURCES = {
  jaxPhenome: {
    ref: 'Jackson Laboratory Mouse Phenome Database — C57BL/6J body length',
    url: 'https://phenome.jax.org/projects/Ackert1?strainid=7',
    note: 'Nose to base of tail, 9.7 cm (female) to 10.1 cm (male).',
  },
  ramalingasetty2021: {
    ref: 'Ramalingasetty et al. 2021, "A Whole-Body Musculoskeletal Model of the Mouse", IEEE Access 9:163861',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8865483/',
    note: 'Total length 16.9 cm nose to tail tip; body mass 34.3 g; Table 1 joint ranges of motion.',
  },
  charles2016: {
    ref: 'Charles et al. 2016, "Musculoskeletal Geometry, Muscle Architecture and Functional Specialisations of the Mouse Hindlimb", PLoS ONE 11:e0147669',
    url: 'https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0147669',
    note: 'C57BL/6 hindlimb geometry from microCT and dissection; thigh segment 16.25 mm; body mass 23.5 g.',
  },
  herbin2004: {
    ref: 'Herbin et al. 2004/2007, symmetrical and asymmetrical gaits in the mouse; treadmill versus overground locomotion',
    url: 'https://www.sciencedirect.com/science/article/pii/S1631068305001909',
    note: 'Step frequency and stride length per gait across 15-85 cm/s in SWISS mice.',
  },
  bellardita2015: {
    ref: 'Bellardita & Kiehn 2015, "Phenotypic Characterization of Speed-Associated Gait Changes in Mice Reveals Modular Organization of Locomotor Networks", Current Biology 25:1426',
    url: 'https://www.cell.com/current-biology/fulltext/S0960-9822(15)00418-2',
    note: 'Speed-dependent gait transitions; trot stance ~50% of the step cycle, bound ~34%; duty factor falls as speed rises.',
  },
  knutsenScholarpedia: {
    ref: 'Knutsen, "Whisking Kinematics", Scholarpedia',
    url: 'http://www.scholarpedia.org/article/Whisking_kinematics',
    note: 'Mouse fundamental whisking frequency 11.3 Hz with a strong second harmonic near 22 Hz; exploratory whisking 5-15 Hz; amplitudes 10-100 deg.',
  },
  adaptiveWhisking2022: {
    ref: 'Adaptive whisking in mice (freely-behaving whisker tracking)',
    url: 'https://pubmed.ncbi.nlm.nih.gov/35153684/',
    note: 'Amplitude 40 +/- 13 deg; protraction ~1080 deg/s versus retraction ~1564 deg/s; amplitude negatively correlated with frequency.',
  },
  sniffing2008: {
    ref: 'Rodent sniffing rates (cf. Wesson et al. 2008)',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2533419',
    note: 'Quiescent mice 3-5 Hz, rising to ~12 Hz during active investigation.',
  },
};

// ---------------------------------------------------------------- measurements
export const BIOMETRICS = {
  morphology: {
    bodyLength: { value: 98, units: 'mm', source: 'jaxPhenome', note: 'nose to base of tail' },
    tailLength: { value: 80, units: 'mm', source: 'jaxPhenome', note: 'tail 77-83 mm' },
    totalLength: { value: 169, units: 'mm', source: 'ramalingasetty2021', note: 'nose to tail tip' },
    bodyMass: { value: 25, units: 'g', source: 'charles2016', note: '23.5 g (Charles) to 34.3 g (Ramalingasetty)' },
    humerus: { value: 10.8, units: 'mm', source: 'ramalingasetty2021' },
    radius: { value: 11.0, units: 'mm', source: 'ramalingasetty2021', note: 'radius/ulna' },
    manus: { value: 4.6, units: 'mm', source: 'ramalingasetty2021' },
    femur: { value: 16.3, units: 'mm', source: 'charles2016', note: 'thigh segment 16.25 mm' },
    tibia: { value: 17.0, units: 'mm', source: 'charles2016', note: 'the mouse tibia is slightly longer than the femur' },
    pes: { value: 15.0, units: 'mm', source: 'ramalingasetty2021', note: 'long, held near-plantigrade' },
  },

  /**
   * Joint ranges of motion, degrees, from ramalingasetty2021 Table 1.
   * Paired entries are [min, max]; single values are a symmetric +/- limit.
   * The rig's joint frames are not anatomically identical to the model these
   * came from, so these are applied as limits on the equivalent rig angle:
   * a safety net on the IK rather than a reproduction of the original frames.
   */
  rangeOfMotion: {
    hip: { value: [-30, 50], units: 'deg', source: 'ramalingasetty2021', note: 'flexion-extension' },
    knee: { value: [40, 145], units: 'deg', source: 'ramalingasetty2021', note: 'flexion magnitude' },
    ankle: { value: [-50, 50], units: 'deg', source: 'ramalingasetty2021', note: 'plantarflexion-dorsiflexion' },
    shoulder: { value: [-45, 45], units: 'deg', source: 'ramalingasetty2021', note: 'retraction-protraction' },
    elbow: { value: [27, 120], units: 'deg', source: 'ramalingasetty2021', note: 'flexion magnitude, from 60-153 deg interior' },
    wrist: { value: [-20, 50], units: 'deg', source: 'ramalingasetty2021', note: 'extension-flexion' },
    lumbar: { value: 5, units: 'deg', source: 'ramalingasetty2021', note: 'lateral bending' },
    thoracic: { value: 5, units: 'deg', source: 'ramalingasetty2021', note: 'lateral bending' },
    cervicalYaw: { value: 5, units: 'deg', source: 'ramalingasetty2021', note: 'lateral bending' },
    cervicalPitch: { value: 9, units: 'deg', source: 'ramalingasetty2021', note: 'flexion-extension' },
    head: { value: 50, units: 'deg', source: 'ramalingasetty2021', note: 'flexion-extension' },
    jaw: { value: 30, units: 'deg', source: 'ramalingasetty2021', note: 'lower jaw opening, 0-30 deg' },
    tailSeg: { value: 10, units: 'deg', source: 'ramalingasetty2021', note: 'per-segment bending' },
  },

  /**
   * The gait repertoire. `speed` is the speed each gait is centred on,
   * `dutyFactor` the stance fraction of the step cycle, and `phase` the
   * footfall offsets in cycles for [front-left, front-right, hind-left,
   * hind-right].
   */
  gaits: [
    {
      name: 'walk',
      speed: { value: 9, units: 'cm/s', source: 'herbin2004' },
      stepFrequency: { value: 2.7, sd: 0.7, units: 'Hz', source: 'herbin2004' },
      strideLength: { value: 3.4, sd: 0.6, units: 'cm', source: 'herbin2004' },
      dutyFactor: { value: 0.68, source: 'bellardita2015', note: 'long stance, three or four limbs grounded' },
      phase: { value: [0.25, 0.75, 0.0, 0.5], source: 'bellardita2015', note: 'lateral sequence LH -> LF -> RH -> RF' },
    },
    {
      name: 'trot',
      speed: { value: 40, units: 'cm/s', source: 'herbin2004' },
      stepFrequency: { value: 5.9, sd: 1.0, units: 'Hz', source: 'herbin2004' },
      strideLength: { value: 6.8, sd: 0.8, units: 'cm', source: 'herbin2004' },
      dutyFactor: { value: 0.50, source: 'bellardita2015', note: 'stance ~50% of the step cycle' },
      phase: { value: [0.0, 0.5, 0.5, 0.0], source: 'bellardita2015', note: 'diagonal pairs together' },
    },
    {
      name: 'gallop',
      speed: { value: 89, units: 'cm/s', source: 'herbin2004' },
      stepFrequency: { value: 9.8, sd: 0.7, units: 'Hz', source: 'herbin2004' },
      strideLength: { value: 9.1, units: 'cm', source: 'herbin2004' },
      dutyFactor: { value: 0.35, source: 'bellardita2015', note: 'bound stance ~34%; duty falls as speed rises' },
      phase: { value: [0.5, 0.6, 0.0, 0.05], source: 'bellardita2015', note: 'half-bound: hindlimbs near-synchronous, forelimbs offset' },
    },
  ],

  whisking: {
    fundamental: { value: 11.3, units: 'Hz', source: 'knutsenScholarpedia', note: 'mouse; strong second harmonic near 22 Hz' },
    exploratoryRange: { value: [5, 15], units: 'Hz', source: 'knutsenScholarpedia' },
    amplitude: { value: 40, sd: 13, units: 'deg', source: 'adaptiveWhisking2022', note: 'range 10-100 deg across behaviours' },
    protractionSpeed: { value: 1080, units: 'deg/s', source: 'adaptiveWhisking2022' },
    retractionSpeed: { value: 1564, units: 'deg/s', source: 'adaptiveWhisking2022', note: 'retraction is faster, so the waveform is asymmetric' },
    amplitudeFrequencySlope: { value: -0.03, units: '1/Hz', source: 'adaptiveWhisking2022', note: 'amplitude falls as frequency rises' },
  },

  sniffing: {
    rest: { value: 4, units: 'Hz', source: 'sniffing2008', note: 'quiescent mice 3-5 Hz' },
    active: { value: 12, units: 'Hz', source: 'sniffing2008', note: 'up to ~12 Hz while investigating' },
  },
};

// ---------------------------------------------------------------- derived
const mm = (k) => BIOMETRICS.morphology[k].value / 1000;          // mm -> m
const rad = (k) => {
  const v = BIOMETRICS.rangeOfMotion[k].value;
  return Array.isArray(v) ? v.map((d) => d * DEG) : v * DEG;
};

/** Segment lengths in metres, which is what the rig is built in. */
export const MORPH = {
  bodyLen: mm('bodyLength'),
  tailLen: mm('tailLength'),
  humerus: mm('humerus'),
  radius: mm('radius'),
  manus: mm('manus'),
  femur: mm('femur'),
  tibia: mm('tibia'),
  pes: mm('pes'),
};

/** Joint limits in radians. Pairs are [min, max]; scalars are +/- limits. */
export const ROM = {
  hip: rad('hip'),
  knee: rad('knee'),
  ankle: rad('ankle'),
  shoulder: rad('shoulder'),
  elbow: rad('elbow'),
  wrist: rad('wrist'),
  lumbar: rad('lumbar'),
  thoracic: rad('thoracic'),
  cervicalYaw: rad('cervicalYaw'),
  cervicalPitch: rad('cervicalPitch'),
  head: rad('head'),
  jaw: rad('jaw'),
  tailSeg: rad('tailSeg'),
};

/** Gait table in the compact form the rig's blender wants. */
export const GAITS = BIOMETRICS.gaits.map((g) => ({
  name: g.name,
  v: g.speed.value,            // cm/s
  duty: g.dutyFactor.value,
  ph: g.phase.value,           // footfall offsets, cycles
}));

/** The fastest gait in the table, used to map simulator speed onto the data. */
export const GAIT_V_MAX = GAITS[GAITS.length - 1].v;

export const WHISK = {
  amplitudeDeg: BIOMETRICS.whisking.amplitude.value,
  fundamentalHz: BIOMETRICS.whisking.fundamental.value,
  ampFreqSlope: BIOMETRICS.whisking.amplitudeFrequencySlope.value,
  // fraction of the cycle spent protracting: retraction is faster, so it is
  // the shorter half of the sweep
  protractFraction:
    BIOMETRICS.whisking.retractionSpeed.value
    / (BIOMETRICS.whisking.protractionSpeed.value + BIOMETRICS.whisking.retractionSpeed.value),
};

export const SNIFF = {
  restHz: BIOMETRICS.sniffing.rest.value,
  activeHz: BIOMETRICS.sniffing.active.value,
};

export { DEG };
