/**
 * What each simulated region is doing, and the experimental work the model of it
 * is based on. Acronyms and structure IDs are Allen Mouse Brain CCFv3 (see
 * data/mouse_brain_ccf.json).
 *
 * These are literature-derived *model* descriptions: the geometry is real
 * mouse anatomy, the tuning curves reproduce published response properties,
 * but no recorded spike trains are being played back.
 */

export const GROUPS = {
  spatial: { label: 'spatial map',   color: '#4dd4c0' },
  sensory: { label: 'sensory',       color: '#6aa6ff' },
  motor:   { label: 'motor',         color: '#9fe870' },
  reward:  { label: 'reward',        color: '#ff6b8a' },
  state:   { label: 'internal state',color: '#ffb84d' },
};

export const ROLES = {
  // ---------------- spatial map ----------------
  CA1: {
    group: 'spatial',
    short: 'place cells — "where am I"',
    role: 'Place cells. Each cell fires in one small patch of the arena, so the active subset tells the mouse where it is. Spikes advance in theta phase as the mouse crosses the field.',
    ref: "O'Keefe & Dostrovsky 1971; O'Keefe & Recce 1993",
  },
  CA3: {
    group: 'spatial',
    short: 'recalling a place from a hint',
    role: 'Recurrent store that completes partial patterns: broader place fields than CA1, and the engine that drives replay during rest.',
    ref: 'Nakazawa et al. 2002',
  },
  DG: {
    group: 'spatial',
    short: 'telling similar places apart',
    role: 'Pattern separation. Very sparse, very sharp fields — few cells active at a time, so similar places get distinct codes.',
    ref: 'Leutgeb et al. 2007',
  },
  ENTm: {
    group: 'spatial',
    short: 'grid cells — the distance ruler',
    role: 'Grid cells, in three modules whose spacing grows by a factor of ~1.42. A hexagonal lattice of firing fields acts as the metric for distance. Speed cells here scale their rate linearly with running speed.',
    ref: 'Hafting et al. 2005; Stensola et al. 2012; Kropff et al. 2015',
  },
  SUB: {
    group: 'spatial',
    short: 'distance from the walls',
    role: 'Border / boundary-vector cells: fire at a preferred distance and allocentric direction from a wall.',
    ref: 'Solstad et al. 2008; Lever et al. 2009',
  },
  POST: {
    group: 'spatial',
    short: 'compass — which way I face',
    role: 'Head-direction cells — an internal compass. Each cell fires over a ~90° band of headings, regardless of position.',
    ref: 'Taube et al. 1990',
  },
  AD: {
    group: 'spatial',
    short: 'compass, half a step ahead',
    role: 'Anterodorsal thalamic head-direction cells. They are anticipatory: they signal the heading the mouse will have ~50 ms from now.',
    ref: 'Blair & Sharp 1995; Taube 1995',
  },
  RSP: {
    group: 'spatial',
    short: 'tying the compass to landmarks',
    role: 'Retrosplenial cortex binds the compass to landmarks — conjunctive position × heading responses used to anchor the map to the cue card.',
    ref: 'Alexander & Nitz 2015',
  },

  // ---------------- sensory ----------------
  MOB: {
    group: 'sensory',
    short: 'smell',
    role: 'Olfactory bulb. Firing tracks odour concentration, chopped into sniff-locked bursts at 5–10 Hz. This is how the mouse actually finds the cheese.',
    ref: 'Wachowiak 2011',
  },
  PIR: {
    group: 'sensory',
    short: 'what that smell is',
    role: 'Piriform cortex: odour identity, and strong responses to *change* in concentration — the gradient signal for tracking a plume.',
    ref: 'Stettler & Axel 2009',
  },
  AUDp: {
    group: 'sensory',
    short: 'hearing — and pup calls',
    role: 'Primary auditory cortex. Mouse hearing reaches far above ours, and newborn pups call at 40-90 kHz when they are cold or out of the nest. Those calls are what a mother is listening for, and hearing one is what sends her to fetch the pup.',
    ref: 'Ehret 2005; Marlin et al. 2015',
  },
  'SSp-bfd': {
    group: 'sensory',
    short: 'whiskers',
    role: 'Barrel cortex. Each whisker has its own cortical column; firing jumps when whiskers sweep a wall at 8–12 Hz. A wall-hugging mouse navigates largely by this.',
    ref: 'Woolsey & Van der Loos 1970; Crochet & Petersen 2006',
  },
  VISp: {
    group: 'sensory',
    short: 'sight',
    role: 'Primary visual cortex. Mouse acuity is poor but optic flow is strong, so firing follows self-motion as much as the cheese coming into view.',
    ref: 'Niell & Stryker 2008; Allen Brain Observatory',
  },
  LGd: {
    group: 'sensory',
    short: 'sight, one step earlier',
    role: 'Visual thalamus — the relay from retina to V1, carrying the same flow signal one synapse earlier.',
    ref: 'Piscopo et al. 2013',
  },

  // ---------------- motor ----------------
  MOp: {
    group: 'motor',
    short: 'movement commands',
    role: 'Primary motor cortex. Rate scales with locomotion speed and turning — the descending command for the step cycle.',
    ref: 'Ayling et al. 2009',
  },
  MOs: {
    group: 'motor',
    short: 'planning the next move',
    role: 'Secondary motor / premotor. Ramps up *before* a turn: it carries the intended action rather than the executed one.',
    ref: 'Murakami et al. 2014',
  },
  CP: {
    group: 'motor',
    short: 'choosing an action',
    role: 'Caudoputamen. Selects and energises actions; its gain depends on how much dopamine is arriving, which is why vigour tracks reward.',
    ref: 'Panigrahi et al. 2015',
  },
  CB: {
    group: 'motor',
    short: 'balance and coordination',
    role: 'Cerebellum. Fires with angular velocity and acceleration — the fine correction that keeps the body coordinated through turns.',
    ref: 'Medina & Lisberger 2008',
  },
  SCm: {
    group: 'motor',
    short: 'turning to look at things',
    role: 'Superior colliculus (motor layers). Bursts when something new appears off to one side, and drives the orienting turn toward it.',
    ref: 'Wang et al. 2015',
  },
  PAG: {
    group: 'motor',
    short: 'alertness and fear',
    role: 'Periaqueductal grey: arousal and defensive state. Rises with speed and with time spent exposed in the open centre.',
    ref: 'Tovote et al. 2016',
  },

  // ---------------- reward ----------------
  VTA: {
    group: 'reward',
    short: 'dopamine — "better than expected"',
    role: 'Dopamine neurons. They do not report reward — they report reward *prediction error*. An unexpected cheese causes a burst; once the approach is learned, the burst moves to the moment the cheese is detected, and eating it becomes unsurprising.',
    ref: 'Schultz et al. 1997; Cohen et al. 2012',
  },
  SNc: {
    group: 'reward',
    short: 'dopamine — energy to move',
    role: 'Nigrostriatal dopamine. Shares the prediction-error signal and sets movement vigour through the caudoputamen.',
    ref: 'da Silva et al. 2018',
  },
  ACB: {
    group: 'reward',
    short: 'how good is it here',
    role: 'Nucleus accumbens. Encodes how valuable the current spot is — the learned value V(s) that rises as the mouse closes in on cheese.',
    ref: 'Day et al. 2007',
  },
  BLA: {
    group: 'reward',
    short: 'good or bad',
    role: 'Basolateral amygdala. Assigns valence: a positive transient when food is detected and again when it is eaten.',
    ref: 'Beyeler et al. 2016',
  },
  CEA: {
    group: 'reward',
    short: 'threat',
    role: 'Central amygdala. Threat and aversion — bumps a wall, and it spikes; sits high while the mouse is out in the exposed centre.',
    ref: 'Ciocchi et al. 2010',
  },

  // ---------------- internal state ----------------
  LHA: {
    group: 'state',
    short: 'the urge to eat',
    role: 'Lateral hypothalamus: the feeding drive itself. Its firing is the product of hunger and food availability, and it is what turns a smell into approach.',
    ref: 'Jennings et al. 2015',
  },
  ARH: {
    group: 'state',
    short: 'hunger itself',
    role: 'Arcuate AgRP neurons — the hunger signal. Counter-intuitively they switch *off* within seconds of the mouse detecting food, before a single bite is taken.',
    ref: 'Betley et al. 2015; Chen et al. 2015',
  },

  // ---------------- thirst: the lamina terminalis ----------------
  SFO: {
    group: 'state',
    short: 'thirst sensor',
    role: 'Subfornical organ. It sits outside the blood-brain barrier and senses blood sodium directly — this is the thirst signal. Like the hunger neurons, it switches off within seconds of the mouse starting to drink, long before the water could reach the blood.',
    ref: 'Oka et al. 2015; Zimmerman et al. 2016',
  },
  MEPO: {
    group: 'state',
    short: 'thirst, added up',
    role: 'Median preoptic nucleus: the integrator of the thirst circuit, pooling the organ signals into a single drive to seek water.',
    ref: 'Augustine et al. 2018',
  },
  OV: {
    group: 'state',
    short: 'how salty the blood is',
    role: 'Vascular organ of the lamina terminalis — the second barrier-free osmosensor, reporting how concentrated the blood has become.',
    ref: 'Pool et al. 2021',
  },

  // ---------------- pheromones and mating ----------------
  AOB: {
    group: 'sensory',
    short: 'pheromones — who is nearby',
    role: 'Accessory olfactory bulb. The vomeronasal system: a separate nose for pheromones. It reports the sex and reproductive state of the other mouse, which ordinary smell does not.',
    ref: 'Dulac & Torello 2003',
  },
  MEA: {
    group: 'state',
    short: 'what another mouse means',
    role: 'Medial amygdala. Where pheromone signals are read for social meaning and routed on to mating or aggression — the decision point between courting and attacking.',
    ref: 'Li et al. 2017; Hong et al. 2014',
  },
  BST: {
    group: 'state',
    short: 'where male and female differ most',
    role: 'Bed nucleus of the stria terminalis. One of the most sexually dimorphic structures in the brain: its principal nucleus is markedly larger in males, and the model gives the male a correspondingly stronger response.',
    ref: 'Bayless et al. 2019',
  },
  MPN: {
    group: 'state',
    short: 'courtship, and caring for pups',
    role: 'Medial preoptic nucleus. Two populations, two jobs: the Esr1 neurons drive male courtship, while the neighbouring galanin neurons drive parental care — grooming pups, fetching strays, crouching over the litter. Switching the galanin neurons on makes even a virgin animal start parenting.',
    ref: 'Wei et al. 2018; Wu et al. 2014; Kohl et al. 2018',
  },
  VMH: {
    group: 'state',
    short: 'female receptivity',
    role: 'Ventromedial hypothalamus. Its ventrolateral part carries female sexual receptivity, and in males the same region carries aggression — one structure, opposite jobs by sex.',
    ref: 'Lin et al. 2011; Inoue et al. 2019',
  },
  PMv: {
    group: 'state',
    short: 'am I well-fed enough to mate',
    role: 'Ventral premammillary nucleus. Links reproductive readiness to body condition: it reports whether the animal is well-fed enough to mate, which is why starving suppresses mating.',
    ref: 'Donato et al. 2011',
  },

  // ---------------- light and stress ----------------
  SCH: {
    group: 'state',
    short: 'body clock — reads the light',
    role: 'Suprachiasmatic nucleus — the master clock. It is driven directly by retinal irradiance, so its firing here tracks the arena light level rather than anything the mouse is doing.',
    ref: 'Meijer & Schwartz 2003',
  },
  PVH: {
    group: 'state',
    short: 'stress, and oxytocin',
    role: 'Paraventricular hypothalamus. The stress output — bright light, deep water and collisions all push it up. It is also the source of oxytocin, which is released while nursing and which retunes the mother\'s auditory cortex so that pup calls become salient to her.',
    ref: 'Fuzesi et al. 2016; Marlin et al. 2015',
  },
};

/** Ordered list for the UI, grouped by system. */
export const ORDER = [
  'CA1', 'CA3', 'DG', 'ENTm', 'SUB', 'POST', 'AD', 'RSP',
  'MOB', 'PIR', 'AOB', 'SSp-bfd', 'AUDp', 'VISp', 'LGd',
  'MOp', 'MOs', 'CP', 'CB', 'SCm', 'PAG',
  'VTA', 'SNc', 'ACB', 'BLA', 'CEA',
  'LHA', 'ARH', 'SFO', 'MEPO', 'OV',
  'MEA', 'BST', 'MPN', 'VMH', 'PMv',
  'SCH', 'PVH',
];
