# Optogenetics

Press **G**. You get a rig that lets you express a light-sensitive protein in
one named population of neurons, shine light on it, and watch the animal's
behaviour change.

That is the actual technique, and it is why we know which cells cause which
behaviour rather than merely correlating with it. Recording tells you a
neuron is active during attack; only driving it tells you the neuron *causes*
the attack. The 2026 Nobel Prize in Physiology or Medicine went to Karl
Deisseroth, Peter Hegemann and Georg Nagel for the light-gated ion channels
that made it possible.

Everything lives in [`src/optogenetics.js`](../src/optogenetics.js).

## The proteins

Opsins are microbial membrane proteins — channelrhodopsin from green algae,
halorhodopsin and archaerhodopsin from archaea — delivered into neurons by a
virus. Blue-light channelrhodopsins pass cations and depolarise; the amber
pumps and anion channels hyperpolarise and silence.

| opsin | λ | effect | τ off | follows to | why you would pick it |
|---|---|---|---|---|---|
| ChR2(H134R) | 470 nm | excite | 19 ms | 40 Hz | the workhorse |
| ChETA | 470 nm | excite | 4 ms | 200 Hz | fast trains without spike failure |
| ChRmine | 585 nm | excite | 30 ms | 40 Hz | red-shifted, huge current, works through tissue |
| SSFO | 470 nm | excite | ~30 min | bistable | one flash latches it on for minutes |
| eNpHR3.0 | 590 nm | silence | 4.2 ms | continuous | chloride pump |
| Arch | 566 nm | silence | 10 ms | continuous | proton pump |
| stGtACR2 | 470 nm | silence | 15 ms | continuous | chloride *channel*, silences at low power |

The differences are modelled, not cosmetic. A pump needs the light held on
continuously. A step-function opsin latches from a single flash. And pulsing
ChR2 above ~40 Hz produces *less* drive, not more, because the channel cannot
close in time between pulses — the panel marks the frequency in red when you
cross that line.

## What each region does

Every mapping is a published optogenetic result. The full list with citations
is in `TARGETS` in the source; the headline ones:

| region | stimulating it | source |
|---|---|---|
| **VMH** (VMHvl) | mounting at low power, **attack** at high power | Lin et al. 2011, Nature 470:221 |
| MPN | courtship and mounting | Wei et al. 2018 |
| PMv | aggression, social dominance | Stagkourakis et al. 2018 |
| ARH | voracious feeding in a sated mouse | Aponte 2011; Krashes 2011 |
| SFO | drinking in a water-sated mouse | Oka et al. 2015 |
| PAG | freezing and flight | Tovote et al. 2016 |
| CEA | freezing | Ciocchi et al. 2010 |
| VTA | reward, place preference | Tsai et al. 2009 |
| SCm | contraversive orienting turn | Wang et al. 2015 |
| CA1 | corrupts the decoded position — an implanted memory | Liu et al. 2012 |

## The one worth trying first

**VMHvl is dose-dependent, and that is the point.** The same neurons produce
different behaviour at different drive levels. Run the two presets back to
back:

| power | mating | aggression | VMH rate |
|---|---|---|---|
| 0.3 mW | 0.44 | 0.00 | 9 Hz |
| 0.8 mW | 0.84 | 0.00 | 13 Hz |
| 1.5 mW | 0.62 | 0.27 | 16 Hz |
| 4 mW | 0.31 | 0.64 | 20 Hz |
| 12 mW | 0.12 | 0.86 | 22 Hz |
| 20 mW | 0.07 | 0.91 | 23 Hz |

Turn the power up on a mounting male and he starts attacking instead. Turn the
light off and it stops immediately.

## Reading the panel

- **Subject tabs** — the two animals have completely independent implants.
  Light on the male's VMHvl does nothing to the female.
- **Per-neuron bars** — one bar per cell in the targeted population, height is
  firing rate, white means spiking on this frame. This is where you watch the
  light take hold cell by cell.
- **Power / frequency / expression** — irradiance at the fibre tip in mW/mm²,
  pulse rate, and how well the virus took. Expression below ~40% is a good way
  to see a manipulation fail the way real ones do.
- **Evoked behaviour** — the drives this is producing right now. These are what
  the simulator's behaviour controller reads, so what you see here is what the
  animal is about to do.

## Honest limits

With nothing expressed, or expressed but unlit, the rig is a true no-op and the
baseline physiology is untouched — this is tested, not asserted.

Beyond that: the millisecond channel kinetics are not resolvable at a 16 ms
simulation step, so what is modelled is the *envelope* of opsin engagement plus
a separate fidelity term for the follow limit, rather than individual
photocurrents. The behavioural mappings are drive strengths read off published
results, not fitted dose-response curves — the VMHvl crossover reproduces the
qualitative finding, and the numbers in the table above are this model's, not
Lin's. Real optogenetics also hits axons of passage, suffers opsin desensitisation
and heats tissue at high power; none of that is here.
