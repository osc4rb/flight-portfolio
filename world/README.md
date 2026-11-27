# world/ — the 3D island (v5)

Open `world/index.html` through a local server, for example `python -m http.server 8766` in `flight-portfolio`,
then go to http://localhost:8766/world/. Add `?debug=1` to get `window.game`.

## What it is
You start on foot. Walk to the yellow truck and press **E** to drive. At the airstrip, walk to the jet and press **E**
to fly. Five people around the island hold the five parts of the résumé (`site.js` → `home.sections`); press **E**
next to one to read it. Coins are for fun. R respawns, Esc or E closes a panel.

## Engine: Bruno Simon's folio-2025 (MIT)
`engine/` holds files from https://github.com/brunosimon/folio-2025 (`sources/Game/`), licence in
`engine/LICENSE-folio-2025.md`. They run without a build: `index.html` has an import map that points every package
they import at jsDelivr:
- three 0.187: `three/webgpu`, `three/tsl` and the addons
- gsap, camera-controls, seedrandom, normalize-wheel
- Rapier 0.19.3 compat

Copied as-is: Events, Ticker, Time, Viewport, Objects, View, Rendering, Player, Physics/Physics,
Physics/PhysicsVehicle, Inputs/* (keyboard, gamepad, pointer, wheel, touch nipple, interactive buttons),
Passes/cheapDOF, utilities, threejs-override.

Changed (each marked `[world patch]` in the code):
- `Game.js` is ours. It has the same name so his imports resolve. It boots the engine in his order and stubs the
  systems we did not port: audio, achievements, tracks, weather, water and the rest.
- `Player.js`: drives only when `game.mode === 'drive'`, and only then moves the camera and touch joystick.
- `View.js`: the focus point follows height too, and `game.cameraOverride` lets the jet's chase camera take over.
  The radius cap is 42 m, not his 30, because our jet and runway are about four times his car.
- `Ticker.js`: delta is never negative, and a zero-length frame is skipped. Either one panics Rapier.
- `Materials/MeshDefaultMaterial.js`: his shading model, copied. Patches: the water band is off by default,
  `flipBackNormals` lets grass keep an up normal on both sides, and emissive is added for the hover glow. The reveal
  is on, as in his (it was off until 2026-11-25).
- `Materials/MeshGridMaterial.js`: his grid material, copied unchanged (the dark grid around the opening disc).

Not used from his repo: his world (`World/`, all `Areas`), his server and multiplayer, BlackFriday, and anything in
`static/` (models, textures, sounds, fonts). Those are not cleared for reuse. The full download of his sources is
kept read-only in `../vendor/folio-2025/` for reference.

## Ours (`game/`)
- `Reveal.js`: the opening, ported from his `Reveal.js`, `World/Intro.js` and `World/Grid.js`. A blue ring closes as
  the loader fades and shrinks away. A 7 m disc (his is 3.5 m) holding the robot, the desk and the jet's cockpit then opens on a dark blue grid, with a "Click to start"
  label (words in `site.js` → `world.intro`). A click, a tap, Enter, Space, W or ↑ sweeps the glowing edge out to 45 m
  (back.in, 2 s); then everything shows. His timing and eases are kept. The sound is synthesized (`Sound.reveal()`).
  - Every MeshDefaultMaterial cuts at the reveal distance with his glowing band. Other materials get `maskNode`, and
    MeshDefaultMaterials get `maskShadowNode`, so hidden things cast no shadow into the disc.
  - The HUD (`.game.intro`), the quests and the Juice hover all wait for `game.reveal.then()`.
  - The input filter is `intro` until the sweep starts, and `wandering` 150 ms later, so Enter does not also board
    the jet.
  - `?skip=1` or `#skip` opens the world at once.
  - The camera follows his zoom: 0.6 → 0.3 while the disc waits, then out to 0 (the 42 m cap) for play.
- `Places.js`: wayfinding. A floating label (the stations' sprite style) over the computer, the jet, the truck, the
  race start and the blimp, hidden during the opening. An arrow at the screen's edge points to what the current quest
  needs (`site.js` → `world.quests[i].at`; "people" means the nearest one not met yet).
- `Map.js` (class `IslandMap`): M or the Map button. The island is drawn once on a canvas from our own `height()`,
  roads, runway, houses and the lap's gates, turned 45° so up on the map is up on screen. Each pin is a place, and a
  click travels there (a wipe, then you stand beside it); in flight the pins are off. After his `Map.js` (a painted
  map there). Sound moved from M to N.
- `Stage.js`: the island built in code:
  - terrain mesh plus a Rapier heightfield on the same grid
  - sea, roads, runway and trees
  - houses that fade when they hide you from the camera
  - knock-over bricks, coins and clouds
  - respawns
- `Walker.js`: the person: a Rapier kinematic character controller with walk, run and jump animations.
  - Its face is the owner's GitHub avatar (`site.js` → `avatar`) on a framed, unlit plane on the robot's torso.
  - It loads from `avatars.githubusercontent.com/<login>`, because `github.com/<login>.png` redirects without CORS
    headers.
  - After 1.2 s standing still, the robot turns to face the camera.
- `CarVisual.js`: our Blender pickup on his `PhysicsVehicle` chassis, after his `World/VisualVehicle.js`. It starts in the
  opening disc beside the jet (`Stage.js` → `START_TRUCK`, the first respawn).
  - The wheels spin, steer and ride their own suspension; they hang down in the air.
  - The blinkers blink while you steer, the stop lights light when you brake and the reverse lights when you back up.
  - Boost draws two glowing trails from the back corners (his `Trails.js`).
  - Ours: headlights with beams and a pool of light on the ground, and a roof light bar. All of them glow at night
    (Look's `nightUniform`).
- `Explosions.js`: his `Explosions.js`, `World/Fireballs.js` and `World/ExplosiveCrates.js`. Twenty crates in seven
  spots (`SPOTS`), light sleeping Rapier boxes; a hit sets one off (a click, then the boom 0.4 s later). The fireball
  throws every dynamic body in range, kicks the camera roll and bends the trees; his noise texture is replaced by
  three's `mx_noise_float`. The jet and the robot set crates off by distance, and a jet crash is a fireball too. A
  crate comes back 30 s later once you are 25 m away.
- `Tracks.js`: his `Tracks.js` and `Trails.js`. Every wheel leaves a track in a 40 m render target that follows you; the
  grass shortens and the ground darkens there. Ours follows the player's height, since the island has hills.
- `Jet.js`: the F-35/F-47 from `../planes.js` with arcade flight: takeoff, landing, crash, bail out, and a chase
  camera.
  - its FOV opens from 46° to 56° with speed and kicks to about 68° on the afterburner, then goes back to his 25°
    when you land
  - 70 speed lines fixed in the world ahead of the camera, so they stream past
  - a two-cone afterburner flame
  - a thump, shake and roll kick when the afterburner lights
  - a crash on rock, and a whoosh with a little shake on a close pass
- `Course.js`: the flight course, our take on his `CircuitArea` (checkpoints in order, a timer, a best time):
  - about 45 rock peaks in the sea around the island, plus three sea arches (half-tori) and a ridge with a lit
    tunnel bore (an extruded profile with a hole), all built in code with noise and painted moss, rock and snow
  - nine gates make a lap that starts and ends over the runway: the next gate is yellow, the one after half white
  - an on-screen marker, or an edge arrow, points to the next gate
  - the lap time and the best time (kept in localStorage on this device)
  - the rock is collision-checked with distance functions (cone, torus, slab with a bore), not Rapier
  - Look leans the rock's normals halfway toward up (`userData.softUp`), so whole mountainsides don't fall into
    core shadow
  - the start area, after his circuit:
    - a light gantry over the start gate: its three lamps turn red one by one as you close in (beeps), and all
      green as the lap starts
    - a podium, and a board of the three fastest laps on this device (canvas texture)
    - 20 fluttering chequered and yellow banners down the runway
    - the gantry posts are solid for the jet (capsules) and for the truck (Rapier)
    - the podium ceremony: land and stop after a lap
      - a wipe, then the pilot stands on the top step
      - the camera swings on the grass side for 4.8 s, with confetti and the fastest lap
      - another wipe leaves you on foot beside the podium
- `Achievements.js`: 17 small goals, after his achievements, kept in localStorage.
  - flight: take off, a full lap, a lap under 25 s, the tunnel, all three arches, a close call, a landing, a
    splashdown
  - the world: the desk, all five people, every coin, knocking over a letter
  - the podium ceremony, the blimp, the secret ring
  - truck flips and the horn, reported by his `Player` through the same `setProgress` and `addProgress` API
  - the HUD shows a ★ count, a list, and a slide-in when one unlocks
- `Sky.js`: flight versions of two of his jokes.
  - Social: a blimp circles the island at 58 m towing a banner with the first contact link. Flying within 26 m
    of it, or clicking it from the ground, pops the `site.js` contact links up in the HUD.
  - Easter egg: a small gold ring spins over the tallest peak; flying through it throws confetti.
  - His Cookie and Toilet areas have no flight version that makes sense, so they are left out.
- `Quests.js`: seven steps told as messages from Oscar in a Messenger-style thread at the top left.
  - It shows his GitHub avatar, a typing indicator, then each message.
  - A tick marks a done step, and the next message follows.
  - The words are in `site.js` → `world`. Each step ends when its achievement unlocks, and steps already done are
    skipped.
- `Letters.js`: the name from `site.js` in 3 m block letters by the airstrip, after his LandingArea letters. It uses
  our own 5×7 block font. Each letter is a sleeping Rapier body with one cuboid per run of blocks, so the truck or
  the walker can knock it over.
- `Desk.js`: the computer inside the computer, by the airstrip. A desk and monitor built from boxes, with a
  canvas picture of the résumé on the screen. E or a click glides the camera into the screen over 1.3 s (ease
  in-out, solved so the screen fills the view). Then the real page, `../index.html?plain=1`, fades in. It sits
  in an iframe that three's `CSS3DRenderer` lays exactly on the screen plane. Esc or the HUD button glides back.
  Viewports narrower than 700 px open the page instead. The technique follows Henry Heffernan's
  portfolio-website (github.com/henryjeff/portfolio-website, MIT, © Henry Heffernan): a CSS3D iframe on a
  monitor plane and a camera move into it. No code or assets were copied.
- `Room.js`: the cabin by the start disc, the room under the island, and the doors to the other sites.
  - Walk up to a door and a sign slides up from the bottom: a tab ("Door 1"), the name and a "Go in" button, E or
    Enter. Its structure follows husam.world's exit sign, measured from his CSS (a tab over a framed panel, a
    key-capped button, a spring in from below); the colours and type are ours. A circle in the door's colour grows
    from the door with the name, his wipe's idea, then the callback runs.
  - The cabin's door leads to the room, `room.glb` 400 m under the start disc, so it never shows from the island. A
    fixed orbit camera looks in over the open corner; drag nudges it, the wheel zooms a little. Look keeps one
    daylight and a dark background there; the shadows follow the room.
  - The computer, board, shelf and phone glow under the pointer with a one-word label. A click dives the camera in
    and opens a panel: Projects (`home.projects`), Papers (the `home` items listed in `world.room.papers`) and
    Contact (`contact`). On wide screens the panel docks right and the thing sits in the left half. The computer
    reuses `Desk.js` (`use({ screen, scale, back })`), so the live CV lies on the room's screen.
  - The other doors set `location.href` to Falcon Bullets, the coaching matcher and the CS-37 site. Words:
    `site.js` → `world.doors`, `world.room`.
- `Stations.js`: the five résumé people, labels, rings, and coin pickup.
- `Modes.js`: on foot, driving or flying. What E does, getting in and out, locking input while a panel is open.
- `Hud.js`: "Just the CV" (top right, opens `../index.html`), sound toggle, controls, the E prompt, the speech bubble, résumé panels, toasts, flight
  readout, the lap readout, the back-from-the-desk button, diagonal wipe. All with springy CSS (overshoot easing) and respecting reduced motion.
- `Sound.js`: every sound is synthesized with WebAudio, so there are no files to license. One-shots: steps, jump,
  land, coin with a rising streak, talk blips with one voice per person, pops, hits, brick clonks, honk (H), chime,
  boom, gate notes rising through the lap, afterburner, start-light beeps. Loops: truck engine, jet engine, wind. M or the button mutes; the choice stays in localStorage.
- `Juice.js`:
  - a damped `Spring` for squash and stretch
  - pooled particles: dust, landing rings, leaves, glowing sparkles, confetti
  - camera shake (trauma²), applied right after View places the camera
  - wobblers: trees sway and drop leaves, houses squash when bumped by the truck or the walker
  - hover glow on people, the truck and the jet; a click walks you there and does the E action
- `Look.js`: a port of his `Ligthing.js`, `Fog.js`, `Cycles/DayCycles.js` and the terrain colour node, with our
  own four presets (day, dusk, night, dawn; an 8-minute day, `?time=0..1` pins it). It swaps every material in the
  scene for MeshDefaultMaterial:
  - lit colour × light colour
  - core shadow plus drop shadows blended toward a tinted shadow colour
  - light bounced up from the ground colour
  - a screen-gradient fog that is also the sky

  A house that hides you opens a dithered hole around you on screen. The ground colours live in
  `Stage.js` → `PALETTE`. Also in Look:
  - ground meshes (terrain, roads, plaza, runway) shade with an up normal, like his floor: drop shadows only, no
    core shadow
  - roads and the plaza are procedural stone slabs
  - every converted material has his white waterline where it crosses the sea (`hasWater`, not on the ground)
  - tree crowns thin out around the player on screen, as in his foliage
- `Water.js`: his `Water.js` and `World/WaterSurface.js`. His details mask (the shore edge, and ripple rings rolling in
  toward the beach) decides where the surface shows; everywhere else you look through it at a hash-blurred copy of the
  seabed (`viewportSharedTexture`, quality 0 only). The depth comes from the terrain height in the grass map, his
  noise textures are `mx_noise_float`, and the seabed is coloured by depth in `Stage.setTerrain`. Ours: the surf is a
  pale sea colour, what you see through the water is tinted toward the sea, and past the terrain's edge the surface
  is the deep sea's colour. His ice and rain splashes need his weather, which we don't have.
- `Foliage.js`: a port of his `World/Foliage.js`. Tree crowns are three blobs of leaf cards with normals bent to
  the blob's sphere, a canvas-drawn leaf-cluster alpha, wind-turned cut-outs, and a lit/shadow side mix.
- `Ambience.js` (ideas from his WindLines, Leaves, Flowers and PoleLights; the code is ours):
  - six white wind streaks that sweep past near the camera and sometimes curl
  - a leaf drifting down from a tree near you every half second or so
  - 900 flower clusters in meadow patches
  - 29 lamp posts along the paths and by each station; their heads glow at night (`look.nightUniform`, bright
    enough for bloom)
- `Grass.js`: about 42k blades (14k on low quality) wrapped around the camera focus in a TSL vertex shader. They
  sway in the wind and bend away from the walker or the truck. Terrain height and a grass mask (roads, plaza,
  runway, sand, water and house floors are bare) are baked at load into a 384² half-float texture, in about 90 ms.
  The idea follows folio-2025's grass; the code is ours. Like his, a blade takes the ground's colour, with its root
  in the shadow colour.
- People (`Stations.js`) turn to face you inside 9 m, hop, and type their lines from `site.js` (`home.sections[i].say`)
  in a speech bubble. The first read throws confetti. Coins pop up, spin and shrink, with sparkles.

## Art
Kenney starter kits on GitHub, CC0. They are loaded at runtime from jsDelivr at pinned commits:
- Starter-Kit-Racing `2f2e5f2` (trucks, tents)
- Starter-Kit-City-Builder `4535092` (garage, fountain)
- Starter-Kit-3D-Platformer `3fa8a04` (character, coin, brick, flag, cloud)

KayKit City Builder Bits 1.0 by Kay Lousberg (www.kaylousberg.com), CC0, loaded from
`github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0` at commit `6397691` through jsDelivr (about 1 MB):
- the eight town buildings, scaled by height to 8–10.5 m
- benches, hydrants, bins, a dumpster, the water tower and four parked cars

The leaf-card bushes (`Foliage.js` → `bushGeometry`) are ours.

Our own models, in `world/models/`, were built in Blender 4.5 LTS by `tools/blender-scripts/bake_models.py`, all
from primitives in code. Ambient occlusion is baked by Cycles into each model's vertex colours, and `Look.js`
multiplies it in.
- `desk.glb` (1.0 MB): the desk, a drawer unit, the monitor with a `Screen` plane (1.6 × 0.9), a keyboard with
  keys, a mouse, a mug, a lamp, a plant and a chair
- `fountain.glb` (0.4 MB): a stone basin with two tiers of bowls
- `crate.glb` (0.2 MB): the explosive crate for `Explosions.js`, one mesh named `Crate`
- `truck.glb` (1.1 MB): a lifted pickup in metres, with nodes `wheel-front-left` and so on, `headlight`, `lightbar`,
  `taillight`, `reverse`, `blinker-left` and `blinker-right` for `CarVisual`
- `jet.glb` (0.7 MB): our jet, built in the jet's own metres on the `planes.js` airframe's envelope. It loads at
  scale 1, so flight and the collider are unchanged; `planes.js` is the fallback.
- `garage.glb` (1.3 MB): a ribbed Quonset hangar with half-open doors, hazard stripes, an office annex, crates and a
  workbench. It sits at 1:1, its doors at the runway's edge.
- `room.glb` (1.5 MB): the room: a plank floor, two walls, a window, a desk with the computer (`Computer` and a
  `Screen` plane like the desk's), a corkboard (`Board` and `BoardFace`, which Room.js draws the projects on), a
  bookshelf (`Shelf`), a side table with a phone (`Phone`), a rug, a beanbag, a floor lamp, a chest and a plant
- `cabin.glb` (1.0 MB): a log cabin with a gable roof, a chimney, lit windows and a `Door`
- `doorway.glb` (0.1 MB): a free-standing door frame on a step, the door ajar; Room.js tints `Panel` per site
- `arch.glb` (1.3 MB): a unit sea arch (radius 1, tube 0.2, legs thickened like `Course.js`'s collision shape),
  painted rock and moss, scaled to each arch

They replace Kenney's fountain, truck and garage, and the `planes.js` jet. The desk and the arches fall back to the code-built versions if a
file is missing.

Nothing is downloaded into the repo. Trees, roads, terrain, the jets, the course rock and the desk are built in code.
