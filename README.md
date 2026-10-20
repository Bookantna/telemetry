<img src="assets/icon.svg" width="64" height="64" alt="">

# F1 25 Telemetry

A personal telemetry app for F1 25 on PC. A small program on your PC receives the game's telemetry, saves every lap, and streams a **Live Dashboard** to your iPad beside the wheel:

- **Delta** to your Reference Lap as the biggest number, with a predicted lap time
- **Track Map** drawn from your own driving, with this lap's Driving Line over the Reference Lap's line, every car, and a close-up that follows you through corners
- **Input Trace**: throttle and brake over the last 5 seconds, to work on your trail braking
- Sector times against your Best Lap (Time Trial, practice, qualifying) or race order and gaps (races)
- Tyre temperatures, pressures and wear, brake temperatures, fuel, ERS and damage

The words used here (Recorded Lap, Reference Lap, Best Lap…) are defined in [CONTEXT.md](CONTEXT.md). Design decisions are in [docs/adr](docs/adr).

## Start it

You need [Node.js 24](https://nodejs.org) or newer.

```sh
npm install
npm start
```

`npm start` builds the dashboard and starts the app. It prints the address to open on your iPad, for example `http://192.168.1.132:8025`. The first time, Windows asks whether Node.js may use the network: allow it on **private networks**, or the iPad cannot connect.

### In F1 25

Settings → Telemetry Settings:

| Setting | Value |
| --- | --- |
| UDP Telemetry | On |
| UDP Broadcast Mode | Off |
| UDP IP Address | 127.0.0.1 |
| UDP Port | 20777 |
| UDP Send Rate | 60 Hz |
| UDP Format | 2025, or 2026 when you drive with the 2026 Season Pack |

### On the iPad

Open the printed address in Safari, then Share → **Add to Home Screen**. Opened from the Home Screen, the dashboard fills the whole screen. A web page cannot keep the screen awake on a local address, so set Settings → Display & Brightness → Auto-Lock to **Never** while you race (see [ADR 0001](docs/adr/0001-pc-node-program-with-browser-dashboard.md)).

The dashboard also works on a phone (a reduced layout: Delta, Input Trace and tyres) and on a PC monitor.

## Recorded Laps

Every lap is saved in `data/telemetry.db`, labelled valid or invalid, complete or incomplete, out-lap or in-lap. Tap the list icon at the top right of the dashboard to see them all; delete a lap with two taps.

Tap a lap to open **Lap Replay**: the car drives the lap again on the Track Map with your throttle and brake below it, at 0.25× to 4× speed. Drag the bar to jump to any corner. On the PC, Space plays and pauses and ← → jump a second.

A **Best Lap** is kept separately for each combination of circuit, Car Generation (2025 or 2026 cars), Session Type and Conditions (dry or wet, decided by your tyres). In Time Trial, Delta compares against your all-time Best Lap. In practice, qualifying and races, it compares against your fastest valid lap of that session.

The **Track Map** for a circuit is drawn from your first full lap there. Use the buttons on the map to rotate or mirror it; the iPad remembers this per circuit.

## Using SimHub or another app at the same time

Only one app on the PC can listen on the game's port. Let this app receive the data and pass a copy on:

```sh
npm run serve -- --forward 127.0.0.1:20778
```

Then set the other app to listen on port 20778. Several `--forward` targets are allowed.

## Options

| Option | Default | |
| --- | --- | --- |
| `--udp-port` | 20777 | Must match the game's UDP Port |
| `--http-port` | 8025 | The dashboard's port |
| `--forward host:port` | none | Forwarding target, repeatable |
| `--db path` | `data/telemetry.db` | Where laps are saved |

Pass them after `--`, for example `npm run serve -- --http-port 9000`. `npm run serve` starts the app without rebuilding the dashboard.

## Try it without the game

A demo feed sends real F1 25 packets for a car lapping a made-up circuit, including invalid laps and a Flashback. Use a separate database so demo laps stay out of your own:

```sh
npm run serve -- --db data/demo.db
npm run demo                       # in a second terminal: Time Trial
npm run demo -- --mode race        # a 20-car race
npm run demo -- --format 2026      # the 2026 Season Pack format
npm run demo -- --speed 4          # four times real speed
```

## Development

```sh
npm test            # packet layouts, lap recording, Reference Lap and Delta
npm run typecheck
npm run dev:server  # restarts the PC program on changes
npm run dev:web     # dashboard with hot reload on http://localhost:5173
```

The packet decoder follows the F1 25 UDP specification (format 2025) and the 2026 Season Pack specification (format 2026). Every packet must match the size the specification states, or it is dropped.
