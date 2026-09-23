# RAGE CIRCUIT

Arcade **combat racing in 3D, third-person view**, playable right in the browser.
Race three AI rivals through the sun-lit **Industrial District**: drift for boost, shoot in any direction,
drop mines, fire homing rockets, fire your car's ability – and survive 1 to 10 laps.

Frontend-only: no backend, no accounts, no database. Records and settings live in your browser's `localStorage`.

## Features

- **Third-person 3D chase camera** (Three.js) – follows your car, looks into drifts, widens with speed and boost, never clips behind walls.
- **Arcade driving model** – momentum, slight slide at speed, speed loss on hard hits.
- **Drift → boost** – hold SPACE in a corner, charge 4 levels (blue → yellow → orange → pink), release for a boost. Hitting a wall loses the charge.
- **Boost meter** (E) – filled by drifting, kills and pickups.
- **Energy** powers weapons and abilities and regenerates faster the faster you drive – camping doesn't pay.
- **4 cars**, each with a real strength and weakness and its own ability:
  | Car | Style | Ability |
  |---|---|---|
  | VIPER | fastest, fragile | OVERCHARGE – 3 s of faster, harder-hitting, free primary fire |
  | RHINO | tank, heaviest | SHIELD – blocks 80 % damage for 2.2 s |
  | SPECTRE | best handling | BLINK – dash forward, cannot pass walls |
  | VOLT | balanced control | EMP – jams nearby enemies' weapons, abilities and boost |
- **4 weapons** – Machine Gun / Cannon (primary), homing Rocket / proximity Mine (secondary).
- **Weapons unlock during the race** – primary 7 s after GO, secondary on lap 2, car ability on lap 3 (after 25 s / 50 s in 1–2 lap races; same rules for bots).
- **Balanced cars** – tuned with batches of bot-only races using identical AI and weapons so every car wins races.
- **3 AI bots** with personalities (aggressive / balanced / racer): racing line, braking, drifting, overtaking, obstacle avoidance, shortcut use, imperfect aim, ability use.
- **Race systems** – ordered checkpoints (no cutting), selectable race length (1 / 3 / 5 / 7 / 10 laps, records kept per length), live positions, WRONG WAY detection, respawn at last checkpoint with ghost mode, R-reset with 2 s penalty, very gentle rubber banding, kill rewards.
- **Risk/reward shortcut**, explosive barrels, pushable barrels, pickups (energy / boost / repair).
- **Game feel** – camera shake, hit-stop, hit flash, damage numbers, sparks, smoke, skid marks, explosions with light flashes, boost flames.
- **Realistic daytime look** – physically based sky, sun with real-time shadows, clear-coated car paint, concrete barriers with painted corners, tyre walls, catch fences, grandstand, sponsor boards, trees, smoking chimneys, cranes and hills on the horizon.
- **Synthesised audio** (WebAudio) – engine with gear changes, weapons, explosions, tyre screech. No audio files.
- **Menus** – title, how-to-play, settings (master / SFX volume, camera shake, graphics quality), car select, loadout, results, pause.
- **Local records** – best race time, best lap, wins.
- **Debug mode** – add `?debug=true` to the URL: FPS, AI routes & targets, checkpoints, collision shapes, per-car stats.

## Controls

| Key | Action |
|---|---|
| W / S | Throttle / brake & reverse |
| A / D | Steer |
| SPACE | Drift (while fast and turning) – release for boost |
| E | Boost (uses Boost meter) |
| Mouse | Aim. Cursor high on screen = ahead, at the sides = sideways, near the bottom = behind you |
| Left mouse | Primary weapon |
| Right mouse / Q | Secondary weapon |
| SHIFT | Car ability |
| R | Reset to last checkpoint (2 s penalty) |
| ESC / P | Pause |

Designed for desktop with keyboard + mouse.

## Tech stack

- TypeScript
- [Three.js](https://threejs.org/) – 3D rendering, sky, shadows, PBR materials
- Vite – dev server and static build
- Plain HTML/CSS for menus and HUD
- WebAudio for procedural sound
- `localStorage` for records and settings

> The original spec asked for Phaser 3. The game was first built top-down in Phaser (still available as the git tag `topdown-mvp`),
> then switched to Three.js because a true third-person camera needs a 3D engine. All gameplay code (physics, AI, combat, race logic) was kept.

## Local development

```bash
npm install
npm run dev
```

Open the URL Vite prints (e.g. `http://localhost:5173`).

## Build

```bash
npm run build
```

Type-checks the project and writes a static site to `dist/`. Preview it with `npm run preview`.

## Deploy (GitHub Pages)

1. Push the repository to GitHub (branch `main`).
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml` (checkout → Node 20 → `npm ci` → `npm run build` → deploy `dist`).

The Vite `base` is set to `./` (relative paths), so the site works from any sub-path such as
`https://username.github.io/rage-circuit/` without changes.

## Project structure

```
src/
  main.ts                 entry point
  style.css               menus + HUD styling
  game/
    App.ts                screen flow (menu → garage → race → results) and render loop
    constants.ts          laps, respawn timings, debug flag
    render/               Three.js: renderer, sky & sun, chase camera, car models, particles, textures
    scenes/               MenuScreen, GarageScreen, RaceSession, ResultsScreen, car previews
    entities/             Car, PlayerCar, AICar, Projectile, Mine, Barrel
    weapons/              Weapon base + MachineGun, Cannon, RocketLauncher, MineLayer
    abilities/            Ability base + Nitro, Shield, Blink, EMP
    systems/              RaceManager, CheckpointManager, CombatSystem, CollisionSystem,
                          RespawnSystem, InputManager, PickupSystem, Effects, AudioManager
    ai/                   RacingAI, CombatAI, personalities
    track/                TrackData (layout), Track (geometry, queries, AI routes), TrackView (3D)
    ui/                   HUD, debug overlay, DOM helpers
    data/                 cars, weapons
    utils/                math, localStorage
```

The simulation runs on a flat 2D plane (x, y); the 3D view maps it to (x, height, y).
That keeps physics, collisions and AI simple and fast while the camera is fully 3D.

## Known limitations

- Single map and single-player only (no multiplayer).
- Desktop only – no touch or gamepad controls.
- Physics is intentionally arcade 2D (no jumps, ramps or real suspension; body roll/pitch are visual).
- Bots don't use pickups on purpose and have simple, readable tactics.
- Graphics are procedural low-poly; no imported models or textures.
- Fonts load from Google Fonts – offline the game falls back to system fonts.
- The camera can briefly get close to buildings at the tightest corners.
