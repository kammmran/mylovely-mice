# Mouse behavior

The session controller in `src/main.js` handles threat responses, fighting,
parental care, and travel out of cages missing a needed resource.
`src/world/behavior.js` handles the mouse's ordinary choices after those checks.

Each mouse remembers food, water, and refuge locations discovered nearby. Memories are stored per
cage and remain available after a tunnel crossing. Food locations are checked
again when the mouse comes within sensing range; missing food is removed from
memory. Exploration favors less-visited areas, with a preference for walls that
varies between individuals and increases under bright light or fear.

Food, water, and courtship are scored by need, distance, and perceived danger.
A small preference for the current goal prevents frequent switching between
similar choices. Casual tunnel exploration comes after these checks.

Eating, drinking, sniffing, rearing, grooming, and resting use short bouts.
Urgent needs can interrupt grooming or rest; defensive responses interrupt all
ordinary choices. Sustained movement raises a fatigue variable, which falls
while stationary. A tired mouse returns to the cage refuge before resting.

Steering slows the mouse before sharp turns and adjusts around nearby bodies
and aversive sources. A separate overlap pass keeps bodies from occupying the
same floor position. These rules apply to both detailed and distant mice.

The behavior repertoire draws on the [NC3Rs overview of mouse behavior and housing](https://nc3rs.org.uk/3rs-resource-library/housing-and-husbandry-mouse).
The decision weights, sensing ranges, and bout durations are simulation choices,
not fitted estimates of animal behavior. The resource memory is also separate
from the neural model's spatial maps.

Run the decision checks with:

```bash
node .github/scripts/check-behavior.mjs
```

The browser smoke test also checks that a thirsty mouse turns toward water,
approaches it, and completes a drinking bout.

## Threat responses

Every animal senses the stimuli in its own cage. The cat approaches outside the
wall, while the owl follows a descending flyover path. The same paths drive the
visible models and the sensory input. Distance and facing affect cat detection;
overhead approach drives looming exposure. The refuge reduces visual exposure.

A distant predator can prompt a short freeze before escape to a remembered
refuge. An imminent overhead threat favors directed escape when that refuge is
known, and freezing when it is not. Close ground danger can trigger retreat
without a refuge target. Arrival beneath a safe roof ends running and starts a
hiding bout. Mice recover gradually, with short pauses to sample the threat's
direction between cautious movements. Neutral noise causes a brief startle;
rotten odor prompts avoidance without predator fear.

These choices draw on studies of [shelter-dependent defensive responses](https://www.nature.com/articles/s41467-018-03580-7)
and [orientation toward shelter during escape](https://www.nature.com/articles/s41586-022-05553-9).
They are rules for this simulation, not a fitted model of predator encounters.
Audio is synthesized for browser playback; calibrated sound pressure and
ultrasonic hearing are not reproduced.

```bash
node .github/scripts/check-threats.mjs
```

The browser check also verifies visible predators, cage isolation, escape into
cover, stopping under the roof, and removal without instantly resetting fear.
