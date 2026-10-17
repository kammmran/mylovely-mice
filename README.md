# mylovely-mice

Two mice in a 3-D open field, each wired to a running model of its own brain.

You drive one of them. Every step, turn, sniff, drink and encounter is fed into
~680 model neurons spread across 37 real anatomical regions, and the panels show
what those neurons do while it happens.

![arena and brain panels](docs/screenshot.png)

## Running it

ES modules and `fetch()` do not work from a `file://` path, so serve the folder:

```bash
cd mylovely-mice
python3 -m http.server 8000
# open http://localhost:8000
```

Three.js is loaded from a CDN, so the first load needs a network connection.

## Controls

| key | |
|---|---|
| `W` `S` / `↑` `↓` | forward / back |
| `A` `D` / `←` `→` | turn |
| `shift` | run |
| `space` | sniff, rear up |
| `X` | swap which mouse you drive (or click one in the colony panel) |
| `O` | autopilot for the mouse you are driving |
| `C` | camera: follow → orbit → overhead |
| `V` | learned-value overlay on the floor |
| `T` | path trail |
| `M` | rotate the cue card 90° |
| `[` `]` | arena light |
| `-` `=` | water level |
| `G` | the optogenetics rig |
| click a pup | lift it; click again to set it down |
| `P` `R` `H` | pause, reset, hide help |

The colony panel also carries the three drive switches. Turning one off silences
that circuit and removes the behaviour: with **mating** off, libido stays at zero,
MPN and VMHvl go quiet and no mating can occur.

## What is actually real

**The anatomy is real.** `data/mouse_brain_ccf.json` is built from the Allen
Mouse Brain Common Coordinate Framework v3 (CCF 2017) structure meshes, pulled
from the Allen Institute's own download server and decimated for real-time
rendering. Region names, structure ids and colours come from the Allen structure
graph API. The brain you rotate is a real mouse brain.

**The physiology is reproduced, not replayed.** No spike trains are played back.
Each population has a tuning curve built to match the published response
properties of that cell type, is driven by the simulated animal's own state, and
emits Poisson spikes. What that buys you is that the panels show real phenomena
rather than decoration:

| what you can watch | reproduces |
|---|---|
| CA1 place fields building up in the rate map as you explore | O'Keefe & Dostrovsky 1971 |
| Spikes advancing in theta phase across a field | O'Keefe & Recce 1993 |
| MEC grid cells in three modules, spacing ×1.42 apart | Hafting 2005; Stensola 2012 |
| Theta climbing 6.7 → 12 Hz with running speed | Rivas 1996; Wells 2013 |
| Head-direction tuning, with the AD cells leading POST by ~50 ms | Taube 1990; Blair & Sharp 1995 |
| The compass rotating when you move the cue card (`M`) | Taube 1990 |
| Sharp-wave ripples replaying the path backwards after a reward | Foster & Wilson 2006 |
| A dopamine burst that shrinks as the cheese becomes predictable | Schultz 1997 |
| AgRP hunger neurons switching off *before* the first bite | Betley 2015; Chen 2015 |
| SFO thirst neurons switching off on reaching water | Oka 2015; Zimmerman 2016 |
| BNST responding more strongly in the male than the female | Bayless 2019 |
| MPN driving male courtship, VMHvl female receptivity | Wei 2018; Lin 2011 |
| SCN firing tracking arena light, and bright light raising CEA/PAG/PVH | Meijer 2003; Fuzesi 2016 |
| Pups calling ultrasonically out of the nest, and the mother fetching them | Ehret 2005; Hofer & Shair 1978 |
| MPOA galanin neurons driving retrieval, oxytocin rising while nursing | Wu 2014; Kohl 2018; Marlin 2015 |
| Stimulating VMHvl: mounting at low power, attack at high power | Lin et al. 2011 |

Full per-region descriptions and citations are in
[`src/neuro/regions.js`](src/neuro/regions.js).

**The body is measured too.** Segment lengths, joint ranges of motion, the gait
repertoire, whisking and breathing rates all come from published measurements,
cited per value in [`src/world/mousedata.js`](src/world/mousedata.js) and mirrored
in [`data/mouse_biometrics.json`](data/mouse_biometrics.json). See
[`docs/biomechanics.md`](docs/biomechanics.md).

**Deliberate compressions.** The oestrous cycle really lasts 4–5 days; here it is
75 s so you can watch it turn over. Hunger, thirst and libido build in minutes
rather than hours. These are labelled where they appear.

## Breeding

Mate the two mice and the female can conceive. From there it plays out properly:

- **Gestation** runs 19.5 days, with her hunger climbing as the litter grows. The
  colony panel tracks the days, and oestrous cycling stops while she is pregnant.
- **Birth** produces 5-8 pups in a nest she sites against a wall. They are
  altricial - pink, naked, blind, deaf and unable to walk, which is what newborn
  mice actually are.
- **They develop**: fur from day 3, eyes open at day 13, weaned at day 21.
- **Pup retrieval.** Take a pup out of the nest - click it, then click where to put
  it down. Out in the cold it starts calling at 40-90 kHz; you will see the mother's
  auditory cortex respond, her MPOA galanin neurons rise, and then she walks over,
  picks the pup up in her mouth, carries it back and drops it in the nest. This is
  the standard laboratory assay for maternal behaviour, and it works here for the
  same reason it works in a real mouse.
- **Nursing** over the litter drives the oxytocin neurons of the PVH.
- She is fertile again within a day of giving birth - mice have a postpartum oestrus.

**The pups grow up.** At weaning each one becomes a mouse of its own, with its own
brain, its own name and its own colouring — it joins the colony as a juvenile at
45% of adult size, grows over the next three weeks, and reaches sexual maturity at
six weeks, at which point it can breed in turn. Juveniles are marked with their age
in the colony panel; adults are not. Press `X` to take control of any of them, or
click one in the panel.

The cage holds eight. Past that, weaned juveniles disperse rather than joining,
which keeps the simulation honest about space and keeps the frame rate sane.

One simulated day is five seconds, so a pregnancy takes about a minute and a half
and a pup reaches adulthood about three and a half minutes after it is born.

## Optogenetics

Press `G` for a virtual optogenetics rig: express an opsin in any modelled region,
shine light on it, and watch behaviour change. The headline demonstration is VMHvl,
where the same neurons do different things at different drive levels:

| light power | mating drive | aggression |
|---|---|---|
| 1.2 mW | 0.70 | 0.17 |
| 12 mW | 0.12 | 0.86 |

At low power the male mounts; at high power he attacks and the other mouse flees.
That crossover is the Lin et al. 2011 result. Each animal is implanted separately,
so stimulating one leaves the other at baseline.

## Layout

```
index.html              page, layout, styling
src/main.js             the loop: steps both mice and their brains, drives every panel
src/neuro/brain.js      the model — populations, tuning curves, drives, TD learning, replay
src/neuro/regions.js    what each region does, and the work it is based on
src/world/arena.js      open field, cheese, water dish, floodable water, lighting
src/world/mouse.js      the mouse rig: articulated body, gait, whisking, autopilot
src/world/mousedata.js  every physical constant, with units and citations
src/world/pups.js       the litter: nest, altricial pups, growth, ultrasonic calls
src/optogenetics.js     opsins, implants, light, region-to-behaviour mapping
src/view/brainview.js   3-D Allen CCF brain, lit by live firing rate
src/view/plots.js       spike raster, LFP and dopamine traces, rate maps, polar tuning
src/view/palette.js     colour parameters (validated for contrast and colour-blindness)
data/mouse_brain_ccf.json   38 decimated Allen CCFv3 structure meshes
```

## Finding your way around

The first time you open it you get a short explainer; the **?** button brings it
back. Beyond that:

- **Click the floor** and the mouse walks there — you never have to touch the
  keyboard if you would rather not.
- **"What just happened"**, bottom left, narrates events in plain language as they
  occur: a dopamine burst when cheese is found, a replay when the mouse stops, the
  female entering oestrus.
- **"Busiest right now"** ranks the five most active regions live, each with a plain
  description ("place cells — where am I"), so you can see what is driving behaviour
  without knowing the acronyms. Click any of them for the full account.
- The complete 37-region list is folded away under **all 37 regions**, and can be
  filtered to one system at a time.

## Reading the panels

- **Spike raster** — one row per sampled neuron, grouped into labelled bands by
  system. Scrolls right to left over a 30 s window; the ruler marks every second
  and brightens every fifth, so intervals can be read off it. Each band is also
  named, so colour is never the only cue. Rows are ordered by what the cells are
  tuned to, which is what makes the bands readable: CA1 and CA3 by field
  position along `+x`, so crossing the arena sweeps the band diagonally; ENTm as
  three blocks, one per grid module (30 / 43 / 60 cm), so the spacing ratio
  shows up as three rates of striping over one run; POST by preferred direction,
  so the head-direction bump walks down the band as the mouse turns; SUB as four
  blocks, one per wall.
- **Spatial tuning** — occupancy-normalised rate maps, accumulated from the
  spikes as you explore, the way an experimentalist would build them. Click a
  card to switch cells. Maps use `+z` up and `+x` left to match the overhead
  camera.
- **Hippocampal LFP** — theta with nested gamma; the pink bands are sharp-wave
  ripples, which only fire when the mouse holds still.
- **Dopamine** — VTA firing rate on top, the learned value V(s) below, on a
  shared time axis.
- **Colony** — both animals' drives side by side, with the environment sliders
  and the three drive switches.

## Caveats

This is a teaching and exploration tool, not a simulator you should draw
scientific conclusions from. The populations are small, the tuning curves are
analytic rather than fitted to data, and the circuits are modelled as
feed-forward drives rather than as interacting networks.
