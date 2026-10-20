# mylovely-mice

A browser simulation of a mouse colony across nine cages. Each mouse has its own
behavior, needs, and brain model. You can observe the colony, control a mouse,
change cage conditions, and compare behavior with neural activity.

[Open the simulation](https://kammmran.github.io/mylovely-mice/)

![Platform and Explore sidebar](docs/screenshot.png)

## Run locally

Serve the project over HTTP so the browser can load its modules and data files:

```bash
git clone https://github.com/kammmran/mylovely-mice.git
cd mylovely-mice
python3 -m http.server 8000
```

Open [localhost:8000](http://localhost:8000). Three.js is included in `vendor/`;
the site needs no build step or backend.

## Using the interface

The default view shows the platform and the controls on the right:

- **Explore:** selected mouse, hunger and thirst, playback speed, camera, and colony controls.
- **Brain:** anatomy, region activity, region details, and learned spatial maps.
- **Tools:** neural signals, optogenetics, health and survival, reports, and panel settings.

On a phone, open the controls with the menu button on the right.

**Customize panels** groups optional panels under Platform, Brain, and Charts.
The Nine cages panel opens in the top-left corner. Popups can be dragged by their
headers, minimized, or closed. **Reset position** moves a popup back to its opening
position; **Alt + arrow keys** moves a focused header with the keyboard. **Escape**
closes the active popup.

**Clean view** hides the overlays and restores the default layout. Panel and report
preferences are saved in the browser. Reloading the page starts a new simulation.

## Controls

| Control | Action |
|---|---|
| `W` / `S` or `↑` / `↓` | Move forward / backward |
| `A` / `D` or `←` / `→` | Turn |
| `Shift` | Run |
| `Space` | Sniff or rear |
| `X` | Select the next mouse |
| `O` | Toggle autopilot for the selected mouse |
| `P` | Pause or resume |
| `R` | Restart the session, after confirmation |
| `.` / `,` | Cycle through 1×, 2×, 4×, and 8× speed / return to 1× |
| `C` | Cycle through follow, orbit, top, and all-nine camera views |
| `J` | Open Nine cages |
| `K` | Open or close the tunnels |
| `B` | Open neural signals |
| `G` | Open optogenetics |
| `N` | Open health and survival |
| `Y` | Open the session report |
| `V` / `T` | Toggle the learned-value overlay / path trail |
| `M` | Rotate the cue card |
| `[` / `]` | Decrease / increase cage lighting |
| `-` / `=` | Lower / raise water level |
| `1`–`6` | Present a threat stimulus |
| `0` | Remove the odor source |
| `H` | Show or collapse the keyboard shortcuts popup |
| `?` | Open help |

Mice forage automatically. Selecting one changes which mouse you observe; movement
keys switch it to manual control. Click the floor to send it to a location, then
let it resume foraging. Click a pup to pick it up and click again to put it down.
Cage controls apply to the selected mouse's cage.

## Reports

Open **Tools → Session report**, or press `Y`. The report captures a snapshot;
it stays unchanged while the simulation continues. **Refresh snapshot** captures
the current state.

In **Report options**, you can:

- Set a report title.
- Choose overview, findings, images, charts, neural signals, cage comparison,
  mouse tables, detailed profiles, timeline, and reading notes.
- Include all mice, the observed mouse, or a custom selection in tables and profiles.
- Start with the **Summary**, **Visual**, or **Complete** preset.

The preview follows these choices. Detailed profiles are off by default to keep
reports shorter.

**Download PDF** can include platform and brain images, cage populations, mouse
condition charts, regional firing rates, and recorded LFP, dopamine, and learned-value
traces. Figures label their scope, units, and time windows. Signals and images belong
to the mouse observed at capture time; colony totals cover all cages.

**Markdown** and **Copy text** use the selected sections and describe the figures.
**Mouse CSV** exports the selected mice as rows. The event journal retains up to
900 events.

## The simulation

The cages form a 3×3 grid:

```text
no water       bright light    scarce food
all male       control         well provisioned
crowded        fox odor        intermittent noise
```

Each cage has its own animals and conditions. Opening the tunnels lets mice move
between cages. The model keeps a separate hippocampal map for each environment
and restores it when a mouse returns.

Each mouse has modeled populations across 38 brain regions. These include place,
grid, head-direction, sensory, motor, reward, and internal-state populations.
The Brain tab displays their activity and spatial tuning. Neural signals adds
spectra, band power, phase-amplitude coupling, inter-spike intervals, and comparison
with recorded firing-rate statistics.

The colony model includes mating, pregnancy, pup development and retrieval,
territorial fighting, injury, and mortality. One simulated day lasts five seconds.
Some processes use additional time compression, so their timing should be read as
part of the model.

Six threat controls are available:

| Key | Stimulus | Modeled response |
|---|---|---|
| `1` | Cat call | Freezing |
| `2` | Owl swoop | Flight toward a wall |
| `3` | Noise burst | Startle |
| `4` | Fox odor | Risk assessment and avoidance |
| `5` | Cat collar | Predator-odor response |
| `6` | Rotten smell | Avoidance |

The optogenetics panel lets you choose an opsin and brain region, apply light,
and inspect changes in activity and behavior. Implants are configured per mouse.
Region mappings and their references are in [src/optogenetics.js](src/optogenetics.js).

## Data and model limits

The project includes these datasets:

| File | Contents |
|---|---|
| [mouse_brain_ccf.json](data/mouse_brain_ccf.json) | Decimated Allen Mouse Brain CCFv3 anatomy meshes |
| [mouse_connectivity.json](data/mouse_connectivity.json) | Projection strengths from the Allen Mouse Brain Connectivity Atlas |
| [mouse_unit_metrics.json](data/mouse_unit_metrics.json) | Recorded firing-rate summaries from the Allen Neuropixels survey |
| [mouse_biometrics.json](data/mouse_biometrics.json) | Body dimensions and movement parameters |

Anatomy and recorded measurements provide inputs and comparisons. The activity,
behavior, and outcomes shown during a session are generated by the model. Neural
populations use analytic tuning curves and Poisson spiking, with simplified circuit
interactions and compressed timescales. This is a teaching project, not a validated
predictive model.

Region descriptions and references are in [src/neuro/regions.js](src/neuro/regions.js).
Physical parameters are documented in [src/world/mousedata.js](src/world/mousedata.js)
and [docs/biomechanics.md](docs/biomechanics.md).

## Project structure

| Path | Purpose |
|---|---|
| `index.html`, `styles/` | Page layout and interface styles |
| `src/main.js` | Simulation loop, input, and panel wiring |
| `src/neuro/` | Brain populations, region definitions, and signal analysis |
| `src/world/` | Cages, mouse bodies, movement, breeding, threats, and mortality |
| `src/view/` | Brain view, plots, sidebar, and floating windows |
| `src/report.js` | Report capture, preview, and exports |
| `src/reportoptions.js`, `src/reportvisuals.js` | Report choices and figure drawing |
| `src/pdf.js` | PDF writer |
| `src/optogenetics.js` | Opsins, implants, and stimulation controls |
| `data/`, `vendor/` | Bundled data and Three.js |

## Checks and deployment

With Node.js 22 or later, run the source and report checks from the project root:

```bash
node .github/scripts/check-imports.mjs
node .github/scripts/check-page.mjs
node .github/scripts/check-report.mjs
```

[CI](.github/workflows/ci.yml) also checks module syntax and JSON files, then runs
Playwright against the staged site at `/mylovely-mice/`. The browser checks cover
the simulation, panel controls, saved preferences, mobile layout, report choices,
and document downloads.

Pushes to `main` run [the Pages workflow](.github/workflows/deploy.yml). It publishes
only after the checks pass. To deploy a fork, set **Settings → Pages → Build and
deployment → Source** to **GitHub Actions**. A deployment can also be started from
the Actions tab.

The public site stays available when your computer is off. Each visitor's browser
runs its own simulation, which stops when the tab closes.
