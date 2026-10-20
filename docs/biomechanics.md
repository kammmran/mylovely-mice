# Where the mouse's body comes from

The brain model's citations live in [`src/neuro/regions.js`](../src/neuro/regions.js),
one per region. This page covers the body's locomotion parameters: segment
lengths, joint limits, gait timings, whisking, and breathing rates.

Those numbers are defined once, with units and a citation each, in
[`src/world/mousedata.js`](../src/world/mousedata.js), and mirrored for
non-browser use in [`data/mouse_biometrics.json`](../data/mouse_biometrics.json).
`mouse.js` imports these parameters. Coat, face, ear and tail geometry in
`mouseappearance.js` approximates a mouse's appearance; it is not a measured
surface reconstruction. The continuous tail uses a visual deformation curve.

## Sources

| key | work | what it supplies |
|---|---|---|
| `jaxPhenome` | [Jackson Laboratory Mouse Phenome Database](https://phenome.jax.org/projects/Ackert1?strainid=7), C57BL/6J | body length (nose to tail base, 9.7–10.1 cm) and tail length (7.7–8.3 cm) |
| `ramalingasetty2021` | [Ramalingasetty et al. 2021, *A Whole-Body Musculoskeletal Model of the Mouse*, IEEE Access 9:163861](https://pmc.ncbi.nlm.nih.gov/articles/PMC8865483/) | all joint ranges of motion (Table 1); forelimb segments; total length 16.9 cm |
| `charles2016` | [Charles et al. 2016, *Musculoskeletal Geometry, Muscle Architecture and Functional Specialisations of the Mouse Hindlimb*, PLoS ONE 11:e0147669](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0147669) | C57BL/6 hindlimb geometry; femur 16.25 mm |
| `herbin2004` | [Herbin et al. 2004/2007, symmetrical and asymmetrical gaits in the mouse](https://www.sciencedirect.com/science/article/pii/S1631068305001909) | step frequency and stride length for each gait |
| `bellardita2015` | [Bellardita & Kiehn 2015, *Speed-Associated Gait Changes in Mice*, Current Biology 25:1426](https://www.cell.com/current-biology/fulltext/S0960-9822(15)00418-2) | duty factors and footfall phase patterns; speed-driven gait transitions |
| `knutsenScholarpedia` | [Knutsen, *Whisking Kinematics*, Scholarpedia](http://www.scholarpedia.org/article/Whisking_kinematics) | mouse whisking fundamental 11.3 Hz; exploratory range 5–15 Hz |
| `adaptiveWhisking2022` | [Adaptive whisking in mice](https://pubmed.ncbi.nlm.nih.gov/35153684/) | amplitude 40 ± 13°; protraction 1080 °/s vs retraction 1564 °/s |
| `sniffing2008` | [Rodent sniffing rates (cf. Wesson et al. 2008)](https://pmc.ncbi.nlm.nih.gov/articles/PMC2533419) | 3–5 Hz at rest, up to ~12 Hz investigating |

## What each measurement buys you

**Segment lengths.** Femur 16.3 mm, tibia 17.0 mm, pes 15.0 mm, humerus
10.8 mm, radius/ulna 11.0 mm, manus 4.6 mm. The hindlimb is a good deal longer
than the forelimb and is held strongly flexed, which is why a mouse stands in a
crouch rather than on straight legs.

**A three-segment hindlimb.** The pes is long and carried near-plantigrade, so
the hindlimb is modelled as femur → tibia → pes with a real ankle. The foot lies
flat through stance and rolls over the toes at push-off. Forelimbs stay
two-segment plus a short manus.

**Joint limits.** Taken from Table 1 of the whole-body model and applied as
clamps on the IK output: hip, knee, ankle, shoulder, elbow, wrist, lumbar,
thoracic, cervical, head and jaw. The rig's joint frames are
not anatomically identical to the model these came from, so they act as a safety
net rather than as a reproduction of the original frames.

One of these corrected a real error. Published lumbar and thoracic lateral
bending is only about **±5° each**; the rig had been bending its spine ±17°,
which looked plausible and was roughly three times too much.

**The gait repertoire.** Gait is not a single cycle with a changing speed —
mice switch pattern as they accelerate, and the footfall order changes with it.

| gait | centred on | duty factor | footfall phase (FL / FR / HL / HR) | pattern |
|---|---|---|---|---|
| walk | 9 cm/s | 0.68 | 0.25 / 0.75 / 0.00 / 0.50 | lateral sequence LH → LF → RH → RF |
| trot | 40 cm/s | 0.50 | 0.00 / 0.50 / 0.50 / 0.00 | diagonal pairs together |
| gallop | 89 cm/s | 0.35 | 0.50 / 0.60 / 0.00 / 0.05 | half-bound: hindlimbs together, forelimbs offset |

The rig blends between these with speed, interpolating the phases circularly so
they wrap correctly. Duty factor falling from 0.68 to 0.35 is what puts more of
the cycle in the air as the animal speeds up.

**A compression worth knowing about.** The literature speeds span 9–89 cm/s, but
the simulation tops out at 46 cm/s so the 120 cm arena stays navigable. Model
speed is mapped onto the literature range so the whole repertoire is reachable.
The gait *structure* is faithful; the speed axis is compressed.

**No-slip stance.** Stride length is derived as `speed / stride frequency`,
where the frequency is read back off the brain model's own stepping oscillator.
The legs therefore stay phase-locked to motor-cortex firing, while a planted paw
holds its position in the world instead of skating. Measured residual slip is
about 1% of body displacement.

**Whisking is not a sine wave.** Protraction runs at ~1080 °/s and retraction at
~1564 °/s, so the forward sweep occupies about 59% of the cycle and the snap
back 41%. Amplitude is ~40° and falls as frequency rises, which the rig
reproduces via the measured anticorrelation.

**Breathing.** 3–5 Hz at rest, up to ~12 Hz while investigating. Fast sniffs are
shallow, so the rig scales breathing depth inversely with the rate the brain
model reports.

## Caveat

These are population measurements from several strains — C57BL/6 for the limb
geometry, SWISS for the gait timings — combined into one animal. Individual mice
vary, and some of the ranges in the whole-body model are themselves adapted from
rat studies, as its own Table 1 notes. This is a model parameterised from
literature, not a reconstruction of any particular mouse.
