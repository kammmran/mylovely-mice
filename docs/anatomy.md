# Anatomy viewer

Click a mouse on the platform, including an instanced mouse in the cage
overview, to open the floating anatomy window. The Explore menu also has a
Mouse anatomy button. The window follows the mouse selected in the sidebar.
It shares the other windows' drag, minimize, close, and position-reset controls.

Views include:

- Skeleton: skull and jaw, vertebral column, ribs and sternum, pelvis, limb
  bones, paw bones, and tail vertebrae.
- Organs: heart, lungs, liver, stomach, intestine, kidneys, ureters, and bladder.
- Blood system: schematic systemic arteries, systemic veins, and pulmonary
  connections. Red denotes oxygenated blood; blue denotes deoxygenated blood.
- Nerves: a simplified brain, spinal cord, and peripheral branches.
- All systems: combined anatomy with translucent bones.

Select a label, list entry, or structure in the model to read its description.
Drag to rotate, scroll or pinch to zoom, or choose Side, Top, Front, or Reset.
Body outlines and labels can be hidden. Follow movement holds the current pose
when switched off without pausing the colony.

`src/world/anatomy.js` builds the geometry around a display copy of the mouse
rig. The viewer copies the observed animal's joint transforms directly rather
than running a separate walking animation. Limb bones stay attached through
gait changes, grooming, rearing, and freezing. Tail vertebrae follow the body
tail's centerline. Simulation pause also stops the anatomy's pose and flow.

The geometry is procedural and schematic, not a segmented scan. It does not
represent every bone, tissue, vessel, nerve, or individual variation. Heart
pulses and circulating markers illustrate function; they are not physiological
measurements. Organ positions and terminology were checked against Jackson
Laboratory's [Anatomy of the Laboratory Mouse](https://www.informatics.jax.org/cookbook/contents.shtml)
and [anatomy chapter](https://www.informatics.jax.org/greenbook/chapters/chapter13.shtml).
The brain outline in this window is separate from the Allen atlas in the Brain tab.

The browser smoke test checks joint synchronization, pause and view freeze,
layer selection, explanations, and opening a single popup by clicking a mouse.
