# Inheritance and cage populations

The genetics window follows individual mice and compares allele frequencies across
generations. It uses five independent illustrative loci. Their names describe
effects in the simulation, not real genes or measured genetic associations.

## From parents to offspring

Each mouse carries two alleles at each locus. At conception, an offspring receives
one randomly selected allele from its mother and one from its father. Each
transmission can mutate to a different allele with the probability set in
**Colony setup**. The default is 1% per inherited allele, a setting intended to
make changes visible during a short session rather than represent a biological
mutation rate.

The app records both parents, the transmitted alleles, and any new mutations when
the pregnancy starts. A later mating or a parent's death does not replace the
recorded father. Every pup receives its own ID at birth and retains that ID and
genotype when it becomes a juvenile mouse at weaning. Dead or removed mice remain
in the family records for the rest of the session.

The one-allele-from-each-parent rule follows the basic description of autosomal
inheritance in the [NHGRI allele glossary](https://www.genome.gov/genetics-glossary/Allele).
The model omits linkage, chromosomes, sex-linked inheritance, dominance, and the
many genetic and environmental influences on real mouse traits.

| Modeled locus | Effect in the simulation |
|---|---|
| Coat tone | Blends the two inherited palette colors |
| Exploration | Adjusts preference for exploring |
| Metabolism | Adjusts how quickly hunger and thirst rise |
| Threat sensitivity | Adjusts the strength of defensive responses |
| Body size | Adjusts adult display size |

Founder behavior alleles are sampled independently; their coat alleles match their
starting palette color. Introduced mice have no recorded parents and join G0.
Offspring generation is one greater than the highest generation of either parent,
so a G1 × G0 pairing produces G2. Generations can overlap in time.

## Reading the views

**Generations** groups all mice by their birth cage and generation. G0 contains the
starting and introduced mice. An allele's frequency is its copy count divided by
twice the number of recorded mice in that cohort. The chart and table keep mice
that later leave or die, allowing a consistent comparison of birth cohorts. The
mutation column counts new mutations across all five loci in that cohort.

**Family tree** shows the selected mouse between its parents and offspring. Click
a relative to follow that branch. The genotype table separates maternal and
paternal alleles and lists any mutations. Founder allele columns have no known
parental origin. **Watch this mouse** selects a living weaned mouse on the platform.

**Compare cages** uses living mice and pups currently in each cage, including
arrivals through tunnels. It compares these residents with the cage's recorded G0
baseline. The delta is the change in the first listed allele, in percentage points.
An empty population displays a dash rather than a zero frequency.

Changes can reflect reproduction, survival, migration, mutation, and chance.
Small populations can change by random sampling alone, as described in the
[NHGRI genetic drift glossary](https://www.genome.gov/genetics-glossary/Genetic-Drift).
The charts do not establish that a cage caused selection for a particular allele.
Cage conditions do not rewrite an individual's genome.

## Breeding and exports

Natural mating happens separately in each cage. You can also expand **Choose a
breeding pair** and select a living adult mother and father in the same cage. The
mother must not already be pregnant. This starts a pregnancy; gestation and pup
development then follow simulation time. Faster playback shortens the wait.

**Download family data** saves all recorded mice, parent IDs, offspring IDs,
genotypes, birth and current cages, mutation records, and locus definitions as
JSON. **Download generation CSV** saves per-cage birth-cohort allele counts and
frequencies. Exports include the current session only.

Colony setup is saved locally, but the simulation and family records are held in
memory. Reloading, restarting, or starting a new colony clears them. Download the
data first if you want to keep it.

## Colony capacity

Cage count is a user-entered positive whole number, defaulting to nine. The grid,
tunnels, cage controls, overview camera, reports, and comparisons use that count.
Population growth and adding mice have no fixed application cap. The browser's
available memory and processing time remain the practical limits.

The renderer grows its instanced mouse buffers as needed. Nearby encounters use
cage-local spatial buckets, background brains update less often as the colony
grows, and detailed neural maps are allocated when a mouse is inspected. These
reduce the cost of larger colonies; they do not make capacity infinite.
