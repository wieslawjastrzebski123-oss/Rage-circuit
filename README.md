# RAGE CIRCUIT

Arcade **combat racing in 3D, third-person view**, playable right in the browser.
Race three AI rivals through the sun-lit **Industrial District**: drift for boost, shoot in any direction,
drop mines, fire homing rockets, fire your car's ability – and survive 1 to 10 laps.

Solo mode is frontend-only. **Online multiplayer** (up to 5 players + bots) uses a small authoritative Node.js server.
No accounts, no database – records and settings live in your browser's `localStorage`.

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

## Multiplayer

- **MULTIPLAYER** in the main menu → nickname + server address → **CREATE ROOM** (you get a 4-letter code) or **JOIN** with a friend's code.
- Lobby: everyone picks a car and weapons and presses **READY**; the host picks the lap count and starts. The grid has 6 cars – empty slots are bots.
- The **server runs the whole race** (physics, weapons, damage, bots), so nobody can cheat by editing the page. Browsers only send key presses and mouse aim (60×/s) and receive the world state (30×/s).
- Your own car is **predicted locally** for instant response and silently corrected by the server; rivals are smoothly interpolated.
- A player who disconnects mid-race is replaced by a bot. The race closes 45 s after the first car finishes.

### Run the server locally

```bash
npm run server
```

Starts the game server on `ws://localhost:8787`. Open the game (`npm run dev`) in two browser windows and use that address.

`npx tsx scripts/prediction-test.ts` (with the server running) measures how well client prediction matches the server.

### Host the server online (Render.com, free plan)

1. Push the repo to GitHub.
2. On render.com: **New → Blueprint**, pick the repository – `render.yaml` + `Dockerfile` set everything up.
3. Copy the service address, e.g. `https://rage-circuit-server.onrender.com`, and use it as **`wss://rage-circuit-server.onrender.com`**.
4. Build the client with `VITE_SERVER_URL=wss://… npm run build` so the MULTIPLAYER screen pre-fills that address (players can still type another one).

Free Render services sleep when idle – the first connection after a break can take ~30–60 s.

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

### Phones and tablets

Touch devices get on-screen controls automatically (play in landscape – the game asks you to rotate the phone):

| Control | Action |
|---|---|
| Left thumb (anywhere on the left half) | Floating stick – slide sideways to steer, push up to boost |
| — | The car accelerates by itself |
| BRAKE | Brake; hold to reverse |
| DRIFT / BOOST | Same as SPACE / E |
| FIRE / ALT / SKILL | Primary weapon / secondary weapon / car ability – aiming is automatic (nearest rival ahead); the primary also fires by itself when a rival is close ahead |
| ↺ / II | Reset to checkpoint / pause |

The thumb can slide from one button to another without lifting. Phones start on the LOW graphics setting.
Add `?touch=true` to the URL to try the touch controls on a desktop.

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

## Deploy (own server)

`scripts/deploy-server.sh` copies the project to an Ubuntu server, builds it and installs the game server (systemd) and nginx:

```bash
SSH_KEY=/path/to/key ./scripts/deploy-server.sh ubuntu@SERVER_IP
```

nginx serves the game from `/opt/rage-circuit/dist` and forwards `/ws` to the game server, so the MULTIPLAYER screen connects to the same address automatically.
The Vite `base` is `./` (relative paths), so the static build also works from any sub-path.

## Project structure

```
server/                   multiplayer server: index.ts (WebSocket + rooms), Room.ts (lobby), ServerRace.ts (authoritative race)
src/
  main.ts                 entry point
  style.css               menus + HUD styling
  game/
    App.ts                screen flow (menu → garage → race → results) and render loop
    constants.ts          laps, respawn timings, debug flag
    render/               Three.js: renderer, sky & sun, chase camera, car models, particles, textures
    scenes/               MenuScreen, GarageScreen, RaceSession, ResultsScreen, OnlineScreen (connect + lobby), NetRaceSession
    net/                  protocol shared by client and server, NetClient (WebSocket)
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

- Single map.
- Multiplayer needs the Node server hosted somewhere (a static host alone can only serve the client).
- No matchmaking or public room list – you join with a room code.
- Online: collisions with other cars are resolved by the server, so bumping a rival can cause a small visible correction.
- No gamepad support.
- Physics is intentionally arcade 2D (no jumps, ramps or real suspension; body roll/pitch are visual).
- Bots don't use pickups on purpose and have simple, readable tactics.
- Graphics are procedural low-poly; no imported models or textures.
- Fonts load from Google Fonts – offline the game falls back to system fonts.
- The camera can briefly get close to buildings at the tightest corners.
